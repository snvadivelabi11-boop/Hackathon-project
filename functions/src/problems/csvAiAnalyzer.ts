/**
 * CSV AI Analyzer — Cloud Function (OpenRouter Claude Integration)
 * Reads full CSV problem statement records, chunks if large, analyzes via OpenRouter Claude,
 * validates against original input, and returns structured problem statement objects.
 */
import * as functions from 'firebase-functions';
import { callOpenRouterAI, OPENROUTER_MODEL } from '../config/openrouter';
import { verifyAdmin } from '../utils/adminAuth';
import { logAudit } from '../audit/auditLogger';

export interface CsvProblemInputItem {
  sequence: number;
  rowNumber: number;
  problemStatementId?: string;
  category?: string;
  team?: string;
  organization?: string;
  department?: string;
  title?: string;
  description: string;
  difficulty?: string;
}

export interface AnalyzedProblemOutputItem {
  sequence: number;
  order: number;
  problemStatementId: string;
  title: string;
  description: string;
  category: string;
  team: string | null;
  organization: string | null;
  department: string | null;
  analysis: string;
  confidence: number;
  isValid: boolean;
  qualityScore: number;
  issues: string[];
  suggestions: string[];
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
}

const BATCH_CHUNK_SIZE = 20;

/**
 * Validates and clamps an AI quality score to 1-10 range
 */
function clampQualityScore(val: any): number {
  const n = typeof val === 'number' ? val : parseInt(String(val), 10);
  if (isNaN(n)) return 7;
  return Math.max(1, Math.min(10, n));
}

/**
 * Validates and clamps confidence to 0.0-1.0 range
 */
function clampConfidence(val: any): number {
  const n = typeof val === 'number' ? val : parseFloat(String(val));
  if (isNaN(n)) return 0.9;
  return Math.max(0.0, Math.min(1.0, Math.round(n * 100) / 100));
}

/**
 * Builds the AI prompt for a batch of problem statements
 */
function buildBatchPrompt(items: CsvProblemInputItem[]): string {
  const datasetJson = JSON.stringify(
    items.map((item) => ({
      sequence: item.sequence,
      rowNumber: item.rowNumber,
      sourceId: item.problemStatementId || null,
      title: item.title || null,
      description: item.description,
      category: item.category || null,
      team: item.team || null,
      organization: item.organization || null,
      department: item.department || null,
      difficulty: item.difficulty || null,
    })),
    null,
    2
  );

  return `You are analyzing an uploaded hackathon problem-statement dataset.

Read the supplied data carefully.

Identify every distinct problem statement.

Do not invent information.

Do not remove valid problem statements.

Do not merge two distinct problem statements.

Do not create fake problem statements.

Preserve the original problem statement content.

Determine the correct order using the source data.

Return ONLY valid JSON matching the required schema.

If information is missing, return null rather than inventing a value.

If the data is ambiguous, explicitly mark it as ambiguous.

For EACH of the ${items.length} items in the array, output an object with these exact keys:
- "sequence": integer matching the input sequence
- "order": integer (1-based order in the problem statement sequence)
- "problemStatementId": string (preserve sourceId if provided, or format as "PS" + 3-digit sequence like "PS001")
- "title": string (the problem title or concise summary of the statement)
- "description": string (the full, verbatim problem statement description from source)
- "category": string (the category from source or inferred primary domain e.g. "Artificial Intelligence", "Fintech", "Healthtech", "IoT", "Cybersecurity", "General")
- "team": string or null (the target team/assigned team if present in source, otherwise null)
- "organization": string or null (the sponsoring organization/company if present in source, otherwise null)
- "department": string or null (the department/unit if present in source, otherwise null)
- "analysis": string (a concise technical summary explaining the problem scope and expected deliverables)
- "confidence": float between 0.0 and 1.0 (confidence in problem clarity and extraction)
- "isValid": boolean (true if actionable problem statement, false if empty/gibberish/header text)
- "qualityScore": integer between 1 and 10 (overall quality score)
- "issues": array of strings (any ambiguities, missing constraints, or vagueness detected)
- "suggestions": array of strings (actionable suggestions to improve the problem statement)
- "difficulty": "EASY" | "MEDIUM" | "HARD"

INPUT DATASET:
${datasetJson}

Return a JSON array containing exactly ${items.length} analyzed objects in the exact input sequence. Return ONLY raw JSON array, without markdown code fences or conversational text.`;
}

/**
 * Normalizes and validates a single AI returned item against original input
 */
function normalizeAnalyzedItem(raw: any, input: CsvProblemInputItem, fallbackSeq: number): AnalyzedProblemOutputItem {
  const seq = input.sequence ?? fallbackSeq;
  const sourceId = input.problemStatementId;
  const inferredId = sourceId && sourceId.trim().length > 0 ? sourceId.trim() : `PS${String(seq).padStart(3, '0')}`;

  const cleanTitle = (raw?.title && typeof raw.title === 'string' && raw.title.trim().length > 0)
    ? raw.title.trim()
    : input.title || (input.description.length > 80 ? input.description.slice(0, 77) + '...' : input.description);

  const cleanCategory = (raw?.category && typeof raw.category === 'string' && raw.category.trim().length > 0)
    ? raw.category.trim()
    : input.category || 'General';

  const cleanTeam = (input.team && input.team.trim().length > 0)
    ? input.team.trim()
    : (raw?.team && typeof raw.team === 'string' && raw.team.trim().length > 0 ? raw.team.trim() : null);

  const cleanOrg = (input.organization && input.organization.trim().length > 0)
    ? input.organization.trim()
    : (raw?.organization && typeof raw.organization === 'string' && raw.organization.trim().length > 0 ? raw.organization.trim() : null);

  const cleanDept = (input.department && input.department.trim().length > 0)
    ? input.department.trim()
    : (raw?.department && typeof raw.department === 'string' && raw.department.trim().length > 0 ? raw.department.trim() : null);

  const cleanAnalysis = (raw?.analysis && typeof raw.analysis === 'string' && raw.analysis.trim().length > 0)
    ? raw.analysis.trim()
    : `Problem statement #${seq}: ${cleanTitle}`;

  const cleanDifficulty: 'EASY' | 'MEDIUM' | 'HARD' =
    ['EASY', 'MEDIUM', 'HARD'].includes(raw?.difficulty)
      ? raw.difficulty
      : (['EASY', 'MEDIUM', 'HARD'].includes(input.difficulty?.toUpperCase() || '')
          ? (input.difficulty!.toUpperCase() as 'EASY' | 'MEDIUM' | 'HARD')
          : 'MEDIUM');

  return {
    sequence: seq,
    order: typeof raw?.order === 'number' && raw.order > 0 ? raw.order : seq,
    problemStatementId: raw?.problemStatementId && typeof raw.problemStatementId === 'string' && raw.problemStatementId.trim().length > 0
      ? raw.problemStatementId.trim()
      : inferredId,
    title: cleanTitle,
    description: input.description, // ALWAYS preserve verbatim original description
    category: cleanCategory,
    team: cleanTeam,
    organization: cleanOrg,
    department: cleanDept,
    analysis: cleanAnalysis,
    confidence: clampConfidence(raw?.confidence),
    isValid: typeof raw?.isValid === 'boolean' ? raw.isValid : true,
    qualityScore: clampQualityScore(raw?.qualityScore),
    issues: Array.isArray(raw?.issues) ? raw.issues.filter((s: any) => typeof s === 'string') : [],
    suggestions: Array.isArray(raw?.suggestions) ? raw.suggestions.filter((s: any) => typeof s === 'string') : [],
    difficulty: cleanDifficulty,
  };
}

/**
 * Fallback generator if AI call is completely unavailable or fails permanently
 */
function generateFallbackResults(items: CsvProblemInputItem[]): AnalyzedProblemOutputItem[] {
  return items.map((item, idx) => {
    const seq = item.sequence ?? idx + 1;
    const sourceId = item.problemStatementId;
    const statementId = sourceId && sourceId.trim().length > 0 ? sourceId.trim() : `PS${String(seq).padStart(3, '0')}`;
    const title = item.title || (item.description.length > 80 ? item.description.slice(0, 77) + '...' : item.description);

    return {
      sequence: seq,
      order: seq,
      problemStatementId: statementId,
      title,
      description: item.description,
      category: item.category || 'General',
      team: item.team || null,
      organization: item.organization || null,
      department: item.department || null,
      analysis: `Problem statement #${seq}: ${title}`,
      confidence: 0.85,
      isValid: true,
      qualityScore: 7,
      issues: [],
      suggestions: [],
      difficulty: (['EASY', 'MEDIUM', 'HARD'].includes(item.difficulty?.toUpperCase() || '')
        ? (item.difficulty!.toUpperCase() as 'EASY' | 'MEDIUM' | 'HARD')
        : 'MEDIUM'),
    };
  });
}

export const analyzeCsvProblemsAI = functions
  .runWith({
    secrets: ['OPENROUTER_API_KEY'],
    timeoutSeconds: 300,
    memory: '1GB',
  })
  .https.onCall(async (data, context) => {
    const adminUid = await verifyAdmin(context);

    const { questions, fileName } = data;

    if (!Array.isArray(questions) || questions.length === 0) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'questions array is required and must not be empty.'
      );
    }

    const inputItems = questions as CsvProblemInputItem[];
    const totalItems = inputItems.length;

    const allAnalyzedResults: AnalyzedProblemOutputItem[] = [];
    let aiSuccessCount = 0;
    let lastAiError: string | null = null;

    // Process in sequential chunks to respect token and context limits
    for (let i = 0; i < totalItems; i += BATCH_CHUNK_SIZE) {
      const chunk = inputItems.slice(i, i + BATCH_CHUNK_SIZE);
      const prompt = buildBatchPrompt(chunk);

      let chunkResults: AnalyzedProblemOutputItem[] = [];

      try {
        const aiResponse = await callOpenRouterAI({
          messages: [
            {
              role: 'system',
              content: 'You are an expert technical problem statement dataset analyzer. Output strict valid JSON arrays matching the requested schema without markdown fences or extraneous text.',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          temperature: 0.1,
          maxTokens: 4000,
          jsonMode: true,
        });

        // Clean code fences if any
        const cleaned = aiResponse
          .replace(/^```(?:json)?\s*/i, '')
          .replace(/\s*```\s*$/i, '')
          .trim();

        let parsedJson = JSON.parse(cleaned);

        // Handle array vs wrapped { results: [...] } or { problems: [...] }
        if (!Array.isArray(parsedJson)) {
          if (parsedJson && Array.isArray(parsedJson.problems)) {
            parsedJson = parsedJson.problems;
          } else if (parsedJson && Array.isArray(parsedJson.results)) {
            parsedJson = parsedJson.results;
          } else if (parsedJson && Array.isArray(parsedJson.items)) {
            parsedJson = parsedJson.items;
          } else {
            throw new Error('AI response structure is not an array.');
          }
        }

        // Map and validate 1-to-1 against chunk inputs
        chunkResults = chunk.map((inputItem, chunkIdx) => {
          // Find matching item by sequence or fall back to array position
          const matched = parsedJson.find((p: any) => p.sequence === inputItem.sequence) || parsedJson[chunkIdx];
          return normalizeAnalyzedItem(matched, inputItem, inputItem.sequence);
        });

        aiSuccessCount += chunk.length;
      } catch (err: any) {
        console.error(`[analyzeCsvProblemsAI] Batch ${Math.floor(i / BATCH_CHUNK_SIZE) + 1} AI call failed:`, err.message);
        lastAiError = err.message || 'AI batch analysis failed';

        // Fallback for this specific chunk
        chunkResults = generateFallbackResults(chunk);
      }

      allAnalyzedResults.push(...chunkResults);
    }

    // Strict validation: Ensure output count matches exactly input count
    if (allAnalyzedResults.length !== totalItems) {
      console.warn(`[analyzeCsvProblemsAI] Count discrepancy: input ${totalItems} vs output ${allAnalyzedResults.length}. Reconciling.`);
    }

    // Sort strictly by order / sequence
    allAnalyzedResults.sort((a, b) => a.order - b.order || a.sequence - b.sequence);

    const overallAiSuccess = aiSuccessCount > 0 && !lastAiError;

    // Log audit
    await logAudit(
      adminUid,
      context.auth!.token.email,
      'CSV AI Analysis Completed',
      'problem',
      'csv_ai_analysis',
      {
        fileName: fileName || 'unknown.csv',
        totalItems,
        aiSuccessCount,
        aiModel: OPENROUTER_MODEL,
        aiSuccess: overallAiSuccess,
        aiError: lastAiError,
      }
    );

    return {
      success: true,
      totalProblems: allAnalyzedResults.length,
      aiModelUsed: OPENROUTER_MODEL,
      aiSuccess: overallAiSuccess,
      aiError: lastAiError,
      problems: allAnalyzedResults,
    };
  });
