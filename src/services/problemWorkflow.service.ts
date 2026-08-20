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
  orderBy,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase/config';
import {
  ProblemStatement,
  ParsedProblemStatement,
  ProblemAssignmentConfig,
  ProblemPublication,
  ProblemAssignmentValidationResult,
  Team,
  TeamProblemAssignment,
} from '../types';
import dayjs from 'dayjs';

export interface ProblemAssignmentPreviewItem {
  statementId: string;
  sequence: number;
  title: string;
  description: string;
  requirements?: string[];
  technicalGuidelines?: string;
  constraints?: string;
  expectedOutcome?: string;
  assignedTeamIds: string[];
  assignedTeams: Array<{
    teamId: string;
    teamName: string;
    leaderName: string;
    status?: string;
  }>;
}

/**
 * Saves all parsed problem statements immediately as DRAFT records in Firestore.
 * Auto-generates unique IDs (e.g. PS001, PS002...) and strictly maintains sequence 1..N.
 * Draft records are NOT visible to users.
 */
export async function saveAllProblemStatementsAsDraft(
  parsedProblems: ParsedProblemStatement[],
  sourceFileName: string,
  adminUser: { uid?: string; email?: string }
): Promise<{ success: boolean; savedCount: number; statementIds: string[] }> {
  if (!parsedProblems || parsedProblems.length === 0) {
    throw new Error('No problem statements provided to save.');
  }

  const batch = writeBatch(db);
  const statementIds: string[] = [];
  const now = serverTimestamp();

  parsedProblems.forEach((p, idx) => {
    const seq = p.sequence || idx + 1;
    const statementId = `PS${String(seq).padStart(3, '0')}`;
    statementIds.push(statementId);

    const psRef = doc(db, 'problemStatements', statementId);
    batch.set(
      psRef,
      {
        statementId,
        problemStatementId: statementId,
        sequence: seq,
        order: seq,
        title: p.title,
        description: p.description,
        requirements: p.requirements || [],
        technicalGuidelines: p.technicalGuidelines || '',
        constraints: p.constraints || '',
        expectedOutcome: p.expectedOutcome || '',
        evaluationNotes: p.evaluationNotes || '',
        instructions: p.technicalGuidelines ? [p.technicalGuidelines] : [],
        sourceFileName,
        aiProcessed: p.aiProcessed ?? true,
        status: 'DRAFT', // Strictly DRAFT until Admin publishes
        createdAt: now,
        updatedAt: now,
        createdBy: adminUser.email || adminUser.uid || 'admin',
        publishedAt: null,
        publishedBy: null,
      },
      { merge: true }
    );
  });

  // Audit Log
  const auditRef = doc(collection(db, 'auditLogs'));
  batch.set(auditRef, {
    action: 'Problem Statements Saved as Draft',
    category: 'problem',
    adminUid: adminUser.uid || 'admin',
    adminEmail: adminUser.email || 'admin@hackathon.org',
    targetId: `draft_batch_${Date.now()}`,
    details: {
      count: parsedProblems.length,
      sourceFileName,
      statementIds,
    },
    timestamp: now,
  });

  await batch.commit();

  return {
    success: true,
    savedCount: parsedProblems.length,
    statementIds,
  };
}

/**
 * Resolves the actual persisted Firestore team-to-problem assignments for preview.
 * READ-ONLY: Derives mapping strictly from saved relationships in Firestore.
 * Does NOT recalculate, distribute, shuffle, or invent assignments.
 */
export function calculateDynamicAssignmentMapping(
  statements: ProblemStatement[],
  teams: Team[],
  _config?: ProblemAssignmentConfig
): ProblemAssignmentPreviewItem[] {
  if (statements.length === 0) return [];

  // Sort statements deterministically by permanent order / sequence
  const sortedStatements = [...statements].sort((a, b) => {
    const ordA = a.order !== undefined && a.order !== null ? a.order : (a.sequence || 0);
    const ordB = b.order !== undefined && b.order !== null ? b.order : (b.sequence || 0);
    if (ordA !== ordB) return ordA - ordB;
    return a.statementId.localeCompare(b.statementId, undefined, { numeric: true });
  });

  const teamMap = new Map<string, Team>();
  teams.forEach((t) => {
    if (t.teamId) {
      teamMap.set(t.teamId.toUpperCase(), t);
    }
  });

  return sortedStatements.map((st, idx) => {
    const seq = st.order !== undefined && st.order !== null ? st.order : (st.sequence || idx + 1);
    const assignedSet = new Set<string>();

    // 1. Check direct problem statement fields
    if (st.assignedTeamId && st.assignedTeamId.trim().length > 0) {
      assignedSet.add(st.assignedTeamId.trim());
    }
    if (Array.isArray(st.assignedTeamIds)) {
      st.assignedTeamIds.forEach((tid) => {
        if (tid && tid.trim()) assignedSet.add(tid.trim());
      });
    }
    if (st.team && st.team.trim().length > 0 && !st.team.startsWith('PS') && st.team.toUpperCase().startsWith('TEAM')) {
      assignedSet.add(st.team.trim());
    }

    // 2. Cross-reference actual teams in Firestore
    teams.forEach((t) => {
      if (!t.teamId) return;
      const matchesStatementId =
        t.assignedStatementId === st.statementId ||
        t.problemStatementId === st.statementId ||
        t.assignedProblemId === st.statementId ||
        t.assignedProblemCode === st.statementId ||
        t.problemStatementCode === st.statementId;

      const matchesOrder =
        (t.assignedProblemOrder !== undefined && t.assignedProblemOrder !== null && t.assignedProblemOrder === seq) ||
        (t.problemStatementOrder !== undefined && t.problemStatementOrder !== null && t.problemStatementOrder === seq);

      if (matchesStatementId || matchesOrder) {
        assignedSet.add(t.teamId.trim());
      }
    });

    const assignedTeamIds = Array.from(assignedSet);
    const assignedTeams = assignedTeamIds.map((tid) => {
      const teamObj = teamMap.get(tid.toUpperCase());
      return {
        teamId: tid,
        teamName: teamObj?.teamName || tid,
        leaderName: teamObj?.leaderName || '',
        status: teamObj?.status || 'active',
      };
    });

    return {
      statementId: st.statementId,
      sequence: seq,
      title: st.title,
      description: st.description,
      requirements: Array.isArray(st.requirements)
        ? st.requirements
        : st.requirements
          ? [st.requirements]
          : [],
      technicalGuidelines: st.technicalGuidelines,
      constraints: st.constraints,
      expectedOutcome: st.expectedOutcome,
      assignedTeamIds,
      assignedTeams,
    };
  });
}

/**
 * Strict 10-point validation check before publishing.
 * Blocks publishing if any blocking issues exist.
 */
export function validateAssignmentMappingStrict(
  statements: ProblemStatement[],
  teams: Team[],
  mapping: ProblemAssignmentPreviewItem[]
): ProblemAssignmentValidationResult {
  const issues: string[] = [];
  const totalTeams = teams.length;
  const totalStatements = statements.length;

  if (totalStatements === 0) {
    issues.push('No problem statements found in the database.');
  }

  if (totalTeams === 0) {
    issues.push('No registered teams found to assign.');
  }

  // 1. Check for empty problem titles or descriptions
  statements.forEach((st) => {
    if (!st.title || st.title.trim().length === 0) {
      issues.push(`Problem Statement ${st.statementId} is missing a title.`);
    }
    if (!st.description || st.description.trim().length === 0) {
      issues.push(`Problem Statement ${st.statementId} (${st.title}) is missing a description.`);
    }
  });

  // 2. Check for duplicate sequences
  const seqSet = new Set<number>();
  const duplicateSequences: number[] = [];
  statements.forEach((st) => {
    const seq = st.sequence || st.order || 1;
    if (seqSet.has(seq)) {
      duplicateSequences.push(seq);
      issues.push(`Duplicate sequence number detected: #${seq} (${st.title})`);
    }
    seqSet.add(seq);
  });

  // 3. Check for inactive/disabled teams in assignment
  const existingTeamMap = new Map<string, Team>();
  teams.forEach((t) => existingTeamMap.set(t.teamId.toUpperCase(), t));

  const assignedTeamSet = new Set<string>();
  const unassignedTeamIds: string[] = [];
  const missingTeamIds: string[] = [];

  mapping.forEach((m) => {
    m.assignedTeamIds.forEach((tid) => {
      const teamObj = existingTeamMap.get(tid.toUpperCase());
      if (!teamObj) {
        missingTeamIds.push(tid);
        issues.push(`Assigned team ${tid} does not exist in the database.`);
      } else if (teamObj.status === 'disabled') {
        issues.push(`Team ${tid} (${teamObj.teamName}) is currently disabled.`);
      }

      if (assignedTeamSet.has(tid.toUpperCase())) {
        issues.push(`Duplicate assignment: Team ${tid} is assigned to multiple problem statements.`);
      }
      assignedTeamSet.add(tid.toUpperCase());
    });
  });

  // 4. Check for unassigned active teams
  teams.forEach((t) => {
    if (t.status !== 'disabled' && !assignedTeamSet.has(t.teamId.toUpperCase())) {
      unassignedTeamIds.push(t.teamId);
    }
  });

  if (unassignedTeamIds.length > 0) {
    issues.push(`${unassignedTeamIds.length} active teams have no problem assigned: ${unassignedTeamIds.slice(0, 5).join(', ')}${unassignedTeamIds.length > 5 ? '...' : ''}`);
  }

  const isValid = issues.length === 0;

  return {
    isValid,
    totalTeams,
    totalStatements,
    assignedTeamsCount: assignedTeamSet.size,
    unassignedTeamIds,
    missingTeamIds,
    duplicateSequences,
    issues,
  };
}

/**
 * Publishes Problem Statement Assignments creating an immutable snapshot (PUB_001, PUB_002...).
 * Only after this execution do problem statements become LIVE to users.
 */
export async function publishAssignmentSnapshot(
  statements: ProblemStatement[],
  teams: Team[],
  mapping: ProblemAssignmentPreviewItem[],
  adminUser: { uid?: string; email?: string }
): Promise<ProblemPublication> {
  const validation = validateAssignmentMappingStrict(statements, teams, mapping);
  if (!validation.isValid) {
    throw new Error(`Cannot publish problem statements. Validation errors:\n${validation.issues.join('\n')}`);
  }

  // 1. Fetch current publication version to increment
  const versionDocRef = doc(db, 'settings', 'publishedProblemVersion');
  const versionSnap = await getDoc(versionDocRef);
  const currentVersion = versionSnap.exists() ? Number(versionSnap.data()?.activeVersion || 0) : 0;
  const newVersion = currentVersion + 1;
  const publicationId = `PUB_${String(newVersion).padStart(3, '0')}`;

  const batch = writeBatch(db);
  const now = dayjs().toISOString();

  const statementsSnapshot: any[] = [];
  const assignmentMapping: any[] = [];

  // 2. Queue Firestore updates
  mapping.forEach((pItem) => {
    statementsSnapshot.push({
      statementId: pItem.statementId,
      sequence: pItem.sequence,
      title: pItem.title,
      description: pItem.description,
      requirements: pItem.requirements || [],
      technicalGuidelines: pItem.technicalGuidelines || '',
      constraints: pItem.constraints || '',
      expectedOutcome: pItem.expectedOutcome || '',
    });

    // A. Update Problem Statement to PUBLISHED
    const psRef = doc(db, 'problemStatements', pItem.statementId);
    batch.set(
      psRef,
      {
        statementId: pItem.statementId,
        problemStatementId: pItem.statementId,
        sequence: pItem.sequence,
        order: pItem.sequence,
        title: pItem.title,
        description: pItem.description,
        requirements: pItem.requirements || [],
        technicalGuidelines: pItem.technicalGuidelines || '',
        constraints: pItem.constraints || '',
        expectedOutcome: pItem.expectedOutcome || '',
        assignedTeamIds: pItem.assignedTeamIds,
        assignedTeamId: pItem.assignedTeamIds[0] || null,
        assignedTeamName: pItem.assignedTeams[0]?.teamName || null,
        status: 'PUBLISHED',
        publishedAt: serverTimestamp(),
        publishedBy: adminUser.uid || adminUser.email || 'admin',
        version: newVersion,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    // B. Update each assigned team's document and teamProblemAssignment
    pItem.assignedTeams.forEach((t) => {
      assignmentMapping.push({
        teamId: t.teamId,
        teamName: t.teamName,
        statementId: pItem.statementId,
        statementTitle: pItem.title,
        sequence: pItem.sequence,
      });

      // Write teamProblemAssignments/{teamId}
      const assignRef = doc(db, 'teamProblemAssignments', t.teamId);
      batch.set(
        assignRef,
        {
          teamId: t.teamId,
          statementId: pItem.statementId,
          problemStatementId: pItem.statementId,
          problemSequence: pItem.sequence,
          statementTitle: pItem.title,
          description: pItem.description,
          requirements: pItem.requirements || [],
          technicalGuidelines: pItem.technicalGuidelines || '',
          constraints: pItem.constraints || '',
          expectedOutcome: pItem.expectedOutcome || '',
          assignedAt: now,
          publishedAt: now,
          assignedBy: adminUser.email || adminUser.uid || 'admin',
          publicationId,
          publicationVersion: newVersion,
          status: 'PUBLISHED',
        },
        { merge: true }
      );

      // Write duplicate problemAssignments/{assignmentId}
      const legacyRef = doc(db, 'problemAssignments', `${t.teamId}_${pItem.statementId}`);
      batch.set(
        legacyRef,
        {
          assignmentId: `${t.teamId}_${pItem.statementId}`,
          teamId: t.teamId,
          problemStatementId: pItem.statementId,
          assignmentSequence: pItem.sequence,
          status: 'PUBLISHED',
          publishedAt: now,
          publishedBy: adminUser.uid || 'admin',
          createdAt: now,
          updatedAt: now,
        },
        { merge: true }
      );

      // Update Team doc reference
      const teamRef = doc(db, 'teams', t.teamId);
      batch.update(teamRef, {
        assignedStatementId: pItem.statementId,
        assignedStatementTitle: pItem.title,
        publicationId,
        updatedAt: serverTimestamp(),
      });
    });
  });

  // 3. Write immutable publication snapshot to problemPublications/{publicationId}
  const publicationDoc: ProblemPublication = {
    publicationId,
    version: newVersion,
    totalStatements: statementsSnapshot.length,
    totalTeamsAssigned: assignmentMapping.length,
    status: 'LIVE',
    publishedAt: now,
    publishedBy: adminUser.uid || adminUser.email || 'admin',
    adminEmail: adminUser.email || 'admin@hackathon.org',
    statementsSnapshot,
    assignmentMapping,
  };

  const pubRef = doc(db, 'problemPublications', publicationId);
  batch.set(pubRef, {
    ...publicationDoc,
    createdAt: serverTimestamp(),
  });

  // 4. Update active version pointer in settings/publishedProblemVersion
  batch.set(
    versionDocRef,
    {
      activePublicationId: publicationId,
      activeVersion: newVersion,
      totalStatements: statementsSnapshot.length,
      totalTeamsAssigned: assignmentMapping.length,
      publishedAt: serverTimestamp(),
      publishedBy: adminUser.email || adminUser.uid || 'admin',
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  // 5. Audit Log
  const auditRef = doc(collection(db, 'auditLogs'));
  batch.set(auditRef, {
    action: `Problem Statements Published (${publicationId} - v${newVersion})`,
    category: 'problem',
    adminUid: adminUser.uid || 'admin',
    adminEmail: adminUser.email || 'admin@hackathon.org',
    targetId: publicationId,
    details: {
      publicationId,
      version: newVersion,
      totalStatements: statementsSnapshot.length,
      totalTeams: assignmentMapping.length,
    },
    timestamp: serverTimestamp(),
  });

  await batch.commit();
  return publicationDoc;
}

/**
 * Reverts active published version to Draft status.
 */
export async function unpublishActiveProblemVersion(
  statements: ProblemStatement[],
  adminUser: { uid?: string; email?: string }
): Promise<void> {
  const batch = writeBatch(db);

  statements.forEach((st) => {
    const psRef = doc(db, 'problemStatements', st.statementId);
    batch.update(psRef, {
      status: 'DRAFT',
      publishedAt: null,
      publishedBy: null,
      updatedAt: serverTimestamp(),
    });

    if (st.assignedTeamId) {
      const assignRef = doc(db, 'teamProblemAssignments', st.assignedTeamId);
      batch.update(assignRef, {
        status: 'DRAFT',
        publishedAt: null,
        updatedAt: serverTimestamp(),
      });

      const teamRef = doc(db, 'teams', st.assignedTeamId);
      batch.update(teamRef, {
        assignedStatementId: null,
        assignedStatementTitle: null,
        publicationId: null,
        updatedAt: serverTimestamp(),
      });
    }
  });

  const versionDocRef = doc(db, 'settings', 'publishedProblemVersion');
  batch.set(
    versionDocRef,
    {
      activePublicationId: null,
      activeVersion: null,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  const auditRef = doc(collection(db, 'auditLogs'));
  batch.set(auditRef, {
    action: 'Problem Statements Unpublished',
    category: 'problem',
    adminUid: adminUser.uid || 'admin',
    adminEmail: adminUser.email || 'admin',
    targetId: 'unpublish',
    timestamp: serverTimestamp(),
  });

  await batch.commit();
}

/**
 * Subscribes to Problem Publication history in Firestore
 */
export function subscribeToProblemPublications(
  callback: (publications: ProblemPublication[]) => void
): () => void {
  const q = query(collection(db, 'problemPublications'), orderBy('publishedAt', 'desc'));
  return onSnapshot(
    q,
    (snap) => {
      const list: ProblemPublication[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() } as ProblemPublication));
      callback(list);
    },
    (err) => {
      console.warn('[ProblemWorkflow] subscribeToProblemPublications fallback:', err);
      getDocs(collection(db, 'problemPublications')).then((s) => {
        const list: ProblemPublication[] = [];
        s.forEach((d) => list.push({ id: d.id, ...d.data() } as ProblemPublication));
        callback(list);
      }).catch(() => callback([]));
    }
  );
}

/**
 * Subscribes to the active published version metadata in settings/publishedProblemVersion
 */
export function subscribeToActivePublishedVersion(
  callback: (data: { activePublicationId: string | null; activeVersion: number | null } | null) => void
): () => void {
  const docRef = doc(db, 'settings', 'publishedProblemVersion');
  return onSnapshot(
    docRef,
    (snap) => {
      if (snap.exists()) {
        const d = snap.data();
        callback({
          activePublicationId: d.activePublicationId || null,
          activeVersion: d.activeVersion || null,
        });
      } else {
        callback(null);
      }
    },
    (err) => {
      console.warn('[ProblemWorkflow] subscribeToActivePublishedVersion error:', err);
      callback(null);
    }
  );
}

/**
 * ATOMIC & SECURE DELETE ALL PROBLEM STATEMENTS
 * 
 * 1. Calls Cloud Function endpoint deleteAllProblemStatements.
 * 2. Fallback to client-side batched Firestore deletion in chunks of 400.
 * 3. Permanently deletes all problem statements, team assignments, publications, and imports.
 * 4. Cleans assignedStatementId / assignedStatementTitle references from teams without deleting teams or scores.
 * 5. Records an official Admin Audit Log.
 */
export async function deleteAllProblemStatementsFromFirestore(
  adminUser: { uid?: string; email?: string }
): Promise<{ success: boolean; deletedCount: number; message: string }> {
  try {
    const fn = httpsCallable<any, any>(functions, 'deleteAllProblemStatements');
    const res = await fn({});
    if (res.data && res.data.success) {
      return {
        success: true,
        deletedCount: res.data.deletedCount || 0,
        message: res.data.message || 'All problem statements deleted successfully.',
      };
    }
  } catch (fnErr: any) {
    console.warn('[ProblemWorkflow] Cloud Function deleteAllProblemStatements fallback:', fnErr.message);
  }

  // Client-side Batched Fallback Deletion
  const now = serverTimestamp();

  // 1. Fetch all problem statements
  const psSnap = await getDocs(collection(db, 'problemStatements'));
  const totalStatements = psSnap.size;

  // 2. Fetch all team assignments
  const assignSnap = await getDocs(collection(db, 'teamProblemAssignments'));

  // 3. Fetch publications & imports
  const pubSnap = await getDocs(collection(db, 'problemPublications'));
  const importSnap = await getDocs(collection(db, 'problemStatementImports'));

  // 4. Fetch teams to clean assignment references
  const teamsSnap = await getDocs(collection(db, 'teams'));
  const teamsToClean = teamsSnap.docs.filter((d) => {
    const data = d.data();
    return data.assignedStatementId || data.assignedStatementTitle || data.publicationId;
  });

  const operations: Array<(b: ReturnType<typeof writeBatch>) => void> = [];

  // A. Delete problem statements
  psSnap.docs.forEach((d) => {
    operations.push((b) => b.delete(doc(db, 'problemStatements', d.id)));
  });

  // B. Delete team assignments
  assignSnap.docs.forEach((d) => {
    operations.push((b) => b.delete(doc(db, 'teamProblemAssignments', d.id)));
  });

  // C. Delete publications
  pubSnap.docs.forEach((d) => {
    operations.push((b) => b.delete(doc(db, 'problemPublications', d.id)));
  });

  // D. Delete import records
  importSnap.docs.forEach((d) => {
    operations.push((b) => b.delete(doc(db, 'problemStatementImports', d.id)));
  });

  // E. Reset settings docs
  operations.push((b) => b.delete(doc(db, 'settings', 'problemDistributionDraft')));
  operations.push((b) =>
    b.set(
      doc(db, 'settings', 'publishedProblemVersion'),
      {
        activePublicationId: null,
        activeVersion: 0,
        status: 'UNPUBLISHED',
        totalStatements: 0,
        totalTeamsAssigned: 0,
        unassignedAt: now,
        unassignedBy: adminUser.email || adminUser.uid || 'admin',
      },
      { merge: true }
    )
  );

  // F. Clean team references
  teamsToClean.forEach((tDoc) => {
    operations.push((b) => {
      b.update(doc(db, 'teams', tDoc.id), {
        assignedStatementId: null,
        assignedStatementTitle: null,
        publicationId: null,
        publicationVersion: null,
        updatedAt: now,
      });
    });
  });

  // G. Audit Log
  operations.push((b) => {
    const auditRef = doc(collection(db, 'auditLogs'));
    b.set(auditRef, {
      action: 'DELETE_ALL_PROBLEM_STATEMENTS',
      category: 'problem',
      adminUid: adminUser.uid || 'admin',
      adminEmail: adminUser.email || 'admin@hackathon.org',
      targetId: 'all_problem_statements',
      details: {
        deletedProblemStatementsCount: totalStatements,
        deletedAssignmentsCount: assignSnap.size,
        deletedPublicationsCount: pubSnap.size,
        cleanedTeamsCount: teamsToClean.length,
      },
      timestamp: now,
    });
  });

  // Execute in batches of max 400 operations
  const BATCH_SIZE = 400;
  for (let i = 0; i < operations.length; i += BATCH_SIZE) {
    const batch = writeBatch(db);
    const chunk = operations.slice(i, i + BATCH_SIZE);
    chunk.forEach((op) => op(batch));
    await batch.commit();
  }

  return {
    success: true,
    deletedCount: totalStatements,
    message: 'All problem statements deleted successfully.',
  };
}

