import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot,
  query,
  where,
  serverTimestamp,
} from 'firebase/firestore';
import { db, auth } from '../firebase/config';
import { Score, LeaderboardEntry, Team } from '../types';
import { normalizeScore, safeString, safeNumber, safeRoundNumber } from '../utils/normalize';
import { getScoringConfig, getMaxMarksForRound } from './scoringConfig.service';

/**
 * Subscribes to all scores (Admin only) from Firestore
 */
export function subscribeToAllScores(callback: (scores: Score[]) => void): () => void {
  const q = query(collection(db, 'scores'));
  return onSnapshot(
    q,
    (snapshot) => {
      const scores: Score[] = [];
      snapshot.forEach((d) => {
        scores.push(normalizeScore(d.data(), d.id));
      });
      callback(scores);
    },
    (err) => {
      console.error('[ScoresService] subscribeToAllScores error:', err);
      callback([]);
    }
  );
}

/**
 * Subscribes to score publishing visibility status from Firestore
 */
export function subscribeToScoresPublishStatus(callback: (isPublished: boolean) => void): () => void {
  const settingRef = doc(db, 'settings', 'scoresVisibility');
  return onSnapshot(
    settingRef,
    (snap) => {
      if (snap.exists()) {
        callback(snap.data()?.isPublished === true);
      } else {
        callback(true);
      }
    },
    (err) => {
      console.warn('[ScoresService] subscribeToScoresPublishStatus error:', err);
      callback(true);
    }
  );
}

/**
 * Updates score publishing visibility status (Admin control)
 */
export async function setScoresPublishStatus(isPublished: boolean): Promise<void> {
  const settingRef = doc(db, 'settings', 'scoresVisibility');
  await setDoc(settingRef, { isPublished, updatedAt: serverTimestamp() }, { merge: true });
}

/**
 * Subscribes to scores for a specific team (Team Score View - isolated to own team)
 */
export function subscribeToTeamScores(teamId: string, callback: (scores: Score[]) => void): () => void {
  if (!teamId) {
    callback([]);
    return () => {};
  }
  const q = query(collection(db, 'scores'), where('teamId', '==', teamId));
  return onSnapshot(
    q,
    (snapshot) => {
      const scores: Score[] = [];
      snapshot.forEach((d) => {
        scores.push(normalizeScore(d.data(), d.id));
      });
      callback(scores);
    },
    (err) => {
      console.warn('[ScoresService] subscribeToTeamScores error:', err);
      callback([]);
    }
  );
}

/**
 * Saves final Admin score and feedback with dynamic config-driven numeric bounds
 * Updates /scores/{scoreId} and /teams/{teamId} in Firestore.
 */
export async function submitEvaluation(
  teamId: string,
  roundId: string,
  criteriaScores: Record<string, number>,
  adminFinalScore: number,
  feedback: string,
  evaluatorEmail?: string
): Promise<Score> {
  const scoringConfig = await getScoringConfig();
  const roundNum = safeRoundNumber(roundId);
  const maxMarks = getMaxMarksForRound(roundNum, scoringConfig);

  if (isNaN(adminFinalScore) || adminFinalScore < 0 || adminFinalScore > maxMarks) {
    throw new Error(`Score must be a number between 0 and ${maxMarks} for Round ${roundNum}.`);
  }

  const scoreId = `${teamId}_${roundId}`;
  const now = new Date().toISOString();
  const percentage = Number(((adminFinalScore / maxMarks) * 100).toFixed(1));

  const scoreItem: Score = {
    id: scoreId,
    teamId,
    roundId,
    submissionId: `${teamId}_${roundId}`,
    criteriaScores: criteriaScores || {},
    aiSuggestedScore: null,
    totalMarks: adminFinalScore,
    percentage,
    feedback: (feedback || '').trim(),
    evaluationStatus: 'FINALIZED',
    evaluatedBy: evaluatorEmail || auth.currentUser?.email || 'admin@hackathon.org',
    evaluatedAt: now,
  };

  // 1. Save Score document in Firestore
  await setDoc(
    doc(db, 'scores', scoreId),
    {
      id: scoreId,
      teamId,
      roundId,
      round: roundNum,
      submissionId: `${teamId}_${roundId}`,
      criteriaScores: criteriaScores || {},
      aiSuggestedScore: null,
      totalMarks: adminFinalScore,
      adminFinalScore,
      maxMarks,
      percentage,
      feedback: (feedback || '').trim(),
      evaluationStatus: 'FINALIZED',
      evaluatedBy: evaluatorEmail || auth.currentUser?.email || 'admin@hackathon.org',
      evaluatorId: auth.currentUser?.uid || 'admin',
      evaluatedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  // 2. Atomically calculate and update Team total score
  const teamScoresSnap = await getDocs(query(collection(db, 'scores'), where('teamId', '==', teamId)));
  let r1Score: number | null = null;
  let r2Score: number | null = null;
  let r3Score: number | null = null;

  teamScoresSnap.forEach((d) => {
    const sData = d.data();
    const r = safeRoundNumber(sData.round || sData.roundId);
    const scoreVal = safeNumber(sData.totalMarks || sData.adminFinalScore, 0);
    if (r === 1) r1Score = scoreVal;
    if (r === 2) r2Score = scoreVal;
    if (r === 3) r3Score = scoreVal;
  });

  if (roundNum === 1) r1Score = adminFinalScore;
  if (roundNum === 2) r2Score = adminFinalScore;
  if (roundNum === 3) r3Score = adminFinalScore;

  const totalScore = (r1Score || 0) + (r2Score || 0) + (r3Score || 0);

  const teamDocRef = doc(db, 'teams', teamId);
  await updateDoc(teamDocRef, {
    round1Score: r1Score,
    round2Score: r2Score,
    round3Score: r3Score,
    totalScore,
    updatedAt: serverTimestamp(),
  }).catch(() => {});

  // 3. Save audit log
  const auditRef = doc(collection(db, 'auditLogs'));
  await setDoc(auditRef, {
    id: auditRef.id,
    adminUid: auth.currentUser?.uid || 'admin',
    adminEmail: evaluatorEmail || auth.currentUser?.email || 'admin@hackathon.org',
    action: 'Admin Score Evaluated',
    targetType: 'score',
    targetId: scoreId,
    timestamp: now,
    metadata: { teamId, roundId, adminFinalScore, maxMarks, percentage },
  }).catch(() => {});

  return scoreItem;
}

/**
 * Fetches ranked leaderboard computed from live Firestore teams and scores using dynamic scoringConfig
 */
export async function fetchLeaderboard(): Promise<LeaderboardEntry[]> {
  const [teamsSnap, scoresSnap, selectionsSnap, scoringConfig] = await Promise.all([
    getDocs(collection(db, 'teams')),
    getDocs(collection(db, 'scores')),
    getDocs(collection(db, 'selections')),
    getScoringConfig(),
  ]);

  const totalPossibleMarks = scoringConfig.totalMaxMarks || 90;

  const selectionsMap = new Map<string, { status: string; isPublished: boolean }>();
  selectionsSnap.forEach((d) => {
    selectionsMap.set(d.id, {
      status: safeString(d.data().status || 'NOT_SELECTED'),
      isPublished: Boolean(d.data().isPublished),
    });
  });

  const teamScoresMap = new Map<string, { round1: number; round2: number; round3: number; total: number }>();
  scoresSnap.forEach((d) => {
    const s = d.data();
    const tId = safeString(s.teamId);
    if (!tId) return;
    const current = teamScoresMap.get(tId) || { round1: 0, round2: 0, round3: 0, total: 0 };
    const r = safeRoundNumber(s.round || s.roundId);
    const scoreVal = safeNumber(s.totalMarks || s.adminFinalScore, 0);
    if (r === 1) current.round1 = scoreVal;
    if (r === 2) current.round2 = scoreVal;
    if (r === 3) current.round3 = scoreVal;
    current.total = current.round1 + current.round2 + current.round3;
    teamScoresMap.set(tId, current);
  });

  const entries: LeaderboardEntry[] = [];
  teamsSnap.forEach((d) => {
    const t = d.data();
    const teamId = safeString(t.teamId || d.id);
    if (!teamId) return;
    const scores = teamScoresMap.get(teamId) || { round1: 0, round2: 0, round3: 0, total: 0 };
    const sel = selectionsMap.get(teamId) || { status: 'NOT_SELECTED', isPublished: false };

    entries.push({
      teamId,
      teamName: safeString(t.teamName || teamId),
      leaderName: safeString(t.leaderName || ''),
      round1Score: scores.round1,
      round2Score: scores.round2,
      round3Score: scores.round3,
      totalScore: scores.total,
      percentage: Number(((scores.total / totalPossibleMarks) * 100).toFixed(1)),
      selectionStatus: sel.status as any,
      isSelectionPublished: sel.isPublished,
      rank: 1,
    });
  });

  // Sort: Total Score DESC -> Round 3 DESC -> Round 2 DESC -> Team ID ASC
  entries.sort((a, b) => {
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    if (b.round3Score !== a.round3Score) return b.round3Score - a.round3Score;
    if (b.round2Score !== a.round2Score) return b.round2Score - a.round2Score;
    return a.teamId.localeCompare(b.teamId);
  });

  return entries.map((entry, index) => ({
    ...entry,
    rank: index + 1,
  }));
}
