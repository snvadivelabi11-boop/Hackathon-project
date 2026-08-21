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
  index?: number;
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
  aiAnalyzed?: boolean;
  aiModelUsed?: string | null;
}

const BATCH_CHUNK_SIZE = 5;
const CONCURRENCY_LIMIT = 2;
const DEFAULT_MODEL = '~anthropic/claude-sonnet-latest';

export type OpenRouterErrorCode =
  | 'OPENROUTER_INSUFFICIENT_CREDITS'
  | 'OPENROUTER_UNAUTHORIZED'
  | 'OPENROUTER_FORBIDDEN'
  | 'OPENROUTER_RATE_LIMITED'
  | 'OPENROUTER_MODEL_UNAVAILABLE'
  | 'OPENROUTER_TIMEOUT'
  | 'OPENROUTER_NETWORK_ERROR'
  | 'OPENROUTER_INVALID_RESPONSE'
  | 'OPENROUTER_GENERIC_ERROR';

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
 * Classifies an error into a standardized machine-readable error code
 */
function classifyError(status: number, message: string): { code: OpenRouterErrorCode; cleanMessage: string } {
  const msg = message || '';
  if (status === 402 || msg.includes('402') || msg.includes('Insufficient credits') || msg.includes('OPENROUTER_INSUFFICIENT_CREDITS')) {
    return {
      code: 'OPENROUTER_INSUFFICIENT_CREDITS',
      cleanMessage: 'OpenRouter AI analysis is unavailable because the configured OpenRouter account has insufficient credits.',
    };
  }
  if (status === 401 || msg.includes('401') || msg.includes('OPENROUTER_UNAUTHORIZED') || msg.includes('Invalid OpenRouter API key')) {
    return {
      code: 'OPENROUTER_UNAUTHORIZED',
      cleanMessage: 'OpenRouter API key is invalid or unauthorized.',
    };
  }
  if (status === 403 || msg.includes('403') || msg.includes('OPENROUTER_FORBIDDEN')) {
    return {
      code: 'OPENROUTER_FORBIDDEN',
      cleanMessage: 'OpenRouter access is forbidden for this account.',
    };
  }
  if (status === 429 || msg.includes('429') || msg.includes('OPENROUTER_RATE_LIMITED')) {
    return {
      code: 'OPENROUTER_RATE_LIMITED',
      cleanMessage: 'OpenRouter rate limit exceeded. Please wait a moment.',
    };
  }
  if (status === 404 || msg.includes('404') || msg.includes('No endpoints found') || msg.includes('OPENROUTER_MODEL_UNAVAILABLE')) {
    return {
      code: 'OPENROUTER_MODEL_UNAVAILABLE',
      cleanMessage: 'Configured AI model is currently unavailable on OpenRouter.',
    };
  }
  if (msg.includes('AbortError') || msg.includes('timeout') || msg.includes('timed out') || msg.includes('OPENROUTER_TIMEOUT')) {
    return {
      code: 'OPENROUTER_TIMEOUT',
      cleanMessage: 'OpenRouter AI analysis timed out.',
    };
  }
  if (msg.includes('Failed to fetch') || msg.includes('network') || msg.includes('Network') || msg.includes('OPENROUTER_NETWORK_ERROR')) {
    return {
      code: 'OPENROUTER_NETWORK_ERROR',
      cleanMessage: 'Network connection to OpenRouter failed.',
    };
  }
  return {
    code: 'OPENROUTER_GENERIC_ERROR',
    cleanMessage: msg || 'OpenRouter AI analysis request failed.',
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
  expectedSequence: number,
  isAiSuccess: boolean = false,
  modelUsed: string | null = null
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
    aiAnalyzed: isAiSuccess,
    aiModelUsed: isAiSuccess ? modelUsed : null,
  };
}

/**
 * Generates structured fallback output when AI analysis is unreachable
 */
function generateFallbackResults(items: CsvProblemInputItem[]): AnalyzedProblemOutputItem[] {
  return items.map((item, idx) => {
    const seq = item.sequence || item.index || idx + 1;
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
      aiAnalyzed: false,
      aiModelUsed: null,
    };
  });
}

/**
 * Calls OpenRouter AI with fast fail-fast error handling
 */
async function callOpenRouter(prompt: string, apiKey: string, model: string): Promise<{ content: string; modelUsed: string }> {
  const modelsToTry = [
    model,
    'anthropic/claude-sonnet-4.6',
    '~anthropic/claude-sonnet-latest',
    'openai/gpt-4o-mini',
  ].filter((m, i, arr) => arr.indexOf(m) === i);

  let lastError: Error | null = null;
  let lastStatus = 500;

  for (const currentModel of modelsToTry) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000); // 20s subrequest timeout

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
              content: 'You are an expert technical problem statement dataset analyzer. Output strict valid JSON matching the requested schema without markdown fences.',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          temperature: 0.1,
          max_tokens: 1500,
          response_format: { type: 'json_object' },
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      lastStatus = res.status;

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        const cleanErr = sanitizeError(errText, apiKey);
        const classification = classifyError(res.status, cleanErr);

        if (res.status === 404) {
          lastError = new Error(`OPENROUTER_MODEL_UNAVAILABLE: Model "${currentModel}" not available: ${cleanErr}`);
          continue; // Try fallback candidate model
        }
        if (res.status === 402) {
          lastError = new Error(`OPENROUTER_INSUFFICIENT_CREDITS: ${classification.cleanMessage}`);
          continue; // Try lower-cost candidate model or fail fast
        }
        if (res.status === 401) {
          throw new Error(`OPENROUTER_UNAUTHORIZED: ${classification.cleanMessage}`);
        }
        throw new Error(`${classification.code}: ${cleanErr}`);
      }

      const json: any = await res.json();
      const choice = json.choices?.[0]?.message?.content;
      if (!choice) {
        throw new Error('OPENROUTER_INVALID_RESPONSE: OpenRouter returned an empty response.');
      }

      const modelUsed = json.model || currentModel;
      return { content: choice, modelUsed };
    } catch (err: any) {
      const isAbort = err.name === 'AbortError';
      const errMsg = isAbort ? 'OPENROUTER_TIMEOUT: OpenRouter request timed out after 20s.' : err.message;
      const classification = classifyError(lastStatus, errMsg);
      lastError = new Error(sanitizeError(classification.cleanMessage ? `${classification.code}: ${classification.cleanMessage}` : errMsg, apiKey));

      if (!errMsg.includes('404') && !errMsg.includes('402')) {
        break; // Fail fast on timeouts, auth, or network errors
      }
    }
  }

  throw lastError || new Error('OPENROUTER_GENERIC_ERROR: OpenRouter call failed.');
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
        hasApiKey: Boolean(env.OPENROUTER_API_KEY && env.OPENROUTER_API_KEY.length > 5),
        timestamp: new Date().toISOString(),
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }

  // Pre-flight AI Health Check endpoint (checks auth and credit status in < 500ms)
  if (request.method === 'POST' && (url.pathname === '/ai-health-check' || url.pathname === '/health-check-ai')) {
    const apiKey = env.OPENROUTER_API_KEY || '';
    if (!apiKey) {
      return new Response(
        JSON.stringify({
          healthy: false,
          authenticated: false,
          creditsAvailable: false,
          errorCode: 'OPENROUTER_UNAUTHORIZED',
          error: 'OpenRouter API key is not configured on Cloudflare Worker secret.',
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    try {
      const authRes = await fetch('https://openrouter.ai/api/v1/auth/key', {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!authRes.ok) {
        const errText = await authRes.text().catch(() => '');
        return new Response(
          JSON.stringify({
            healthy: false,
            authenticated: false,
            creditsAvailable: false,
            errorCode: 'OPENROUTER_UNAUTHORIZED',
            error: sanitizeError(errText, apiKey),
          }),
          {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      const authData: any = await authRes.json();
      return new Response(
        JSON.stringify({
          healthy: true,
          authenticated: true,
          creditsAvailable: authData?.data?.usage !== undefined,
          isFreeTier: Boolean(authData?.data?.is_free_tier),
          label: authData?.data?.label,
          model: env.OPENROUTER_MODEL || DEFAULT_MODEL,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    } catch (err: any) {
      return new Response(
        JSON.stringify({
          healthy: false,
          authenticated: false,
          creditsAvailable: false,
          errorCode: 'OPENROUTER_NETWORK_ERROR',
          error: sanitizeError(err.message, apiKey),
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }
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

      // If no API key configured on worker, return structured fallback with clear note
      if (!apiKey) {
        const fallbackProblems = generateFallbackResults(inputItems);
        return new Response(
          JSON.stringify({
            success: true,
            totalProblems: fallbackProblems.length,
            aiAnalyzedCount: 0,
            aiModelUsed: model,
            aiSuccess: false,
            errorCode: 'OPENROUTER_UNAUTHORIZED',
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
      let lastErrorCode: OpenRouterErrorCode | null = null;
      let lastModelUsed = model;
      let shouldStopBatch = false;

      // Split into chunks of 5 items
      const chunks: CsvProblemInputItem[][] = [];
      for (let i = 0; i < totalItems; i += BATCH_CHUNK_SIZE) {
        chunks.push(inputItems.slice(i, i + BATCH_CHUNK_SIZE));
      }

      // Process chunks in safe concurrency of up to CONCURRENCY_LIMIT (2)
      for (let b = 0; b < chunks.length; b += CONCURRENCY_LIMIT) {
        if (shouldStopBatch) {
          for (let remainingIdx = b; remainingIdx < chunks.length; remainingIdx++) {
            allAnalyzedResults.push(...generateFallbackResults(chunks[remainingIdx]));
          }
          break;
        }

        const currentBatch = chunks.slice(b, b + CONCURRENCY_LIMIT);
        const batchPromises = currentBatch.map(async (chunk, batchIdx) => {
          const chunkNumber = b + batchIdx + 1;
          const prompt = buildBatchPrompt(chunk);
          try {
            const { content: aiResponseText, modelUsed } = await callOpenRouter(prompt, apiKey, model);
            
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
              const matched = parsedJson.find((p: any) => p.sequence === (inputItem.sequence || inputItem.index)) || parsedJson[cIdx];
              return normalizeAnalyzedItem(matched, inputItem, inputItem.sequence || inputItem.index || cIdx + 1, true, modelUsed);
            });

            return {
              success: true,
              count: chunk.length,
              results: mappedResults,
              error: null,
              errorCode: null,
              modelUsed,
            };
          } catch (err: any) {
            console.error(`[Worker] Chunk ${chunkNumber} AI call failed:`, err.message);
            const classification = classifyError(500, err.message);
            return {
              success: false,
              count: 0,
              results: generateFallbackResults(chunk),
              error: classification.cleanMessage || err.message,
              errorCode: classification.code,
              modelUsed: model,
            };
          }
        });

        const batchOutputs = await Promise.all(batchPromises);
        for (const output of batchOutputs) {
          if (output.success) {
            aiSuccessCount += output.count;
            if (output.modelUsed) lastModelUsed = output.modelUsed;
          } else if (output.error) {
            lastAiError = output.error;
            lastErrorCode = output.errorCode;
            if (output.errorCode === 'OPENROUTER_INSUFFICIENT_CREDITS' || output.errorCode === 'OPENROUTER_UNAUTHORIZED') {
              shouldStopBatch = true;
            }
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
          aiAnalyzedCount: aiSuccessCount,
          aiModelUsed: lastModelUsed,
          aiSuccess: overallAiSuccess,
          errorCode: lastErrorCode,
          aiError: lastAiError,
          problems: allAnalyzedResults,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    } catch (err: any) {
      const classification = classifyError(500, err.message);
      return new Response(
        JSON.stringify({
          success: false,
          errorCode: classification.code,
          error: classification.cleanMessage || err.message || 'Internal worker error during CSV analysis.',
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
