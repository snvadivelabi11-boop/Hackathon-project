import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { HackathonTimingConfig, RoundTimingConfig, Round, RoundStatus } from '../types';
import dayjs from 'dayjs';
import { toIST } from '../utils/date';

/**
 * Generates standard default 5-day hackathon timing window:
 * Status defaults to SCHEDULED (Schedule != Activate).
 */
export function getDefaultTimingConfig(): HackathonTimingConfig {
  const base = toIST();
  const startDay = base.hour(9).minute(0).second(0).millisecond(0);
  const endDay = base.add(5, 'day').hour(18).minute(0).second(0).millisecond(0);

  const defaultRound: RoundTimingConfig = {
    startDate: startDay.format('YYYY-MM-DD'),
    startTime: '09:00',
    endDate: endDay.format('YYYY-MM-DD'),
    endTime: '18:00',
    startIso: startDay.toISOString(),
    endIso: endDay.toISOString(),
    status: 'SCHEDULED',
    statusOverride: 'AUTO',
  };

  return {
    hackathonStartDate: startDay.format('YYYY-MM-DD'),
    hackathonStartTime: '09:00',
    hackathonEndDate: endDay.format('YYYY-MM-DD'),
    hackathonEndTime: '18:00',
    hackathonStartIso: startDay.toISOString(),
    endIso: endDay.toISOString(),
    hackathonEndIso: endDay.toISOString(),
    timezone: 'Asia/Kolkata',
    runId: 'RUN_001',
    round1: { ...defaultRound, runId: 'RUN_001' },
    round2: { ...defaultRound, runId: 'RUN_001' },
    round3: { ...defaultRound, runId: 'RUN_001' },
    updatedAt: new Date().toISOString(),
    updatedBy: 'system',
  } as HackathonTimingConfig;
}

export const DEFAULT_TIMING_CONFIG = getDefaultTimingConfig();

/**
 * Subscribes in real-time to global Hackathon Timing Configuration (/settings/timingConfig)
 */
export function subscribeToTimingConfig(
  callback: (config: HackathonTimingConfig) => void
): () => void {
  const docRef = doc(db, 'settings', 'timingConfig');
  return onSnapshot(
    docRef,
    (snap) => {
      if (snap.exists()) {
        const d = snap.data() as HackathonTimingConfig;
        callback(d);
      } else {
        callback(DEFAULT_TIMING_CONFIG);
      }
    },
    (err) => {
      console.warn('[TimingService] subscribeToTimingConfig fallback:', err);
      callback(DEFAULT_TIMING_CONFIG);
    }
  );
}

/**
 * Saves Admin-configured global timing and syncs to /rounds/round1..3.
 * Core Principle: Schedule != Activate.
 * Preserves active/paused status if currently running, otherwise stays SCHEDULED.
 */
export async function saveTimingConfig(
  config: HackathonTimingConfig,
  adminUser: { uid?: string; email?: string }
): Promise<void> {
  const batch = writeBatch(db);
  const now = serverTimestamp();

  // 1. Save to /settings/timingConfig
  const timingRef = doc(db, 'settings', 'timingConfig');
  batch.set(
    timingRef,
    {
      ...config,
      updatedAt: now,
      updatedBy: adminUser.email || adminUser.uid || 'admin',
    },
    { merge: true }
  );

  // 2. Synchronize to individual round documents
  const roundsToSync = [
    { id: 'round1', num: 1, cfg: config.round1, name: 'Round 1 — Architecture & System Flow' },
    { id: 'round2', num: 2, cfg: config.round2, name: 'Round 2 — PPT Presentation' },
    { id: 'round3', num: 3, cfg: config.round3, name: 'Round 3 — Prototype & GitHub Repository' },
  ];

  for (const r of roundsToSync) {
    const roundRef = doc(db, 'rounds', r.id);
    const startIso = r.cfg?.startIso || config.hackathonStartIso;
    const endIso = r.cfg?.endIso || config.hackathonEndIso;

    // Respect existing status or override, default to SCHEDULED
    let status: RoundStatus = r.cfg?.status || 'SCHEDULED';
    if (r.cfg?.statusOverride === 'LOCKED') status = 'LOCKED';
    if (r.cfg?.statusOverride === 'FORCE_CLOSED') status = 'ENDED';
    if (r.cfg?.statusOverride === 'FORCE_ACTIVE') status = 'ACTIVE';

    batch.set(
      roundRef,
      {
        id: r.id,
        roundNumber: r.num,
        startTime: startIso,
        endTime: endIso,
        status,
        updatedAt: now,
      },
      { merge: true }
    );
  }

  // 3. Log Audit
  const auditRef = doc(db, 'auditLogs', `timing_${Date.now()}`);
  batch.set(auditRef, {
    action: 'TIMING_CONFIG_UPDATED',
    category: 'timing',
    adminUid: adminUser.uid || 'admin',
    adminEmail: adminUser.email || 'admin@hackathon.org',
    targetId: 'timingConfig',
    details: {
      hackathonStart: config.hackathonStartIso,
      hackathonEnd: config.hackathonEndIso,
      round1: config.round1,
      round2: config.round2,
      round3: config.round3,
    },
    timestamp: now,
  });

  await batch.commit();
}

export interface RoundTimingEvaluationResult {
  state: RoundStatus;
  isUploadAllowed: boolean;
  statusMessage: string;
  badgeColor: 'blue' | 'green' | 'red' | 'orange' | 'default';
  startTime: dayjs.Dayjs;
  endTime: dayjs.Dayjs;
  startsInSeconds: number;
  endsInSeconds: number;
  startsInFormatted: string;
  endsInFormatted: string;
}

/**
 * Calculates authoritative timing state for a round based on status & server time.
 * Single Authoritative State Machine: SCHEDULED -> ACTIVE <-> PAUSED -> ENDED
 */
export function calculateRoundTimingEvaluation(
  roundIdOrNum: string | number,
  timingConfig?: HackathonTimingConfig | null,
  roundDoc?: Round | null
): RoundTimingEvaluationResult {
  const roundKey = String(roundIdOrNum).toLowerCase().includes('2')
    ? 'round2'
    : String(roundIdOrNum).toLowerCase().includes('3')
    ? 'round3'
    : 'round1';

  const cfg = timingConfig?.[roundKey];

  // Resolve start & end timestamps
  let startIso = cfg?.startIso || roundDoc?.startTime || timingConfig?.hackathonStartIso;
  let endIso = cfg?.endIso || roundDoc?.endTime || timingConfig?.hackathonEndIso;

  if (!startIso) startIso = DEFAULT_TIMING_CONFIG.round1.startIso;
  if (!endIso) endIso = DEFAULT_TIMING_CONFIG.round1.endIso;

  const now = toIST();
  const startTime = toIST(startIso);
  const endTime = toIST(endIso);

  const diffStartMs = startTime.diff(now);
  const diffEndMs = endTime.diff(now);

  const startsInSeconds = Math.max(0, Math.floor(diffStartMs / 1000));
  const endsInSeconds = Math.max(0, Math.floor(diffEndMs / 1000));

  const formatCountdown = (totalSecs: number) => {
    const days = Math.floor(totalSecs / 86400);
    const hours = Math.floor((totalSecs % 86400) / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;
    const pad = (n: number) => String(n).padStart(2, '0');
    if (days > 0) {
      return `${days}d : ${pad(hours)}h : ${pad(mins)}m : ${pad(secs)}s`;
    }
    return `${pad(hours)} : ${pad(mins)} : ${pad(secs)}`;
  };

  // Determine effective status from roundDoc or timingConfig
  const effectiveStatus: RoundStatus = roundDoc?.status || cfg?.status || 'SCHEDULED';

  // 1. Explicit LOCKED
  if (effectiveStatus === 'LOCKED' || cfg?.statusOverride === 'LOCKED') {
    return {
      state: 'LOCKED',
      isUploadAllowed: false,
      statusMessage: 'Round is locked by Administrator.',
      badgeColor: 'default',
      startTime,
      endTime,
      startsInSeconds: 0,
      endsInSeconds: 0,
      startsInFormatted: '00:00:00',
      endsInFormatted: '00:00:00',
    };
  }

  // 2. Explicit or Deadline ENDED
  if (
    effectiveStatus === 'ENDED' ||
    cfg?.statusOverride === 'FORCE_CLOSED' ||
    (effectiveStatus === 'ACTIVE' && diffEndMs <= 0) ||
    (effectiveStatus === 'LIVE' && diffEndMs <= 0)
  ) {
    return {
      state: 'ENDED',
      isUploadAllowed: false,
      statusMessage: 'Round has ended. Submissions are closed.',
      badgeColor: 'red',
      startTime,
      endTime,
      startsInSeconds: 0,
      endsInSeconds: 0,
      startsInFormatted: '00:00:00',
      endsInFormatted: '00:00:00',
    };
  }

  // 3. Explicit ACTIVE / LIVE (Set ONLY via manual Admin START action)
  if (
    effectiveStatus === 'ACTIVE' ||
    effectiveStatus === 'LIVE' ||
    cfg?.statusOverride === 'FORCE_ACTIVE'
  ) {
    return {
      state: 'ACTIVE',
      isUploadAllowed: true,
      statusMessage: 'Round is LIVE and accepting submissions.',
      badgeColor: 'green',
      startTime,
      endTime,
      startsInSeconds: 0,
      endsInSeconds,
      startsInFormatted: '00:00:00',
      endsInFormatted: formatCountdown(endsInSeconds),
    };
  }

  // 4. Explicit PAUSED
  if (effectiveStatus === 'PAUSED') {
    return {
      state: 'PAUSED',
      isUploadAllowed: false,
      statusMessage: 'Round is paused by Administrator. Submissions temporarily suspended.',
      badgeColor: 'orange',
      startTime,
      endTime,
      startsInSeconds: 0,
      endsInSeconds,
      startsInFormatted: '00:00:00',
      endsInFormatted: formatCountdown(endsInSeconds),
    };
  }

  // 5. SCHEDULED / NOT_STARTED / UPCOMING (Manual Admin START required)
  // Even if current time reaches/passes scheduled start time, round remains SCHEDULED until Admin clicks START ROUND.
  return {
    state: 'SCHEDULED',
    isUploadAllowed: false,
    statusMessage: 'Waiting for Admin to start this round.',
    badgeColor: 'blue',
    startTime,
    endTime,
    startsInSeconds,
    endsInSeconds,
    startsInFormatted: formatCountdown(startsInSeconds),
    endsInFormatted: formatCountdown(endsInSeconds),
  };
}

/**
 * Live round timing helper for Admin & Team UI
 */
export function calculateLiveRoundTiming(
  round: Round,
  timingConfig?: HackathonTimingConfig | null
) {
  const evalRes = calculateRoundTimingEvaluation(round.id, timingConfig, round);
  return {
    liveStatus: evalRes.state,
    isUploadAllowed: evalRes.isUploadAllowed,
    remainingSeconds: evalRes.endsInSeconds,
    statusMessage: evalRes.statusMessage,
  };
}

/**
 * Formats remaining seconds as "4d : 23h : 59m : 59s"
 */
export function formatRemainingSecondsDetailed(totalSecs: number): string {
  if (totalSecs <= 0) return '00 : 00 : 00';
  const days = Math.floor(totalSecs / 86400);
  const hours = Math.floor((totalSecs % 86400) / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (days > 0) {
    return `${days}d : ${pad(hours)}h : ${pad(mins)}m : ${pad(secs)}s`;
  }
  return `${pad(hours)} : ${pad(mins)} : ${pad(secs)}`;
}
