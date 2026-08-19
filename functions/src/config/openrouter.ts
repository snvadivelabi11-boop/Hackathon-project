/**
 * OpenRouter AI Gateway client helper
 * Securely uses OPENROUTER_API_KEY from environment variables (Cloud Functions runtime or .env)
 */

export function getOpenRouterApiKey(): string {
  const key = process.env.OPENROUTER_API_KEY || '';
  return key.trim();
}

export const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash';

export interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
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
  const temperature = options.temperature ?? 0.2;

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
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenRouter API error (${res.status}): ${errText}`);
  }

  const json: any = await res.json();
  const choice = json.choices?.[0]?.message?.content;
  if (!choice) {
    throw new Error('OpenRouter returned an empty response.');
  }

  return choice;
}
