/**
 * Live Cloudflare Worker E2E Integration Test
 * Sends a real HTTP request to the deployed Cloudflare Worker endpoint.
 */

async function testLiveWorker() {
  console.log('\n========================================================================================');
  console.log('       LIVE DEPLOYED CLOUDFLARE WORKER END-TO-END TEST                                  ');
  console.log('========================================================================================\n');

  const endpoint = 'https://hackathon-csv-ai-analyzer.hackathon-csv-ai.workers.dev/analyze-csv';

  const testPayload = {
    fileName: 'test_hackathon_problems.csv',
    questions: [
      {
        sequence: 1,
        rowNumber: 2,
        problemStatementId: 'PS-AI-01',
        category: 'Artificial Intelligence',
        team: 'AlphaTeam',
        organization: 'ApexTech',
        department: 'DataScience',
        title: 'Deepfake Audio Detection',
        description: 'Design a real-time spectral transformer model to detect generative voice cloning in phone banking',
        difficulty: 'HARD',
      },
      {
        sequence: 2,
        rowNumber: 3,
        problemStatementId: 'PS-WEB3-02',
        category: 'Blockchain',
        team: 'BetaTeam',
        organization: 'LedgerCorp',
        department: 'Security',
        title: 'Zero-Knowledge Identity Vault',
        description: 'Build a zk-SNARK verifiable identity credential system for anonymous KYC compliance',
        difficulty: 'HARD',
      },
    ],
  };

  console.log(`📡 Sending POST request to: ${endpoint}...`);
  const t0 = Date.now();

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(testPayload),
    });

    const elapsed = Date.now() - t0;
    console.log(`⏱️ Response received in ${elapsed}ms (HTTP Status: ${res.status})`);

    const data: any = await res.json();
    console.log('📦 Response Summary:');
    console.log(`   - success: ${data.success}`);
    console.log(`   - totalProblems: ${data.totalProblems}`);
    console.log(`   - aiModelUsed: ${data.aiModelUsed}`);
    console.log(`   - aiSuccess: ${data.aiSuccess}`);
    if (data.aiError) {
      console.log(`   - aiNote: ${data.aiError}`);
    }

    if (Array.isArray(data.problems)) {
      console.log('\n🔍 Problems Returned:');
      data.problems.forEach((p: any, idx: number) => {
        console.log(`   [Problem ${p.order || p.sequence}] ID: ${p.problemStatementId} | Category: ${p.category} | Org: ${p.organization} | Quality: ${p.qualityScore}/10 | Title: ${p.title}`);
        if (p.analysis) {
          console.log(`     -> Analysis: ${p.analysis}`);
        }
      });
    }

    const pass = res.ok && data.success === true && data.totalProblems === 2 && data.problems.length === 2;
    console.log('\n========================================================================================');
    console.log(`Result: ${pass ? '✅ LIVE WORKER E2E TEST PASSED' : '❌ LIVE WORKER E2E TEST FAILED'}`);
    console.log('========================================================================================\n');

    if (!pass) process.exit(1);
  } catch (err: any) {
    console.error('❌ Network / HTTP Error calling live worker:', err.message);
    process.exit(1);
  }
}

testLiveWorker().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
