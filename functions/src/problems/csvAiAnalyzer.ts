/**
 * CSV AI Analyzer — Cloud Function
 * Sends parsed CSV problem statements to OpenRouter for AI quality assessment.
 * Returns quality scores, issues, suggestions, and inferred metadata per question.
 */
import * as functions from 'firebase-functions';
import { callOpenRouterAI } from '../config/openrouter';
import { verifyAdmin } from '../utils/adminAuth';
import { logAudit } from '../audit/auditLogger';

export interface CsvAiQuestionInput {
  sequence: number;
  title: string;
  description: string;
  category?: string;
}

export interface CsvAiQuestionResult {
  sequence: number;
  isValid: boolean;
  qualityScore: number; // 1-10
  issues: string[];
  suggestions: string[];
  detectedCategory: string;
  detectedDifficulty: 'EASY' | 'MEDIUM' | 'HARD';
}

const MAX_QUESTIONS_PER_CALL = 50;

/**
 * Validates and clamps an AI quality score to 1-10 range
 */
function clampScore(val: any): number {
  const n = typeof val === 'number' ? val : parseInt(String(val), 10);
  if (isNaN(n)) return 5;
  return Math.max(1, Math.min(10, n));
}

/**
 * Validates a single AI result item and normalizes it
 */
function normalizeAiResult(raw: any, seq: number): CsvAiQuestionResult {
  return {
    sequence: raw?.sequence ?? seq,
    isValid: typeof raw?.isValid === 'boolean' ? raw.isValid : true,
    qualityScore: clampScore(raw?.qualityScore),
    issues: Array.isArray(raw?.issues) ? raw.issues.filter((s: any) => typeof s === 'string') : [],
    suggestions: Array.isArray(raw?.suggestions) ? raw.suggestions.filter((s: any) => typeof s === 'string') : [],
    detectedCategory: typeof raw?.detectedCategory === 'string' ? raw.detectedCategory : 'General',
    detectedDifficulty: ['EASY', 'MEDIUM', 'HARD'].includes(raw?.detectedDifficulty)
      ? raw.detectedDifficulty
      : 'MEDIUM',
  };
}

/**
 * Builds the AI prompt from parsed CSV questions
 */
function buildPrompt(questions: CsvAiQuestionInput[]): string {
  const questionsList = questions.map((q) =>
    `[Question ${q.sequence}]\nTitle: ${q.title}\nDescription: ${q.description}${q.category ? `\nCategory: ${q.category}` : ''}`
  ).join('\n\n');

  return `You are an expert hackathon problem statement reviewer.

Analyze each of the following ${questions.length} problem statements from a CSV upload.

For EACH problem statement, assess:
1. isValid (boolean) — Is this a legitimate, actionable problem statement? Mark false for gibberish, test data, or meaningless text.
2. qualityScore (integer 1-10) — Overall quality. 10 = excellent, well-defined problem. 1 = unusable.
   - 8-10: Clear problem, well-defined deliverables, appropriate scope
   - 5-7: Acceptable but could be improved (missing details, vague scope)
   - 1-4: Poor quality (too vague, too short, missing context)
3. issues (string array) — Specific problems found. Examples: "Too vague", "Missing deliverables", "No technical requirements", "Duplicate of another question"
4. suggestions (string array) — Actionable improvements. Examples: "Add expected output format", "Specify technology constraints"
5. detectedCategory (string) — Best-fit category. Examples: "Web Development", "Machine Learning", "Data Science", "Mobile App", "IoT", "Blockchain", "General"
6. detectedDifficulty ("EASY" | "MEDIUM" | "HARD")

Return a JSON array of objects with keys: sequence, isValid, qualityScore, issues, suggestions, detectedCategory, detectedDifficulty.
Return ONLY the raw JSON array. No markdown fences, no explanations.

Problem Statements:

${questionsList}`;
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

    // Limit input size
    const truncated = questions.slice(0, MAX_QUESTIONS_PER_CALL) as CsvAiQuestionInput[];
    const wasTruncated = questions.length > MAX_QUESTIONS_PER_CALL;

    let aiResults: CsvAiQuestionResult[] = [];
    let aiSuccess = false;
    let aiError: string | null = null;

    try {
      const prompt = buildPrompt(truncated);

      const response = await callOpenRouterAI({
        messages: [
          {
            role: 'system',
            content: 'You are an expert technical problem statement reviewer. You output strict valid JSON arrays without markdown or code fences.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.15,
        maxTokens: 4000,
        jsonMode: true,
      });

      // Clean and parse the response
      const cleaned = response
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```\s*$/i, '')
        .trim();

      const parsed = JSON.parse(cleaned);

      if (Array.isArray(parsed)) {
        aiResults = parsed.map((item: any, idx: number) =>
          normalizeAiResult(item, truncated[idx]?.sequence ?? idx + 1)
        );
        aiSuccess = true;
      } else if (parsed && typeof parsed === 'object' && Array.isArray(parsed.results)) {
        // Handle case where AI wraps in { results: [...] }
        aiResults = parsed.results.map((item: any, idx: number) =>
          normalizeAiResult(item, truncated[idx]?.sequence ?? idx + 1)
        );
        aiSuccess = true;
      } else {
        throw new Error('AI response is not an array or wrapped array.');
      }
    } catch (err: any) {
      console.error('[analyzeCsvProblemsAI] AI call failed:', err.message);
      aiError = err.message || 'AI analysis failed';

      // Fallback: return stub results with aiAnalyzed = false
      aiResults = truncated.map((q) => ({
        sequence: q.sequence,
        isValid: true,
        qualityScore: 5,
        issues: [],
        suggestions: [],
        detectedCategory: q.category || 'General',
        detectedDifficulty: 'MEDIUM' as const,
      }));
    }

    // Log audit
    await logAudit(
      adminUid,
      context.auth!.token.email,
      'CSV AI Analysis',
      'problem',
      'csv_ai_analysis',
      {
        fileName: fileName || 'unknown.csv',
        questionsAnalyzed: truncated.length,
        aiSuccess,
        aiError,
        wasTruncated,
      }
    );

    return {
      success: true,
      aiSuccess,
      aiError,
      wasTruncated,
      totalAnalyzed: truncated.length,
      results: aiResults,
    };
  });
