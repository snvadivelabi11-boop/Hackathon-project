/**
 * Master Verification Orchestrator
 * Executes all 15 test suites and builds sequentially, aggregating all verification results.
 */

import { execSync } from 'child_process';

interface SuiteResult {
  name: string;
  command: string;
  passed: boolean;
  output: string;
}

const suites: { name: string; command: string }[] = [
  { name: '1. Production Security Audit', command: 'npx tsx scratch/runSecurityAudit.ts' },
  { name: '2. Live Cloudflare Worker E2E Test', command: 'npx tsx scratch/testLiveCloudflareWorkerE2E.ts' },
  { name: '3. Cloudflare Worker Unit Logic', command: 'npx tsx scratch/testCloudflareWorkerLogic.ts' },
  { name: '4. Master 28-Test CSV AI Pipeline', command: 'npx tsx scratch/runMasterCsvAiE2ETests.ts' },
  { name: '5. CSV Analyzer Unit Suite (18 Tests)', command: 'npx tsx scratch/runCsvAnalyzerTests.ts' },
  { name: '6. CSV AI Verification Suite (12 Tests)', command: 'npx tsx scratch/runCsvAiAnalyzerVerification.ts' },
  { name: '7. Multi-Device User Login Suite (15 Tests)', command: 'npx tsx scratch/runMultiDeviceUserLoginTests.ts' },
  { name: '8. Multi-Admin Concurrency Suite (20 Tests)', command: 'npx tsx scratch/runMultiAdminConcurrencyTests.ts' },
  { name: '9. Password Reset Suite (15 Tests)', command: 'npx tsx scratch/runPasswordResetTests.ts' },
  { name: '10. Manual Round Control Suite (13 Tests)', command: 'npx tsx scratch/runManualRoundControlTests.ts' },
  { name: '11. Round Activation & Lifecycle (30 Tests)', command: 'npx tsx scratch/runRoundActivationTests.ts' },
  { name: '12. Flexible Scheduling & Duration (24 Tests)', command: 'npx tsx scratch/runFlexibleScheduling24Tests.ts' },
  { name: '13. Global Timing System (17 Tests)', command: 'npx tsx scratch/runTimingTests.ts' },
  { name: '14. Reset Hackathon System (20 Tests)', command: 'npx tsx scratch/runResetHackathonTests.ts' },
  { name: '15. Final Master QA Suite (17 Tests)', command: 'npx tsx scratch/runFinalMasterQASuite.ts' },
  { name: '16. Final Master System E2E (30 Tests)', command: 'npx tsx scratch/runMasterE2ETests.ts' },
  { name: '17. Sequential Problem Assignment Suite (51 Tests)', command: 'npx tsx scratch/testSequentialProblemAssignment.ts' },
  { name: '18. 12 Required Assignment Cases Suite (44 Tests)', command: 'npx tsx scratch/testRequired12AssignmentCases.ts' },
  { name: '19. Cloud Functions Backend Build', command: 'npm --prefix functions run build' },
  { name: '20. Frontend Production Build', command: 'npm run build' },
];

async function runAll() {
  console.log('\n========================================================================================');
  console.log('       MASTER SYSTEM QA & PRODUCTION VERIFICATION ORCHESTRATOR                          ');
  console.log('========================================================================================\n');

  const results: SuiteResult[] = [];
  let totalPassed = 0;
  let totalFailed = 0;

  for (const suite of suites) {
    process.stdout.write(`⏳ Running [${suite.name}]... `);
    try {
      const output = execSync(suite.command, { stdio: 'pipe' }).toString();
      results.push({ name: suite.name, command: suite.command, passed: true, output });
      totalPassed++;
      console.log('✅ PASS');
    } catch (err: any) {
      const output = (err.stdout?.toString() || '') + '\n' + (err.stderr?.toString() || '');
      results.push({ name: suite.name, command: suite.command, passed: false, output });
      totalFailed++;
      console.log('❌ FAIL');
      console.error(output.slice(0, 500));
    }
  }

  console.log('\n========================================================================================');
  console.log('             COMPREHENSIVE TEST SUITE EXECUTION SUMMARY                                 ');
  console.log('========================================================================================');
  console.log(`Total Suites Executed: ${suites.length}`);
  console.log(`Suites Passed:         ${totalPassed} / ${suites.length} (${((totalPassed / suites.length) * 100).toFixed(1)}%)`);
  console.log(`Suites Failed:         ${totalFailed}`);
  console.log('========================================================================================\n');

  if (totalFailed > 0) {
    process.exit(1);
  }
}

runAll().catch((err) => {
  console.error('Master runner failed:', err);
  process.exit(1);
});
