import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { HelperError } from '../core/errors.js';

// The only network use in the helper: one TypeSafe System One request per
// prose chunk during pre-screening. The key comes from the environment only and
// never appears in requests to the model, helper responses, errors, or logs.
export const TYPESAFE_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
export const TYPESAFE_MODEL = 'jev-latest';
const ATTEMPTS = 3;
const BACKOFF_MS = 500;
const TIMEOUT_MS = 30_000;
const RETRYABLE = new Set([429, 500, 502, 503, 504, 529]);

export function typesafeApiKey() {
  const key = process.env.TYPESAFE_API_KEY?.trim();
  if (!key) throw new HelperError('typesafe_api_key_missing');
  return key;
}

export type NoulQuestion = { instructions: string; criteria: { true: string; false: string } };

const answerSchema = z.object({
  model: z.string().min(1).max(256),
  answers: z.object({ answer: z.object({ type: z.literal('noul'), noul: z.number().min(0).max(1) }) }),
  usage: z.object({ input_tokens: z.number().int().nonnegative() }).optional(),
});

function cancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw new HelperError('cancelled');
}

// Asks one Noul question about `state` and returns the probability of "yes".
export async function askNoul(options: { key: string; state: unknown; question: NoulQuestion; signal?: AbortSignal }) {
  const body = JSON.stringify({ model: TYPESAFE_MODEL, state: options.state,
    questions: { answer: { type: 'noul', ...options.question } } });
  for (let attempt = 1; ; attempt += 1) {
    cancelled(options.signal);
    const timeout = AbortSignal.timeout(TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(TYPESAFE_ENDPOINT, { method: 'POST', body,
        headers: { authorization: `Bearer ${options.key}`, 'content-type': 'application/json' },
        signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout });
    } catch {
      cancelled(options.signal);
      throw new HelperError('typesafe_unreachable');
    }
    if (response.status === 401 || response.status === 403) throw new HelperError('typesafe_auth_failed');
    if (RETRYABLE.has(response.status)) {
      await response.body?.cancel();
      if (attempt >= ATTEMPTS) throw new HelperError('typesafe_unavailable', { status: response.status });
      try { await delay(BACKOFF_MS * 2 ** (attempt - 1), undefined, options.signal ? { signal: options.signal } : {}); }
      catch { throw new HelperError('cancelled'); }
      continue;
    }
    // Never surface the response body: a validation error may echo prose.
    if (!response.ok) throw new HelperError('typesafe_invalid_response', { status: response.status });
    let json: unknown;
    try { json = await response.json(); } catch {
      cancelled(options.signal);
      throw new HelperError('typesafe_invalid_response', { status: response.status });
    }
    const parsed = answerSchema.safeParse(json);
    if (!parsed.success) throw new HelperError('typesafe_invalid_response', { status: response.status });
    return { probability: parsed.data.answers.answer.noul, model: parsed.data.model,
      inputTokens: parsed.data.usage?.input_tokens ?? 0 };
  }
}
