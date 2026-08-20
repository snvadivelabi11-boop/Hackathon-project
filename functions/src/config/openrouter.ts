/**
 * OpenRouter AI Gateway client helper
 * Securely uses OPENROUTER_API_KEY from environment variables (Cloud Functions runtime secrets)
 */

export function getOpenRouterApiKey(): string {
  const key = process.env.OPENROUTER_API_KEY || '';
  return key.trim();
}

// Configured Claude model through OpenRouter (server/env configurable)
export const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'anthropic/claude-sonnet-4.6';

export interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Sanitizes error messages so API keys are never exposed in logs or return values
 */
function sanitizeErrorMessage(msg: string, key?: string): string {
  let clean = msg || '';
  if (key && key.length > 5) {
    clean = clean.split(key).join('[REDACTED_API_KEY]');
  }
  return clean.replace(/Bearer\s+[a-zA-Z0-9_\-\.]+/gi, 'Bearer [REDACTED_TOKEN]');
}

export async function callOpenRouterAI(options: {
  messages: OpenRouterMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
}): Promise<string> {
  const apiKey = getOpenRouterApiKey();
  if (!apiKey) {
    throw new Error('OpenRouter API key is not configured. Please set OPENROUTER_API_KEY environment variable.');
  }

  const model = options.model || OPENROUTER_MODEL;
  const temperature = options.temperature ?? 0.1;
  const maxRetries = 2;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 45000); // 45s timeout per request

      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://hackathon-portal.local',
          'X-Title': 'Hackathon Management Portal',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: options.messages,
          temperature,
          max_tokens: options.maxTokens || 4000,
          ...(options.jsonMode ? { response_format: { type: 'json_object' } } : {}),
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        const cleanErr = sanitizeErrorMessage(errText, apiKey);
        // If 429 (rate limit) or 5xx (server error), retry
        if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
          const backoff = Math.pow(2, attempt) * 1000;
          await new Promise((r) => setTimeout(r, backoff));
          continue;
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
      const errMsg = isAbort ? 'OpenRouter request timed out after 45 seconds.' : err.message;
      lastError = new Error(sanitizeErrorMessage(errMsg, apiKey));

      if (attempt < maxRetries && (isAbort || errMsg.includes('fetch failed') || errMsg.includes('network'))) {
        const backoff = Math.pow(2, attempt) * 1000;
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }
      break;
    }
  }

  throw lastError || new Error('OpenRouter request failed after retries.');
}
