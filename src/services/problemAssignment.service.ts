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
  runTransaction,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import {
  ProblemStatement,
  ParsedProblemStatement,
  ProblemAssignmentConfig,
  ProblemStatementImport,
  Team,
} from '../types';
import dayjs from 'dayjs';

export const DEFAULT_ASSIGNMENT_CONFIG: ProblemAssignmentConfig = {
  assignmentMode: 'batch_alternating',
  batchSize: 10,
  batchStartTeamNumbers: [1, 21, 41, 61, 81],
};

/**
 * Normalizes number to 3-digit team ID (e.g. 1 -> TEAM001, 21 -> TEAM021)
 */
export function formatTeamId(num: number): string {
  return `TEAM${String(num).padStart(3, '0')}`;
}

/**
 * Subscribes to the Problem Assignment Configuration in Firestore
 */
export function subscribeToAssignmentConfig(
  callback: (config: ProblemAssignmentConfig) => void
): () => void {
  const docRef = doc(db, 'settings', 'problemDistribution');
  return onSnapshot(
    docRef,
    (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        callback({
          assignmentMode: data.assignmentMode || DEFAULT_ASSIGNMENT_CONFIG.assignmentMode,
          batchSize: Number(data.batchSize) || DEFAULT_ASSIGNMENT_CONFIG.batchSize,
          batchStartTeamNumbers: Array.isArray(data.batchStartTeamNumbers) && data.batchStartTeamNumbers.length > 0
            ? data.batchStartTeamNumbers.map(Number)
            : DEFAULT_ASSIGNMENT_CONFIG.batchStartTeamNumbers,
          updatedAt: data.updatedAt,
          updatedBy: data.updatedBy,
        });
      } else {
        callback(DEFAULT_ASSIGNMENT_CONFIG);
      }
    },
    (err) => {
      console.warn('[ProblemAssignment] subscribeToAssignmentConfig error:', err);
      callback(DEFAULT_ASSIGNMENT_CONFIG);
    }
  );
}

/**
 * Saves the Problem Assignment Configuration in Firestore
 */
export async function saveAssignmentConfig(
  config: Partial<ProblemAssignmentConfig>,
  adminEmail: string = 'admin'
): Promise<void> {
  const docRef = doc(db, 'settings', 'problemDistribution');
  await setDoc(
    docRef,
    {
      assignmentMode: config.assignmentMode || 'batch_alternating',
      batchSize: Number(config.batchSize) || 10,
      batchStartTeamNumbers: config.batchStartTeamNumbers || [1, 21, 41, 61, 81],
      updatedAt: serverTimestamp(),
      updatedBy: adminEmail,
    },
    { merge: true }
  );
}

/**
 * Calculates which team ID will be assigned to each problem statement based on the configured mode and sequence.
 */
export function calculateAssignedTeamIds(
  totalProblems: number,
  config: ProblemAssignmentConfig
): string[] {
  const assignedTeamIds: string[] = [];
  const batchSize = Math.max(1, config.batchSize || 10);
  const startNumbers = config.batchStartTeamNumbers?.length > 0 ? config.batchStartTeamNumbers : [1, 21, 41, 61, 81];

  for (let i = 0; i < totalProblems; i++) {
    if (config.assignmentMode === 'sequential') {
      assignedTeamIds.push(formatTeamId(i + 1));
    } else if (config.assignmentMode === 'round_robin') {
      assignedTeamIds.push(formatTeamId(i + 1));
    } else {
      // Default: batch_alternating
      // Batch 0: i in [0..9] -> start = startNumbers[0] (1) -> 1..10
      // Batch 1: i in [10..19] -> start = startNumbers[1] (21) -> 21..30
      // Batch 2: i in [20..29] -> start = startNumbers[2] (41) -> 41..50
      const batchIndex = Math.floor(i / batchSize);
      const indexInBatch = i % batchSize;
      const startNum = batchIndex < startNumbers.length
        ? startNumbers[batchIndex]
        : startNumbers[startNumbers.length - 1] + (batchIndex - startNumbers.length + 1) * 20;

      const teamNum = startNum + indexInBatch;
      assignedTeamIds.push(formatTeamId(teamNum));
    }
  }

  return assignedTeamIds;
}

/**
 * Validates whether all required teams exist in Firestore before assignment.
 */
export function validateTeamsExist(
  requiredTeamIds: string[],
  existingTeams: Team[]
): { isValid: boolean; missingTeamIds: string[] } {
  const existingSet = new Set(existingTeams.map((t) => t.teamId.toUpperCase()));
  const missingTeamIds: string[] = [];

  for (const tid of requiredTeamIds) {
    if (!existingSet.has(tid.toUpperCase())) {
      missingTeamIds.push(tid);
    }
  }

  return {
    isValid: missingTeamIds.length === 0,
    missingTeamIds,
  };
}

/**
 * Subscribes to Problem Statement Import History
 */
export function subscribeToImports(
  callback: (imports: ProblemStatementImport[]) => void
): () => void {
  const q = query(collection(db, 'problemStatementImports'), orderBy('uploadedAt', 'desc'));
  return onSnapshot(
    q,
    (snap) => {
      const list: ProblemStatementImport[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() } as ProblemStatementImport));
      callback(list);
    },
    (err) => {
      console.warn('[ProblemAssignment] subscribeToImports fallback:', err);
      getDocs(collection(db, 'problemStatementImports')).then((s) => {
        const list: ProblemStatementImport[] = [];
        s.forEach((d) => list.push({ id: d.id, ...d.data() } as ProblemStatementImport));
        callback(list);
      }).catch(() => callback([]));
    }
  );
}

/**
 * Checks if a file with the same content hash or name was previously imported.
 */
export async function checkPreviousImport(
  fileHash: string,
  fileName: string
): Promise<ProblemStatementImport | null> {
  const importsSnap = await getDocs(collection(db, 'problemStatementImports'));
  for (const d of importsSnap.docs) {
    const imp = d.data() as ProblemStatementImport;
    if (imp.fileHash === fileHash || imp.fileName === fileName) {
      return { id: d.id, ...imp };
    }
  }
  return null;
}

/**
 * Performs atomic bulk creation of problem statements as DRAFT and sets up draft team assignments.
 * AI or file upload NEVER automatically publishes.
 */
export async function bulkCreateAndAssignProblems(
  problems: ParsedProblemStatement[],
  sourceFileName: string,
  adminUser: { uid?: string; email?: string },
  existingTeams: Team[],
  config: ProblemAssignmentConfig,
  fileHash?: string
): Promise<{ success: boolean; totalCreated: number; totalAssigned: number; importId: string }> {
  if (!problems || problems.length === 0) {
    throw new Error('No problem statements to create.');
  }

  // 1. Calculate and validate required teams
  const requiredTeamIds = calculateAssignedTeamIds(problems.length, config);
  const teamValidation = validateTeamsExist(requiredTeamIds, existingTeams);

  if (!teamValidation.isValid) {
    throw new Error(
      `Required teams are missing: ${teamValidation.missingTeamIds.join(', ')}. Please create the required teams before publishing problem assignments.`
    );
  }

  const batch = writeBatch(db);
  const now = dayjs().toISOString();
  const importId = `IMP_${Date.now()}`;
  const teamMap = new Map<string, Team>();
  existingTeams.forEach((t) => teamMap.set(t.teamId.toUpperCase(), t));

  const assignedMapping: Array<{ problemSequence: number; problemTitle: string; teamId: string; teamName: string }> = [];

  // 2. Queue Problem Statements and Draft Team Assignments
  problems.forEach((p, idx) => {
    const targetTeamId = requiredTeamIds[idx];
    const teamObj = teamMap.get(targetTeamId.toUpperCase());
    const targetTeamName = teamObj?.teamName || targetTeamId;
    const statementId = `PS${String(p.sequence).padStart(3, '0')}`;

    // A. Problem Statement doc - ALWAYS CREATED AS DRAFT
    const psRef = doc(db, 'problemStatements', statementId);
    batch.set(
      psRef,
      {
        statementId,
        sequence: p.sequence,
        order: p.sequence,
        title: p.title,
        description: p.description,
        examples: p.examples || '',
        technicalGuidelines: p.technicalGuidelines || '',
        constraints: p.constraints || '',
        expectedOutcome: p.expectedOutcome || '',
        instructions: p.technicalGuidelines ? [p.technicalGuidelines] : [],
        sourceFileName,
        aiProcessed: true,
        assignedTeamId: targetTeamId,
        assignedTeamName: targetTeamName,
        status: 'draft', // NEVER published automatically
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: adminUser.email || adminUser.uid || 'admin',
        publishedAt: null,
        publishedBy: null,
      },
      { merge: true }
    );

    // B. Team Assignment doc - ALWAYS CREATED AS DRAFT
    const assignRef = doc(db, 'teamProblemAssignments', targetTeamId);
    batch.set(
      assignRef,
      {
        teamId: targetTeamId,
        statementId,
        problemSequence: p.sequence,
        statementTitle: p.title,
        description: p.description,
        examples: p.examples || '',
        technicalGuidelines: p.technicalGuidelines || '',
        constraints: p.constraints || '',
        expectedOutcome: p.expectedOutcome || '',
        instructions: p.technicalGuidelines ? [p.technicalGuidelines] : [],
        sourceFileName,
        assignedAt: now,
        publishedAt: null,
        assignedBy: adminUser.email || adminUser.uid || 'admin',
        status: 'DRAFT', // Users cannot see until published
      },
      { merge: true }
    );

    assignedMapping.push({
      problemSequence: p.sequence,
      problemTitle: p.title,
      teamId: targetTeamId,
      teamName: targetTeamName,
    });
  });

  // 3. Queue Import History record
  const importRef = doc(db, 'problemStatementImports', importId);
  batch.set(importRef, {
    importId,
    fileName: sourceFileName,
    fileHash: fileHash || '',
    totalDetected: problems.length,
    totalCreated: problems.length,
    totalAssigned: problems.length,
    status: 'SUCCESS',
    uploadedBy: adminUser.email || adminUser.uid || 'admin',
    uploadedAt: serverTimestamp(),
    aiModel: 'OpenRouter / Gemini Problem Extraction Engine',
    errorMessage: null,
    assignedMapping,
  });

  // 4. Queue Audit Log
  const auditRef = doc(collection(db, 'auditLogs'));
  batch.set(auditRef, {
    action: 'Bulk Problem Statements Created as Draft',
    category: 'problem',
    adminUid: adminUser.uid || 'admin',
    adminEmail: adminUser.email || 'admin@hackathon.org',
    targetId: importId,
    details: {
      fileName: sourceFileName,
      totalProblems: problems.length,
      assignedTeams: requiredTeamIds,
      initialStatus: 'draft',
    },
    timestamp: serverTimestamp(),
  });

  // 5. Commit atomic batch write
  await batch.commit();

  return {
    success: true,
    totalCreated: problems.length,
    totalAssigned: problems.length,
    importId,
  };
}

/**
 * Explicitly publishes an individual problem statement and makes it visible to the assigned team.
 */
export async function publishSingleProblemStatement(
  statement: ProblemStatement,
  adminUser: { uid?: string; email?: string }
): Promise<void> {
  const batch = writeBatch(db);
  const now = dayjs().toISOString();

  // 1. Update Problem Statement status
  const psRef = doc(db, 'problemStatements', statement.statementId);
  batch.update(psRef, {
    status: 'published',
    publishedAt: serverTimestamp(),
    publishedBy: adminUser.uid || adminUser.email || 'admin',
    updatedAt: serverTimestamp(),
  });

  // 2. If assigned to a team, update Team Assignment to PUBLISHED
  if (statement.assignedTeamId) {
    const assignRef = doc(db, 'teamProblemAssignments', statement.assignedTeamId);
    batch.set(
      assignRef,
      {
        teamId: statement.assignedTeamId,
        statementId: statement.statementId,
        problemSequence: statement.sequence || statement.order || 1,
        statementTitle: statement.title,
        description: statement.description,
        examples: statement.examples || '',
        technicalGuidelines: statement.technicalGuidelines || '',
        constraints: statement.constraints || '',
        expectedOutcome: statement.expectedOutcome || '',
        instructions: statement.instructions || [],
        sourceFileName: statement.sourceFileName || '',
        assignedAt: now,
        publishedAt: now,
        assignedBy: adminUser.email || adminUser.uid || 'admin',
        status: 'PUBLISHED',
      },
      { merge: true }
    );

    // 3. Update team doc with active reference
    const teamRef = doc(db, 'teams', statement.assignedTeamId);
    batch.update(teamRef, {
      assignedStatementId: statement.statementId,
      assignedStatementTitle: statement.title,
      updatedAt: serverTimestamp(),
    });
  }

  // 4. Audit Log
  const auditRef = doc(collection(db, 'auditLogs'));
  batch.set(auditRef, {
    action: 'Problem Statement Published',
    category: 'problem',
    adminUid: adminUser.uid || 'admin',
    adminEmail: adminUser.email || 'admin',
    targetId: statement.statementId,
    details: {
      statementId: statement.statementId,
      title: statement.title,
      assignedTeamId: statement.assignedTeamId,
    },
    timestamp: serverTimestamp(),
  });

  await batch.commit();
}

/**
 * Explicitly publishes all reviewed draft problem statements in an atomic batch.
 */
export async function publishAllDraftProblemStatements(
  drafts: ProblemStatement[],
  adminUser: { uid?: string; email?: string }
): Promise<{ success: boolean; publishedCount: number }> {
  if (!drafts || drafts.length === 0) {
    throw new Error('No draft problem statements to publish.');
  }

  const batch = writeBatch(db);
  const now = dayjs().toISOString();

  drafts.forEach((st) => {
    // 1. Update Problem Statement
    const psRef = doc(db, 'problemStatements', st.statementId);
    batch.update(psRef, {
      status: 'published',
      publishedAt: serverTimestamp(),
      publishedBy: adminUser.uid || adminUser.email || 'admin',
      updatedAt: serverTimestamp(),
    });

    // 2. Update Team Assignment
    if (st.assignedTeamId) {
      const assignRef = doc(db, 'teamProblemAssignments', st.assignedTeamId);
      batch.set(
        assignRef,
        {
          teamId: st.assignedTeamId,
          statementId: st.statementId,
          problemSequence: st.sequence || st.order || 1,
          statementTitle: st.title,
          description: st.description,
          examples: st.examples || '',
          technicalGuidelines: st.technicalGuidelines || '',
          constraints: st.constraints || '',
          expectedOutcome: st.expectedOutcome || '',
          instructions: st.instructions || [],
          sourceFileName: st.sourceFileName || '',
          assignedAt: now,
          publishedAt: now,
          assignedBy: adminUser.email || adminUser.uid || 'admin',
          status: 'PUBLISHED',
        },
        { merge: true }
      );

      // 3. Update team doc
      const teamRef = doc(db, 'teams', st.assignedTeamId);
      batch.update(teamRef, {
        assignedStatementId: st.statementId,
        assignedStatementTitle: st.title,
        updatedAt: serverTimestamp(),
      });
    }
  });

  // 4. Audit Log
  const auditRef = doc(collection(db, 'auditLogs'));
  batch.set(auditRef, {
    action: 'Bulk Problem Statements Published',
    category: 'problem',
    adminUid: adminUser.uid || 'admin',
    adminEmail: adminUser.email || 'admin',
    targetId: 'bulk_publish',
    details: {
      publishedCount: drafts.length,
      problemIds: drafts.map((d) => d.statementId),
    },
    timestamp: serverTimestamp(),
  });

  await batch.commit();

  return {
    success: true,
    publishedCount: drafts.length,
  };
}

/**
 * Unpublishes a problem statement and reverts it to DRAFT, hiding it from the user.
 */
export async function unpublishProblemStatement(
  statement: ProblemStatement,
  adminUser: { uid?: string; email?: string }
): Promise<void> {
  const batch = writeBatch(db);

  // 1. Revert Problem Statement status to draft
  const psRef = doc(db, 'problemStatements', statement.statementId);
  batch.update(psRef, {
    status: 'draft',
    publishedAt: null,
    publishedBy: null,
    updatedAt: serverTimestamp(),
  });

  // 2. Revert team assignment to DRAFT
  if (statement.assignedTeamId) {
    const assignRef = doc(db, 'teamProblemAssignments', statement.assignedTeamId);
    batch.update(assignRef, {
      status: 'DRAFT',
      publishedAt: null,
      updatedAt: serverTimestamp(),
    });

    const teamRef = doc(db, 'teams', statement.assignedTeamId);
    batch.update(teamRef, {
      assignedStatementId: null,
      assignedStatementTitle: null,
      updatedAt: serverTimestamp(),
    });
  }

  // 3. Audit Log
  const auditRef = doc(collection(db, 'auditLogs'));
  batch.set(auditRef, {
    action: 'Problem Statement Unpublished',
    category: 'problem',
    adminUid: adminUser.uid || 'admin',
    adminEmail: adminUser.email || 'admin',
    targetId: statement.statementId,
    details: {
      statementId: statement.statementId,
    },
    timestamp: serverTimestamp(),
  });

  await batch.commit();
}

/**
 * Reassigns a problem statement to another team with audit logging
 */
export async function reassignProblemStatement(
  statement: ProblemStatement,
  newTeamId: string,
  newTeamName: string,
  oldTeamId?: string | null,
  adminUser?: { uid?: string; email?: string }
): Promise<void> {
  const batch = writeBatch(db);
  const now = dayjs().toISOString();
  const isPublished = statement.status === 'published' || statement.status === 'active';

  // 1. Update Problem Statement
  const psRef = doc(db, 'problemStatements', statement.statementId);
  batch.update(psRef, {
    assignedTeamId: newTeamId,
    assignedTeamName: newTeamName,
    updatedAt: serverTimestamp(),
  });

  // 2. Create/Update new team assignment
  const newAssignRef = doc(db, 'teamProblemAssignments', newTeamId);
  batch.set(
    newAssignRef,
    {
      teamId: newTeamId,
      statementId: statement.statementId,
      problemSequence: statement.sequence || statement.order || 1,
      statementTitle: statement.title,
      description: statement.description,
      examples: statement.examples || '',
      technicalGuidelines: statement.technicalGuidelines || '',
      constraints: statement.constraints || '',
      expectedOutcome: statement.expectedOutcome || '',
      instructions: statement.instructions || [],
      sourceFileName: statement.sourceFileName || '',
      assignedAt: now,
      publishedAt: isPublished ? now : null,
      assignedBy: adminUser?.email || adminUser?.uid || 'admin',
      status: isPublished ? 'PUBLISHED' : 'DRAFT',
    },
    { merge: true }
  );

  // 3. Update new team record if published
  if (isPublished) {
    const newTeamRef = doc(db, 'teams', newTeamId);
    batch.update(newTeamRef, {
      assignedStatementId: statement.statementId,
      assignedStatementTitle: statement.title,
      updatedAt: serverTimestamp(),
    });
  }

  // 4. Remove old team assignment if different
  if (oldTeamId && oldTeamId !== newTeamId) {
    const oldAssignRef = doc(db, 'teamProblemAssignments', oldTeamId);
    batch.delete(oldAssignRef);

    const oldTeamRef = doc(db, 'teams', oldTeamId);
    batch.update(oldTeamRef, {
      assignedStatementId: null,
      assignedStatementTitle: null,
      updatedAt: serverTimestamp(),
    });
  }

  // 5. Audit Log
  const auditRef = doc(collection(db, 'auditLogs'));
  batch.set(auditRef, {
    action: 'Problem Statement Reassigned',
    category: 'problem',
    adminUid: adminUser?.uid || 'admin',
    adminEmail: adminUser?.email || 'admin',
    targetId: statement.statementId,
    details: {
      statementId: statement.statementId,
      fromTeam: oldTeamId || 'None',
      toTeam: newTeamId,
    },
    timestamp: serverTimestamp(),
  });

  await batch.commit();
}

/**
 * Deletes a problem statement, safely cleaning up any active team assignment
 */
export async function deleteProblemStatementCascade(
  statement: ProblemStatement,
  adminUser?: { uid?: string; email?: string }
): Promise<void> {
  const batch = writeBatch(db);

  // 1. Delete problem statement doc
  const psRef = doc(db, 'problemStatements', statement.statementId);
  batch.delete(psRef);

  // 2. If assigned to a team, delete assignment and clear team doc
  if (statement.assignedTeamId) {
    const assignRef = doc(db, 'teamProblemAssignments', statement.assignedTeamId);
    batch.delete(assignRef);

    const teamRef = doc(db, 'teams', statement.assignedTeamId);
    batch.update(teamRef, {
      assignedStatementId: null,
      assignedStatementTitle: null,
      updatedAt: serverTimestamp(),
    });
  }

  // 3. Audit Log
  const auditRef = doc(collection(db, 'auditLogs'));
  batch.set(auditRef, {
    action: 'Problem Statement Deleted',
    category: 'problem',
    adminUid: adminUser?.uid || 'admin',
    adminEmail: adminUser?.email || 'admin',
    targetId: statement.statementId,
    details: {
      statementId: statement.statementId,
      title: statement.title,
      unassignedTeamId: statement.assignedTeamId || null,
    },
    timestamp: serverTimestamp(),
  });

  await batch.commit();
}

/**
 * Result structure for sequential problem assignment
 */
export interface SequentialAssignmentResult {
  success: boolean;
  assigned: boolean;
  alreadyAssigned?: boolean;
  statementId?: string;
  problemSequence?: number;
  statementTitle?: string;
  problem?: ProblemStatement;
  message: string;
}

/**
 * Normalizes any string ID or number to its variant representations to ensure
 * case-insensitive and prefix-insensitive matching across PS001, PS1, 1, ps001, etc.
 */
export function extractIdVariants(rawId: string | number | null | undefined): string[] {
  if (rawId === null || rawId === undefined) return [];
  const str = String(rawId).trim().toLowerCase();
  if (!str) return [];
  const variants = new Set<string>();
  variants.add(str);

  // If format is like PS001, PS1, PS 1
  const psMatch = str.match(/^ps\s*0*(\d+)$/i);
  if (psMatch) {
    const num = parseInt(psMatch[1], 10);
    variants.add(String(num));
    variants.add(`ps${num}`);
    variants.add(`ps${String(num).padStart(3, '0')}`);
  } else {
    // If it's a plain number e.g. "1" or "46"
    const numMatch = str.match(/^0*(\d+)$/);
    if (numMatch) {
      const num = parseInt(numMatch[1], 10);
      variants.add(String(num));
      variants.add(`ps${num}`);
      variants.add(`ps${String(num).padStart(3, '0')}`);
    }
  }
  return Array.from(variants);
}

/**
 * Checks all Firestore sources to find every occupied / assigned / published / reserved Problem Statement ID.
 */
export async function getComprehensiveOccupiedStatementIds(excludeTeamId?: string): Promise<Set<string>> {
  const occupiedVariants = new Set<string>();

  const markOccupied = (rawId: string | number | null | undefined) => {
    if (!rawId) return;
    const variants = extractIdVariants(rawId);
    variants.forEach((v) => occupiedVariants.add(v));
  };

  try {
    const [teamAssignsSnap, problemAssignsSnap, teamsSnap, draftSnap, psSnap] = await Promise.all([
      getDocs(collection(db, 'teamProblemAssignments')).catch(() => null),
      getDocs(collection(db, 'problemAssignments')).catch(() => null),
      getDocs(collection(db, 'teams')).catch(() => null),
      getDoc(doc(db, 'settings', 'problemDistributionDraft')).catch(() => null),
      getDocs(collection(db, 'problemStatements')).catch(() => null),
    ]);

    // 1. Check teamProblemAssignments collection
    if (teamAssignsSnap) {
      teamAssignsSnap.forEach((d) => {
        const data = d.data();
        const teamId = data.teamId || d.id;
        if (excludeTeamId && teamId === excludeTeamId) return;
        markOccupied(data.statementId);
        markOccupied(data.problemStatementId);
        markOccupied(data.problemId);
        if (data.problemSequence) markOccupied(data.problemSequence);
      });
    }

    // 2. Check problemAssignments collection
    if (problemAssignsSnap) {
      problemAssignsSnap.forEach((d) => {
        const data = d.data();
        if (excludeTeamId && data.teamId === excludeTeamId) return;
        markOccupied(data.problemStatementId);
        markOccupied(data.statementId);
        if (data.assignmentSequence) markOccupied(data.assignmentSequence);
      });
    }

    // 3. Check teams collection (catches legacy or directly assigned teams)
    if (teamsSnap) {
      teamsSnap.forEach((d) => {
        const teamId = d.id;
        if (excludeTeamId && teamId === excludeTeamId) return;
        const data = d.data();
        markOccupied(data.assignedStatementId);
        markOccupied(data.problemStatementId);
        markOccupied(data.assignedProblemId);
        markOccupied(data.assignedProblemStatementId);
      });
    }

    // 4. Check settings/problemDistributionDraft mapping
    if (draftSnap && draftSnap.exists()) {
      const draftData = draftSnap.data();
      if (Array.isArray(draftData.mapping)) {
        draftData.mapping.forEach((group: any) => {
          if (Array.isArray(group.assignedTeams) && group.assignedTeams.length > 0) {
            const hasOtherTeam = excludeTeamId
              ? group.assignedTeams.some((t: any) => (t.teamId || t) !== excludeTeamId)
              : true;
            if (hasOtherTeam) {
              markOccupied(group.statementId);
              markOccupied(group.problemStatementId);
            }
          }
        });
      }
    }

    // 5. Check problemStatements collection fields
    if (psSnap) {
      psSnap.forEach((d) => {
        const st = d.data() as ProblemStatement;
        const statementId = d.id;
        const isPublished = st.status === 'PUBLISHED' || st.status === 'published' || st.status === 'active';

        const hasAssignedTeam = Boolean(
          (st.assignedTeamId && st.assignedTeamId.trim().length > 0 && (!excludeTeamId || st.assignedTeamId !== excludeTeamId)) ||
          (Array.isArray(st.assignedTeamIds) && st.assignedTeamIds.some((tid) => !excludeTeamId || tid !== excludeTeamId)) ||
          (Array.isArray((st as any).assignedTeams) && (st as any).assignedTeams.some((t: any) => !excludeTeamId || (t.teamId || t) !== excludeTeamId)) ||
          (st.team && st.team.trim().length > 0 && (!excludeTeamId || st.team !== excludeTeamId))
        );

        if (hasAssignedTeam || (isPublished && (st.assignedTeamId || st.team))) {
          markOccupied(statementId);
          markOccupied(st.statementId);
          markOccupied(st.problemStatementId);
          if (st.sequence) markOccupied(st.sequence);
          if (st.order) markOccupied(st.order);
        }
      });
    }
  } catch (err) {
    console.warn('[ProblemAssignment] Error computing occupied statement IDs:', err);
  }

  return occupiedVariants;
}

/**
 * Checks if a specific ProblemStatement object matches any ID in the occupied variants set.
 */
export function isStatementOccupied(statement: ProblemStatement, occupiedSet: Set<string>, excludeTeamId?: string): boolean {
  const idsToCheck = [
    statement.statementId,
    statement.problemStatementId,
    (statement as any).id,
    statement.sequence ? String(statement.sequence) : null,
    statement.order ? String(statement.order) : null,
  ];

  for (const raw of idsToCheck) {
    if (!raw) continue;
    const variants = extractIdVariants(raw);
    for (const v of variants) {
      if (occupiedSet.has(v)) return true;
    }
  }

  // Also check direct object fields
  if (statement.assignedTeamId && statement.assignedTeamId.trim().length > 0) {
    if (!excludeTeamId || statement.assignedTeamId !== excludeTeamId) return true;
  }
  if (Array.isArray(statement.assignedTeamIds) && statement.assignedTeamIds.length > 0) {
    if (!excludeTeamId || statement.assignedTeamIds.some((tid) => tid !== excludeTeamId)) return true;
  }
  if (Array.isArray((statement as any).assignedTeams) && (statement as any).assignedTeams.length > 0) {
    if (!excludeTeamId || (statement as any).assignedTeams.some((t: any) => (t.teamId || t) !== excludeTeamId)) return true;
  }
  if (statement.team && statement.team.trim().length > 0) {
    if (!excludeTeamId || statement.team !== excludeTeamId) return true;
  }

  return false;
}

/**
 * Calculates the next available unassigned Problem Statement in sequential order (1..N).
 * Pure query helper for previewing in the Add Team modal or UI without writing to Firestore.
 */
export async function getNextAvailableProblemStatement(
  knownStatements?: ProblemStatement[],
  excludeTeamId?: string
): Promise<{
  nextProblem: ProblemStatement | null;
  totalStatements: number;
  totalAssigned: number;
  totalAvailable: number;
}> {
  try {
    // 1. Fetch statements if not provided
    let statements = knownStatements;
    if (!statements || statements.length === 0) {
      const psSnap = await getDocs(collection(db, 'problemStatements'));
      statements = [];
      psSnap.forEach((d) => {
        statements!.push({ statementId: d.id, ...d.data() } as ProblemStatement);
      });
    }

    if (statements.length === 0) {
      return { nextProblem: null, totalStatements: 0, totalAssigned: 0, totalAvailable: 0 };
    }

    // 2. Sort deterministically by Admin Order (1..N), sequence, and numeric statementId
    const sorted = [...statements].sort((a, b) => {
      const ordA = a.order !== undefined && a.order !== null ? a.order : (a.sequence !== undefined && a.sequence !== null ? a.sequence : 0);
      const ordB = b.order !== undefined && b.order !== null ? b.order : (b.sequence !== undefined && b.sequence !== null ? b.sequence : 0);
      if (ordA !== ordB) return ordA - ordB;
      return a.statementId.localeCompare(b.statementId, undefined, { numeric: true });
    });

    // 3. Fetch comprehensive occupied statement IDs across all collections
    const occupiedIds = await getComprehensiveOccupiedStatementIds(excludeTeamId);

    // 4. Find the first unassigned problem statement in sequential order
    const nextAvailable = sorted.find((st) => !isStatementOccupied(st, occupiedIds, excludeTeamId)) || null;

    let assignedCount = 0;
    sorted.forEach((st) => {
      if (isStatementOccupied(st, occupiedIds, excludeTeamId)) assignedCount++;
    });

    const totalAvailable = Math.max(0, sorted.length - assignedCount);

    return {
      nextProblem: nextAvailable,
      totalStatements: sorted.length,
      totalAssigned: assignedCount,
      totalAvailable,
    };
  } catch (err: any) {
    console.warn('[ProblemAssignment] getNextAvailableProblemStatement error:', err);
    return { nextProblem: null, totalStatements: 0, totalAssigned: 0, totalAvailable: 0 };
  }
}

/**
 * Assigns the next available unassigned Problem Statement in sequential order (1..N) to a Team.
 * 
 * Rules:
 * 1. FIRST TEAM -> First available Problem Statement (#1).
 * 2. NEXT TEAM -> Next available Problem Statement (#2, #3...).
 * 3. EXISTING TEAM -> If teamId already has an assignment, keeps it and returns early (Idempotent).
 * 4. ALREADY ASSIGNED -> Assigned problem statements are strictly skipped so each problem gets at most 1 team by default.
 * 5. ATOMIC / CONCURRENCY SAFE -> Uses Firestore runTransaction to prevent race conditions.
 * 6. METADATA PRESERVED -> Preserves all AI analysis, category, difficulty, organization, department, and prompt fields.
 */
export async function assignNextSequentialProblemToTeam(
  teamId: string,
  teamName: string,
  adminUser?: { uid?: string; email?: string | null }
): Promise<SequentialAssignmentResult> {
  if (!teamId) {
    return { success: false, assigned: false, message: 'Invalid team ID provided.' };
  }

  // 1. Check if this team already has an assignment in ANY collection (Rule 3: Existing team keeps its assignment)
  const [existingAssignSnap, existingTeamSnap] = await Promise.all([
    getDoc(doc(db, 'teamProblemAssignments', teamId)).catch(() => null),
    getDoc(doc(db, 'teams', teamId)).catch(() => null),
  ]);

  if (existingAssignSnap && existingAssignSnap.exists()) {
    const existingData = existingAssignSnap.data();
    return {
      success: true,
      assigned: false,
      alreadyAssigned: true,
      statementId: existingData.statementId,
      problemSequence: existingData.problemSequence,
      statementTitle: existingData.statementTitle,
      message: `Team ${teamId} already has assigned problem ${existingData.statementId} ("${existingData.statementTitle}"). Existing assignment preserved.`,
    };
  }

  if (existingTeamSnap && existingTeamSnap.exists()) {
    const teamData = existingTeamSnap.data();
    if (teamData.assignedStatementId) {
      return {
        success: true,
        assigned: false,
        alreadyAssigned: true,
        statementId: teamData.assignedStatementId,
        statementTitle: teamData.assignedStatementTitle || '',
        message: `Team ${teamId} already has assigned problem ${teamData.assignedStatementId} ("${teamData.assignedStatementTitle}"). Existing assignment preserved.`,
      };
    }
  }

  // 2. Pre-fetch comprehensive occupied statement IDs and problem statements outside transaction
  const occupiedSet = await getComprehensiveOccupiedStatementIds(teamId);
  const psSnap = await getDocs(collection(db, 'problemStatements'));
  if (psSnap.empty) {
    return {
      success: true,
      assigned: false,
      message: 'No problem statements found in catalog. Team created without default problem.',
    };
  }

  const allStatements: ProblemStatement[] = [];
  psSnap.forEach((d) => {
    allStatements.push({ statementId: d.id, ...d.data() } as ProblemStatement);
  });

  // Sort deterministically by Admin Order (1..N), sequence, and numeric statementId
  allStatements.sort((a, b) => {
    const ordA = a.order !== undefined && a.order !== null ? a.order : (a.sequence !== undefined && a.sequence !== null ? a.sequence : 0);
    const ordB = b.order !== undefined && b.order !== null ? b.order : (b.sequence !== undefined && b.sequence !== null ? b.sequence : 0);
    if (ordA !== ordB) return ordA - ordB;
    return a.statementId.localeCompare(b.statementId, undefined, { numeric: true });
  });

  // 3. Atomic assignment via Firestore transaction
  try {
    const existingAssignRef = doc(db, 'teamProblemAssignments', teamId);
    const teamRef = doc(db, 'teams', teamId);

    const result = await runTransaction(db, async (transaction) => {
      // PHASE 1 — READS FIRST
      const assignCheck = await transaction.get(existingAssignRef);
      if (assignCheck.exists()) {
        const existingData = assignCheck.data();
        return {
          success: true,
          assigned: false,
          alreadyAssigned: true,
          statementId: existingData.statementId,
          problemSequence: existingData.problemSequence,
          statementTitle: existingData.statementTitle,
          message: `Team ${teamId} already has assigned problem ${existingData.statementId}.`,
        };
      }

      const teamCheck = await transaction.get(teamRef);
      if (teamCheck.exists() && teamCheck.data()?.assignedStatementId) {
        const teamData = teamCheck.data();
        return {
          success: true,
          assigned: false,
          alreadyAssigned: true,
          statementId: teamData.assignedStatementId,
          statementTitle: teamData.assignedStatementTitle || '',
          message: `Team ${teamId} already has assigned problem ${teamData.assignedStatementId}.`,
        };
      }

      // Find the first unassigned problem statement using occupiedSet and transaction.get
      let nextProblem: ProblemStatement | null = null;
      for (const cand of allStatements) {
        if (isStatementOccupied(cand, occupiedSet, teamId)) {
          continue;
        }
        const candRef = doc(db, 'problemStatements', cand.statementId);
        const candSnap = await transaction.get(candRef);
        if (!candSnap.exists()) continue;
        const candData = candSnap.data() as ProblemStatement;
        if (isStatementOccupied(candData, occupiedSet, teamId)) {
          continue;
        }
        nextProblem = { ...cand, ...candData, statementId: cand.statementId };
        break;
      }

      if (!nextProblem) {
        return {
          success: true,
          assigned: false,
          message: 'No unassigned Problem Statements are available for this Team.',
        };
      }

      const now = new Date().toISOString();
      const isPublished = nextProblem.status === 'published' || nextProblem.status === 'PUBLISHED';
      const seq = nextProblem.order !== undefined && nextProblem.order !== null ? nextProblem.order : (nextProblem.sequence || 1);

      // 1. Write /teamProblemAssignments/{teamId}
      transaction.set(
        existingAssignRef,
        {
          teamId,
          statementId: nextProblem.statementId,
          problemStatementId: nextProblem.problemStatementId || nextProblem.statementId,
          problemSequence: seq,
          order: seq,
          statementTitle: nextProblem.title,
          description: nextProblem.description,
          category: nextProblem.category || 'General',
          difficulty: nextProblem.difficulty || 'MEDIUM',
          organization: nextProblem.organization || null,
          department: nextProblem.department || null,
          team: nextProblem.team || teamName,
          aiAnalysis: nextProblem.analysis || nextProblem.evaluationNotes || '',
          confidence: nextProblem.confidence || 0.9,
          qualityScore: nextProblem.aiQualityScore || 8,
          aiIssues: nextProblem.aiIssues || [],
          aiSuggestions: nextProblem.aiSuggestions || [],
          requirements: nextProblem.requirements || [],
          examples: nextProblem.examples || '',
          technicalGuidelines: nextProblem.technicalGuidelines || '',
          constraints: nextProblem.constraints || '',
          expectedOutcome: nextProblem.expectedOutcome || '',
          instructions: nextProblem.instructions || (nextProblem.technicalGuidelines ? [nextProblem.technicalGuidelines] : []),
          sourceFileName: nextProblem.sourceFileName || '',
          assignedAt: now,
          publishedAt: isPublished ? now : null,
          assignedBy: adminUser?.email || adminUser?.uid || 'system_auto_assignment',
          status: isPublished ? 'PUBLISHED' : 'DRAFT',
        },
        { merge: true }
      );

      // 2. Update /problemStatements/{statementId}
      const psRef = doc(db, 'problemStatements', nextProblem.statementId);
      transaction.update(psRef, {
        assignedTeamId: teamId,
        assignedTeamName: teamName,
        updatedAt: serverTimestamp(),
      });

      // 3. Update /teams/{teamId}
      if (teamCheck.exists()) {
        transaction.update(teamRef, {
          assignedStatementId: nextProblem.statementId,
          assignedStatementTitle: nextProblem.title,
          updatedAt: serverTimestamp(),
        });
      }

      // 4. Also write legacy /problemAssignments/{teamId}_{statementId} for backwards compatibility
      const legacyRef = doc(db, 'problemAssignments', `${teamId}_${nextProblem.statementId}`);
      transaction.set(
        legacyRef,
        {
          assignmentId: `${teamId}_${nextProblem.statementId}`,
          teamId,
          problemStatementId: nextProblem.statementId,
          statementId: nextProblem.statementId,
          assignmentSequence: seq,
          status: isPublished ? 'PUBLISHED' : 'DRAFT',
          assignedAt: now,
          createdAt: now,
          updatedAt: now,
        },
        { merge: true }
      );

      return {
        success: true,
        assigned: true,
        statementId: nextProblem.statementId,
        problemSequence: seq,
        statementTitle: nextProblem.title,
        problem: nextProblem,
        message: `Assigned Problem #${seq} (${nextProblem.statementId}: "${nextProblem.title}") to ${teamName} (${teamId}) as default.`,
      };
    });

    return result;
  } catch (txError: any) {
    console.error('[ProblemAssignment] assignNextSequentialProblemToTeam transaction error:', txError);
    // Graceful fallback: return informative message without crashing team creation
    return {
      success: false,
      assigned: false,
      message: `Automatic problem assignment encountered an error: ${txError.message}`,
    };
  }
}

/**
 * Explicitly assigns a SPECIFIC, Admin-selected Problem Statement to a Team.
 * Validates that the problem is FREE and executes atomically via Firestore runTransaction.
 * STRICT RULE: All reads are performed before all writes inside the transaction.
 */
export async function assignSpecificProblemToTeam(
  teamId: string,
  teamName: string,
  statementId: string,
  adminUser?: { uid?: string; email?: string | null }
): Promise<SequentialAssignmentResult> {
  if (!teamId || !statementId) {
    return { success: false, assigned: false, message: 'Invalid team ID or statement ID provided.' };
  }

  // Pre-fetch comprehensive occupied statement IDs across all collections outside transaction
  const occupiedSet = await getComprehensiveOccupiedStatementIds(teamId);

  try {
    const existingAssignRef = doc(db, 'teamProblemAssignments', teamId);
    const teamRef = doc(db, 'teams', teamId);
    const psRef = doc(db, 'problemStatements', statementId);
    const legacyRef = doc(db, 'problemAssignments', `${teamId}_${statementId}`);

    const result = await runTransaction(db, async (transaction) => {
      // =========================================================================
      // PHASE 1 — ALL READS FIRST (No writes allowed before all reads complete)
      // =========================================================================
      const psSnap = await transaction.get(psRef);
      const teamSnap = await transaction.get(teamRef);
      const existingAssignSnap = await transaction.get(existingAssignRef);

      // =========================================================================
      // PHASE 2 — VALIDATE
      // =========================================================================
      if (!psSnap.exists()) {
        return {
          success: false,
          assigned: false,
          message: `Problem Statement ${statementId} does not exist in catalog.`,
        };
      }

      const psData = psSnap.data() as ProblemStatement;

      // If occupied by another team or published, fail safely with user-friendly message
      if (
        isStatementOccupied(psData, occupiedSet, teamId) ||
        psData.status === 'PUBLISHED' ||
        psData.status === 'published' ||
        psData.status === 'active' ||
        (psData.assignedTeamId && psData.assignedTeamId !== teamId)
      ) {
        return {
          success: false,
          assigned: false,
          message: 'This problem statement has already been assigned. Please select another FREE problem statement.',
        };
      }

      const now = new Date().toISOString();
      const isPublished = (psData.status as string) === 'published' || (psData.status as string) === 'PUBLISHED';
      const seq = psData.order !== undefined && psData.order !== null ? psData.order : (psData.sequence || 1);

      // =========================================================================
      // PHASE 3 — ALL WRITES (No reads after any write)
      // =========================================================================
      // 1. Write /teamProblemAssignments/{teamId}
      transaction.set(
        existingAssignRef,
        {
          teamId,
          statementId: psData.statementId,
          problemStatementId: psData.problemStatementId || psData.statementId,
          problemSequence: seq,
          order: seq,
          statementTitle: psData.title,
          description: psData.description,
          category: psData.category || 'General',
          difficulty: psData.difficulty || 'MEDIUM',
          organization: psData.organization || null,
          department: psData.department || null,
          team: psData.team || teamName,
          aiAnalysis: psData.analysis || psData.evaluationNotes || '',
          confidence: psData.confidence || 0.9,
          qualityScore: psData.aiQualityScore || 8,
          aiIssues: psData.aiIssues || [],
          aiSuggestions: psData.aiSuggestions || [],
          requirements: psData.requirements || [],
          examples: psData.examples || '',
          technicalGuidelines: psData.technicalGuidelines || '',
          constraints: psData.constraints || '',
          expectedOutcome: psData.expectedOutcome || '',
          instructions: psData.instructions || (psData.technicalGuidelines ? [psData.technicalGuidelines] : []),
          sourceFileName: psData.sourceFileName || '',
          assignedAt: now,
          publishedAt: isPublished ? now : null,
          assignedBy: adminUser?.email || adminUser?.uid || 'admin_manual_assignment',
          status: isPublished ? 'PUBLISHED' : 'DRAFT',
        },
        { merge: true }
      );

      // 2. Update /problemStatements/{statementId}
      transaction.update(psRef, {
        assignedTeamId: teamId,
        assignedTeamName: teamName,
        updatedAt: serverTimestamp(),
      });

      // 3. Update /teams/{teamId}
      if (teamSnap.exists()) {
        transaction.update(teamRef, {
          assignedStatementId: psData.statementId,
          assignedStatementTitle: psData.title,
          assignedProblemId: psData.statementId,
          assignedProblemCode: psData.statementId,
          assignedProblemOrder: seq,
          assignmentStatus: 'ASSIGNED',
          assignmentLocked: true,
          assignedAt: now,
          updatedAt: serverTimestamp(),
        });
      }

      // 4. Write /problemAssignments/{teamId}_{statementId} (legacy table)
      transaction.set(
        legacyRef,
        {
          assignmentId: `${teamId}_${psData.statementId}`,
          teamId,
          problemStatementId: psData.statementId,
          statementId: psData.statementId,
          assignmentSequence: seq,
          status: isPublished ? 'PUBLISHED' : 'DRAFT',
          assignedAt: now,
          createdAt: now,
          updatedAt: now,
        },
        { merge: true }
      );

      return {
        success: true,
        assigned: true,
        statementId: psData.statementId,
        problemSequence: seq,
        statementTitle: psData.title,
        problem: psData,
        message: `Assigned Problem #${seq} (${psData.statementId}: "${psData.title}") to ${teamName} (${teamId}).`,
      };
    });

    return result;
  } catch (txError: any) {
    console.error('[ProblemAssignment] assignSpecificProblemToTeam transaction error:', txError);
    return {
      success: false,
      assigned: false,
      message: `Problem assignment encountered an error: ${txError.message}`,
    };
  }
}

/**
 * Reassigns a Team's Problem Statement to a new FREE Problem Statement.
 * Atomically releases the old assignment and sets the new assignment.
 * STRICT RULE: All reads are performed before all writes inside the transaction.
 */
export async function reassignTeamProblem(
  teamId: string,
  teamName: string,
  newStatementId: string,
  adminUser?: { uid?: string; email?: string | null }
): Promise<SequentialAssignmentResult> {
  if (!teamId || !newStatementId) {
    return { success: false, assigned: false, message: 'Invalid team ID or statement ID provided.' };
  }

  // Pre-fetch comprehensive occupied statement IDs outside transaction
  const occupiedSet = await getComprehensiveOccupiedStatementIds(teamId);

  try {
    const existingAssignRef = doc(db, 'teamProblemAssignments', teamId);
    const teamRef = doc(db, 'teams', teamId);
    const newPsRef = doc(db, 'problemStatements', newStatementId);

    const result = await runTransaction(db, async (transaction) => {
      // =========================================================================
      // PHASE 1 — ALL READS FIRST (No writes allowed before all reads complete)
      // =========================================================================
      const newPsSnap = await transaction.get(newPsRef);
      const existingAssignSnap = await transaction.get(existingAssignRef);
      const teamSnap = await transaction.get(teamRef);

      // Determine old statement ID to release
      let oldStatementId: string | null = null;
      if (existingAssignSnap.exists()) {
        oldStatementId = existingAssignSnap.data().statementId || null;
      } else if (teamSnap.exists()) {
        oldStatementId = teamSnap.data().assignedStatementId || null;
      }

      let oldPsSnap: any = null;
      let oldPsRef: any = null;
      if (oldStatementId && oldStatementId !== newStatementId) {
        oldPsRef = doc(db, 'problemStatements', oldStatementId);
        oldPsSnap = await transaction.get(oldPsRef);
      }

      // =========================================================================
      // PHASE 2 — VALIDATE
      // =========================================================================
      if (!newPsSnap.exists()) {
        return {
          success: false,
          assigned: false,
          message: `Problem Statement ${newStatementId} does not exist.`,
        };
      }

      const newPsData = newPsSnap.data() as ProblemStatement;
      if (
        isStatementOccupied(newPsData, occupiedSet, teamId) ||
        newPsData.status === 'PUBLISHED' ||
        newPsData.status === 'published' ||
        newPsData.status === 'active' ||
        (newPsData.assignedTeamId && newPsData.assignedTeamId !== teamId)
      ) {
        return {
          success: false,
          assigned: false,
          message: 'This problem statement has already been assigned. Please select another FREE problem statement.',
        };
      }

      const now = new Date().toISOString();
      const isPublished = (newPsData.status as string) === 'published' || (newPsData.status as string) === 'PUBLISHED';
      const seq = newPsData.order !== undefined && newPsData.order !== null ? newPsData.order : (newPsData.sequence || 1);

      // =========================================================================
      // PHASE 3 — ALL WRITES (No reads after any write)
      // =========================================================================
      // 1. Release old statement if any
      if (oldStatementId && oldStatementId !== newStatementId && oldPsRef && oldPsSnap?.exists()) {
        transaction.update(oldPsRef, {
          assignedTeamId: null,
          assignedTeamName: null,
          updatedAt: serverTimestamp(),
        });
        const oldLegacyRef = doc(db, 'problemAssignments', `${teamId}_${oldStatementId}`);
        transaction.delete(oldLegacyRef);
      }

      // 2. Assign new statement in /teamProblemAssignments/{teamId}
      transaction.set(
        existingAssignRef,
        {
          teamId,
          statementId: newPsData.statementId,
          problemStatementId: newPsData.problemStatementId || newPsData.statementId,
          problemSequence: seq,
          order: seq,
          statementTitle: newPsData.title,
          description: newPsData.description,
          category: newPsData.category || 'General',
          difficulty: newPsData.difficulty || 'MEDIUM',
          organization: newPsData.organization || null,
          department: newPsData.department || null,
          team: newPsData.team || teamName,
          aiAnalysis: newPsData.analysis || newPsData.evaluationNotes || '',
          confidence: newPsData.confidence || 0.9,
          qualityScore: newPsData.aiQualityScore || 8,
          aiIssues: newPsData.aiIssues || [],
          aiSuggestions: newPsData.aiSuggestions || [],
          requirements: newPsData.requirements || [],
          examples: newPsData.examples || '',
          technicalGuidelines: newPsData.technicalGuidelines || '',
          constraints: newPsData.constraints || '',
          expectedOutcome: newPsData.expectedOutcome || '',
          instructions: newPsData.instructions || (newPsData.technicalGuidelines ? [newPsData.technicalGuidelines] : []),
          sourceFileName: newPsData.sourceFileName || '',
          assignedAt: now,
          publishedAt: isPublished ? now : null,
          assignedBy: adminUser?.email || adminUser?.uid || 'admin_reassignment',
          status: isPublished ? 'PUBLISHED' : 'DRAFT',
        },
        { merge: true }
      );

      // 3. Update new problem statement in /problemStatements/{statementId}
      transaction.update(newPsRef, {
        assignedTeamId: teamId,
        assignedTeamName: teamName,
        updatedAt: serverTimestamp(),
      });

      // 4. Update team document in /teams/{teamId}
      if (teamSnap.exists()) {
        transaction.update(teamRef, {
          assignedStatementId: newPsData.statementId,
          assignedStatementTitle: newPsData.title,
          assignedProblemId: newPsData.statementId,
          assignedProblemCode: newPsData.statementId,
          assignedProblemOrder: seq,
          assignmentStatus: 'ASSIGNED',
          assignmentLocked: true,
          assignedAt: now,
          updatedAt: serverTimestamp(),
        });
      }

      // 5. Write new legacy record in /problemAssignments/{teamId}_{statementId}
      const newLegacyRef = doc(db, 'problemAssignments', `${teamId}_${newPsData.statementId}`);
      transaction.set(
        newLegacyRef,
        {
          assignmentId: `${teamId}_${newPsData.statementId}`,
          teamId,
          problemStatementId: newPsData.statementId,
          statementId: newPsData.statementId,
          assignmentSequence: seq,
          status: isPublished ? 'PUBLISHED' : 'DRAFT',
          assignedAt: now,
          createdAt: now,
          updatedAt: now,
        },
        { merge: true }
      );

      return {
        success: true,
        assigned: true,
        statementId: newPsData.statementId,
        problemSequence: seq,
        statementTitle: newPsData.title,
        problem: newPsData,
        message: `Successfully reassigned Team ${teamId} to Problem #${seq} (${newPsData.statementId}: "${newPsData.title}").`,
      };
    });

    return result;
  } catch (err: any) {
    console.error('[ProblemAssignment] reassignTeamProblem transaction error:', err);
    return {
      success: false,
      assigned: false,
      message: `Problem reassignment encountered an error: ${err.message}`,
    };
  }
}
