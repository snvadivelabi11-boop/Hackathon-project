/**
 * Cloudflare Worker Logic Verification Test Suite
 * Tests worker routing, CORS, chunking, prompt generation, and 1:1 reconciliation.
 */

import { handleWorkerRequest, CsvProblemInputItem, Env } from '../cloudflare-worker/src/index';

interface TestResult {
  name: string;
  passed: boolean;
  details: string;
}

const results: TestResult[] = [];

function record(name: string, passed: boolean, details: string) {
  results.push({ name, passed, details });
  const icon = passed ? '✅' : '❌';
  console.log(`  ${icon} ${name} -> ${passed ? 'PASS' : 'FAIL'} (${details})`);
}

async function runWorkerTests() {
  console.log('\n========================================================================================');
  console.log('       CLOUDFLARE WORKER BACKEND VERIFICATION SUITE                                    ');
  console.log('========================================================================================\n');

  const mockEnv: Env = {
    OPENROUTER_MODEL: 'anthropic/claude-3.5-sonnet',
    ALLOWED_ORIGINS: '*',
  };

  // Test 1: OPTIONS CORS Preflight
  const optionsReq = new Request('https://worker.local/analyze-csv', { method: 'OPTIONS' });
  const optionsRes = await handleWorkerRequest(optionsReq, mockEnv);
  const corsOk = optionsRes.status === 204 && optionsRes.headers.get('Access-Control-Allow-Origin') === '*';
  record('1. CORS Preflight (OPTIONS /analyze-csv)', corsOk, `Status: ${optionsRes.status}, Origin Header: ${optionsRes.headers.get('Access-Control-Allow-Origin')}`);

  // Test 2: Health Check (GET /health)
  const healthReq = new Request('https://worker.local/health', { method: 'GET' });
  const healthRes = await handleWorkerRequest(healthReq, mockEnv);
  const healthData = await healthRes.json() as any;
  const healthOk = healthRes.status === 200 && healthData.status === 'healthy';
  record('2. Health Check (GET /health)', healthOk, `Status: ${healthData.status}, Model: ${healthData.model}`);

  // Test 3: POST /analyze-csv with empty payload returns 400
  const emptyReq = new Request('https://worker.local/analyze-csv', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ questions: [] }),
  });
  const emptyRes = await handleWorkerRequest(emptyReq, mockEnv);
  const emptyData = await emptyRes.json() as any;
  const emptyOk = emptyRes.status === 400 && emptyData.error.includes('required');
  record('3. Validation of Empty Payload (POST /analyze-csv)', emptyOk, `Status: ${emptyRes.status}, Error: "${emptyData.error}"`);

  // Test 4: POST /analyze-csv without API Key returns clean structured fallback without crashing
  const sampleItems: CsvProblemInputItem[] = [
    {
      sequence: 1,
      rowNumber: 2,
      problemStatementId: 'PS-FIN-01',
      category: 'Fintech',
      team: 'AlphaTeam',
      organization: 'NationalBank',
      department: 'FraudRisk',
      title: 'Real-time AML Graph ML Detector',
      description: 'Build an AML transaction graph network with subgraph anomaly detection',
      difficulty: 'HARD',
    },
    {
      sequence: 2,
      rowNumber: 3,
      problemStatementId: 'PS-HEALTH-02',
      category: 'Healthtech',
      team: null,
      organization: 'CityHospital',
      department: 'Cardiology',
      title: 'ECG Rhythm Classifier',
      description: 'Edge 1D CNN model for classifying cardiac arrhythmia on wearables',
      difficulty: 'MEDIUM',
    },
  ];

  const postReq = new Request('https://worker.local/analyze-csv', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName: 'test.csv', questions: sampleItems }),
  });

  const postRes = await handleWorkerRequest(postReq, mockEnv);
  const postData = await postRes.json() as any;
  const postOk = postRes.status === 200 &&
    postData.success === true &&
    postData.totalProblems === 2 &&
    postData.problems.length === 2 &&
    postData.problems[0].problemStatementId === 'PS-FIN-01' &&
    postData.problems[0].organization === 'NationalBank' &&
    postData.problems[1].organization === 'CityHospital';

  record('4. Structured Response & Metadata Preservation', postOk, `Total Problems: ${postData.totalProblems}, Q1 ID: ${postData.problems[0].problemStatementId}, Q1 Org: ${postData.problems[0].organization}`);

  // Test 5: 1:1 Reconciliation (15 Items in -> 15 Items out)
  const items15: CsvProblemInputItem[] = [];
  for (let i = 1; i <= 15; i++) {
    items15.push({
      sequence: i,
      rowNumber: i + 1,
      problemStatementId: `PS${String(i).padStart(3, '0')}`,
      category: `Domain${(i % 3) + 1}`,
      team: `Team${i}`,
      organization: `Org${i}`,
      department: `Dept${i}`,
      title: `Problem ${i}`,
      description: `Problem statement description #${i} with specific deliverables`,
      difficulty: 'MEDIUM',
    });
  }

  const req15 = new Request('https://worker.local/analyze-csv', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName: '15_items.csv', questions: items15 }),
  });

  const res15 = await handleWorkerRequest(req15, mockEnv);
  const data15 = await res15.json() as any;
  const rec15Ok = data15.totalProblems === 15 && data15.problems.length === 15 && data15.problems[14].problemStatementId === 'PS015';
  record('5. 15-Item 1:1 Batch Reconciliation', rec15Ok, `Reconciled ${data15.problems.length}/15 problem statements in exact sequence`);

  // Summary
  console.log('\n========================================================================================');
  console.log('             CLOUDFLARE WORKER TEST EXECUTION SUMMARY                                   ');
  console.log('========================================================================================');
  const passCount = results.filter((r) => r.passed).length;
  const failCount = results.filter((r) => !r.passed).length;
  console.log(`Total Checks:    ${results.length}`);
  console.log(`PASS:            ${passCount} (${((passCount / results.length) * 100).toFixed(1)}%)`);
  console.log(`FAIL:            ${failCount}`);
  console.log('========================================================================================\n');

  if (failCount > 0) process.exit(1);
}

runWorkerTests().catch((err) => {
  console.error('Worker test suite failed:', err);
  process.exit(1);
});
