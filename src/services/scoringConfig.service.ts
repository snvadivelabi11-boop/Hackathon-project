import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot,
  collection,
  serverTimestamp,
} from 'firebase/firestore';
import { db, auth } from '../firebase/config';
import { ScoringConfig, DEFAULT_SCORING_CONFIG } from '../types';
import { safeNumber, safeRoundNumber } from '../utils/normalize';

export const normalizeScoringConfig = (data: any): ScoringConfig => {
  if (!data) return DEFAULT_SCORING_CONFIG;

  const r1 = safeNumber(data.round1MaxMarks, DEFAULT_SCORING_CONFIG.round1MaxMarks);
  const r2 = safeNumber(data.round2MaxMarks, DEFAULT_SCORING_CONFIG.round2MaxMarks);
  const r3 = safeNumber(data.round3MaxMarks, DEFAULT_SCORING_CONFIG.round3MaxMarks);
  const total = safeNumber(data.totalMaxMarks, r1 + r2 + r3);

  return {
    round1MaxMarks: r1,
    round2MaxMarks: r2,
    round3MaxMarks: r3,
    totalMaxMarks: total,
    updatedAt: data.updatedAt || null,
    updatedBy: data.updatedBy || '',
  };
};

/**
 * Subscribes to real-time scoring configuration from Firestore
 */
export function subscribeToScoringConfig(callback: (config: ScoringConfig) => void): () => void {
  const docRef = doc(db, 'settings', 'scoringConfig');
  return onSnapshot(
    docRef,
    (snap) => {
      if (snap.exists()) {
        callback(normalizeScoringConfig(snap.data()));
      } else {
        callback(DEFAULT_SCORING_CONFIG);
      }
    },
    (err) => {
      console.warn('[ScoringConfigService] subscribeToScoringConfig error:', err);
      callback(DEFAULT_SCORING_CONFIG);
    }
  );
}

/**
 * Fetches the current scoring configuration once
 */
export async function getScoringConfig(): Promise<ScoringConfig> {
  try {
    const docRef = doc(db, 'settings', 'scoringConfig');
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      return normalizeScoringConfig(snap.data());
    }
  } catch (err) {
    console.warn('[ScoringConfigService] getScoringConfig fetch error:', err);
  }
  return DEFAULT_SCORING_CONFIG;
}

/**
 * Saves and validates the scoring configuration in Firestore, syncing round documents.
 */
export async function saveScoringConfig(config: {
  round1MaxMarks: number;
  round2MaxMarks: number;
  round3MaxMarks: number;
  totalMaxMarks: number;
}): Promise<ScoringConfig> {
  const r1 = Number(config.round1MaxMarks);
  const r2 = Number(config.round2MaxMarks);
  const r3 = Number(config.round3MaxMarks);
  const total = Number(config.totalMaxMarks);

  if (isNaN(r1) || r1 <= 0) throw new Error('Round 1 maximum marks must be a positive number.');
  if (isNaN(r2) || r2 <= 0) throw new Error('Round 2 maximum marks must be a positive number.');
  if (isNaN(r3) || r3 <= 0) throw new Error('Round 3 maximum marks must be a positive number.');
  if (isNaN(total) || total <= 0) throw new Error('Total maximum marks must be a positive number.');

  const computedTotal = r1 + r2 + r3;
  if (computedTotal !== total) {
    throw new Error(
      `Total marks must equal the sum of all round maximum marks (${r1} + ${r2} + ${r3} = ${computedTotal}).`
    );
  }

  const payload: ScoringConfig = {
    round1MaxMarks: r1,
    round2MaxMarks: r2,
    round3MaxMarks: r3,
    totalMaxMarks: total,
    updatedAt: serverTimestamp(),
    updatedBy: auth.currentUser?.email || auth.currentUser?.uid || 'admin',
  };

  // 1. Save /settings/scoringConfig
  const docRef = doc(db, 'settings', 'scoringConfig');
  await setDoc(docRef, payload, { merge: true });

  // 2. Sync to /rounds/{roundId} documents
  await updateDoc(doc(db, 'rounds', 'round1'), { maxMarks: r1, updatedAt: serverTimestamp() }).catch(() => {});
  await updateDoc(doc(db, 'rounds', 'round2'), { maxMarks: r2, updatedAt: serverTimestamp() }).catch(() => {});
  await updateDoc(doc(db, 'rounds', 'round3'), { maxMarks: r3, updatedAt: serverTimestamp() }).catch(() => {});

  // 3. Save audit log
  const auditDocRef = doc(collection(db, 'auditLogs'));
  await setDoc(auditDocRef, {
    id: auditDocRef.id,
    adminUid: auth.currentUser?.uid || 'admin',
    adminEmail: auth.currentUser?.email || 'admin@hackathon.org',
    action: 'Scoring Config Updated',
    targetType: 'system',
    targetId: 'scoringConfig',
    timestamp: new Date().toISOString(),
    metadata: { round1MaxMarks: r1, round2MaxMarks: r2, round3MaxMarks: r3, totalMaxMarks: total },
  }).catch(() => {});

  return payload;
}

/**
 * Helper to get max marks for a given round from a ScoringConfig
 */
export function getMaxMarksForRound(
  roundIdOrNumber: string | number,
  config: ScoringConfig = DEFAULT_SCORING_CONFIG
): number {
  const roundNum = safeRoundNumber(roundIdOrNumber);
  if (roundNum === 1) return config.round1MaxMarks;
  if (roundNum === 2) return config.round2MaxMarks;
  if (roundNum === 3) return config.round3MaxMarks;
  return config.round1MaxMarks;
}
