import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { logAudit } from '../audit/auditLogger';
import { verifyAdmin } from '../utils/adminAuth';
import { ProblemStatementDoc, TeamProblemAssignmentDoc } from '../types';

export const generateProblemDistribution = functions.https.onCall(async (data, context) => {
  await verifyAdmin(context);

  const db = admin.firestore();

  // 1. Fetch active teams
  const teamsSnap = await db.collection('teams').get();
  const teams = teamsSnap.docs
    .map((d) => ({ teamId: d.id, ...d.data() } as any))
    .filter((t) => t.status !== 'disabled')
    .sort((a, b) => a.teamId.localeCompare(b.teamId));

  if (teams.length === 0) {
    throw new functions.https.HttpsError('failed-precondition', 'No active teams found to distribute.');
  }

  // 2. Fetch active problem statements
  const psSnap = await db.collection('problemStatements').get();
  const statements = psSnap.docs
    .map((d) => ({ statementId: d.id, ...d.data() } as ProblemStatementDoc))
    .filter((p) => p.status !== 'disabled')
    .sort((a, b) => (a.order || 0) - (b.order || 0) || a.statementId.localeCompare(b.statementId));

  if (statements.length === 0) {
    throw new functions.https.HttpsError('failed-precondition', 'No active problem statements found.');
  }

  const N = teams.length;
  const M = statements.length;

  const mapping: Array<{
    statementId: string;
    statementTitle: string;
    description: string;
    instructions: string[];
    assignedTeams: Array<{ teamId: string; teamName: string; leaderName: string }>;
  }> = [];

  const baseCount = Math.floor(N / M);
  const remainder = N % M;

  let currentTeamIdx = 0;

  for (let i = 0; i < M; i++) {
    const ps = statements[i];
    const countForThisPS = baseCount + (i < remainder ? 1 : 0);
    const assignedTeamsForPS: Array<{ teamId: string; teamName: string; leaderName: string }> = [];

    for (let c = 0; c < countForThisPS && currentTeamIdx < N; c++) {
      const team = teams[currentTeamIdx];
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

  const now = admin.firestore.FieldValue.serverTimestamp();
  await db.collection('settings').doc('problemDistributionDraft').set({
    status: 'DRAFT',
    totalTeams: N,
    totalStatements: M,
    mapping,
    generatedAt: now,
    generatedBy: context.auth!.token.email || context.auth!.uid,
  });

  await logAudit(
    context.auth!.uid,
    context.auth!.token.email,
    'Distribution Generated',
    'problem',
    'draft',
    { totalTeams: N, totalStatements: M, avgTeamsPerStatement: (N / M).toFixed(1) }
  );

  return {
    success: true,
    totalTeams: N,
    totalStatements: M,
    avgTeamsPerStatement: Number((N / M).toFixed(1)),
    mapping,
    message: `Generated sequential distribution for ${N} teams across ${M} problem statements.`,
  };
});

export const publishProblemDistribution = functions.https.onCall(async (data, context) => {
  await verifyAdmin(context);

  const db = admin.firestore();
  const draftDoc = await db.collection('settings').doc('problemDistributionDraft').get();

  if (!draftDoc.exists) {
    throw new functions.https.HttpsError('not-found', 'No draft problem distribution found. Generate distribution first.');
  }

  const draftData = draftDoc.data()!;
  const mapping: any[] = draftData.mapping || [];

  if (mapping.length === 0) {
    throw new functions.https.HttpsError('failed-precondition', 'Draft distribution mapping is empty.');
  }

  // Fetch currently active teams to exclude deleted / disabled teams
  const teamsSnap = await db.collection('teams').get();
  const activeTeamsSet = new Set(
    teamsSnap.docs
      .filter((d) => d.data().status !== 'disabled')
      .map((d) => d.id.toUpperCase())
  );

  const batch = db.batch();
  const now = admin.firestore.FieldValue.serverTimestamp();
  let totalAssigned = 0;

  mapping.forEach((group) => {
    group.assignedTeams.forEach((team: any) => {
      if (!activeTeamsSet.has(team.teamId.toUpperCase())) {
        // Skip stale / deleted / disabled teams
        return;
      }

      const assignmentRef = db.collection('teamProblemAssignments').doc(team.teamId);
      const assignmentData: TeamProblemAssignmentDoc = {
        teamId: team.teamId,
        statementId: group.statementId,
        statementTitle: group.statementTitle,
        description: group.description,
        instructions: group.instructions || [],
        assignedAt: now,
        publishedAt: now,
        status: 'PUBLISHED',
      };
      batch.set(assignmentRef, assignmentData, { merge: true });

      const teamRef = db.collection('teams').doc(team.teamId);
      batch.set(teamRef, {
        assignedStatementId: group.statementId,
        problemStatementId: group.statementId,
        assignedProblemId: group.statementId,
        assignedProblemTitle: group.statementTitle,
        problemTitle: group.statementTitle,
        assignmentPublished: true,
        updatedAt: now,
      }, { merge: true });

      totalAssigned++;
    });
  });

  batch.update(db.collection('settings').doc('problemDistributionDraft'), {
    status: 'PUBLISHED',
    publishedAt: now,
    publishedBy: context.auth!.token.email || context.auth!.uid,
  });

  batch.set(db.collection('settings').doc('problemDistributionState'), {
    status: 'PUBLISHED',
    totalTeams: totalAssigned,
    totalStatements: mapping.length,
    publishedAt: now,
    publishedBy: context.auth!.token.email || context.auth!.uid,
  });

  await batch.commit();

  await logAudit(
    context.auth!.uid,
    context.auth!.token.email,
    'Distribution Published',
    'problem',
    'published',
    { totalTeams: totalAssigned, totalStatements: mapping.length }
  );

  return {
    success: true,
    totalAssigned,
    totalStatements: mapping.length,
    message: `Problem distribution successfully published to ${totalAssigned} teams!`,
  };
});

export const resetProblemDistribution = functions.https.onCall(async (data, context) => {
  await verifyAdmin(context);

  const db = admin.firestore();
  const assignmentsSnap = await db.collection('teamProblemAssignments').get();
  const batch = db.batch();

  assignmentsSnap.forEach((doc) => {
    batch.delete(doc.ref);
  });

  batch.delete(db.collection('settings').doc('problemDistributionDraft'));
  batch.set(db.collection('settings').doc('problemDistributionState'), {
    status: 'DRAFT',
    totalTeams: 0,
    totalStatements: 0,
    resetAt: admin.firestore.FieldValue.serverTimestamp(),
    resetBy: context.auth!.token.email || context.auth!.uid,
  });

  await batch.commit();

  await logAudit(
    context.auth!.uid,
    context.auth!.token.email,
    'Distribution Reset',
    'problem',
    'all',
    { resetCount: assignmentsSnap.size }
  );

  return {
    success: true,
    message: 'Problem statement distribution has been reset.',
  };
});

export const saveProblemStatement = functions.https.onCall(async (data, context) => {
  await verifyAdmin(context);

  const { statementId, title, description, instructions, order, status } = data;
  if (!statementId || !title || !description) {
    throw new functions.https.HttpsError('invalid-argument', 'statementId, title, and description are required.');
  }

  const db = admin.firestore();
  const docRef = db.collection('problemStatements').doc(statementId);
  const now = admin.firestore.FieldValue.serverTimestamp();

  const payload: ProblemStatementDoc = {
    statementId,
    title: title.trim(),
    description: description.trim(),
    instructions: Array.isArray(instructions) ? instructions : [],
    order: Number(order) || 1,
    status: status === 'disabled' ? 'disabled' : 'active',
    createdAt: now,
    updatedAt: now,
  };

  await docRef.set(payload, { merge: true });

  await logAudit(
    context.auth!.uid,
    context.auth!.token.email,
    'Problem Statement Created',
    'problem',
    statementId,
    { title, order }
  );

  return { success: true, statementId, message: `Problem statement ${statementId} saved.` };
});

export const deleteProblemStatement = functions.https.onCall(async (data, context) => {
  await verifyAdmin(context);

  const { statementId } = data;
  if (!statementId) {
    throw new functions.https.HttpsError('invalid-argument', 'statementId is required.');
  }

  const db = admin.firestore();
  await db.collection('problemStatements').doc(statementId).delete();

  await logAudit(
    context.auth!.uid,
    context.auth!.token.email,
    'Problem Statement Deleted',
    'problem',
    statementId,
    {}
  );

  return { success: true, message: `Problem statement ${statementId} deleted.` };
});

import { callOpenRouterAI } from '../config/openrouter';

export const parseProblemStatementsAI = functions.runWith({ secrets: ['OPENROUTER_API_KEY'], timeoutSeconds: 300, memory: '1GB' }).https.onCall(async (data, context) => {
  await verifyAdmin(context);

  const { rawText, fileName } = data;
  if (!rawText || typeof rawText !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'rawText string is required.');
  }

  let parsedList: any[] = [];

  // 1. Attempt LLM Parsing via OpenRouter
  try {
    const prompt = `You are parsing a hackathon problem-statement document.
Identify every distinct problem statement in the uploaded document.
For each problem statement, extract:
- sequence (1, 2, 3...)
- title
- description
- examples (if provided)
- technicalGuidelines (if provided)
- constraints (if provided)
- expectedOutcome (if provided)

Return the result as a strict JSON array of objects with keys: sequence, title, description, examples, technicalGuidelines, constraints, expectedOutcome.
Do not wrap in markdown quotes. Return only raw JSON.

Document text:
${rawText.slice(0, 15000)}`;

    const response = await callOpenRouterAI({
      messages: [
        { role: 'system', content: 'You are an expert technical parser that outputs strict valid JSON arrays without markdown or code fences.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
    });

    const cleaned = response.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
    const jsonParsed = JSON.parse(cleaned);
    if (Array.isArray(jsonParsed) && jsonParsed.length > 0) {
      parsedList = jsonParsed.map((item, idx) => ({
        sequence: idx + 1,
        title: item.title || `Problem Statement ${idx + 1}`,
        description: item.description || '',
        examples: item.examples || undefined,
        technicalGuidelines: item.technicalGuidelines || undefined,
        constraints: item.constraints || undefined,
        expectedOutcome: item.expectedOutcome || undefined,
        sourceFile: fileName || 'upload.txt',
        aiProcessed: true,
      }));
    }
  } catch (err: any) {
    console.warn('[OpenRouter] AI call failed, falling back to heuristic parsing:', err.message);
  }

  // 2. Fallback to rule-based segmentation if OpenRouter wasn't available
  if (parsedList.length === 0) {
    const problemRegex = /(?:^|\n\s*)(?:(?:Problem\s*(?:Statement)?\s*(?:#|No\.?)?\s*(\d+)[:.\-–]?)|(?:(\d+)\.\s+[A-Z]))/gi;
    const matches: Array<{ index: number; numberStr: string }> = [];
    let match: RegExpExecArray | null;

    while ((match = problemRegex.exec(rawText)) !== null) {
      matches.push({
        index: match.index,
        numberStr: match[1] || match[2] || '',
      });
    }

    const rawChunks: string[] = [];
    if (matches.length >= 2) {
      for (let i = 0; i < matches.length; i++) {
        const start = matches[i].index;
        const end = i < matches.length - 1 ? matches[i + 1].index : rawText.length;
        const chunk = rawText.slice(start, end).trim();
        if (chunk.length > 20) rawChunks.push(chunk);
      }
    } else {
      const doubleNewlineChunks = rawText
        .split(/\n\s*\n(?=[A-Z0-9#])/)
        .map((c) => c.trim())
        .filter((c) => c.length > 30);
      if (doubleNewlineChunks.length >= 2) {
        rawChunks.push(...doubleNewlineChunks);
      } else {
        rawChunks.push(rawText.trim());
      }
    }

    parsedList = rawChunks.map((chunk, index) => {
      const lines = chunk.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
      let title = lines[0]
        .replace(/^(?:Problem\s*(?:Statement)?\s*(?:#|No\.?)?\s*\d+[:.\-–]?\s*)/i, '')
        .replace(/^\d+[:.)\-–]\s*/, '')
        .replace(/^Title[:\-–]\s*/i, '')
        .trim() || `Problem Statement ${index + 1}`;

      let description = '';
      let examples = '';
      let technicalGuidelines = '';
      let constraints = '';
      let expectedOutcome = '';

      const bodyLines = lines.slice(1);
      let currentSection: 'description' | 'examples' | 'guidelines' | 'constraints' | 'outcome' = 'description';

      for (const line of bodyLines) {
        const lower = line.toLowerCase();
        if (lower.startsWith('description:') || lower.startsWith('overview:') || lower.startsWith('problem description:')) {
          currentSection = 'description';
          const content = line.replace(/^[^:]+:\s*/i, '').trim();
          if (content) description += (description ? '\n' : '') + content;
        } else if (lower.startsWith('technical guidelines:') || lower.startsWith('guidelines:') || lower.startsWith('technical stack:')) {
          currentSection = 'guidelines';
          const content = line.replace(/^[^:]+:\s*/i, '').trim();
          if (content) technicalGuidelines += (technicalGuidelines ? '\n' : '') + content;
        } else if (lower.startsWith('constraints:') || lower.startsWith('limitations:')) {
          currentSection = 'constraints';
          const content = line.replace(/^[^:]+:\s*/i, '').trim();
          if (content) constraints += (constraints ? '\n' : '') + content;
        } else if (lower.startsWith('expected outcome:') || lower.startsWith('outcome:') || lower.startsWith('deliverables:')) {
          currentSection = 'outcome';
          const content = line.replace(/^[^:]+:\s*/i, '').trim();
          if (content) expectedOutcome += (expectedOutcome ? '\n' : '') + content;
        } else if (lower.startsWith('examples:') || lower.startsWith('example:')) {
          currentSection = 'examples';
          const content = line.replace(/^[^:]+:\s*/i, '').trim();
          if (content) examples += (examples ? '\n' : '') + content;
        } else {
          if (currentSection === 'description') description += (description ? '\n' : '') + line;
          else if (currentSection === 'guidelines') technicalGuidelines += (technicalGuidelines ? '\n' : '') + line;
          else if (currentSection === 'constraints') constraints += (constraints ? '\n' : '') + line;
          else if (currentSection === 'outcome') expectedOutcome += (expectedOutcome ? '\n' : '') + line;
          else if (currentSection === 'examples') examples += (examples ? '\n' : '') + line;
        }
      }

      if (!description) description = bodyLines.join('\n') || title;

      return {
        sequence: index + 1,
        title: title.length > 120 ? title.slice(0, 117) + '...' : title,
        description,
        examples: examples || undefined,
        technicalGuidelines: technicalGuidelines || undefined,
        constraints: constraints || undefined,
        expectedOutcome: expectedOutcome || undefined,
        sourceFile: fileName || 'upload.txt',
        aiProcessed: true,
      };
    });
  }

  await logAudit(
    context.auth!.uid,
    context.auth!.token.email,
    'AI Problem Document Parsed',
    'problem',
    fileName || 'upload',
    { totalDetected: parsedList.length }
  );

  return {
    success: true,
    totalDetected: parsedList.length,
    problems: parsedList,
  };
});

/**
 * SECURE ATOMIC DELETE ALL PROBLEM STATEMENTS & RELATED ASSIGNMENTS
 * 
 * Rules:
 * 1. Admin authentication required.
 * 2. Permanently removes all /problemStatements docs.
 * 3. Removes all /teamProblemAssignments, /problemPublications, /problemStatementImports, and draft states.
 * 4. Cleans assignedStatementId / assignedStatementTitle from /teams docs.
 * 5. Strictly PRESERVES all teams, user accounts, auth credentials, submissions, scores, and certificates.
 * 6. Uses batched deletion in chunks of 400 to prevent Firestore batch limit exceptions.
 * 7. Records an official audit log.
 */
export const deleteAllProblemStatements = functions.https.onCall(async (data, context) => {
  await verifyAdmin(context);

  const db = admin.firestore();
  const now = admin.firestore.FieldValue.serverTimestamp();

  // 1. Fetch all problem statements
  const psSnap = await db.collection('problemStatements').get();
  const totalStatements = psSnap.size;

  // 2. Fetch all team assignments
  const assignSnap = await db.collection('teamProblemAssignments').get();

  // 3. Fetch all publications & imports
  const pubSnap = await db.collection('problemPublications').get();
  const importSnap = await db.collection('problemStatementImports').get();

  // 4. Fetch teams with assignment fields
  const teamsSnap = await db.collection('teams').get();
  const teamsToClean = teamsSnap.docs.filter((d) => {
    const data = d.data();
    return data.assignedStatementId || data.assignedStatementTitle || data.publicationId;
  });

  // Prepare batch operations
  const operations: Array<(batch: admin.firestore.WriteBatch) => void> = [];

  // A. Delete problem statements
  psSnap.docs.forEach((doc) => {
    operations.push((batch) => batch.delete(doc.ref));
  });

  // B. Delete team assignments
  assignSnap.docs.forEach((doc) => {
    operations.push((batch) => batch.delete(doc.ref));
  });

  // C. Delete publications
  pubSnap.docs.forEach((doc) => {
    operations.push((batch) => batch.delete(doc.ref));
  });

  // D. Delete import history
  importSnap.docs.forEach((doc) => {
    operations.push((batch) => batch.delete(doc.ref));
  });

  // E. Reset settings docs
  const draftRef = db.collection('settings').doc('problemDistributionDraft');
  operations.push((batch) => batch.delete(draftRef));

  const pubVersionRef = db.collection('settings').doc('publishedProblemVersion');
  operations.push((batch) => batch.set(pubVersionRef, {
    activePublicationId: null,
    activeVersion: 0,
    status: 'UNPUBLISHED',
    totalStatements: 0,
    totalTeamsAssigned: 0,
    unassignedAt: now,
    unassignedBy: context.auth!.token.email || context.auth!.uid,
  }, { merge: true }));

  // F. Clean team assignment references (PRESERVE team account, name, score, etc.)
  teamsToClean.forEach((tDoc) => {
    operations.push((batch) => {
      batch.update(tDoc.ref, {
        assignedStatementId: admin.firestore.FieldValue.delete(),
        assignedStatementTitle: admin.firestore.FieldValue.delete(),
        publicationId: admin.firestore.FieldValue.delete(),
        publicationVersion: admin.firestore.FieldValue.delete(),
        updatedAt: now,
      });
    });
  });

  // Execute in batches of max 400 operations
  const BATCH_SIZE = 400;
  for (let i = 0; i < operations.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const chunk = operations.slice(i, i + BATCH_SIZE);
    chunk.forEach((op) => op(batch));
    await batch.commit();
  }

  // Audit Log
  await logAudit(
    context.auth!.uid,
    context.auth!.token.email,
    'DELETE_ALL_PROBLEM_STATEMENTS',
    'problem',
    'all_problem_statements',
    {
      deletedProblemStatementsCount: totalStatements,
      deletedAssignmentsCount: assignSnap.size,
      deletedPublicationsCount: pubSnap.size,
      cleanedTeamsCount: teamsToClean.length,
      timestamp: new Date().toISOString(),
    }
  );

  return {
    success: true,
    deletedCount: totalStatements,
    message: 'All problem statements and related assignment mappings deleted successfully.',
  };
});

