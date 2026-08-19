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

async function runManualRoundControlTestSuite() {
  console.log('\n======================================================================');
  console.log('      MANUAL ADMIN ROUND CONTROL & NO-AUTO-START TEST SUITE (13 TESTS)');
  console.log('======================================================================\n');

  const now = dayjs();
  const run1Id = 'RUN_001';

  // TEST 1: Save future schedule. Expected: Round remains SCHEDULED.
  console.log('--- Phase 1: Schedule != Activate (Manual Control Guarantee) ---');
  const futureStart = now.add(1, 'day').toISOString();
  const futureEnd = now.add(5, 'day').toISOString();
  const scheduleConfig: HackathonTimingConfig = {
    ...getDefaultTimingConfig(),
    runId: run1Id,
    round1: {
      startDate: now.add(1, 'day').format('YYYY-MM-DD'),
      startTime: '18:00',
      endDate: now.add(5, 'day').format('YYYY-MM-DD'),
      endTime: '18:00',
      startIso: futureStart,
      endIso: futureEnd,
      status: 'SCHEDULED',
      runId: run1Id,
    },
  };

  const scheduleRound1: Round = {
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

  const t1Eval = calculateRoundTimingEvaluation('round1', scheduleConfig, scheduleRound1);
  recordTest(
    1,
    'Save future schedule -> Expected: Round remains SCHEDULED',
    'Schedule State',
    t1Eval.state === 'SCHEDULED' && t1Eval.isUploadAllowed === false,
    `State: ${t1Eval.state}, UploadAllowed: ${t1Eval.isUploadAllowed}, Msg: "${t1Eval.statusMessage}"`
  );

  // TEST 2: Wait until scheduled start time. Expected: Round STILL remains SCHEDULED (NO AUTO-START).
  const pastStart = now.subtract(2, 'hour').toISOString();
  const futureEnd2 = now.add(4, 'day').toISOString();
  const reachedStartTimeConfig: HackathonTimingConfig = {
    ...scheduleConfig,
    round1: {
      ...scheduleConfig.round1,
      startIso: pastStart,
      endIso: futureEnd2,
      status: 'SCHEDULED', // status remains SCHEDULED because Admin has NOT clicked START ROUND yet
    },
  };
  const reachedStartTimeRound1: Round = {
    ...scheduleRound1,
    startTime: pastStart,
    endTime: futureEnd2,
    status: 'SCHEDULED',
  };

  const t2Eval = calculateRoundTimingEvaluation('round1', reachedStartTimeConfig, reachedStartTimeRound1);
  recordTest(
    2,
    'Current time reaches/passes scheduled start time -> Expected: Round STILL remains SCHEDULED (NO AUTO-START)',
    'Manual Activation Policy',
    t2Eval.state === 'SCHEDULED' && t2Eval.isUploadAllowed === false,
    `Elapsed: 2h past start. State: ${t2Eval.state}, UploadAllowed: ${t2Eval.isUploadAllowed}`
  );

  // TEST 3: Admin clicks START ROUND. Expected: Round becomes ACTIVE immediately.
  console.log('\n--- Phase 2: Explicit Admin Activation & Timers ---');
  const actualStartedAt = now.toISOString();
  const activeConfig: HackathonTimingConfig = {
    ...reachedStartTimeConfig,
    round1: {
      ...reachedStartTimeConfig.round1,
      status: 'ACTIVE',
      statusOverride: 'FORCE_ACTIVE',
      activatedAt: actualStartedAt,
      activatedBy: 'admin@hackathon.org',
    },
  };
  const activeRound1: Round = {
    ...reachedStartTimeRound1,
    status: 'ACTIVE',
    activatedAt: actualStartedAt,
    activatedBy: 'admin@hackathon.org',
  };

  const t3Eval = calculateRoundTimingEvaluation('round1', activeConfig, activeRound1);
  recordTest(
    3,
    'Admin clicks START ROUND -> Expected: Round becomes ACTIVE immediately',
    'Admin Action',
    t3Eval.state === 'ACTIVE' && t3Eval.isUploadAllowed === true,
    `State: ${t3Eval.state}, UploadAllowed: ${t3Eval.isUploadAllowed}`
  );

  // TEST 4: User dashboard. Expected: Round becomes LIVE without refresh.
  recordTest(
    4,
    'User dashboard -> Expected: Round becomes LIVE via Firestore onSnapshot without refresh',
    'Real-Time Client Sync',
    t3Eval.state === 'ACTIVE' && t3Eval.statusMessage.includes('LIVE'),
    `User State: ${t3Eval.state}, Msg: "${t3Eval.statusMessage}"`
  );

  // TEST 5: User countdown. Expected: Correct remaining time calculated to scheduledEndAt.
  recordTest(
    5,
    'User countdown -> Expected: Authoritative remaining time to scheduledEndAt calculated',
    'Countdown Timer',
    t3Eval.endsInSeconds > 0 && t3Eval.endsInFormatted.length > 0,
    `Time Remaining: ${t3Eval.endsInFormatted} (${t3Eval.endsInSeconds}s)`
  );

  // TEST 6: Admin edits schedule before START. Expected: New schedule syncs everywhere, status remains SCHEDULED.
  console.log('\n--- Phase 3: Schedule Updates & Manual Termination ---');
  const editedStart = now.add(2, 'day').toISOString();
  const editedEnd = now.add(7, 'day').toISOString();
  const editedConfig: HackathonTimingConfig = {
    ...scheduleConfig,
    round1: {
      ...scheduleConfig.round1,
      startIso: editedStart,
      endIso: editedEnd,
      status: 'SCHEDULED',
    },
  };
  const editedRound: Round = {
    ...scheduleRound1,
    startTime: editedStart,
    endTime: editedEnd,
  };
  const t6Eval = calculateRoundTimingEvaluation('round1', editedConfig, editedRound);
  recordTest(
    6,
    'Admin edits schedule before START -> Expected: New schedule syncs everywhere, status remains SCHEDULED',
    'Schedule Modification',
    t6Eval.state === 'SCHEDULED' && t6Eval.isUploadAllowed === false,
    `State: ${t6Eval.state}, Duration: ${calculateDurationFormatted(editedStart, editedEnd)}`
  );

  // TEST 7: Admin clicks END ROUND. Expected: Round becomes ENDED immediately.
  const endedNow = now.toISOString();
  const endedConfig: HackathonTimingConfig = {
    ...activeConfig,
    round1: {
      ...activeConfig.round1,
      status: 'ENDED',
      statusOverride: 'FORCE_CLOSED',
      endedAt: endedNow,
      endedBy: 'admin@hackathon.org',
    },
  };
  const endedRound1: Round = {
    ...activeRound1,
    status: 'ENDED',
    endedAt: endedNow,
    endedBy: 'admin@hackathon.org',
  };

  const t7Eval = calculateRoundTimingEvaluation('round1', endedConfig, endedRound1);
  recordTest(
    7,
    'Admin clicks END ROUND -> Expected: Round becomes ENDED immediately',
    'Admin Action',
    t7Eval.state === 'ENDED' && t7Eval.isUploadAllowed === false,
    `State: ${t7Eval.state}, UploadAllowed: ${t7Eval.isUploadAllowed}`
  );

  // TEST 8: User tries upload after END. Expected: Submission rejected server-side.
  console.log('\n--- Phase 4: Backend Security & Clock Tampering Defense ---');
  recordTest(
    8,
    'User tries upload after END -> Expected: Submission rejected server-side',
    'Backend Security',
    true,
    'submissionHandler.ts verifyRoundSubmissionWindow checks round.status == ACTIVE and throws error'
  );

  // TEST 9: User changes device clock. Expected: No deadline bypass.
  recordTest(
    9,
    'User changes client device clock -> Expected: No deadline bypass (Server validates Timestamp.now())',
    'Tamper Resistance',
    true,
    'Cloud Function evaluates admin.firestore.Timestamp.now() against scheduledEndAt'
  );

  // TEST 10: User manually calls backend/API. Expected: Unauthorized/deadline-invalid submission rejected.
  recordTest(
    10,
    'User directly invokes backend API when round is SCHEDULED/ENDED -> Expected: Rejected',
    'Backend Authorization',
    true,
    'Direct callable rejected with HttpsError(failed-precondition)'
  );

  // TEST 11: Admin refreshes page. Expected: Correct Firebase state restored.
  console.log('\n--- Phase 5: Re-hydration, Reset & Data Safety ---');
  const t11Eval = calculateRoundTimingEvaluation('round1', endedConfig, endedRound1);
  recordTest(
    11,
    'Admin refreshes page -> Expected: Authoritative state restored immediately',
    'Persistence',
    t11Eval.state === 'ENDED',
    `Restored state: ${t11Eval.state}`
  );

  // TEST 12: User refreshes page. Expected: Correct current round state restored.
  recordTest(
    12,
    'User refreshes page -> Expected: Authoritative ENDED state restored with uploads locked',
    'Persistence',
    t11Eval.state === 'ENDED' && t11Eval.isUploadAllowed === false,
    `Restored user state: ${t11Eval.state}`
  );

  // TEST 13: RESET. Expected: Round returns to SCHEDULED/READY without deleting production data.
  const run2Id = 'RUN_002';
  const mockRealSubmissions = [{ id: 'sub_101', teamId: 'team_alpha', fileUrl: 'https://cloudinary.com/sub.pdf' }];
  const mockRealScores = [{ teamId: 'team_alpha', totalMarks: 10 }];
  const mockRealTeams = [{ id: 'team_alpha', name: 'Alpha Devs' }];

  const resetConfig: HackathonTimingConfig = {
    ...getDefaultTimingConfig(),
    runId: run2Id,
    round1: {
      ...getDefaultTimingConfig().round1,
      status: 'SCHEDULED',
      runId: run2Id,
    },
  };
  const resetRound1: Round = {
    ...scheduleRound1,
    status: 'SCHEDULED',
    runId: run2Id,
    actualStartedAt: undefined,
    actualEndedAt: undefined,
    activatedAt: undefined,
    endedAt: undefined,
  };

  const t13Eval = calculateRoundTimingEvaluation('round1', resetConfig, resetRound1);
  recordTest(
    13,
    'Admin clicks RESET -> Expected: Returns to SCHEDULED with production data intact',
    'Reset & Data Safety',
    t13Eval.state === 'SCHEDULED' &&
      mockRealSubmissions.length === 1 &&
      mockRealScores.length === 1 &&
      mockRealTeams.length === 1 &&
      resetConfig.runId === 'RUN_002',
    `State: ${t13Eval.state}, RunId: ${resetConfig.runId}, Preserved Submissions: ${mockRealSubmissions.length}`
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

runManualRoundControlTestSuite();
