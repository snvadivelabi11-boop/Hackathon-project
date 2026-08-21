/**
 * Cloudflare Worker — Problem Statement CSV AI Analyzer Backend
 * Securely communicates with Google Gemini API at Cloudflare's edge.
 * Enforces safe batching, strict non-fabrication prompt, structured JSON mode, and 1:1 input reconciliation.
 */

export interface Env {
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  OPENROUTER_API_KEY?: string; // Legacy fallback reference
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

const BATCH_CHUNK_SIZE = 12;
const CONCURRENCY_LIMIT = 2;
const DEFAULT_MODEL = 'gemini-3.5-flash-lite';

export type GeminiErrorCode =
  | 'INVALID_API_KEY'
  | 'MODEL_UNAVAILABLE'
  | 'RATE_LIMITED'
  | 'QUOTA_EXCEEDED'
  | 'TIMEOUT'
  | 'NETWORK_ERROR'
  | 'INVALID_AI_RESPONSE'
  | 'STRUCTURED_OUTPUT_ERROR'
  | 'GEMINI_GENERIC_ERROR';

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
 * Classifies an error into a standardized machine-readable Gemini error code
 */
function classifyError(status: number, message: string): { code: GeminiErrorCode; cleanMessage: string } {
  const msg = message || '';

  if (status === 400 && (msg.includes('API_KEY_INVALID') || msg.includes('API key not valid') || msg.includes('INVALID_API_KEY'))) {
    return {
      code: 'INVALID_API_KEY',
      cleanMessage: 'Google Gemini API key is invalid or not authorized.',
    };
  }
  if (status === 401 || msg.includes('401') || msg.includes('UNAUTHENTICATED') || msg.includes('INVALID_API_KEY')) {
    return {
      code: 'INVALID_API_KEY',
      cleanMessage: 'Google Gemini API key authentication failed.',
    };
  }
  if (status === 403 || msg.includes('403') || msg.includes('PERMISSION_DENIED')) {
    return {
      code: 'INVALID_API_KEY',
      cleanMessage: 'Google Gemini API access is forbidden or permission denied for this key.',
    };
  }
  if (status === 429 || msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')) {
    if (msg.toLowerCase().includes('quota') || msg.includes('exceeded your current quota')) {
      return {
        code: 'QUOTA_EXCEEDED',
        cleanMessage: 'Google Gemini API quota exceeded. Please check plan/billing details.',
      };
    }
    return {
      code: 'RATE_LIMITED',
      cleanMessage: 'Google Gemini API rate limit reached. Please wait a moment.',
    };
  }
  if (status === 404 || msg.includes('404') || msg.includes('NOT_FOUND') || msg.includes('no longer available') || msg.includes('MODEL_UNAVAILABLE')) {
    return {
      code: 'MODEL_UNAVAILABLE',
      cleanMessage: 'Selected Google Gemini AI model is currently unavailable.',
    };
  }
  if (msg.includes('AbortError') || msg.includes('timeout') || msg.includes('timed out') || msg.includes('TIMEOUT')) {
    return {
      code: 'TIMEOUT',
      cleanMessage: 'Google Gemini AI analysis request timed out.',
    };
  }
  if (msg.includes('Failed to fetch') || msg.includes('network') || msg.includes('Network') || msg.includes('NETWORK_ERROR')) {
    return {
      code: 'NETWORK_ERROR',
      cleanMessage: 'Network connection to Google Gemini API failed.',
    };
  }
  if (msg.includes('JSON') || msg.includes('parse') || msg.includes('STRUCTURED_OUTPUT_ERROR')) {
    return {
      code: 'STRUCTURED_OUTPUT_ERROR',
      cleanMessage: 'Failed to parse structured JSON response from Google Gemini AI.',
    };
  }
  return {
    code: 'GEMINI_GENERIC_ERROR',
    cleanMessage: msg || 'Google Gemini AI analysis request failed.',
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
  return clean.replace(/key=[a-zA-Z0-9_\-\.]+/gi, 'key=[REDACTED_KEY]')
              .replace(/Bearer\s+[a-zA-Z0-9_\-\.]+/gi, 'Bearer [REDACTED_TOKEN]');
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

  return `You are an expert technical problem statement dataset analyzer for a hackathon.

Read the supplied problem statement dataset carefully.
Identify every distinct problem statement.
Do not invent information.
Do not remove valid problem statements.
Do not merge distinct problem statements.
Do not create fake problem statements.
Preserve the original problem statement content and ordering.

For EACH of the ${items.length} items in the array, output a JSON object with these exact keys:
- "sequence": integer matching the input sequence
- "order": integer (1-based order in the problem statement sequence)
- "problemStatementId": string (preserve sourceId if provided, or format as "PS" + 3-digit sequence like "PS001")
- "title": string (the problem title or concise summary of the statement)
- "description": string (the full, verbatim problem statement description from source)
- "category": string (the category from source or inferred primary domain e.g. "Artificial Intelligence", "Blockchain", "Healthcare", "IoT", "Cybersecurity", "General")
- "team": string or null (target team if present in source, otherwise null)
- "organization": string or null (sponsoring organization/company if present in source, otherwise null)
- "department": string or null (department/unit if present in source, otherwise null)
- "analysis": string (a concise technical summary explaining scope, architecture, and expected deliverables)
- "confidence": float between 0.0 and 1.0 (confidence in problem clarity and extraction)
- "isValid": boolean (true if actionable problem statement, false if empty/gibberish/header text)
- "qualityScore": integer between 1 and 10 (overall technical depth and quality)
- "issues": array of strings (list of potential gaps, ambiguities, or missing requirements; empty array if clear)
- "suggestions": array of strings (concrete improvements, recommended frameworks, or extension ideas)
- "difficulty": string ("EASY", "MEDIUM", or "HARD")

Dataset to analyze:
${datasetJson}

Respond strictly with a JSON object in this exact structure:
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
  const seq = fallbackInput.sequence || fallbackInput.index || expectedSequence;
  const order = seq;

  const rawPsId = fallbackInput.problemStatementId || item.problemStatementId;
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
 * Safely parses and extracts structured problem statements from Gemini response
 */
function parseGeminiStructuredJson(aiResponseText: string): any[] {
  if (!aiResponseText || typeof aiResponseText !== 'string') {
    throw new Error('STRUCTURED_OUTPUT_ERROR: Gemini returned an empty text payload.');
  }

  // 1. Clean markdown code fences and control characters
  let cleaned = aiResponseText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

  // 2. Direct JSON.parse attempt
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.problems)) return parsed.problems;
    if (parsed && Array.isArray(parsed.results)) return parsed.results;
    if (parsed && Array.isArray(parsed.items)) return parsed.items;
  } catch {
    // Continue to next extraction strategy
  }

  // 3. Extract outermost JSON array or object
  const startIdx = cleaned.indexOf('[');
  const endIdx = cleaned.lastIndexOf(']');
  if (startIdx !== -1 && endIdx > startIdx) {
    try {
      const arrayJson = JSON.parse(cleaned.substring(startIdx, endIdx + 1));
      if (Array.isArray(arrayJson) && arrayJson.length > 0) return arrayJson;
    } catch {
      // Continue
    }
  }

  const objStart = cleaned.indexOf('{');
  const objEnd = cleaned.lastIndexOf('}');
  if (objStart !== -1 && objEnd > objStart) {
    try {
      const objJson = JSON.parse(cleaned.substring(objStart, objEnd + 1));
      if (Array.isArray(objJson.problems)) return objJson.problems;
      if (Array.isArray(objJson.results)) return objJson.results;
      if (Array.isArray(objJson.items)) return objJson.items;
    } catch {
      // Continue
    }
  }

  // 4. Robust Individual Item Regex Extractor for truncated or trailing-comma responses
  const extractedItems: any[] = [];
  const itemRegex = /\{[^{}]*"sequence"\s*:\s*\d+[^{}]*\}/g;
  let match: RegExpExecArray | null;
  while ((match = itemRegex.exec(cleaned)) !== null) {
    try {
      const parsedItem = JSON.parse(match[0]);
      if (parsedItem && typeof parsedItem === 'object') {
        extractedItems.push(parsedItem);
      }
    } catch {
      // Skip malformed individual snippet
    }
  }

  if (extractedItems.length > 0) {
    return extractedItems;
  }

  throw new Error('STRUCTURED_OUTPUT_ERROR: Failed to parse structured JSON response from Google Gemini AI.');
}

/**
 * Calls Google Gemini API with structured JSON output and candidate model fallback
 */
async function callGemini(
  prompt: string,
  apiKey: string,
  preferredModel: string
): Promise<{ content: string; modelUsed: string }> {
  const modelsToTry = [
    preferredModel,
    'gemini-3.5-flash-lite',
    'gemini-flash-lite-latest',
    'gemini-3.5-flash',
    'gemini-3.6-flash',
  ].filter((m, i, arr) => Boolean(m) && arr.indexOf(m) === i);

  let lastError: Error | null = null;
  let lastStatus = 500;

  for (const currentModel of modelsToTry) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000); // 20s subrequest timeout

      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${apiKey}`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.1,
            maxOutputTokens: 8192,
          },
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
          lastError = new Error(`MODEL_UNAVAILABLE: Model "${currentModel}" not found or unsupported: ${cleanErr}`);
          continue; // Try next candidate model
        }
        if (res.status === 429) {
          lastError = new Error(`${classification.code}: ${classification.cleanMessage}`);
          // Wait 1.5s and try next candidate model
          await new Promise((resolve) => setTimeout(resolve, 1500));
          continue;
        }
        if (res.status === 400 || res.status === 401 || res.status === 403) {
          throw new Error(`INVALID_API_KEY: ${classification.cleanMessage}`);
        }
        throw new Error(`${classification.code}: ${cleanErr}`);
      }

      const json: any = await res.json();
      const candidate = json.candidates?.[0];
      const rawText = candidate?.content?.parts?.[0]?.text;

      if (!rawText) {
        throw new Error('INVALID_AI_RESPONSE: Google Gemini returned an empty response candidate.');
      }

      return { content: rawText, modelUsed: currentModel };
    } catch (err: any) {
      const isAbort = err.name === 'AbortError';
      const errMsg = isAbort ? 'TIMEOUT: Google Gemini request timed out after 20s.' : err.message;
      const classification = classifyError(lastStatus, errMsg);
      lastError = new Error(sanitizeError(classification.cleanMessage ? `${classification.code}: ${classification.cleanMessage}` : errMsg, apiKey));

      if (!errMsg.includes('404') && !errMsg.includes('429') && !errMsg.includes('RATE_LIMITED')) {
        break; // Fail fast on auth or fatal network errors
      }
    }
  }

  throw lastError || new Error('GEMINI_GENERIC_ERROR: Google Gemini call failed.');
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
    const hasGeminiKey = Boolean(env.GEMINI_API_KEY && env.GEMINI_API_KEY.length > 5);
    return new Response(
      JSON.stringify({
        status: 'healthy',
        provider: 'google-gemini',
        service: 'hackathon-csv-ai-analyzer',
        model: env.GEMINI_MODEL || DEFAULT_MODEL,
        hasApiKey: hasGeminiKey,
        hasGeminiKey,
        timestamp: new Date().toISOString(),
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }

  // Pre-flight AI Health Check endpoint (checks auth in < 500ms)
  if (request.method === 'POST' && (url.pathname === '/ai-health-check' || url.pathname === '/health-check-ai')) {
    const apiKey = env.GEMINI_API_KEY || '';
    if (!apiKey) {
      return new Response(
        JSON.stringify({
          healthy: false,
          authenticated: false,
          errorCode: 'INVALID_API_KEY',
          error: 'GEMINI_API_KEY is not configured in Cloudflare Worker secrets.',
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    try {
      const authRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
      if (!authRes.ok) {
        const errText = await authRes.text().catch(() => '');
        const classification = classifyError(authRes.status, errText);
        return new Response(
          JSON.stringify({
            healthy: false,
            authenticated: false,
            errorCode: classification.code,
            error: classification.cleanMessage,
          }),
          {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      return new Response(
        JSON.stringify({
          healthy: true,
          authenticated: true,
          provider: 'google-gemini',
          model: env.GEMINI_MODEL || DEFAULT_MODEL,
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
          errorCode: 'NETWORK_ERROR',
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
      const model = env.GEMINI_MODEL || DEFAULT_MODEL;
      const apiKey = env.GEMINI_API_KEY || '';

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
            errorCode: 'INVALID_API_KEY',
            aiError: 'GEMINI_API_KEY is not configured in Cloudflare Worker secrets.',
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
      let lastErrorCode: GeminiErrorCode | null = null;
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
            const { content: aiResponseText, modelUsed } = await callGemini(prompt, apiKey, model);
            const parsedItems = parseGeminiStructuredJson(aiResponseText);

            // Strict 1:1 mapping against chunk inputs
            const mappedResults = chunk.map((inputItem, cIdx) => {
              const matched = parsedItems.find((p: any) => p.sequence === (inputItem.sequence || inputItem.index)) || parsedItems[cIdx];
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
            console.error(`[Worker] Chunk ${chunkNumber} Gemini AI call failed:`, err.message);
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
            if (output.errorCode === 'INVALID_API_KEY' || output.errorCode === 'QUOTA_EXCEEDED') {
              shouldStopBatch = true;
            }
          }
          allAnalyzedResults.push(...output.results);
        }

        // Small inter-batch pause to maintain steady API throughput
        if (b + CONCURRENCY_LIMIT < chunks.length) {
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
      }

      // Sort strictly by sequence
      allAnalyzedResults.sort((a, b) => a.sequence - b.sequence);

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

