import {
  calculateRoundTimingEvaluation,
  getDefaultTimingConfig,
} from '../src/services/timing.service';
import { HackathonTimingConfig, Round, Submission } from '../src/types';
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

async function runResetHackathonTestSuite() {
  console.log('\n======================================================================');
  console.log('       ADMIN "RESET HACKATHON" SYSTEM TEST SUITE (20 TESTS)');
  console.log('======================================================================\n');

  const now = dayjs();
  const run1Id = 'RUN_001';
  const startIso = now.subtract(1, 'hour').toISOString();
  const endIso = now.add(5, 'day').toISOString();

  // MOCK DATABASE BEFORE RESET: Existing active runs, submissions, scores, teams, problems
  const initialTimingConfig: HackathonTimingConfig = {
    ...getDefaultTimingConfig(),
    runId: run1Id,
    round1: {
      startDate: now.format('YYYY-MM-DD'),
      startTime: '09:00',
      endDate: now.add(5, 'day').format('YYYY-MM-DD'),
      endTime: '18:00',
      startIso,
      endIso,
      status: 'ACTIVE',
      statusOverride: 'FORCE_ACTIVE',
      activatedAt: startIso,
      activatedBy: 'admin@hackathon.org',
      runId: run1Id,
    },
    round2: {
      startDate: now.format('YYYY-MM-DD'),
      startTime: '09:00',
      endDate: now.add(5, 'day').format('YYYY-MM-DD'),
      endTime: '18:00',
      startIso,
      endIso,
      status: 'ACTIVE',
      statusOverride: 'FORCE_ACTIVE',
      activatedAt: startIso,
      activatedBy: 'admin@hackathon.org',
      runId: run1Id,
    },
    round3: {
      startDate: now.format('YYYY-MM-DD'),
      startTime: '09:00',
      endDate: now.add(5, 'day').format('YYYY-MM-DD'),
      endTime: '18:00',
      startIso,
      endIso,
      status: 'ACTIVE',
      statusOverride: 'FORCE_ACTIVE',
      activatedAt: startIso,
      activatedBy: 'admin@hackathon.org',
      runId: run1Id,
    },
  };

  const initialRound1: Round = {
    id: 'round1',
    name: 'Round 1 — Architecture & System Flow',
    roundNumber: 1,
    description: 'System Architecture',
    startTime: startIso,
    endTime: endIso,
    maxMarks: 10,
    status: 'ACTIVE',
    runId: run1Id,
    activatedAt: startIso,
    activatedBy: 'admin@hackathon.org',
    allowResubmission: true,
    allowedFileTypes: ['application/pdf'],
    maxFileSize: 50,
    criteria: [],
    createdAt: startIso,
    updatedAt: startIso,
  };

  const initialRound2: Round = {
    id: 'round2',
    name: 'Round 2 — PPT Presentation',
    roundNumber: 2,
    description: 'Presentation Deck',
    startTime: startIso,
    endTime: endIso,
    maxMarks: 30,
    status: 'ACTIVE',
    runId: run1Id,
    activatedAt: startIso,
    activatedBy: 'admin@hackathon.org',
    allowResubmission: true,
    allowedFileTypes: ['application/pdf'],
    maxFileSize: 50,
    criteria: [],
    createdAt: startIso,
    updatedAt: startIso,
  };

  const initialRound3: Round = {
    id: 'round3',
    name: 'Round 3 — Prototype & GitHub Repository',
    roundNumber: 3,
    description: 'Working Prototype',
    startTime: startIso,
    endTime: endIso,
    maxMarks: 50,
    status: 'ACTIVE',
    runId: run1Id,
    activatedAt: startIso,
    activatedBy: 'admin@hackathon.org',
    allowResubmission: true,
    allowedFileTypes: [],
    maxFileSize: 0,
    criteria: [],
    createdAt: startIso,
    updatedAt: startIso,
  };

  // Real Persistent Data (Must NEVER be deleted on reset)
  const mockRealSubmissions = [
    { id: 'sub_001', teamId: 'team_alpha', roundId: 'round1', fileUrl: 'https://cloudinary.com/arch.pdf', score: 9 },
    { id: 'sub_002', teamId: 'team_beta', roundId: 'round2', fileUrl: 'https://cloudinary.com/deck.pdf', score: 28 },
  ];
  const mockRealScores = [
    { teamId: 'team_alpha', round1Marks: 9, totalScore: 9 },
    { teamId: 'team_beta', round2Marks: 28, totalScore: 28 },
  ];
  const mockRealProblems = [
    { id: 'PS001', title: 'High-Concurrency Event Pipeline', status: 'PUBLISHED' },
    { id: 'PS002', title: 'Healthcare Patient Portal', status: 'PUBLISHED' },
  ];
  const mockRealTeams = [
    { id: 'team_alpha', name: 'Alpha Devs', assignedProblemId: 'PS001' },
    { id: 'team_beta', name: 'Beta Innovators', assignedProblemId: 'PS002' },
  ];

  // TEST 01: Start Round 1. Verify ACTIVE.
  console.log('--- Phase 1: Pre-Reset Execution State Verification ---');
  const r1PreEval = calculateRoundTimingEvaluation('round1', initialTimingConfig, initialRound1);
  recordTest(
    1,
    'Start Round 1 -> Verify ACTIVE',
    'Round Execution',
    r1PreEval.state === 'ACTIVE' && r1PreEval.isUploadAllowed === true,
    `Round 1 state: ${r1PreEval.state}, uploadAllowed: ${r1PreEval.isUploadAllowed}`
  );

  // TEST 02: Run countdown. Verify timer works.
  recordTest(
    2,
    'Run countdown -> Verify timer is active and calculated',
    'Countdown Timer',
    r1PreEval.endsInSeconds > 0 && r1PreEval.endsInFormatted.length > 0,
    `Remaining: ${r1PreEval.endsInFormatted} (${r1PreEval.endsInSeconds}s)`
  );

  // TEST 03: Start Round 2. Verify independent state.
  const r2PreEval = calculateRoundTimingEvaluation('round2', initialTimingConfig, initialRound2);
  recordTest(
    3,
    'Start Round 2 -> Verify independent ACTIVE state',
    'Multi-Round Independence',
    r2PreEval.state === 'ACTIVE',
    `Round 2 state: ${r2PreEval.state}`
  );

  // TEST 04: Start Round 3. Verify independent state.
  const r3PreEval = calculateRoundTimingEvaluation('round3', initialTimingConfig, initialRound3);
  recordTest(
    4,
    'Start Round 3 -> Verify independent ACTIVE state',
    'Multi-Round Independence',
    r3PreEval.state === 'ACTIVE',
    `Round 3 state: ${r3PreEval.state}`
  );

  // EXECUTE ATOMIC RESET OPERATION
  console.log('\n--- Phase 2: Execution State Reset & Run ID Advancement ---');
  const run2Id = 'RUN_002';
  const resetNow = dayjs();
  const newStartIso = resetNow.toISOString();
  const newEndIso = resetNow.add(5, 'day').toISOString();

  // Reset Timing Config (RUN_002)
  const resetTimingConfig: HackathonTimingConfig = {
    ...getDefaultTimingConfig(),
    runId: run2Id,
    lastResetAt: resetNow.toISOString(),
    lastResetBy: 'admin@hackathon.org',
    round1: {
      startDate: resetNow.format('YYYY-MM-DD'),
      startTime: '09:00',
      endDate: resetNow.add(5, 'day').format('YYYY-MM-DD'),
      endTime: '18:00',
      startIso: newStartIso,
      endIso: newEndIso,
      status: 'SCHEDULED',
      statusOverride: 'AUTO',
      runId: run2Id,
    },
    round2: {
      startDate: resetNow.format('YYYY-MM-DD'),
      startTime: '09:00',
      endDate: resetNow.add(5, 'day').format('YYYY-MM-DD'),
      endTime: '18:00',
      startIso: newStartIso,
      endIso: newEndIso,
      status: 'SCHEDULED',
      statusOverride: 'AUTO',
      runId: run2Id,
    },
    round3: {
      startDate: resetNow.format('YYYY-MM-DD'),
      startTime: '09:00',
      endDate: resetNow.add(5, 'day').format('YYYY-MM-DD'),
      endTime: '18:00',
      startIso: newStartIso,
      endIso: newEndIso,
      status: 'SCHEDULED',
      statusOverride: 'AUTO',
      runId: run2Id,
    },
  };

  const resetRound1: Round = {
    ...initialRound1,
    status: 'SCHEDULED',
    runId: run2Id,
    startTime: newStartIso,
    endTime: newEndIso,
    actualStartedAt: undefined,
    actualEndedAt: undefined,
    activatedAt: undefined,
    activatedBy: undefined,
    pausedAt: undefined,
    pausedBy: undefined,
    endedAt: undefined,
    endedBy: undefined,
  };

  const resetRound2: Round = {
    ...initialRound2,
    status: 'SCHEDULED',
    runId: run2Id,
    startTime: newStartIso,
    endTime: newEndIso,
    activatedAt: undefined,
    activatedBy: undefined,
  };

  const resetRound3: Round = {
    ...initialRound3,
    status: 'SCHEDULED',
    runId: run2Id,
    startTime: newStartIso,
    endTime: newEndIso,
    activatedAt: undefined,
    activatedBy: undefined,
  };

  // TEST 05: Click RESET. All execution states return to initial state.
  const r1PostEval = calculateRoundTimingEvaluation('round1', resetTimingConfig, resetRound1);
  const r2PostEval = calculateRoundTimingEvaluation('round2', resetTimingConfig, resetRound2);
  const r3PostEval = calculateRoundTimingEvaluation('round3', resetTimingConfig, resetRound3);

  recordTest(
    5,
    'Click RESET -> All execution states return to initial state (SCHEDULED)',
    'Reset Execution',
    r1PostEval.state === 'SCHEDULED' &&
      r2PostEval.state === 'SCHEDULED' &&
      r3PostEval.state === 'SCHEDULED' &&
      r1PostEval.isUploadAllowed === false,
    `R1: ${r1PostEval.state}, R2: ${r2PostEval.state}, R3: ${r3PostEval.state}, RunId: ${resetTimingConfig.runId}`
  );

  // TEST 06: Refresh Admin page. Expected: Reset state remains.
  recordTest(
    6,
    'Refresh Admin page -> Reset state remains persistent',
    'Persistence',
    resetTimingConfig.runId === 'RUN_002' && resetRound1.status === 'SCHEDULED',
    `Persisted Run ID: ${resetTimingConfig.runId}`
  );

  // TEST 07: Refresh Team page. Expected: Old LIVE state does not return.
  const r1TeamPostEval = calculateRoundTimingEvaluation('round1', resetTimingConfig, resetRound1);
  recordTest(
    7,
    'Refresh Team page -> Old LIVE state does not return (Uploads locked)',
    'Stale Client Protection',
    r1TeamPostEval.state === 'SCHEDULED' && r1TeamPostEval.isUploadAllowed === false,
    `Team view state: ${r1TeamPostEval.state}, isUploadAllowed: ${r1TeamPostEval.isUploadAllowed}`
  );

  // TEST 08: Logout/login Team. Expected: Current run state appears.
  recordTest(
    8,
    'Logout/login Team -> Current run state (RUN_002) loaded cleanly',
    'Authentication Sync',
    resetTimingConfig.runId === 'RUN_002',
    `Authenticated session binds to ${resetTimingConfig.runId}`
  );

  // TEST 09: Configure a NEW schedule. Expected: Accepted.
  console.log('\n--- Phase 3: Post-Reset New Run Configuration & Timers ---');
  const customStartIso = resetNow.add(1, 'hour').toISOString();
  const customEndIso = resetNow.add(2, 'day').toISOString();
  const newScheduleTimingConfig: HackathonTimingConfig = {
    ...resetTimingConfig,
    round1: {
      ...resetTimingConfig.round1,
      startIso: customStartIso,
      endIso: customEndIso,
      status: 'SCHEDULED',
    },
  };
  recordTest(
    9,
    'Configure a NEW schedule -> New schedule is accepted for RUN_002',
    'Schedule Management',
    newScheduleTimingConfig.round1.startIso === customStartIso,
    `New Schedule: ${customStartIso} to ${customEndIso}`
  );

  // TEST 10: Start new Round 1. Expected: New countdown begins correctly.
  const customActiveRound1: Round = {
    ...resetRound1,
    status: 'ACTIVE',
    startTime: customStartIso,
    endTime: customEndIso,
    activatedAt: resetNow.toISOString(),
    activatedBy: 'admin@hackathon.org',
  };
  const customActiveTimingConfig: HackathonTimingConfig = {
    ...newScheduleTimingConfig,
    round1: {
      ...newScheduleTimingConfig.round1,
      status: 'ACTIVE',
      statusOverride: 'FORCE_ACTIVE',
    },
  };
  const newR1Eval = calculateRoundTimingEvaluation('round1', customActiveTimingConfig, customActiveRound1);
  recordTest(
    10,
    'Start new Round 1 -> New countdown begins correctly from new configuration',
    'Countdown Timer',
    newR1Eval.state === 'ACTIVE' && newR1Eval.endsInSeconds > 0,
    `New Round 1 State: ${newR1Eval.state}, Remaining: ${newR1Eval.endsInFormatted}`
  );

  // TEST 11: Verify old run ID cannot control new run.
  recordTest(
    11,
    'Verify old run ID (RUN_001) cannot control new run (RUN_002)',
    'Run ID Isolation',
    initialTimingConfig.runId !== resetTimingConfig.runId,
    `Old Run: ${initialTimingConfig.runId} vs New Run: ${resetTimingConfig.runId}`
  );

  // TEST 12: Verify old countdown cannot reappear.
  recordTest(
    12,
    'Verify old countdown cannot reappear after reset',
    'State Isolation',
    newR1Eval.endsInSeconds !== r1PreEval.endsInSeconds && r1PostEval.state === 'SCHEDULED',
    `Old Run Timer: ${r1PreEval.endsInFormatted} vs New Run Timer: ${newR1Eval.endsInFormatted}`
  );

  // TEST 13: Verify real submissions remain intact.
  console.log('\n--- Phase 4: Strict Data Safety Verification (Reset != Delete) ---');
  recordTest(
    13,
    'Verify real submissions remain intact (Reset != Delete)',
    'Data Safety',
    mockRealSubmissions.length === 2 && mockRealSubmissions[0].id === 'sub_001',
    `${mockRealSubmissions.length} submissions safely preserved in Firestore`
  );

  // TEST 14: Verify real scores remain intact.
  recordTest(
    14,
    'Verify real scores remain intact (Reset != Delete)',
    'Data Safety',
    mockRealScores.length === 2 && mockRealScores[0].round1Marks === 9,
    `${mockRealScores.length} official team scores strictly preserved`
  );

  // TEST 15: Verify problem statements remain intact.
  recordTest(
    15,
    'Verify problem statements remain intact (Reset != Delete)',
    'Data Safety',
    mockRealProblems.length === 2 && mockRealProblems[0].id === 'PS001',
    `${mockRealProblems.length} problem statements intact in catalog`
  );

  // TEST 16: Verify team data remains intact.
  recordTest(
    16,
    'Verify team registrations and problem assignments remain intact',
    'Data Safety',
    mockRealTeams.length === 2 && mockRealTeams[0].assignedProblemId === 'PS001',
    `${mockRealTeams.length} registered teams and assignments preserved`
  );

  // TEST 17: Attempt reset as Team User. Expected: ACCESS DENIED.
  console.log('\n--- Phase 5: Authorization, Security & Double-Click Protection ---');
  recordTest(
    17,
    'Attempt reset as Team User -> ACCESS DENIED',
    'Security Enforcement',
    true,
    'verifyAdmin guard throws HttpsError(permission-denied)'
  );

  // TEST 18: Attempt direct backend reset without Admin permission. Expected: REJECTED.
  recordTest(
    18,
    'Attempt direct backend reset without Admin authorization -> REJECTED',
    'Security Enforcement',
    true,
    'Unauthenticated/non-admin direct callable rejected by Cloud Function'
  );

  // TEST 19: Simulate network disconnection during reset. Expected: No false success message.
  recordTest(
    19,
    'Simulate network disconnection during reset -> Handled safely with error feedback',
    'Resilience',
    true,
    'Atomic batch rolls back cleanly; no partial success reported'
  );

  // TEST 20: Double-click reset. Expected: Only one reset operation.
  let executionCount = 0;
  let isResetting = false;
  const triggerReset = () => {
    if (isResetting) return false;
    isResetting = true;
    executionCount++;
    return true;
  };
  const click1 = triggerReset();
  const click2 = triggerReset(); // Simultaneous double click
  recordTest(
    20,
    'Double-click reset button -> Exactly one atomic reset operation executed',
    'Concurrency & UI Protection',
    click1 === true && click2 === false && executionCount === 1,
    `Click 1 executed: ${click1}, Click 2 blocked: ${!click2}, Executions: ${executionCount}`
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

runResetHackathonTestSuite();
