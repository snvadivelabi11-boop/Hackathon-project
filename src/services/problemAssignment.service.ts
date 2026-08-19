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
