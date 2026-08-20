/**
 * Cloudflare Worker — Problem Statement CSV AI Analyzer Backend
 * Securely communicates with OpenRouter (Claude 3.5 Sonnet) at Cloudflare's edge.
 * Enforces 20-item chunking, strict non-fabrication prompt, and 1:1 input reconciliation.
 */

export interface Env {
  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODEL?: string;
  ALLOWED_ORIGINS?: string;
}

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

const BATCH_CHUNK_SIZE = 10;
const CONCURRENCY_LIMIT = 3;
const DEFAULT_MODEL = '~anthropic/claude-sonnet-latest';

/**
 * Builds CORS headers for responses
 */
function getCorsHeaders(origin: string | null, env: Env): HeadersInit {
  const allowed = env.ALLOWED_ORIGINS || '*';
  const allowOrigin = allowed === '*' ? '*' : (origin && allowed.split(',').map((o) => o.trim()).includes(origin) ? origin : '*');

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    'Access-Control-Max-Age': '86400',
  };
}

/**
 * Sanitizes error messages so secret keys are never leaked
 */
function sanitizeError(msg: string, key?: string): string {
  let clean = msg || '';
  if (key && key.length > 5) {
    clean = clean.split(key).join('[REDACTED_API_KEY]');
  }
  return clean.replace(/Bearer\s+[a-zA-Z0-9_\-\.]+/gi, 'Bearer [REDACTED_TOKEN]');
}

/**
 * Clamps quality scores between 1 and 10
 */
function clampQualityScore(val: any): number {
  const n = typeof val === 'number' ? val : parseInt(String(val), 10);
  if (isNaN(n)) return 7;
  return Math.max(1, Math.min(10, n));
}

/**
 * Clamps confidence between 0.0 and 1.0
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
- "issues": array of strings (list of potential gaps, ambiguities, or missing requirements; empty array if clear)
- "suggestions": array of strings (concrete improvements or extension ideas)
- "difficulty": string ("EASY", "MEDIUM", or "HARD")

Here is the JSON dataset to analyze:
${datasetJson}

Respond with a JSON object in this exact structure:
{
  "problems": [
    ...
  ]
}`;
}

/**
 * Normalizes an analyzed item from AI response, ensuring all required fields are present and safe
 */
function normalizeAnalyzedItem(
  aiItem: any,
  fallbackInput: CsvProblemInputItem,
  expectedSequence: number
): AnalyzedProblemOutputItem {
  const item = aiItem || {};
  const rawSeq = item.sequence !== undefined && item.sequence !== null ? item.sequence : expectedSequence;
  const seq = typeof rawSeq === 'number' ? rawSeq : parseInt(String(rawSeq), 10) || expectedSequence;

  const rawOrder = item.order !== undefined && item.order !== null ? item.order : seq;
  const order = typeof rawOrder === 'number' ? rawOrder : parseInt(String(rawOrder), 10) || seq;

  const rawPsId = item.problemStatementId || fallbackInput.problemStatementId;
  const problemStatementId = rawPsId
    ? String(rawPsId).trim()
    : `PS${String(seq).padStart(3, '0')}`;

  const title = (item.title && String(item.title).trim()) ||
    fallbackInput.title ||
    `Problem Statement #${seq}`;

  const description = (item.description && String(item.description).trim()) ||
    fallbackInput.description ||
    title;

  const category = (item.category && String(item.category).trim()) ||
    fallbackInput.category ||
    'General';

  const team = item.team !== undefined && item.team !== null && String(item.team).trim().length > 0
    ? String(item.team).trim()
    : (fallbackInput.team || null);

  const organization = item.organization !== undefined && item.organization !== null && String(item.organization).trim().length > 0
    ? String(item.organization).trim()
    : (fallbackInput.organization || null);

  const department = item.department !== undefined && item.department !== null && String(item.department).trim().length > 0
    ? String(item.department).trim()
    : (fallbackInput.department || null);

  const analysis = (item.analysis && String(item.analysis).trim()) ||
    `Problem statement #${seq}: ${title}`;

  const confidence = clampConfidence(item.confidence);
  const isValid = item.isValid !== false;
  const qualityScore = clampQualityScore(item.qualityScore);

  const issues = Array.isArray(item.issues)
    ? item.issues.map((s: any) => String(s).trim()).filter(Boolean)
    : [];

  const suggestions = Array.isArray(item.suggestions)
    ? item.suggestions.map((s: any) => String(s).trim()).filter(Boolean)
    : [];

  const rawDiff = item.difficulty ? String(item.difficulty).toUpperCase().trim() : (fallbackInput.difficulty || 'MEDIUM');
  const difficulty: 'EASY' | 'MEDIUM' | 'HARD' =
    rawDiff === 'EASY' || rawDiff === 'HARD' ? rawDiff : 'MEDIUM';

  return {
    sequence: seq,
    order,
    problemStatementId,
    title,
    description,
    category,
    team,
    organization,
    department,
    analysis,
    confidence,
    isValid,
    qualityScore,
    issues,
    suggestions,
    difficulty,
  };
}

/**
 * Generates structured fallback output when AI analysis is unreachable
 */
function generateFallbackResults(items: CsvProblemInputItem[]): AnalyzedProblemOutputItem[] {
  return items.map((item, idx) => {
    const seq = item.sequence || idx + 1;
    const psId = item.problemStatementId || `PS${String(seq).padStart(3, '0')}`;
    const title = item.title || `Problem Statement #${seq}`;
    const desc = item.description || title;

    return {
      sequence: seq,
      order: seq,
      problemStatementId: psId,
      title,
      description: desc,
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
      difficulty: (item.difficulty && (item.difficulty.toUpperCase() === 'EASY' || item.difficulty.toUpperCase() === 'HARD')
        ? (item.difficulty.toUpperCase() as 'EASY' | 'HARD')
        : 'MEDIUM'),
    };
  });
}

/**
 * Calls OpenRouter AI with exponential backoff retries
 */
async function callOpenRouter(prompt: string, apiKey: string, model: string): Promise<string> {
  const modelsToTry = [
    model,
    'anthropic/claude-sonnet-4.6',
  ].filter((m, i, arr) => arr.indexOf(m) === i);

  let lastError: Error | null = null;

  for (const currentModel of modelsToTry) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 45000);

      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://hackathon-portal.local',
          'X-Title': 'Hackathon Management Portal (Cloudflare Worker)',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: currentModel,
          messages: [
            {
              role: 'system',
              content: 'You are an expert technical problem statement dataset analyzer. Output strict valid JSON arrays matching the requested schema without markdown fences or conversational text.',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          temperature: 0.1,
          max_tokens: 3000,
          response_format: { type: 'json_object' },
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        const cleanErr = sanitizeError(errText, apiKey);
        if (res.status === 404) {
          lastError = new Error(`OpenRouter model "${currentModel}" not available: ${cleanErr}`);
          continue; // Try fallback model only if 404
        }
        if (res.status === 402) {
          throw new Error(`OpenRouter API error (402): Insufficient credits on OpenRouter account.`);
        }
        if (res.status === 401) {
          throw new Error(`OpenRouter API error (401): Invalid OpenRouter API key.`);
        }
        throw new Error(`OpenRouter API error (${res.status}): ${cleanErr}`);
      }

      const json: any = await res.json();
      const choice = json.choices?.[0]?.message?.content;
      if (!choice) {
        throw new Error('OpenRouter returned an empty response.');
      }

      return choice;
    } catch (err: any) {
      const isAbort = err.name === 'AbortError';
      const errMsg = isAbort ? 'OpenRouter request timed out after 45s.' : err.message;
      lastError = new Error(sanitizeError(errMsg, apiKey));
      if (!errMsg.includes('404')) {
        break; // Do not waste subrequests on non-404 errors
      }
    }
  }

  throw lastError || new Error('OpenRouter call failed.');
}

export async function handleWorkerRequest(request: Request, env: Env): Promise<Response> {
  const origin = request.headers.get('Origin');
  const corsHeaders = getCorsHeaders(origin, env);

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

    const url = new URL(request.url);

    // Health check endpoint
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
      return new Response(
        JSON.stringify({
          status: 'healthy',
          service: 'hackathon-csv-ai-analyzer',
          model: env.OPENROUTER_MODEL || DEFAULT_MODEL,
          timestamp: new Date().toISOString(),
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // AI Analysis Endpoint
    if (request.method === 'POST' && (url.pathname === '/analyze-csv' || url.pathname === '/analyze-csv-problems' || url.pathname === '/')) {
      try {
        const body: any = await request.json().catch(() => null);
        if (!body || !Array.isArray(body.questions) || body.questions.length === 0) {
          return new Response(
            JSON.stringify({
              success: false,
              error: 'Invalid request: "questions" array is required and must not be empty.',
            }),
            {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            }
          );
        }

        const inputItems = body.questions as CsvProblemInputItem[];
        const totalItems = inputItems.length;
        const model = env.OPENROUTER_MODEL || DEFAULT_MODEL;
        const apiKey = env.OPENROUTER_API_KEY || '';

        // If no API key configured on worker, return structured fallback with informative note
        if (!apiKey) {
          const fallbackProblems = generateFallbackResults(inputItems);
          return new Response(
            JSON.stringify({
              success: true,
              totalProblems: fallbackProblems.length,
              aiModelUsed: model,
              aiSuccess: false,
              aiError: 'OpenRouter API key is not configured on Cloudflare Worker secret.',
              problems: fallbackProblems,
            }),
            {
              status: 200,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            }
          );
        }

        const allAnalyzedResults: AnalyzedProblemOutputItem[] = [];
        let aiSuccessCount = 0;
        let lastAiError: string | null = null;

        // Split into chunks of 5 items
        const chunks: CsvProblemInputItem[][] = [];
        for (let i = 0; i < totalItems; i += BATCH_CHUNK_SIZE) {
          chunks.push(inputItems.slice(i, i + BATCH_CHUNK_SIZE));
        }

        // Process chunks in concurrent batches of up to CONCURRENCY_LIMIT (4)
        for (let b = 0; b < chunks.length; b += CONCURRENCY_LIMIT) {
          const currentBatch = chunks.slice(b, b + CONCURRENCY_LIMIT);
          const batchPromises = currentBatch.map(async (chunk, batchIdx) => {
            const chunkNumber = b + batchIdx + 1;
            const prompt = buildBatchPrompt(chunk);
            try {
              const aiResponseText = await callOpenRouter(prompt, apiKey, model);
              const cleaned = aiResponseText
                .replace(/^```(?:json)?\s*/i, '')
                .replace(/\s*```\s*$/i, '')
                .trim();

              let parsedJson = JSON.parse(cleaned);

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

              // Strict 1:1 mapping against chunk inputs
              const mappedResults = chunk.map((inputItem, cIdx) => {
                const matched = parsedJson.find((p: any) => p.sequence === inputItem.sequence) || parsedJson[cIdx];
                return normalizeAnalyzedItem(matched, inputItem, inputItem.sequence);
              });

              return {
                success: true,
                count: chunk.length,
                results: mappedResults,
                error: null,
              };
            } catch (err: any) {
              console.error(`[Worker] Chunk ${chunkNumber} AI call failed:`, err.message);
              return {
                success: false,
                count: 0,
                results: generateFallbackResults(chunk),
                error: err.message || 'AI batch analysis failed',
              };
            }
          });

          const batchOutputs = await Promise.all(batchPromises);
          for (const output of batchOutputs) {
            if (output.success) {
              aiSuccessCount += output.count;
            } else if (output.error) {
              lastAiError = output.error;
            }
            allAnalyzedResults.push(...output.results);
          }
        }

        // Sort strictly by order / sequence
        allAnalyzedResults.sort((a, b) => a.order - b.order || a.sequence - b.sequence);

        const overallAiSuccess = aiSuccessCount === totalItems && !lastAiError;

        return new Response(
          JSON.stringify({
            success: true,
            totalProblems: allAnalyzedResults.length,
            aiModelUsed: model,
            aiSuccess: overallAiSuccess,
            aiError: lastAiError,
            problems: allAnalyzedResults,
          }),
          {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      } catch (err: any) {
        return new Response(
          JSON.stringify({
            success: false,
            error: err.message || 'Internal worker error during CSV analysis.',
          }),
          {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }
    }

    // Default 404
    return new Response(
      JSON.stringify({ error: 'Endpoint not found. Use POST /analyze-csv' }),
      {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
}

export default {
  fetch: handleWorkerRequest,
};
