import { parseArgs } from 'node:util';
import { configuredModel, probeStructuredOutput, type ProviderName } from '../llm/sdk-probe.js';

try {
  const { values, positionals } = parseArgs({ allowPositionals: true,
    options: { 'allow-paid': { type: 'boolean' }, only: { type: 'string', multiple: true } } });
  const [provider, model] = positionals;
  if (!['openai', 'anthropic', 'gateway'].includes(provider ?? '') || !model ||
      positionals.length !== 2 || !values['allow-paid'] ||
      (provider === 'gateway' ? !values.only?.length : values.only !== undefined)) {
    throw new Error('usage');
  }
  const keyName = provider === 'openai' ? 'OPENAI_API_KEY' : provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'AI_GATEWAY_API_KEY';
  const key = process.env[keyName];
  if (!key) { console.error(`Set ${keyName} in the process environment.`); process.exitCode = 2; }
  else {
    try {
      const result = await probeStructuredOutput({
        model: configuredModel(provider as ProviderName, model, key), provider: provider as ProviderName,
        request: { batchId: 'smoke', segments: [{ segmentId: 's1', editable: 'This sentnce has a typo.', context: [] }] },
        maxOutputTokens: 512, timeoutMs: 30000,
        ...(values.only ? { gatewayOnly: values.only } : {}),
      });
      console.log(JSON.stringify({ schemaValid: result.schemaValid,
        inputTokens: result.inputTokens, outputTokens: result.outputTokens }));
      if (!result.schemaValid) process.exitCode = 2;
    } catch {
      console.error('Live smoke failed; check model support, credentials, and provider availability. No response body was logged.');
      process.exitCode = 2;
    }
  }
} catch {
  console.error('Usage: npm run smoke:live -- <openai|anthropic|gateway> <model-id> --allow-paid [--only <gateway-upstream>]');
  process.exitCode = 2;
}
