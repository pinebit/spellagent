import { describe, expect, it, vi, afterEach } from 'vitest';
import { MockLanguageModelV4 } from 'ai/test';
import { configuredModel, probeStructuredOutput, type ProviderName } from '../src/llm/sdk-probe.js';

const request = { batchId: 'b1', segments: [{ segmentId: 's1', editable: 'A sentnce.', context: ['Read only.'] }] };
const valid = JSON.stringify({ results: [{ segmentId: 's1', proposals: [] }] });
const options = { request, maxOutputTokens: 200, timeoutMs: 1000 };
function mock(text = valid) {
  return new MockLanguageModelV4({ doGenerate: {
    content: [{ type: 'text', text }], finishReason: { unified: 'stop', raw: 'stop' },
    usage: { inputTokens: { total: 20, noCache: 20, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 10, text: 10, reasoning: 0 } }, warnings: [],
  } });
}
afterEach(() => vi.restoreAllMocks());

describe('pinned AI SDK structured output', () => {
  it('passes schema, limits, and provider options without tools', async () => {
    const model = mock();
    const result = await probeStructuredOutput({ ...options, model, provider: 'openai' });
    expect(result).toMatchObject({ schemaValid: true, inputTokens: 20, outputTokens: 10 });
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(model.doGenerateCalls[0]).toMatchObject({ maxOutputTokens: 200,
      responseFormat: { type: 'json' }, providerOptions: { openai: { store: false } } });
    expect(model.doGenerateCalls[0]!.tools ?? []).toHaveLength(0);
  });
  it('preserves complete JSON with an invalid item for later independent validation', async () => {
    const text = JSON.stringify({ results: [{ segmentId: 's1', proposals: [] }, { broken: true }] });
    const result = await probeStructuredOutput({ ...options, model: mock(text), provider: 'openai' });
    expect(result.schemaValid).toBe(false);
    expect(result.text).toBe(text);
    expect(result.inputTokens).toBe(20);
  });
  it('rejects truncated JSON without repair', async () => {
    await expect(probeStructuredOutput({ ...options, model: mock('{"results":['), provider: 'openai' })).rejects.toThrow();
  });
  it('propagates an already aborted request without dispatch', async () => {
    const model = mock();
    await expect(probeStructuredOutput({ ...options, model, provider: 'openai', signal: AbortSignal.abort() })).rejects.toThrow();
    expect(model.doGenerateCalls).toHaveLength(0);
  });
  it('rejects unsupported settings warnings', async () => {
    const model = mock();
    const generate = model.doGenerate;
    model.doGenerate = async opts => ({ ...await generate(opts), warnings: [{ type: 'unsupported', feature: 'maxOutputTokens' }] });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(probeStructuredOutput({ ...options, model, provider: 'openai' })).rejects.toThrow('settings');
  });
});

for (const provider of ['openai', 'anthropic'] as const) {
  describe(`${provider} direct adapter with mocked HTTP`, () => {
    function fixture(text: string) {
      return provider === 'openai' ? {
        id: 'resp_test', object: 'response', created_at: 1, model: 'gpt-4.1-mini', status: 'completed',
        output: [{ type: 'message', id: 'msg_test', status: 'completed', role: 'assistant',
          content: [{ type: 'output_text', text, annotations: [] }] }],
        usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30,
          input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } },
      } : {
        id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-sonnet-4-5',
        content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null,
        usage: { input_tokens: 20, output_tokens: 10 },
      };
    }
    const modelId = provider === 'openai' ? 'gpt-4.1-mini' : 'claude-sonnet-4-5';
    it('sends bounded structured requests to the direct provider endpoint', async () => {
      const fetchMock = vi.fn<typeof fetch>(async () => Response.json(fixture(valid)));
      const model = configuredModel(provider, modelId, 'test-key', fetchMock);
      const result = await probeStructuredOutput({ ...options, model, provider });
      expect(result.schemaValid).toBe(true);
      expect(result.inputTokens).toBe(20);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(String(url)).toContain(provider === 'openai' ? 'api.openai.com' : 'api.anthropic.com');
      const body = JSON.parse(String(init?.body));
      if (provider === 'openai') {
        expect(body.max_output_tokens).toBe(200);
        expect(body.store).toBe(false);
        expect(body.text.format.type).toBe('json_schema');
      } else {
        expect(body.max_tokens).toBe(200);
        expect(body.output_config.format.type).toBe('json_schema');
      }
      expect(body.tools ?? []).toHaveLength(0);
    });
    it('retains a schema-invalid response through the actual adapter', async () => {
      const text = JSON.stringify({ results: [{ segmentId: 's1', proposals: [] }, { broken: true }] });
      const model = configuredModel(provider, modelId, 'test-key', async () => Response.json(fixture(text)));
      expect(await probeStructuredOutput({ ...options, model, provider })).toMatchObject({ text, schemaValid: false });
    });
    it('does not retry a 429 inside the SDK', async () => {
      const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ error: { type: 'rate_limit_error', message: 'limited' } }, { status: 429 }));
      const model = configuredModel(provider, modelId, 'test-key', fetchMock);
      await expect(probeStructuredOutput({ ...options, model, provider: provider as ProviderName })).rejects.toThrow();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
}

describe('Vercel AI Gateway adapter with mocked HTTP', () => {
  function gatewayFixture(text = valid) {
    return { content: [{ type: 'text', text }], finishReason: { unified: 'stop', raw: 'stop' },
      usage: { inputTokens: { total: 20, noCache: 20, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 10, text: 10, reasoning: 0 } }, warnings: [] };
  }
  it('uses explicit gateway credentials, model and upstream allowlist with no catalog request', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json(gatewayFixture()));
    const model = configuredModel('gateway', 'openai/gpt-4.1-mini', 'gateway-test-key', fetchMock);
    const result = await probeStructuredOutput({ ...options, model, provider: 'gateway', gatewayOnly: ['openai'] });
    expect(result.schemaValid).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://ai-gateway.vercel.sh/v4/ai/language-model');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer gateway-test-key');
    expect(new Headers(init?.headers).get('ai-language-model-id')).toBe('openai/gpt-4.1-mini');
    const body = JSON.parse(String(init?.body));
    expect(body.maxOutputTokens).toBe(200);
    expect(body.responseFormat.type).toBe('json');
    expect(body.providerOptions.gateway).toEqual({ only: ['openai'] });
    expect(body.tools ?? []).toHaveLength(0);
  });
  it('requires a gateway key and explicit routes; never silently selects ambient OIDC', async () => {
    expect(() => configuredModel('gateway', 'openai/test', '')).toThrow('key');
    const model = mock();
    await expect(probeStructuredOutput({ ...options, model, provider: 'gateway' })).rejects.toThrow('allowlist');
    expect(model.doGenerateCalls).toHaveLength(0);
  });
  it('preserves schema-invalid items and disables SDK retries', async () => {
    const text = JSON.stringify({ results: [{ segmentId: 's1', proposals: [] }, { broken: true }] });
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json(gatewayFixture(text)));
    const model = configuredModel('gateway', 'openai/gpt-4.1-mini', 'test-key', fetchMock);
    expect(await probeStructuredOutput({ ...options, model, provider: 'gateway', gatewayOnly: ['openai'] }))
      .toMatchObject({ text, schemaValid: false });
    fetchMock.mockImplementation(async () => Response.json({ error: { message: 'limited' } }, { status: 429 }));
    await expect(probeStructuredOutput({ ...options, model, provider: 'gateway', gatewayOnly: ['openai'] })).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
