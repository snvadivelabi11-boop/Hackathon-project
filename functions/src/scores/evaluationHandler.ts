import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { logAudit } from '../audit/auditLogger';
import { verifyAdmin } from '../utils/adminAuth';

async function getScoringConfig(db: admin.firestore.Firestore) {
  const configDoc = await db.collection('settings').doc('scoringConfig').get();
  if (configDoc.exists) {
    const d = configDoc.data()!;
    const r1 = Number(d.round1MaxMarks) || 10;
    const r2 = Number(d.round2MaxMarks) || 30;
    const r3 = Number(d.round3MaxMarks) || 50;
    const total = Number(d.totalMaxMarks) || (r1 + r2 + r3);
    return { round1MaxMarks: r1, round2MaxMarks: r2, round3MaxMarks: r3, totalMaxMarks: total };
  }
  return { round1MaxMarks: 10, round2MaxMarks: 30, round3MaxMarks: 50, totalMaxMarks: 90 };
}

/**
 * Saves Admin-approved final score and feedback with dynamic bounds checking (0 to round.maxMarks).
 * Preserves the original aiSuggestedScore separately.
 */
export const evaluateSubmission = functions.https.onCall(async (data, context) => {
  await verifyAdmin(context);

  const { teamId, roundId, criteriaScores, adminFinalScore, feedback } = data;
  if (!teamId || !roundId) {
    throw new functions.https.HttpsError('invalid-argument', 'teamId and roundId are required.');
  }

  const db = admin.firestore();
  const scoringConfig = await getScoringConfig(db);

  // Validate Round & Max marks dynamically
  const roundDoc = await db.collection('rounds').doc(roundId).get();
  let maxMarks = 10;
  if (roundDoc.exists && typeof roundDoc.data()!.maxMarks === 'number') {
    maxMarks = roundDoc.data()!.maxMarks;
  } else if (roundId.includes('1')) {
    maxMarks = scoringConfig.round1MaxMarks;
  } else if (roundId.includes('2')) {
    maxMarks = scoringConfig.round2MaxMarks;
  } else if (roundId.includes('3')) {
    maxMarks = scoringConfig.round3MaxMarks;
  }

  let totalMarks = 0;
  if (adminFinalScore !== undefined && adminFinalScore !== null) {
    totalMarks = Number(adminFinalScore);
  } else if (criteriaScores) {
    for (const val of Object.values(criteriaScores)) {
      totalMarks += Number(val) || 0;
    }
  }

  if (isNaN(totalMarks) || totalMarks < 0) {
    throw new functions.https.HttpsError('invalid-argument', 'Score must be non-negative.');
  }

  if (totalMarks > maxMarks) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      `Final score (${totalMarks}) cannot exceed round maximum marks (${maxMarks}).`
    );
  }

  const scoreId = `${teamId}_${roundId}`;
  const scoreRef = db.collection('scores').doc(scoreId);
  const existingScore = await scoreRef.get();
  const aiSuggested = existingScore.exists ? existingScore.data()!.aiSuggestedScore : undefined;

  const now = admin.firestore.FieldValue.serverTimestamp();
  const percentage = Number(((totalMarks / maxMarks) * 100).toFixed(1));

  await scoreRef.set(
    {
      teamId,
      roundId,
      submissionId: `${teamId}_${roundId}`,
      criteriaScores: criteriaScores || {},
      aiSuggestedScore: aiSuggested ?? null,
      totalMarks,
      adminFinalScore: totalMarks,
      maxMarks,
      percentage,
      feedback: feedback ? String(feedback).trim() : '',
      evaluationStatus: 'FINALIZED',
      evaluatedBy: context.auth!.token.email || context.auth!.uid,
      evaluatedAt: now,
      updatedAt: now,
    },
    { merge: true }
  );

  // Update totalScore in /teams/{teamId}
  const allScoresSnap = await db.collection('scores').where('teamId', '==', teamId).get();
  let r1Score: number | null = null;
  let r2Score: number | null = null;
  let r3Score: number | null = null;

  allScoresSnap.forEach((doc) => {
    const s = doc.data();
    if (s.roundId.includes('1')) r1Score = s.totalMarks ?? null;
    if (s.roundId.includes('2')) r2Score = s.totalMarks ?? null;
    if (s.roundId.includes('3')) r3Score = s.totalMarks ?? null;
  });

  if (roundId.includes('1')) r1Score = totalMarks;
  if (roundId.includes('2')) r2Score = totalMarks;
  if (roundId.includes('3')) r3Score = totalMarks;

  const teamTotal = (r1Score || 0) + (r2Score || 0) + (r3Score || 0);
  await db.collection('teams').doc(teamId).update({
    round1Score: r1Score,
    round2Score: r2Score,
    round3Score: r3Score,
    totalScore: teamTotal,
    updatedAt: now,
  }).catch(() => {});

  // Mark submission as EVALUATED
  const subRef = db.collection('submissions').doc(`${teamId}_${roundId}`);
  const subDoc = await subRef.get();
  if (subDoc.exists) {
    await subRef.update({ status: 'EVALUATED', updatedAt: now });
  }

  await logAudit(
    context.auth!.uid,
    context.auth!.token.email,
    'Admin Score Changed',
    'score',
    scoreId,
    { teamId, roundId, adminFinalScore: totalMarks, maxMarks, percentage }
  );

  return {
    success: true,
    scoreId,
    teamId,
    roundId,
    totalMarks,
    maxMarks,
    percentage,
    message: 'Final score and feedback saved successfully.',
  };
});

/**
 * Recalculates ranked leaderboard using dynamic scoringConfig
 */
export const calculateLeaderboard = functions.https.onCall(async (data, context) => {
  await verifyAdmin(context);

  const db = admin.firestore();
  const [teamsSnap, scoresSnap, selectionsSnap, subsSnap, scoringConfig] = await Promise.all([
    db.collection('teams').get(),
    db.collection('scores').get(),
    db.collection('selections').get(),
    db.collection('submissions').get(),
    getScoringConfig(db),
  ]);

  const maxTotalScore = scoringConfig.totalMaxMarks || 90;

  const selectionsMap = new Map<string, { status: string; isPublished: boolean }>();
  selectionsSnap.forEach((doc) => {
    const sel = doc.data();
    selectionsMap.set(doc.id, { status: sel.status, isPublished: sel.isPublished || false });
  });

  const teamScoresMap = new Map<string, { round1: number; round2: number; round3: number; total: number }>();
  scoresSnap.forEach((doc) => {
    const s = doc.data();
    const current = teamScoresMap.get(s.teamId) || { round1: 0, round2: 0, round3: 0, total: 0 };
    if (s.roundId.includes('1')) current.round1 = Number(s.totalMarks) || 0;
    if (s.roundId.includes('2')) current.round2 = Number(s.totalMarks) || 0;
    if (s.roundId.includes('3')) current.round3 = Number(s.totalMarks) || 0;
    current.total = current.round1 + current.round2 + current.round3;
    teamScoresMap.set(s.teamId, current);
  });

  const lastSubTimeMap = new Map<string, number>();
  subsSnap.forEach((doc) => {
    const sub = doc.data();
    if (sub.submittedAt) {
      const timeMs = sub.submittedAt.toMillis ? sub.submittedAt.toMillis() : new Date(sub.submittedAt).getTime();
      const existing = lastSubTimeMap.get(sub.teamId) || 0;
      if (timeMs > existing) lastSubTimeMap.set(sub.teamId, timeMs);
    }
  });

  const entries: any[] = [];
  teamsSnap.forEach((doc) => {
    const t = doc.data();
    const teamId = doc.id;
    const scores = teamScoresMap.get(teamId) || { round1: 0, round2: 0, round3: 0, total: 0 };
    const sel = selectionsMap.get(teamId) || { status: 'NOT_SELECTED', isPublished: false };
    const lastSub = lastSubTimeMap.get(teamId) || 0;

    entries.push({
      teamId,
      teamName: t.teamName || teamId,
      leaderName: t.leaderName || '',
      round1Score: scores.round1,
      round2Score: scores.round2,
      round3Score: scores.round3,
      totalScore: scores.total,
      percentage: Number(((scores.total / maxTotalScore) * 100).toFixed(1)),
      selectionStatus: sel.status,
      isSelectionPublished: sel.isPublished,
      lastSubTime: lastSub,
    });
  });

  // Deterministic sorting
  entries.sort((a, b) => {
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    if (b.round3Score !== a.round3Score) return b.round3Score - a.round3Score;
    if (b.round2Score !== a.round2Score) return b.round2Score - a.round2Score;
    if (a.lastSubTime && b.lastSubTime && a.lastSubTime !== b.lastSubTime) {
      return a.lastSubTime - b.lastSubTime;
    }
    return a.teamId.localeCompare(b.teamId);
  });

  const ranked = entries.map((entry, index) => ({
    rank: index + 1,
    ...entry,
  }));

  return { success: true, leaderboard: ranked, maxTotalScore };
});
