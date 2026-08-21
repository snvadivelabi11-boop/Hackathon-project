import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions, isFirebaseConfigured } from '../firebase/config';
import { Round, RoundStatus } from '../types';
import dayjs from 'dayjs';

export const DEFAULT_ROUNDS_STRUCTURE: Round[] = [
  {
    id: 'round1',
    name: 'Round 1 — Architecture & System Flow',
    roundNumber: 1,
    description: 'Design modular cloud architecture, data pipeline, and system flow diagrams.',
    problemStatement: 'Develop a scalable, high-concurrency cloud architecture for an enterprise real-time event pipeline handling 100,000 requests per second with strict zero data loss and fault tolerance.',
    instructions: [
      'Submit architecture document in PDF or image format.',
      'Include end-to-end data flow and database schemas.',
      'Maximum Score: 10 Marks.',
    ],
    startTime: dayjs().toISOString(),
    endTime: dayjs().add(5, 'day').toISOString(),
    maxMarks: 10,
    status: 'SCHEDULED',
    allowResubmission: true,
    allowedFileTypes: ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'],
    maxFileSize: 50,
    criteria: [
      { id: 'c1', name: 'System Scalability & Concurrency', maxMarks: 4 },
      { id: 'c2', name: 'Fault Tolerance & Failover', maxMarks: 3 },
      { id: 'c3', name: 'Database & Data Partitioning', maxMarks: 3 },
    ],
    createdAt: dayjs().toISOString(),
    updatedAt: dayjs().toISOString(),
  },
  {
    id: 'round2',
    name: 'Round 2 — PPT Presentation',
    roundNumber: 2,
    description: 'Engineering slide presentation covering solution architecture, algorithms, and milestones.',
    problemStatement: 'Prepare technical presentation slides detailing algorithm complexity, API contracts, and prototype roadmap.',
    instructions: [
      'Upload presentation deck in .ppt, .pptx, or .pdf format.',
      'Maximum Score: 30 Marks.',
    ],
    startTime: dayjs().toISOString(),
    endTime: dayjs().add(5, 'day').toISOString(),
    maxMarks: 30,
    status: 'SCHEDULED',
    allowResubmission: true,
    allowedFileTypes: [
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/pdf',
    ],
    maxFileSize: 50,
    criteria: [
      { id: 'c4', name: 'Technical Depth & Architecture', maxMarks: 10 },
      { id: 'c5', name: 'Algorithm Feasibility', maxMarks: 10 },
      { id: 'c6', name: 'Clarity & Delivery', maxMarks: 10 },
    ],
    createdAt: dayjs().toISOString(),
    updatedAt: dayjs().toISOString(),
  },
  {
    id: 'round3',
    name: 'Round 3 — Prototype & GitHub Repository',
    roundNumber: 3,
    description: 'Working functional code prototype, deployment, and public GitHub repository.',
    problemStatement: 'Submit working prototype GitHub repository URL and live application deployment.',
    instructions: [
      'Provide public GitHub repository URL.',
      'Provide optional live web/app prototype link.',
      'Maximum Score: 50 Marks.',
    ],
    startTime: dayjs().toISOString(),
    endTime: dayjs().add(5, 'day').toISOString(),
    maxMarks: 50,
    status: 'SCHEDULED',
    allowResubmission: true,
    allowedFileTypes: [],
    maxFileSize: 0,
    criteria: [
      { id: 'c7', name: 'Code Quality & Modularity', maxMarks: 15 },
      { id: 'c8', name: 'Feature Completeness', maxMarks: 20 },
      { id: 'c9', name: 'UI/UX & Deployment Stability', maxMarks: 15 },
    ],
    createdAt: dayjs().toISOString(),
    updatedAt: dayjs().toISOString(),
  },
];

/**
 * Initializes default 3 rounds in Firestore if collection is empty
 */
export async function initializeDefaultRoundsIfEmpty(): Promise<void> {
  try {
    const snap = await getDocs(collection(db, 'rounds'));
    if (snap.empty) {
      for (const r of DEFAULT_ROUNDS_STRUCTURE) {
        await setDoc(doc(db, 'rounds', r.id), {
          ...r,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    }
  } catch (err) {
    console.warn('[RoundsService] initializeDefaultRounds error:', err);
  }
}

/**
 * Subscribes to real-time updates for all hackathon rounds from Firestore
 */
export function subscribeToRounds(callback: (rounds: Round[]) => void): () => void {
  const q = query(collection(db, 'rounds'), orderBy('roundNumber', 'asc'));
  return onSnapshot(
    q,
    (snapshot) => {
      const rounds: Round[] = [];
      snapshot.forEach((doc) => {
        rounds.push({ id: doc.id, ...doc.data() } as Round);
      });

      if (rounds.length === 0) {
        initializeDefaultRoundsIfEmpty();
        callback(DEFAULT_ROUNDS_STRUCTURE);
      } else {
        callback(rounds);
      }
    },
    (err) => {
      console.warn('[RoundsService] subscribeToRounds error:', err);
      callback(DEFAULT_ROUNDS_STRUCTURE);
    }
  );
}

/**
 * Subscribes to a single round from Firestore
 */
export function subscribeToRound(roundId: string, callback: (round: Round | null) => void): () => void {
  const roundDocRef = doc(db, 'rounds', roundId);
  return onSnapshot(
    roundDocRef,
    (snap) => {
      if (snap.exists()) {
        callback({ id: snap.id, ...snap.data() } as Round);
      } else {
        const fallback = DEFAULT_ROUNDS_STRUCTURE.find((r) => r.id === roundId) || null;
        callback(fallback);
      }
    },
    (err) => {
      console.warn('[RoundsService] subscribeToRound error:', err);
      const fallback = DEFAULT_ROUNDS_STRUCTURE.find((r) => r.id === roundId) || null;
      callback(fallback);
    }
  );
}

/**
 * Starts / Activates a round explicitly via manual Admin action.
 * Preserves the exact scheduled end time and keeps /rounds/{roundId} and /settings/timingConfig 100% in sync.
 */
export async function startRound(roundId: string): Promise<void> {
  const roundRef = doc(db, 'rounds', roundId);
  const timingRef = doc(db, 'settings', 'timingConfig');
  const snap = await getDoc(roundRef);
  const nowIso = new Date().toISOString();

  let endIso = snap.exists() ? (snap.data()?.endTime || snap.data()?.scheduledEndAt) : null;
  let startIso = snap.exists() ? (snap.data()?.startTime || snap.data()?.scheduledStartAt) : null;

  if (!startIso) startIso = nowIso;
  if (!endIso) {
    endIso = dayjs(startIso).add(12, 'hour').toISOString();
  }

  const roundKey = roundId.includes('1') ? 'round1' : roundId.includes('2') ? 'round2' : 'round3';

  const batch = writeBatch(db);
  batch.set(
    roundRef,
    {
      status: 'ACTIVE',
      actualStartedAt: serverTimestamp(),
      activatedAt: serverTimestamp(),
      startTime: startIso,
      endTime: endIso,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  batch.set(
    timingRef,
    {
      [roundKey]: {
        status: 'ACTIVE',
        statusOverride: 'FORCE_ACTIVE',
        activatedAt: serverTimestamp(),
        startIso: startIso,
        endIso: endIso,
      },
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  await batch.commit();

  try {
    const fn = httpsCallable(functions, 'startRound');
    await fn({ roundId });
  } catch (err) {
    // Cloud function is optional audit
  }
}

/**
 * Saves a round schedule with validation.
 * Core Principle: Schedule != Activate. Status becomes SCHEDULED.
 * Synchronizes /rounds/{roundId} and /settings/timingConfig atomically.
 */
export async function saveRoundSchedule(
  roundId: string,
  schedule: {
    startDate: string;
    startTime: string;
    endDate: string;
    endTime: string;
    startIso: string;
    endIso: string;
  }
): Promise<void> {
  const roundRef = doc(db, 'rounds', roundId);
  const timingRef = doc(db, 'settings', 'timingConfig');
  const snap = await getDoc(roundRef);
  const currentStatus = snap.exists() ? snap.data()?.status : 'SCHEDULED';
  const status = (currentStatus === 'ACTIVE' || currentStatus === 'LIVE') ? currentStatus : 'SCHEDULED';
  const roundKey = roundId.includes('1') ? 'round1' : roundId.includes('2') ? 'round2' : 'round3';

  const batch = writeBatch(db);
  batch.set(
    roundRef,
    {
      scheduledStartAt: schedule.startIso,
      scheduledEndAt: schedule.endIso,
      startTime: schedule.startIso,
      endTime: schedule.endIso,
      startAt: schedule.startIso,
      endAt: schedule.endIso,
      actualStartedAt: schedule.startIso,
      startDate: schedule.startDate,
      startTimeFormatted: schedule.startTime,
      endDate: schedule.endDate,
      endTimeFormatted: schedule.endTime,
      status: status,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  batch.set(
    timingRef,
    {
      [roundKey]: {
        startDate: schedule.startDate,
        startTime: schedule.startTime,
        endDate: schedule.endDate,
        endTime: schedule.endTime,
        startIso: schedule.startIso,
        endIso: schedule.endIso,
        startAt: schedule.startIso,
        endAt: schedule.endIso,
        status: status,
        statusOverride: status === 'ACTIVE' ? 'FORCE_ACTIVE' : 'AUTO',
      },
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  await batch.commit();

  try {
    const fn = httpsCallable(functions, 'saveRoundSchedule');
    await fn({ roundId, ...schedule });
  } catch (err) {
    // Cloud function is optional audit
  }
}

export async function stopRound(roundId: string): Promise<void> {
  const roundKey = roundId.includes('1') ? 'round1' : roundId.includes('2') ? 'round2' : 'round3';
  const nowIso = new Date().toISOString();
  const batch = writeBatch(db);

  batch.update(doc(db, 'rounds', roundId), {
    status: 'ENDED',
    actualEndedAt: serverTimestamp(),
    endedAt: serverTimestamp(),
    endTime: nowIso,
    updatedAt: serverTimestamp(),
  });

  batch.set(
    doc(db, 'settings', 'timingConfig'),
    {
      [roundKey]: {
        status: 'ENDED',
        statusOverride: 'FORCE_CLOSED',
        endIso: nowIso,
      },
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  await batch.commit();

  try {
    const fn = httpsCallable(functions, 'stopRound');
    await fn({ roundId });
  } catch (err) {
    // Cloud function is optional audit
  }
}

export const endRound = stopRound;

/**
 * Sets status directly (SCHEDULED, ACTIVE, PAUSED, ENDED, LOCKED, NOT_STARTED)
 */
export async function setRoundStatus(roundId: string, status: RoundStatus): Promise<void> {
  await updateDoc(doc(db, 'rounds', roundId), {
    status,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Resets a single round or the entire hackathon state.
 * Returns status to NOT_STARTED / SCHEDULED and advances runId.
 * Strictly preserves submissions, scores, teams, and problem statements.
 */
export async function resetRound(roundId?: string): Promise<{
  success: boolean;
  previousRunId?: string;
  newRunId?: string;
  message: string;
}> {
  try {
    const fn = httpsCallable(functions, 'resetRoundState');
    const res = await fn({ roundId });
    return res.data as any;
  } catch (err: any) {
    console.warn('[RoundsService] Cloud Function resetRoundState fallback to direct Firestore:', err);

    const now = serverTimestamp();
    const batch = writeBatch(db);

    const timingDocRef = doc(db, 'settings', 'timingConfig');
    const timingSnap = await getDoc(timingDocRef);
    const prevTiming = timingSnap.exists() ? (timingSnap.data() as any) : null;
    const prevRunId = prevTiming?.runId || 'RUN_001';

    let nextNum = 2;
    const match = prevRunId.match(/RUN_(\d+)/i);
    if (match) {
      nextNum = parseInt(match[1], 10) + 1;
    }
    const newRunId = `RUN_${String(nextNum).padStart(3, '0')}`;

    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + 5 * 24 * 60 * 60 * 1000);
    const startIso = startDate.toISOString();
    const endIso = endDate.toISOString();

    const freshRoundConfig = {
      startDate: startDate.toISOString().split('T')[0],
      startTime: '09:00',
      endDate: endDate.toISOString().split('T')[0],
      endTime: '18:00',
      startIso,
      endIso,
      status: 'NOT_STARTED' as const,
      statusOverride: 'AUTO' as const,
      runId: newRunId,
    };

    if (roundId) {
      const roundRef = doc(db, 'rounds', roundId);
      batch.set(
        roundRef,
        {
          status: 'NOT_STARTED',
          runId: newRunId,
          startTime: startIso,
          endTime: endIso,
          activatedAt: null,
          activatedBy: null,
          pausedAt: null,
          endedAt: null,
          updatedAt: now,
        },
        { merge: true }
      );

      const roundKey = roundId.includes('1') ? 'round1' : roundId.includes('2') ? 'round2' : 'round3';
      batch.set(
        timingDocRef,
        {
          runId: newRunId,
          [roundKey]: { ...freshRoundConfig },
          lastResetAt: now,
          updatedAt: now,
        },
        { merge: true }
      );
    } else {
      batch.set(
        timingDocRef,
        {
          hackathonStartDate: freshRoundConfig.startDate,
          hackathonStartTime: '09:00',
          hackathonEndDate: freshRoundConfig.endDate,
          hackathonEndTime: '18:00',
          hackathonStartIso: startIso,
          hackathonEndIso: endIso,
          timezone: 'Asia/Kolkata',
          runId: newRunId,
          round1: { ...freshRoundConfig },
          round2: { ...freshRoundConfig },
          round3: { ...freshRoundConfig },
          lastResetAt: now,
          updatedAt: now,
        },
        { merge: true }
      );

      for (const rid of ['round1', 'round2', 'round3']) {
        const roundRef = doc(db, 'rounds', rid);
        batch.set(
          roundRef,
          {
            status: 'NOT_STARTED',
            runId: newRunId,
            startTime: startIso,
            endTime: endIso,
            activatedAt: null,
            activatedBy: null,
            pausedAt: null,
            endedAt: null,
            updatedAt: now,
          },
          { merge: true }
        );
      }
    }

    await batch.commit();
    return {
      success: true,
      previousRunId: prevRunId,
      newRunId,
      message: roundId ? `Round ${roundId} reset successfully.` : `Hackathon reset successfully to ${newRunId}.`,
    };
  }
}

export const resetHackathonState = () => resetRound();

/**
 * Updates round rubric and details
 */
export async function updateRoundConfig(roundId: string, config: Partial<Round>): Promise<void> {
  try {
    const fn = httpsCallable(functions, 'updateRoundConfig');
    await fn({ roundId, ...config });
    return;
  } catch (err) {
    console.warn('[RoundsService] Cloud Function updateRoundConfig fallback to direct Firestore:', err);
  }

  await updateDoc(doc(db, 'rounds', roundId), {
    ...config,
    updatedAt: serverTimestamp(),
  });
}

export const resetRoundState = resetRound;
export { subscribeToTimingConfig } from './timing.service';

