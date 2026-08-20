import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  serverTimestamp,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions, isFirebaseConfigured } from '../firebase/config';
import {
  ProblemStatement,
  TeamProblemAssignment,
  ProblemDistributionPreviewGroup,
  ProblemDistributionDraft,
  Team,
} from '../types';
import dayjs from 'dayjs';

/**
 * Subscribes to all Problem Statements (Admin)
 */
export function subscribeToProblemStatements(callback: (statements: ProblemStatement[]) => void): () => void {
  const q = query(collection(db, 'problemStatements'), orderBy('order', 'asc'));
  return onSnapshot(
    q,
    (snapshot) => {
      const list: ProblemStatement[] = [];
      snapshot.forEach((d) => list.push({ statementId: d.id, ...d.data() } as ProblemStatement));
      callback(list);
    },
    (err) => {
      console.error('[ProblemsService] subscribeToProblemStatements error:', err);
      // Fallback un-ordered query if index is building
      getDocs(collection(db, 'problemStatements')).then((snap) => {
        const list: ProblemStatement[] = [];
        snap.forEach((d) => list.push({ statementId: d.id, ...d.data() } as ProblemStatement));
        callback(list);
      }).catch(() => callback([]));
    }
  );
}

/**
 * Subscribes to a Team's assigned problem statement (Team Portal)
 */
export function subscribeToTeamAssignment(
  teamId: string,
  callback: (assignment: TeamProblemAssignment | null) => void
): () => void {
  const assignmentRef = doc(db, 'teamProblemAssignments', teamId);
  return onSnapshot(
    assignmentRef,
    (snap) => {
      if (snap.exists()) {
        callback(snap.data() as TeamProblemAssignment);
      } else {
        callback(null);
      }
    },
    (err) => {
      console.warn('[ProblemsService] subscribeToTeamAssignment error:', err);
      callback(null);
    }
  );
}

/**
 * Subscribes to problem distribution draft / state
 */
export function subscribeToDistributionState(
  callback: (draft: ProblemDistributionDraft | null) => void
): () => void {
  const draftRef = doc(db, 'settings', 'problemDistributionDraft');
  return onSnapshot(
    draftRef,
    (snap) => {
      if (snap.exists()) {
        callback(snap.data() as ProblemDistributionDraft);
      } else {
        callback(null);
      }
    },
    (err) => {
      console.warn('[ProblemsService] subscribeToDistributionState error:', err);
      callback(null);
    }
  );
}

/**
 * Generates sequential distribution draft from live Firestore teams and problem statements
 */
export async function generateDistribution(): Promise<ProblemDistributionDraft> {
  // 1. Try Cloud Function
  try {
    const fn = httpsCallable<any, any>(functions, 'generateProblemDistribution');
    const res = await fn({});
    if (res.data?.success || res.data?.mapping) {
      return res.data;
    }
  } catch (err) {
    console.warn('[ProblemsService] Cloud Function distribution fallback to Firestore:', err);
  }

  // 2. Direct Firestore sequential calculation
  const [teamsSnap, psSnap] = await Promise.all([
    getDocs(collection(db, 'teams')),
    getDocs(collection(db, 'problemStatements')),
  ]);

  const activeTeams: Team[] = [];
  teamsSnap.forEach((d) => {
    const t = d.data() as Team;
    if (t.status !== 'disabled') activeTeams.push(t);
  });
  activeTeams.sort((a, b) => a.teamId.localeCompare(b.teamId));

  const activeStatements: ProblemStatement[] = [];
  psSnap.forEach((d) => {
    const p = { statementId: d.id, ...d.data() } as ProblemStatement;
    if (p.status !== 'disabled') activeStatements.push(p);
  });
  activeStatements.sort((a, b) => (a.order || 0) - (b.order || 0) || a.statementId.localeCompare(b.statementId));

  const N = activeTeams.length;
  const M = activeStatements.length;

  if (N === 0 || M === 0) {
    const emptyDraft: ProblemDistributionDraft = {
      status: 'DRAFT',
      totalTeams: N,
      totalStatements: M,
      mapping: [],
      generatedAt: dayjs().toISOString(),
    };
    await setDoc(doc(db, 'settings', 'problemDistributionDraft'), emptyDraft, { merge: true });
    return emptyDraft;
  }

  const mapping: ProblemDistributionPreviewGroup[] = [];
  const baseCount = Math.floor(N / M);
  const remainder = N % M;
  let currentTeamIdx = 0;

  for (let i = 0; i < M; i++) {
    const ps = activeStatements[i];
    const countForThisPS = baseCount + (i < remainder ? 1 : 0);
    const assignedTeamsForPS: Array<{ teamId: string; teamName: string; leaderName: string }> = [];

    for (let c = 0; c < countForThisPS && currentTeamIdx < N; c++) {
      const team = activeTeams[currentTeamIdx];
      assignedTeamsForPS.push({
        teamId: team.teamId,
        teamName: team.teamName || team.teamId,
        leaderName: team.leaderName || '',
      });
      currentTeamIdx++;
    }

    mapping.push({
      statementId: ps.statementId,
      statementTitle: ps.title,
      description: ps.description,
      instructions: ps.instructions || [],
      assignedTeams: assignedTeamsForPS,
    });
  }

  const draft: ProblemDistributionDraft = {
    status: 'DRAFT',
    totalTeams: N,
    totalStatements: M,
    mapping,
    generatedAt: dayjs().toISOString(),
  };

  await setDoc(doc(db, 'settings', 'problemDistributionDraft'), draft, { merge: true });
  return draft;
}

/**
 * Publishes distribution to all teams in Firestore
 */
export async function publishDistribution(): Promise<void> {
  try {
    const fn = httpsCallable(functions, 'publishProblemDistribution');
    await fn({});
    return;
  } catch (err) {
    console.warn('[ProblemsService] Cloud Function publish fallback to Firestore:', err);
  }

  const draftRef = doc(db, 'settings', 'problemDistributionDraft');
  const snap = await getDoc(draftRef);
  if (!snap.exists()) throw new Error('No problem distribution draft found. Generate distribution first.');

  const draft = snap.data() as ProblemDistributionDraft;
  const now = dayjs().toISOString();

  for (const group of draft.mapping) {
    for (const team of group.assignedTeams) {
      await setDoc(doc(db, 'teamProblemAssignments', team.teamId), {
        teamId: team.teamId,
        statementId: group.statementId,
        statementTitle: group.statementTitle,
        description: group.description,
        instructions: group.instructions || [],
        assignedAt: now,
        publishedAt: now,
        status: 'PUBLISHED',
      });

      await updateDoc(doc(db, 'teams', team.teamId), {
        assignedStatementId: group.statementId,
        assignedStatementTitle: group.statementTitle,
        updatedAt: serverTimestamp(),
      }).catch(() => {});
    }
  }

  await updateDoc(draftRef, {
    status: 'PUBLISHED',
    publishedAt: now,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Resets distribution
 */
export async function resetDistribution(): Promise<void> {
  try {
    const fn = httpsCallable(functions, 'resetProblemDistribution');
    await fn({});
    return;
  } catch (err) {
    console.warn('[ProblemsService] Cloud Function reset fallback to Firestore:', err);
  }

  const assignmentsSnap = await getDocs(collection(db, 'teamProblemAssignments'));
  for (const d of assignmentsSnap.docs) {
    await deleteDoc(d.ref);
  }

  const teamsSnap = await getDocs(collection(db, 'teams'));
  for (const d of teamsSnap.docs) {
    await updateDoc(d.ref, {
      assignedStatementId: null,
      assignedStatementTitle: null,
      updatedAt: serverTimestamp(),
    }).catch(() => {});
  }

  await deleteDoc(doc(db, 'settings', 'problemDistributionDraft')).catch(() => {});
}

/**
 * Saves (creates/updates) a Problem Statement in Firestore
 */
export async function saveProblemStatement(statement: Partial<ProblemStatement>): Promise<void> {
  try {
    const fn = httpsCallable(functions, 'saveProblemStatement');
    await fn(statement);
    return;
  } catch (err) {
    console.warn('[ProblemsService] Cloud Function save fallback to Firestore:', err);
  }

  const statementId = statement.statementId || `PS${Date.now().toString().slice(-4)}`;
  const docRef = doc(db, 'problemStatements', statementId);

  const payload: any = {
    statementId,
    problemStatementId: statement.problemStatementId || statementId,
    title: statement.title || '',
    description: statement.description || '',
    order: Number(statement.order !== undefined ? statement.order : (statement.sequence !== undefined ? statement.sequence : 1)),
    sequence: Number(statement.sequence !== undefined ? statement.sequence : (statement.order !== undefined ? statement.order : 1)),
    status: statement.status || 'DRAFT',
    updatedAt: serverTimestamp(),
  };

  if (statement.requirements !== undefined) payload.requirements = statement.requirements;
  if (statement.technicalGuidelines !== undefined) payload.technicalGuidelines = statement.technicalGuidelines;
  if (statement.constraints !== undefined) payload.constraints = statement.constraints;
  if (statement.expectedOutcome !== undefined) payload.expectedOutcome = statement.expectedOutcome;
  if (statement.evaluationNotes !== undefined) payload.evaluationNotes = statement.evaluationNotes;
  if (statement.instructions !== undefined) payload.instructions = statement.instructions;
  if (statement.category !== undefined) payload.category = statement.category;
  if (statement.difficulty !== undefined) payload.difficulty = statement.difficulty;
  if (statement.organization !== undefined) payload.organization = statement.organization;
  if (statement.department !== undefined) payload.department = statement.department;

  await setDoc(docRef, payload, { merge: true });
}

/**
 * Deletes a Problem Statement
 */
export async function deleteProblemStatement(statementId: string): Promise<void> {
  try {
    const fn = httpsCallable(functions, 'deleteProblemStatement');
    await fn({ statementId });
    return;
  } catch (err) {
    console.warn('[ProblemsService] Cloud Function delete fallback to Firestore:', err);
  }

  await deleteDoc(doc(db, 'problemStatements', statementId));
}
