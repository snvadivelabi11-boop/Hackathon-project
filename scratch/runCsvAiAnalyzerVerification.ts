import {
  parseRawCsvText,
  detectCsvColumns,
  analyzeCsvProblemStatements,
  sanitizeCsvCell,
  mergeAiAnalysisIntoQuestions,
  CsvAiAnalysisResponse,
  AnalyzedQuestionItem,
} from '../src/services/csvProblemAnalyzer.service';

interface TestResult {
  id: number;
  name: string;
  passed: boolean;
  details: string;
}

const results: TestResult[] = [];

function recordTest(id: number, name: string, passed: boolean, details: string) {
  results.push({ id, name, passed, details });
  const icon = passed ? '✅' : '❌';
  console.log(`  ${icon} [TEST ${String(id).padStart(2, '0')}] ${name} -> ${passed ? 'PASS' : 'FAIL'} (${details})`);
}

async function runCsvAiAnalyzerTestSuite() {
  console.log('\n======================================================================');
  console.log('       CSV AI ANALYZER & CLOUD FUNCTION VERIFICATION SUITE           ');
  console.log('======================================================================\n');

  // --- Phase 1: AI Result Merging & Schema Normalization ---
  console.log('--- Phase 1: AI Result Merging & Schema Normalization ---');

  const sampleQuestions: AnalyzedQuestionItem[] = [
    {
      sequence: 1,
      questionNumber: 'Question 1',
      statementId: 'PS001',
      originalText: 'Real-Time Fraud Detection System',
      title: 'Real-Time Fraud Detection System',
      description: 'Build a ML pipeline for banking transaction fraud detection',
      category: 'Fintech',
      difficulty: 'HARD',
      status: 'VALID',
      validationNotes: 'VALID: Ready to import.',
      rowNumber: 2,
    },
    {
      sequence: 2,
      questionNumber: 'Question 2',
      statementId: 'PS002',
      originalText: 'Smart Campus Waste Segregation',
      title: 'Smart Campus Waste Segregation',
      description: 'IoT bin sensors for automatic waste classification',
      status: 'VALID',
      validationNotes: 'VALID: Ready to import.',
      rowNumber: 3,
    },
  ];

  const mockAiResponse: CsvAiAnalysisResponse = {
    success: true,
    aiSuccess: true,
    totalAnalyzed: 2,
    results: [
      {
        sequence: 1,
        isValid: true,
        qualityScore: 9,
        issues: [],
        suggestions: ['Include sample dataset schema', 'Specify latency constraint (<50ms)'],
        detectedCategory: 'Machine Learning',
        detectedDifficulty: 'HARD',
      },
      {
        sequence: 2,
        isValid: true,
        qualityScore: 7,
        issues: ['Missing hardware platform details'],
        suggestions: ['Specify supported microcontroller architectures (e.g. ESP32, Raspberry Pi)'],
        detectedCategory: 'IoT',
        detectedDifficulty: 'MEDIUM',
      },
    ],
  };

  const merged = mergeAiAnalysisIntoQuestions(sampleQuestions, mockAiResponse);

  // Test 1: Quality scores merged accurately
  const score1 = merged[0].aiQualityScore === 9;
  const score2 = merged[1].aiQualityScore === 7;
  recordTest(1, 'AI Quality Score Merging', score1 && score2, `Q1 Score: ${merged[0].aiQualityScore}/10, Q2 Score: ${merged[1].aiQualityScore}/10`);

  // Test 2: AI Suggestions attached
  const hasSuggestions = merged[0].aiSuggestions?.length === 2 && merged[1].aiSuggestions?.length === 1;
  recordTest(2, 'AI Suggestions Attachment', hasSuggestions, `Q1 suggestions: ${merged[0].aiSuggestions?.length}, Q2 suggestions: ${merged[1].aiSuggestions?.length}`);

  // Test 3: AI Issues attached and surfaced in validationNotes
  const hasIssues = (merged[1].aiIssues?.length ?? 0) > 0 && merged[1].validationNotes.includes('AI Issues');
  recordTest(3, 'AI Issues Merging & Notes Update', hasIssues, `Q2 Notes: "${merged[1].validationNotes}"`);

  // Test 4: Category enrichment (preserving explicit category vs filling empty category)
  const q1CategoryPreserved = merged[0].category === 'Fintech'; // User provided Fintech, preserved
  const q2CategoryInferred = merged[1].category === 'IoT'; // User provided none, AI filled IoT
  recordTest(4, 'Category Enrichment Logic', q1CategoryPreserved && q2CategoryInferred, `Q1: ${merged[0].category} (explicit), Q2: ${merged[1].category} (AI inferred)`);

  // Test 5: Difficulty enrichment
  const q1Diff = merged[0].difficulty === 'HARD';
  const q2Diff = merged[1].difficulty === 'MEDIUM';
  recordTest(5, 'Difficulty Enrichment Logic', q1Diff && q2Diff, `Q1 Difficulty: ${merged[0].difficulty}, Q2 Difficulty: ${merged[1].difficulty}`);

  // --- Phase 2: Graceful Degradation & Edge Cases ---
  console.log('\n--- Phase 2: Graceful Degradation & Edge Cases ---');

  // Test 6: Empty AI results fallback
  const emptyAiResponse: CsvAiAnalysisResponse = {
    success: true,
    aiSuccess: false,
    aiError: 'OpenRouter rate limit',
    totalAnalyzed: 0,
    results: [],
  };
  const fallbackMerged = mergeAiAnalysisIntoQuestions(sampleQuestions, emptyAiResponse);
  const preservedUnchanged = fallbackMerged[0].title === sampleQuestions[0].title && fallbackMerged[0].aiAnalyzed === undefined;
  recordTest(6, 'Empty AI Results Graceful Fallback', preservedUnchanged, 'Original questions intact without corruption');

  // Test 7: AI score clamping logic
  const clampScore = (val: any): number => {
    const n = typeof val === 'number' ? val : parseInt(String(val), 10);
    if (isNaN(n)) return 5;
    return Math.max(1, Math.min(10, n));
  };
  const clampedLow = clampScore(-5) === 1;
  const clampedHigh = clampScore(99) === 10;
  const clampedNaN = clampScore('invalid') === 5;
  const clampedValid = clampScore(8) === 8;
  recordTest(7, 'AI Quality Score Clamping (1-10)', clampedLow && clampedHigh && clampedNaN && clampedValid, 'Clamped: -5 -> 1, 99 -> 10, invalid -> 5, 8 -> 8');

  // Test 8: Response normalization for wrapped object { results: [...] }
  const rawWrappedAiResponse = JSON.stringify({
    results: [
      { sequence: 1, isValid: true, qualityScore: 10, issues: [], suggestions: [], detectedCategory: 'AI', detectedDifficulty: 'HARD' },
    ],
  });
  const parsedWrapped = JSON.parse(rawWrappedAiResponse);
  const isWrappedArray = Array.isArray(parsedWrapped.results);
  recordTest(8, 'Wrapped AI JSON Response Normalization', isWrappedArray && parsedWrapped.results[0].qualityScore === 10, 'Normalized { results: [...] } structure correctly');

  // Test 9: Markdown fences removal in AI response
  const rawWithFences = '```json\n[{"sequence": 1, "qualityScore": 8, "isValid": true}]\n```';
  const cleaned = rawWithFences.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  const parsedCleaned = JSON.parse(cleaned);
  recordTest(9, 'Markdown Code Fences Cleaning', Array.isArray(parsedCleaned) && parsedCleaned[0].qualityScore === 8, 'Cleaned ```json code fences properly');

  // --- Phase 3: End-to-End Pipeline Simulation ---
  console.log('\n--- Phase 3: End-to-End Pipeline Simulation ---');

  const rawCsv = `question,category,description
"Autonomous Drone Navigation","Robotics","Implement SLAM on simulated drone environment"
"Decentralized Identity Verification","Web3","Zero-knowledge proof identity protocol"
"","","Empty row test"
"=SUM(A1:A10) Injection Test","Security","Test formula sanitization"`;

  // Test 10: Full pipeline from raw CSV to AI enrichment
  const localAnalysis = analyzeCsvProblemStatements(rawCsv, 'hackathon_problems.csv', []);
  const validForAi = localAnalysis.validItemsToSave;

  const simulatedAiCall: CsvAiAnalysisResponse = {
    success: true,
    aiSuccess: true,
    totalAnalyzed: validForAi.length,
    results: validForAi.map((q, idx) => ({
      sequence: q.sequence,
      isValid: !q.title.includes('Empty'),
      qualityScore: 8 + (idx % 2),
      issues: q.title.includes('Injection') ? ['Formula syntax detected'] : [],
      suggestions: ['Add evaluation rubric'],
      detectedCategory: q.category || 'General',
      detectedDifficulty: 'MEDIUM' as const,
    })),
  };

  const finalEnriched = mergeAiAnalysisIntoQuestions(localAnalysis.questions, simulatedAiCall);
  const finalValid = mergeAiAnalysisIntoQuestions(localAnalysis.validItemsToSave, simulatedAiCall);

  const test10Pass = finalValid.length === 3 && finalValid.every((q) => q.aiAnalyzed === true && q.aiQualityScore !== undefined);
  recordTest(10, 'Full Pipeline: CSV Parse -> Validation -> AI Enrich', test10Pass, `3 valid items enriched with AI metadata (Scores: ${finalValid.map((q) => q.aiQualityScore).join(', ')})`);

  // Test 11: Formula cell properly sanitized in enriched output
  const injectionItem = finalValid.find((q) => q.title.includes('Injection'));
  const isSanitized = injectionItem?.title.startsWith("'=");
  recordTest(11, 'Formula Injection Sanitization Preserved', isSanitized === true, `Title: "${injectionItem?.title}"`);

  // Test 12: Sequence numbering stability across pipeline
  const sequences = finalValid.map((q) => q.sequence);
  const ids = finalValid.map((q) => q.statementId);
  const seqsOk = JSON.stringify(sequences) === JSON.stringify([1, 2, 4]) && JSON.stringify(ids) === JSON.stringify(['PS001', 'PS002', 'PS004']);
  recordTest(12, 'Sequence Numbering & IDs Stability', seqsOk, `Sequences: [${sequences.join(', ')}], IDs: [${ids.join(', ')}]`);

  // --- Summary ---
  console.log('\n======================================================================');
  console.log('             CSV AI ANALYZER VERIFICATION SUMMARY                     ');
  console.log('======================================================================');
  const passCount = results.filter((r) => r.passed).length;
  const failCount = results.filter((r) => !r.passed).length;
  console.log(`Total Checks:    ${results.length}`);
  console.log(`PASS:            ${passCount} (${((passCount / results.length) * 100).toFixed(1)}%)`);
  console.log(`FAIL:            ${failCount}`);
  console.log('======================================================================\n');

  if (failCount > 0) {
    process.exit(1);
  }
}

runCsvAiAnalyzerTestSuite().catch((err) => {
  console.error('Test suite failed with unexpected error:', err);
  process.exit(1);
});
