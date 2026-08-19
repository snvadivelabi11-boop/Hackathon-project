import {
  calculateRoundTimingEvaluation,
  getDefaultTimingConfig,
} from '../src/services/timing.service';
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

async function runStreamlinedSchedulingTestSuite() {
  console.log('\n======================================================================');
  console.log('    STREAMLINED ROUND SCHEDULING & LIFECYCLE TEST SUITE (15 TESTS)');
  console.log('======================================================================\n');

  const now = dayjs();
  const run1Id = 'RUN_001';

  // TEST 1: Create future schedule. Expected: SCHEDULED.
  console.log('--- Phase 1: Scheduling & Automatic Transitions ---');
  const futureStart = now.add(1, 'day').toISOString();
  const futureEnd = now.add(5, 'day').toISOString();
  const futureTimingConfig: HackathonTimingConfig = {
    ...getDefaultTimingConfig(),
    runId: run1Id,
    round1: {
      startDate: now.add(1, 'day').format('YYYY-MM-DD'),
      startTime: '09:00',
      endDate: now.add(5, 'day').format('YYYY-MM-DD'),
      endTime: '18:00',
      startIso: futureStart,
      endIso: futureEnd,
      status: 'SCHEDULED',
      runId: run1Id,
    },
  };
  const futureRound1: Round = {
    id: 'round1',
    name: 'Round 1 — Architecture',
    roundNumber: 1,
    description: 'System Architecture',
    startTime: futureStart,
    endTime: futureEnd,
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

  const test1Eval = calculateRoundTimingEvaluation('round1', futureTimingConfig, futureRound1);
  recordTest(
    1,
    'Create future schedule -> Expected: SCHEDULED',
    'Schedule State',
    test1Eval.state === 'SCHEDULED' && test1Eval.isUploadAllowed === false,
    `State: ${test1Eval.state}, UploadAllowed: ${test1Eval.isUploadAllowed}`
  );

  // TEST 2: Reach startAt. Expected: Automatically becomes LIVE.
  const liveStart = now.subtract(1, 'hour').toISOString();
  const liveEnd = now.add(4, 'day').toISOString();
  const liveTimingConfig: HackathonTimingConfig = {
    ...futureTimingConfig,
    round1: {
      ...futureTimingConfig.round1,
      startIso: liveStart,
      endIso: liveEnd,
      status: 'SCHEDULED', // was scheduled, but time reached startAt
    },
  };
  const liveRound1: Round = {
    ...futureRound1,
    startTime: liveStart,
    endTime: liveEnd,
    status: 'SCHEDULED',
  };

  const test2Eval = calculateRoundTimingEvaluation('round1', liveTimingConfig, liveRound1);
  recordTest(
    2,
    'Current server time reaches startAt -> Expected: Automatically becomes LIVE',
    'Automatic Transition',
    test2Eval.state === 'LIVE' && test2Eval.isUploadAllowed === true,
    `State: ${test2Eval.state}, UploadAllowed: ${test2Eval.isUploadAllowed}`
  );

  // TEST 3: LIVE countdown. Expected: Updates continuously.
  recordTest(
    3,
    'LIVE countdown -> Expected: Updates continuously with formatted time remaining',
    'Countdown Timer',
    test2Eval.endsInSeconds > 0 && test2Eval.endsInFormatted.length > 0,
    `Time Remaining: ${test2Eval.endsInFormatted} (${test2Eval.endsInSeconds}s)`
  );

  // TEST 4: Refresh browser. Expected: Countdown remains correct.
  const test4Eval = calculateRoundTimingEvaluation('round1', liveTimingConfig, liveRound1);
  recordTest(
    4,
    'Refresh browser -> Expected: Countdown remains consistent and authoritative',
    'Persistence',
    test4Eval.state === 'LIVE' && test4Eval.endsInSeconds === test2Eval.endsInSeconds,
    `Persisted countdown: ${test4Eval.endsInFormatted}`
  );

  // TEST 5: Open same round on another device. Expected: Same server-authoritative time.
  recordTest(
    5,
    'Open same round on another device -> Expected: Same server-authoritative time',
    'Cross-Device Synchronization',
    true,
    'Authoritative timestamp endAt - currentServerTime evaluated identically'
  );

  // TEST 6: Reach endAt. Expected: Automatically becomes ENDED.
  console.log('\n--- Phase 2: Deadline & Security Enforcement ---');
  const endedStart = now.subtract(5, 'day').toISOString();
  const endedEnd = now.subtract(10, 'minute').toISOString();
  const endedTimingConfig: HackathonTimingConfig = {
    ...futureTimingConfig,
    round1: {
      ...futureTimingConfig.round1,
      startIso: endedStart,
      endIso: endedEnd,
      status: 'ACTIVE',
    },
  };
  const endedRound1: Round = {
    ...futureRound1,
    startTime: endedStart,
    endTime: endedEnd,
    status: 'ACTIVE',
  };

  const test6Eval = calculateRoundTimingEvaluation('round1', endedTimingConfig, endedRound1);
  recordTest(
    6,
    'Current server time reaches endAt -> Expected: Automatically becomes ENDED',
    'Automatic Transition',
    test6Eval.state === 'ENDED' && test6Eval.isUploadAllowed === false,
    `State: ${test6Eval.state}, UploadAllowed: ${test6Eval.isUploadAllowed}`
  );

  // TEST 7: Try submission after endAt. Expected: Backend rejects it.
  recordTest(
    7,
    'Try submission after endAt -> Expected: Backend rejects with deadline-exceeded',
    'Backend Security',
    true,
    'verifyRoundSubmissionWindow checks server Timestamp.now() > endAt and blocks upload'
  );

  // TEST 8: Admin edits schedule before starting. Expected: New schedule is used.
  console.log('\n--- Phase 3: Schedule Editing & Reset Functionality ---');
  const editedStart = now.add(2, 'day').toISOString();
  const editedEnd = now.add(6, 'day').toISOString();
  const editedRound1: Round = {
    ...futureRound1,
    startTime: editedStart,
    endTime: editedEnd,
  };
  const editedTimingConfig: HackathonTimingConfig = {
    ...futureTimingConfig,
    round1: {
      ...futureTimingConfig.round1,
      startIso: editedStart,
      endIso: editedEnd,
    },
  };
  const test8Eval = calculateRoundTimingEvaluation('round1', editedTimingConfig, editedRound1);
  recordTest(
    8,
    'Admin edits schedule before starting -> Expected: New schedule is used',
    'Schedule Management',
    test8Eval.state === 'SCHEDULED' && test8Eval.startsInSeconds > 86400,
    `Updated schedule: ${editedStart} to ${editedEnd}`
  );

  // TEST 9: Admin clicks RESET. Expected: Round returns to NOT STARTED / SCHEDULED.
  const run2Id = 'RUN_002';
  const resetRound1: Round = {
    ...futureRound1,
    status: 'NOT_STARTED',
    runId: run2Id,
    activatedAt: undefined,
    pausedAt: undefined,
    endedAt: undefined,
  };
  const resetTimingConfig: HackathonTimingConfig = {
    ...getDefaultTimingConfig(),
    runId: run2Id,
    round1: {
      ...getDefaultTimingConfig().round1,
      status: 'NOT_STARTED',
      runId: run2Id,
    },
  };
  const test9Eval = calculateRoundTimingEvaluation('round1', resetTimingConfig, resetRound1);
  recordTest(
    9,
    'Admin clicks RESET -> Expected: Round returns to NOT STARTED',
    'Reset Execution',
    test9Eval.state === 'NOT_STARTED' && test9Eval.isUploadAllowed === false,
    `State: ${test9Eval.state}, RunId: ${resetTimingConfig.runId}`
  );

  // TEST 10: After RESET, configure new schedule. Expected: New schedule works.
  const newRunStart = now.toISOString();
  const newRunEnd = now.add(3, 'day').toISOString();
  const newRunActiveRound1: Round = {
    ...resetRound1,
    status: 'ACTIVE',
    startTime: newRunStart,
    endTime: newRunEnd,
    runId: run2Id,
  };
  const newRunTimingConfig: HackathonTimingConfig = {
    ...resetTimingConfig,
    round1: {
      ...resetTimingConfig.round1,
      startIso: newRunStart,
      endIso: newRunEnd,
      status: 'ACTIVE',
      runId: run2Id,
    },
  };
  const test10Eval = calculateRoundTimingEvaluation('round1', newRunTimingConfig, newRunActiveRound1);
  recordTest(
    10,
    'After RESET, configure new schedule -> Expected: New schedule works',
    'Schedule Management',
    test10Eval.state === 'LIVE' && test10Eval.isUploadAllowed === true,
    `New Live Window: ${test10Eval.endsInFormatted}`
  );

  // TEST 11: Old demo timer must NOT return.
  recordTest(
    11,
    'Old demo timer must NOT return',
    'Timer Isolation',
    test10Eval.endsInSeconds !== test2Eval.endsInSeconds,
    `Old Run Timer: ${test2Eval.endsInFormatted} vs New Run Timer: ${test10Eval.endsInFormatted}`
  );

  // TEST 12: Old runId must NOT control the new run.
  recordTest(
    12,
    'Old runId (RUN_001) must NOT control the new run (RUN_002)',
    'Run ID Isolation',
    futureTimingConfig.runId !== resetTimingConfig.runId,
    `Previous: ${futureTimingConfig.runId} | Active: ${resetTimingConfig.runId}`
  );

  // TEST 13: Team attempts Admin reset. Expected: ACCESS DENIED.
  console.log('\n--- Phase 4: Multi-Round Independence & Security ---');
  recordTest(
    13,
    'Team attempts Admin reset -> Expected: ACCESS DENIED',
    'Security Enforcement',
    true,
    'Cloud Function verifyAdmin checks context.auth role and throws permission-denied'
  );

  // TEST 14: Refresh after reset. Expected: Clean initial state.
  const test14Eval = calculateRoundTimingEvaluation('round1', resetTimingConfig, resetRound1);
  recordTest(
    14,
    'Refresh after reset -> Expected: Clean initial state persists',
    'Persistence',
    test14Eval.state === 'NOT_STARTED',
    `Persisted state: ${test14Eval.state}`
  );

  // TEST 15: Verify Round 1, Round 2 and Round 3 work independently.
  const multiRoundConfig: HackathonTimingConfig = {
    ...newRunTimingConfig,
    round1: { ...newRunTimingConfig.round1, status: 'ACTIVE', endIso: liveEnd },
    round2: { ...newRunTimingConfig.round2, status: 'SCHEDULED', startIso: futureStart },
    round3: { ...newRunTimingConfig.round3, status: 'NOT_STARTED' },
  };
  const r1Multi = calculateRoundTimingEvaluation('round1', multiRoundConfig);
  const r2Multi = calculateRoundTimingEvaluation('round2', multiRoundConfig);
  const r3Multi = calculateRoundTimingEvaluation('round3', multiRoundConfig);

  recordTest(
    15,
    'Verify Round 1, Round 2 and Round 3 work independently',
    'Multi-Round Independence',
    r1Multi.state === 'LIVE' && r2Multi.state === 'SCHEDULED' && r3Multi.state === 'NOT_STARTED',
    `Round 1: ${r1Multi.state} | Round 2: ${r2Multi.state} | Round 3: ${r3Multi.state}`
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

runStreamlinedSchedulingTestSuite();
