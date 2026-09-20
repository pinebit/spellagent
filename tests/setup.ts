import { vi } from 'vitest';
// Any accidental default-provider network call fails the offline test suite.
vi.stubGlobal('fetch', () => { throw new Error('Network access is forbidden in default tests'); });
vi.stubGlobal('AI_SDK_LOG_WARNINGS', false);
vi.stubEnv('OPENAI_API_KEY', undefined);
vi.stubEnv('ANTHROPIC_API_KEY', undefined);
vi.stubEnv('AI_GATEWAY_API_KEY', undefined);
vi.stubEnv('VERCEL_OIDC_TOKEN', undefined);
