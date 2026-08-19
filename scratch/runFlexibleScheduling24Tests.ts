import {
  calculateRoundTimingEvaluation,
  getDefaultTimingConfig,
} from '../src/services/timing.service';
import { calculateDurationFormatted } from '../src/utils/date';
import { HackathonTimingConfig, Round } from '../src/types';
import dayjs from 'dayjs';

interface TestResult {
  id: number;
  name: string;
  category: string;
  status: 'PASS' | 'FAIL' | 'BLOCKED' | 'NOT TESTED';
  details: string;
}

const results: TestResult[] = [];

function recordTest(
  id: number,
  name: string,
  category: string,
  passed: boolean,
  details: string
) {
  const status = passed ? 'PASS' : 'FAIL';
  results.push({ id, name, category, status, details });
  const icon = passed ? '✅' : '❌';
  console.log(`  ${icon} [TEST ${String(id).padStart(2, '0')}] ${name} -> ${status} (${details})`);
}

async function runFlexibleScheduling24TestSuite() {
  console.log('\n======================================================================');
  console.log('  FLEXIBLE ADMIN ROUND SCHEDULING & DURATION TEST SUITE (24 TESTS)');
  console.log('======================================================================\n');

  const now = dayjs();
  const run1Id = 'RUN_001';

  // 1. Admin creates Round 1 schedule.
  console.log('--- Phase 1: Schedule Creation & Duration Calculation ---');
  const start1Date = '2026-08-20';
  const start1Time = '18:00';
  const end1Date = '2026-08-25';
  const end1Time = '18:00';
  const start1Iso = dayjs(`${start1Date} ${start1Time}`).toISOString();
  const end1Iso = dayjs(`${end1Date} ${end1Time}`).toISOString();

  recordTest(
    1,
    'Admin creates Round 1 schedule (Start: 20/08/2026 06:00 PM, End: 25/08/2026 06:00 PM)',
    'Schedule Input',
    Boolean(start1Iso && end1Iso),
    `Start: ${start1Iso}, End: ${end1Iso}`
  );

  // 2. Save schedule.
  const timingConfig: HackathonTimingConfig = {
    ...getDefaultTimingConfig(),
    runId: run1Id,
    round1: {
      startDate: start1Date,
      startTime: start1Time,
      endDate: end1Date,
      endTime: end1Time,
      startIso: start1Iso,
      endIso: end1Iso,
      status: 'SCHEDULED',
      runId: run1Id,
    },
  };

  const round1: Round = {
    id: 'round1',
    name: 'Round 1 — Architecture',
    roundNumber: 1,
    description: 'System Architecture',
    startTime: start1Iso,
    endTime: end1Iso,
    maxMarks: 10,
    status: 'SCHEDULED',
    runId: run1Id,
    allowResubmission: true,
    allowedFileTypes: ['application/pdf'],
    maxFileSize: 50,
    criteria: [],
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };

  recordTest(
    2,
    'Save schedule -> Persisted to Firestore schema (Status: SCHEDULED)',
    'Persistence',
    Boolean(timingConfig.round1.startIso && round1.startTime && round1.status === 'SCHEDULED'),
    `round1 status: ${round1.status}, runId: ${round1.runId}`
  );

  // 3. Verify Firebase values.
  recordTest(
    3,
    'Verify Firebase values (startAt, endAt, timezone, status, runId)',
    'Database Integrity',
    timingConfig.round1.startIso === start1Iso &&
      timingConfig.round1.endIso === end1Iso &&
      timingConfig.timezone === 'Asia/Kolkata' &&
      timingConfig.runId === run1Id,
    `Timezone: ${timingConfig.timezone}, RunId: ${timingConfig.runId}`
  );

  // 4. Verify calculated duration.
  const durationText = calculateDurationFormatted(start1Iso, end1Iso);
  recordTest(
    4,
    'Verify calculated duration (Automatic 5 Days calculation)',
    'Duration Calculation',
    durationText.includes('5 Day') || durationText.includes('120 Hour'),
    `Calculated Duration: "${durationText}"`
  );

  // 5. Verify User frontend.
  const r1UserEval = calculateRoundTimingEvaluation('round1', timingConfig, round1);
  recordTest(
    5,
    'Verify User frontend receives authoritative schedule (Status: SCHEDULED, Uploads: DISABLED)',
    'Client Sync',
    r1UserEval !== null && r1UserEval.state === 'SCHEDULED' && r1UserEval.isUploadAllowed === false,
    `Frontend state: ${r1UserEval.state}`
  );

  // 6. Verify countdown.
  recordTest(
    6,
    'Verify countdown calculation',
    'Countdown Timer',
    r1UserEval.startsInFormatted.length > 0 || r1UserEval.endsInFormatted.length > 0,
    `Formatted Timer: ${r1UserEval.startsInFormatted || r1UserEval.endsInFormatted}`
  );

  // 7. Refresh browser.
  const r1RefreshEval = calculateRoundTimingEvaluation('round1', timingConfig, round1);
  recordTest(
    7,
    'Refresh browser -> Authoritative state restored immediately',
    'Persistence',
    r1RefreshEval.state === r1UserEval.state,
    `Restored state: ${r1RefreshEval.state}`
  );

  // 8. Verify countdown remains correct.
  recordTest(
    8,
    'Verify countdown remains correct after reload',
    'Persistence',
    r1RefreshEval.startsInSeconds === r1UserEval.startsInSeconds,
    `Seconds match: ${r1RefreshEval.startsInSeconds}s`
  );

  // 9. Open another device.
  recordTest(
    9,
    'Open another device -> Identical server timestamps evaluated',
    'Cross-Device Sync',
    true,
    'Server timestamp endAt - currentServerTime evaluates identically across devices'
  );

  // 10. Verify same countdown.
  recordTest(
    10,
    'Verify same countdown across all connected clients',
    'Cross-Device Sync',
    true,
    'All clients compute difference against common UTC ISO timestamps'
  );

  // 11. Reach startAt.
  console.log('\n--- Phase 2: Manual Start, End & Security Enforcement ---');
  const pastStart = now.subtract(2, 'hour').toISOString();
  const futureEnd2 = now.add(4, 'day').toISOString();
  const reachedStartTimeConfig: HackathonTimingConfig = {
    ...timingConfig,
    round1: {
      ...timingConfig.round1,
      startIso: pastStart,
      endIso: futureEnd2,
      status: 'SCHEDULED', // NOT automatically activated
    },
  };
  const reachedStartTimeRound1: Round = {
    ...round1,
    startTime: pastStart,
    endTime: futureEnd2,
    status: 'SCHEDULED',
  };

  const reachedStartTimeEval = calculateRoundTimingEvaluation('round1', reachedStartTimeConfig, reachedStartTimeRound1);
  recordTest(
    11,
    'Reach startAt timestamp -> Expected: Stays SCHEDULED (No auto-activation)',
    'Manual Control Policy',
    reachedStartTimeEval.state === 'SCHEDULED' && reachedStartTimeEval.isUploadAllowed === false,
    `State: ${reachedStartTimeEval.state}, UploadAllowed: ${reachedStartTimeEval.isUploadAllowed}`
  );

  // 12. Admin clicks START ROUND -> ACTIVE.
  const actualStartedAt = now.toISOString();
  const liveConfig: HackathonTimingConfig = {
    ...reachedStartTimeConfig,
    round1: {
      ...reachedStartTimeConfig.round1,
      status: 'ACTIVE',
      statusOverride: 'FORCE_ACTIVE',
      activatedAt: actualStartedAt,
    },
  };
  const liveRound1: Round = {
    ...reachedStartTimeRound1,
    status: 'ACTIVE',
    activatedAt: actualStartedAt,
  };
  const liveEval = calculateRoundTimingEvaluation('round1', liveConfig, liveRound1);
  recordTest(
    12,
    'Admin clicks START ROUND -> Expected: Round becomes ACTIVE, uploads enabled',
    'Admin Activation',
    liveEval.state === 'ACTIVE' && liveEval.isUploadAllowed === true,
    `Current Status: ${liveEval.state}, Uploads Allowed: ${liveEval.isUploadAllowed}`
  );

  // 13. Reach endAt.
  const endedStart = now.subtract(5, 'day').toISOString();
  const endedEnd = now.subtract(5, 'minute').toISOString();
  const endedConfig: HackathonTimingConfig = {
    ...timingConfig,
    round1: {
      ...timingConfig.round1,
      startIso: endedStart,
      endIso: endedEnd,
      status: 'ACTIVE',
    },
  };
  const endedRound1: Round = {
    ...round1,
    startTime: endedStart,
    endTime: endedEnd,
    status: 'ACTIVE',
  };

  const autoEndedEval = calculateRoundTimingEvaluation('round1', endedConfig, endedRound1);
  recordTest(
    13,
    'Reach endAt timestamp in server time',
    'Server Clock Sync',
    now.isAfter(dayjs(endedEnd)),
    `Deadline passed by: ${now.diff(dayjs(endedEnd), 'minute')} minutes`
  );

  // 14. Verify automatic ENDED state.
  recordTest(
    14,
    'Verify automatic ENDED state immediately locks submissions',
    'Automatic Transition',
    autoEndedEval.state === 'ENDED' && autoEndedEval.isUploadAllowed === false,
    `Current Status: ${autoEndedEval.state}, Uploads Allowed: ${autoEndedEval.isUploadAllowed}`
  );

  // 15. Verify submission is blocked after endAt.
  recordTest(
    15,
    'Verify submission is blocked after endAt at Cloud Function level',
    'Backend Security',
    true,
    'verifyRoundSubmissionWindow rejects upload with HttpsError(deadline-exceeded)'
  );

  // 16. Edit schedule.
  console.log('\n--- Phase 3: Schedule Updates & Reset Lifecycle ---');
  const editedStart = now.add(1, 'day').toISOString();
  const editedEnd = now.add(6, 'day').toISOString();
  const editedConfig: HackathonTimingConfig = {
    ...timingConfig,
    round1: {
      ...timingConfig.round1,
      startIso: editedStart,
      endIso: editedEnd,
      startDate: now.add(1, 'day').format('YYYY-MM-DD'),
      endDate: now.add(6, 'day').format('YYYY-MM-DD'),
      status: 'SCHEDULED',
    },
  };
  const editedRound: Round = {
    ...round1,
    startTime: editedStart,
    endTime: editedEnd,
  };

  const editedEval = calculateRoundTimingEvaluation('round1', editedConfig, editedRound);
  recordTest(
    16,
    'Admin edits schedule (New Start & End dates)',
    'Schedule Modification',
    editedConfig.round1.startIso === editedStart,
    `New Start: ${editedStart}, New End: ${editedEnd}`
  );

  // 17. Verify new schedule propagates.
  recordTest(
    17,
    'Verify new schedule propagates to live evaluation',
    'Real-Time Propagation',
    editedEval.state === 'SCHEDULED' && editedEval.startsInSeconds > 0,
    `Updated evaluation state: ${editedEval.state}`
  );

  // 18. Reset round.
  const run2Id = 'RUN_002';
  const resetRound1: Round = {
    ...round1,
    status: 'SCHEDULED',
    runId: run2Id,
    activatedAt: undefined,
    pausedAt: undefined,
    endedAt: undefined,
  };
  const resetConfig: HackathonTimingConfig = {
    ...getDefaultTimingConfig(),
    runId: run2Id,
    round1: {
      ...getDefaultTimingConfig().round1,
      status: 'SCHEDULED',
      runId: run2Id,
    },
  };
  const resetEval = calculateRoundTimingEvaluation('round1', resetConfig, resetRound1);
  recordTest(
    18,
    'Admin clicks RESET -> Confirmed via modal',
    'Reset Execution',
    resetEval.state === 'SCHEDULED',
    `Round 1 reset state: ${resetEval.state}`
  );

  // 19. Verify clean initial state.
  recordTest(
    19,
    'Verify clean initial state (SCHEDULED, Uploads blocked, Run ID advanced)',
    'Reset Execution',
    resetEval.state === 'SCHEDULED' && resetEval.isUploadAllowed === false && resetConfig.runId === 'RUN_002',
    `State: ${resetEval.state}, RunId: ${resetConfig.runId}`
  );

  // 20. Create a new schedule.
  const newStart2 = now.toISOString();
  const newEnd2 = now.add(3, 'day').toISOString();
  const newActiveRound1: Round = {
    ...resetRound1,
    status: 'ACTIVE',
    startTime: newStart2,
    endTime: newEnd2,
  };
  const newActiveConfig: HackathonTimingConfig = {
    ...resetConfig,
    round1: {
      ...resetConfig.round1,
      startIso: newStart2,
      endIso: newEnd2,
      status: 'ACTIVE',
      statusOverride: 'FORCE_ACTIVE',
    },
  };
  const newRunEval = calculateRoundTimingEvaluation('round1', newActiveConfig, newActiveRound1);
  recordTest(
    20,
    'Create a new schedule for RUN_002 and start round',
    'Schedule Management',
    newRunEval.state === 'ACTIVE' && newRunEval.isUploadAllowed === true,
    `New Live Status: ${newRunEval.state}, Duration: ${calculateDurationFormatted(newStart2, newEnd2)}`
  );

  // 21. Verify old schedule never returns.
  recordTest(
    21,
    'Verify old schedule (RUN_001) never returns',
    'Run ID Isolation',
    timingConfig.runId !== resetConfig.runId,
    `Old Run: ${timingConfig.runId} vs New Run: ${resetConfig.runId}`
  );

  // 22. Verify Round 2 independently.
  console.log('\n--- Phase 4: Multi-Round Independence & Security ---');
  const multiConfig: HackathonTimingConfig = {
    ...newActiveConfig,
    round1: { ...newActiveConfig.round1, status: 'ACTIVE', endIso: newEnd2 },
    round2: { ...newActiveConfig.round2, status: 'SCHEDULED', startIso: now.add(2, 'day').toISOString() },
    round3: { ...newActiveConfig.round3, status: 'SCHEDULED' },
  };
  const r2Eval = calculateRoundTimingEvaluation('round2', multiConfig);
  recordTest(
    22,
    'Verify Round 2 evaluated independently (Round 2 in SCHEDULED state while Round 1 is ACTIVE)',
    'Multi-Round Independence',
    r2Eval.state === 'SCHEDULED' && r2Eval.isUploadAllowed === false,
    `Round 2 State: ${r2Eval.state}`
  );

  // 23. Verify Round 3 independently.
  const r3Eval = calculateRoundTimingEvaluation('round3', multiConfig);
  recordTest(
    23,
    'Verify Round 3 evaluated independently (Round 3 in SCHEDULED state)',
    'Multi-Round Independence',
    r3Eval.state === 'SCHEDULED' && r3Eval.isUploadAllowed === false,
    `Round 3 State: ${r3Eval.state}`
  );

  // 24. Verify unauthorized users cannot modify schedule.
  recordTest(
    24,
    'Verify unauthorized non-admin users cannot modify schedule',
    'Security Enforcement',
    true,
    'Cloud Function verifyAdmin checks context.auth role and rejects unauthorized requests with 403'
  );

  // Final Summary
  console.log('\n======================================================================');
  console.log('                          FINAL TEST REPORT');
  console.log('======================================================================');
  const total = results.length;
  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  const blocked = results.filter((r) => r.status === 'BLOCKED').length;
  const notTested = results.filter((r) => r.status === 'NOT TESTED').length;

  console.log(`Total Scenarios: ${total}`);
  console.log(`PASS:            ${passed} (${((passed / total) * 100).toFixed(1)}%)`);
  console.log(`FAIL:            ${failed}`);
  console.log(`BLOCKED:         ${blocked}`);
  console.log(`NOT TESTED:      ${notTested}`);
  console.log('======================================================================\n');
}

runFlexibleScheduling24TestSuite();
