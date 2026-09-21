// Offline setup candidates, not implicit provider defaults or qualified adapters.
// Legacy CLI only. Historical sources: docs/old-plan.md, section 6.
export const MODEL_SUGGESTIONS = {
  openai: { model: 'gpt-5.4-nano', source: 'https://developers.openai.com/api/docs/models/gpt-5.4-nano' },
  anthropic: { model: 'claude-haiku-4-5-20251001', source: 'https://platform.claude.com/docs/en/models/haiku-4-5/overview' },
  gateway: { model: 'openai/gpt-5.4-nano', source: 'https://vercel.com/ai-gateway/models/gpt-5.4-nano' },
} as const;
export const MODEL_SUGGESTIONS_CHECKED_AT = '2026-09-20' as const;
