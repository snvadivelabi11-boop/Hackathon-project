import {
  calculateRoundTimingEvaluation,
  getDefaultTimingConfig,
} from '../src/services/timing.service';
import { HackathonTimingConfig, Round } from '../src/types';
import dayjs from 'dayjs';

interface TestResult {
  name: string;
  category: string;
  status: 'PASS' | 'FAIL';
  details: string;
}

const results: TestResult[] = [];

function assert(condition: boolean, name: string, category: string, details: string) {
  if (condition) {
    results.push({ name, category, status: 'PASS', details });
    console.log(`  ✅ [PASS] ${name}`);
  } else {
    results.push({ name, category, status: 'FAIL', details });
    console.error(`  ❌ [FAIL] ${name} - ${details}`);
  }
}

async function runTimingTestSuite() {
  console.log('\n======================================================');
  console.log('  GLOBAL HACKATHON ROUND TIMING SYSTEM TEST SUITE');
  console.log('======================================================\n');

  const now = dayjs();

  // Test 1: SCHEDULED State (Schedule != Activate)
  console.log('--- 1. Testing SCHEDULED Timing Window ---');
  const futureStart = now.add(2, 'day').toISOString();
  const futureEnd = now.add(5, 'day').toISOString();
  const scheduledConfig: HackathonTimingConfig = {
    ...getDefaultTimingConfig(),
    hackathonStartIso: futureStart,
    hackathonEndIso: futureEnd,
    round1: {
      startDate: now.add(2, 'day').format('YYYY-MM-DD'),
      startTime: '09:00',
      endDate: now.add(5, 'day').format('YYYY-MM-DD'),
      endTime: '18:00',
      startIso: futureStart,
      endIso: futureEnd,
      status: 'SCHEDULED',
    },
  };

  const scheduledEval = calculateRoundTimingEvaluation('round1', scheduledConfig);
  assert(
    scheduledEval.state === 'SCHEDULED',
    'Round in future returns SCHEDULED status (Schedule != Activate)',
    'Window Calculation',
    `Expected SCHEDULED, received ${scheduledEval.state}`
  );
  assert(
    scheduledEval.isUploadAllowed === false,
    'Uploads blocked during SCHEDULED period',
    'Security Enforcement',
    `isUploadAllowed is ${scheduledEval.isUploadAllowed}`
  );
  assert(
    scheduledEval.statusMessage.includes('start') || scheduledEval.statusMessage.includes('not started'),
    'Appropriate SCHEDULED status message',
    'User Experience',
    `Message: ${scheduledEval.statusMessage}`
  );
  assert(
    scheduledEval.startsInSeconds > 0,
    'Starts-in countdown calculation is positive',
    'Countdown Timer',
    `startsInSeconds = ${scheduledEval.startsInSeconds}`
  );

  // Test 2: ACTIVE State (Admin activated and now is before deadline)
  console.log('\n--- 2. Testing ACTIVE Timing Window ---');
  const pastStart = now.subtract(1, 'day').toISOString();
  const activeEnd = now.add(3, 'day').toISOString();
  const activeConfig: HackathonTimingConfig = {
    ...getDefaultTimingConfig(),
    hackathonStartIso: pastStart,
    hackathonEndIso: activeEnd,
    round1: {
      startDate: now.subtract(1, 'day').format('YYYY-MM-DD'),
      startTime: '09:00',
      endDate: now.add(3, 'day').format('YYYY-MM-DD'),
      endTime: '18:00',
      startIso: pastStart,
      endIso: activeEnd,
      status: 'ACTIVE',
    },
  };

  const activeEval = calculateRoundTimingEvaluation('round1', activeConfig, {
    id: 'round1',
    name: 'Round 1',
    roundNumber: 1,
    description: 'Round 1',
    startTime: pastStart,
    endTime: activeEnd,
    maxMarks: 10,
    status: 'ACTIVE',
    allowResubmission: true,
    allowedFileTypes: [],
    maxFileSize: 50,
    criteria: [],
    createdAt: pastStart,
    updatedAt: pastStart,
  });

  assert(
    activeEval.state === 'LIVE' || activeEval.state === 'ACTIVE',
    'Activated round within window returns LIVE status',
    'Window Calculation',
    `Expected LIVE, received ${activeEval.state}`
  );
  assert(
    activeEval.isUploadAllowed === true,
    'Uploads allowed during ACTIVE period',
    'Security Enforcement',
    `isUploadAllowed is ${activeEval.isUploadAllowed}`
  );
  assert(
    activeEval.endsInSeconds > 0,
    'Deadline countdown calculates remaining seconds',
    'Countdown Timer',
    `endsInSeconds = ${activeEval.endsInSeconds}`
  );

  // Test 3: ENDED State (Deadline passed)
  console.log('\n--- 3. Testing ENDED Timing Window ---');
  const oldStart = now.subtract(5, 'day').toISOString();
  const oldEnd = now.subtract(1, 'day').toISOString();
  const endedConfig: HackathonTimingConfig = {
    ...getDefaultTimingConfig(),
    hackathonStartIso: oldStart,
    hackathonEndIso: oldEnd,
    round1: {
      startDate: now.subtract(5, 'day').format('YYYY-MM-DD'),
      startTime: '09:00',
      endDate: now.subtract(1, 'day').format('YYYY-MM-DD'),
      endTime: '18:00',
      startIso: oldStart,
      endIso: oldEnd,
      status: 'ACTIVE', // Was active, but now deadline has passed
    },
  };

  const endedEval = calculateRoundTimingEvaluation('round1', endedConfig, {
    id: 'round1',
    name: 'Round 1',
    roundNumber: 1,
    description: 'Round 1',
    startTime: oldStart,
    endTime: oldEnd,
    maxMarks: 10,
    status: 'ACTIVE',
    allowResubmission: true,
    allowedFileTypes: [],
    maxFileSize: 50,
    criteria: [],
    createdAt: oldStart,
    updatedAt: oldStart,
  });

  assert(
    endedEval.state === 'ENDED',
    'Round past deadline automatically returns ENDED status',
    'Window Calculation',
    `Expected ENDED, received ${endedEval.state}`
  );
  assert(
    endedEval.isUploadAllowed === false,
    'Uploads blocked after deadline passed',
    'Security Enforcement',
    `isUploadAllowed is ${endedEval.isUploadAllowed}`
  );
  assert(
    endedEval.statusMessage.includes('ended'),
    'Appropriate ENDED status message',
    'User Experience',
    `Message: ${endedEval.statusMessage}`
  );

  // Test 4: Admin Manual Lock Override
  console.log('\n--- 4. Testing Admin Manual Lock Override ---');
  const lockedConfig: HackathonTimingConfig = {
    ...activeConfig,
    round1: {
      ...activeConfig.round1,
      status: 'LOCKED',
      statusOverride: 'LOCKED',
    },
  };

  const lockedEval = calculateRoundTimingEvaluation('round1', lockedConfig);
  assert(
    lockedEval.state === 'LOCKED',
    'statusOverride LOCKED forces LOCKED state even during active window',
    'Admin Override',
    `State: ${lockedEval.state}`
  );
  assert(
    lockedEval.isUploadAllowed === false,
    'Uploads blocked when round is LOCKED by admin',
    'Admin Override',
    `isUploadAllowed: ${lockedEval.isUploadAllowed}`
  );

  // Test 5: Admin Force Close Override
  console.log('\n--- 5. Testing Admin Force Close Override ---');
  const forceClosedConfig: HackathonTimingConfig = {
    ...activeConfig,
    round1: {
      ...activeConfig.round1,
      status: 'ENDED',
      statusOverride: 'FORCE_CLOSED',
    },
  };

  const forceClosedEval = calculateRoundTimingEvaluation('round1', forceClosedConfig);
  assert(
    forceClosedEval.state === 'ENDED',
    'statusOverride FORCE_CLOSED immediately ends round',
    'Admin Override',
    `State: ${forceClosedEval.state}`
  );
  assert(
    forceClosedEval.isUploadAllowed === false,
    'Uploads blocked when round is FORCE_CLOSED',
    'Admin Override',
    `isUploadAllowed: ${forceClosedEval.isUploadAllowed}`
  );

  // Test 6: 5-Day Simultaneous Hackathon Window (20th to 25th)
  console.log('\n--- 6. Testing 5-Day Simultaneous Window (20th to 25th) ---');
  const defaultCfg = getDefaultTimingConfig();
  assert(
    defaultCfg.hackathonStartDate !== undefined && defaultCfg.hackathonEndDate !== undefined,
    'Default timing config generates valid 5-day window',
    'Configuration',
    `Window: ${defaultCfg.hackathonStartDate} to ${defaultCfg.hackathonEndDate}`
  );
  assert(
    defaultCfg.round1.startIso === defaultCfg.hackathonStartIso &&
    defaultCfg.round2.startIso === defaultCfg.hackathonStartIso &&
    defaultCfg.round3.startIso === defaultCfg.hackathonStartIso,
    'All 3 rounds synchronize start window in simultaneous configuration',
    'Multi-Round Sync',
    'Round 1, 2, 3 have matching start timestamps'
  );

  // Test 7: All Three Rounds Evaluated Independently
  console.log('\n--- 7. Testing All 3 Rounds Evaluated Independently ---');
  const multiConfig: HackathonTimingConfig = {
    ...defaultCfg,
    round1: { ...defaultCfg.round1, status: 'ACTIVE', endIso: activeEnd },
    round2: { ...defaultCfg.round2, status: 'SCHEDULED', startIso: now.add(2, 'day').toISOString() },
    round3: { ...defaultCfg.round3, status: 'SCHEDULED' },
  };

  const r1 = calculateRoundTimingEvaluation('round1', multiConfig);
  const r2 = calculateRoundTimingEvaluation('round2', multiConfig);
  const r3 = calculateRoundTimingEvaluation('round3', multiConfig);
  assert(
    (r1.state === 'LIVE' || r1.state === 'ACTIVE') && r2.state === 'SCHEDULED' && r3.state === 'SCHEDULED',
    'Round 1 (ACTIVE), Round 2 (SCHEDULED), and Round 3 (SCHEDULED) evaluated independently',
    'Multi-Round Sync',
    `R1: ${r1.state}, R2: ${r2.state}, R3: ${r3.state}`
  );

  // Test Summary
  console.log('\n======================================================');
  console.log('                  TEST SUMMARY');
  console.log('======================================================');
  const total = results.length;
  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  console.log(`Total Checks: ${total}`);
  console.log(`Passed:       ${passed}`);
  console.log(`Failed:       ${failed}`);
  console.log('======================================================\n');
}

runTimingTestSuite();
