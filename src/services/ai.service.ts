import {
  doc,
  collection,
  onSnapshot,
  setDoc,
  serverTimestamp,
  query,
  where,
  orderBy,
  getDocs,
  getDoc,
  writeBatch,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase/config';
import { AIEvaluation, EvaluationHistoryItem } from '../types';

/**
 * Triggers OpenRouter AI Evidence-Based Evaluation on the secure backend Cloud Function.
 * Strictly adheres to real Firebase data:
 * - Fails honestly if problem statement or submission is missing.
 * - Never fabricates fake scores or mock analysis.
 */
export async function triggerAIEvaluation(
  submissionId: string,
  teamId: string,
  roundId: string
): Promise<AIEvaluation> {
  const fn = httpsCallable<{ submissionId: string; teamId: string; roundId: string }, { success: boolean; evaluation: AIEvaluation; message?: string }>(
    functions,
    'evaluateWithAI'
  );

  const res = await fn({ submissionId, teamId, roundId });

  if (res.data && res.data.evaluation) {
    return res.data.evaluation;
  }

  throw new Error(res.data?.message || 'AI evaluation did not return a valid result. Please retry.');
}

/**
 * Saves the Admin's authoritative final score and feedback in Firestore.
 * Updates evaluations, scores, and team total score atomically.
 * Preserves the original aiRecommendedScore separately.
 */
export async function saveAdminFinalScore(
  submissionId: string,
  teamId: string,
  roundId: string,
  finalScore: number,
  feedback: string,
  adminUser: { uid?: string; email?: string },
  maxMarks: number
): Promise<void> {
  // Call the server-authoritative evaluateSubmission Cloud Function
  try {
    const fn = httpsCallable(functions, 'evaluateSubmission');
    await fn({
      teamId,
      roundId,
      adminFinalScore: finalScore,
      feedback: feedback || '',
    });
    return;
  } catch (err: any) {
    console.warn('[AIService] Cloud Function evaluateSubmission fallback to direct Firestore transaction:', err.message);
  }

  // Fallback direct atomic write if Cloud Functions network is temporarily disconnected
  const batch = writeBatch(db);
  const now = serverTimestamp();
  const percentage = Number(((finalScore / maxMarks) * 100).toFixed(1));

  // 1. Update evaluations/{submissionId}
  const evalRef = doc(db, 'evaluations', submissionId);
  batch.set(
    evalRef,
    {
      adminFinalScore: finalScore,
      finalScore,
      finalComment: feedback || '',
      status: 'finalized',
      evaluatedBy: adminUser.email || adminUser.uid || 'admin',
      evaluatedAt: now,
      updatedAt: now,
    },
    { merge: true }
  );

  // 2. Update scores/{teamId_roundId}
  const scoreId = `${teamId}_${roundId}`;
  const scoreRef = doc(db, 'scores', scoreId);
  batch.set(
    scoreRef,
    {
      teamId,
      roundId,
      submissionId,
      totalMarks: finalScore,
      adminFinalScore: finalScore,
      maxMarks,
      percentage,
      feedback: feedback || '',
      evaluationStatus: 'FINALIZED',
      evaluatedBy: adminUser.email || adminUser.uid || 'admin',
      evaluatedAt: now,
      updatedAt: now,
    },
    { merge: true }
  );

  // 3. Update team doc score field
  const teamRef = doc(db, 'teams', teamId);
  const roundNum = roundId.includes('1') ? 1 : roundId.includes('2') ? 2 : 3;
  const scoreField = roundNum === 1 ? 'round1Score' : roundNum === 2 ? 'round2Score' : 'round3Score';

  batch.set(
    teamRef,
    {
      [scoreField]: finalScore,
      updatedAt: now,
    },
    { merge: true }
  );

  // 4. Save history record
  const historyRef = doc(collection(db, 'evaluationHistory'));
  batch.set(historyRef, {
    historyId: historyRef.id,
    submissionId,
    teamId,
    roundId,
    finalScore,
    maximumScore: maxMarks,
    editedBy: adminUser.email || adminUser.uid || 'admin',
    comment: feedback || '',
    createdAt: now,
  });

  // 5. Audit Log
  const auditRef = doc(collection(db, 'auditLogs'));
  batch.set(auditRef, {
    action: 'Admin Final Score Saved',
    category: 'score',
    adminUid: adminUser.uid || 'admin',
    adminEmail: adminUser.email || 'admin',
    targetId: scoreId,
    details: {
      teamId,
      roundId,
      finalScore,
      maxMarks,
      percentage,
    },
    timestamp: now,
  });

  await batch.commit();
}

/**
 * Subscribes to AI evaluation for a submission from Firestore
 */
export function subscribeToAIEvaluation(
  submissionId: string,
  callback: (evalDoc: AIEvaluation | null) => void
): () => void {
  const evalRef = doc(db, 'evaluations', submissionId);
  return onSnapshot(
    evalRef,
    (snap) => {
      if (snap.exists()) {
        callback({ id: snap.id, ...snap.data() } as AIEvaluation);
      } else {
        callback(null);
      }
    },
    (err) => {
      console.warn('[AIService] subscribeToAIEvaluation error:', err);
      callback(null);
    }
  );
}

/**
 * Subscribes to evaluation history for a submission
 */
export function subscribeToEvaluationHistory(
  submissionId: string,
  callback: (history: EvaluationHistoryItem[]) => void
): () => void {
  const q = query(
    collection(db, 'evaluationHistory'),
    where('submissionId', '==', submissionId),
    orderBy('createdAt', 'desc')
  );

  return onSnapshot(
    q,
    (snap) => {
      const list: EvaluationHistoryItem[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() } as EvaluationHistoryItem));
      callback(list);
    },
    (err) => {
      console.warn('[AIService] subscribeToEvaluationHistory fallback:', err);
      getDocs(collection(db, 'evaluationHistory'))
        .then((s) => {
          const list: EvaluationHistoryItem[] = [];
          s.forEach((d) => {
            const data = d.data() as EvaluationHistoryItem;
            if (data.submissionId === submissionId) {
              list.push({ id: d.id, ...data });
            }
          });
          callback(list);
        })
        .catch(() => callback([]));
    }
  );
}
