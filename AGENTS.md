# Repository instructions

Do not commit or push anything without the user's explicit approval.

Use README.md for development commands and docs/plan.md for design, phase gates, and implementation evidence. These and AGENTS.md are the maintained project documents. Do not silently expand phase scope.
Run npm run check and npm run test:pack for parser, contract, or packaging changes.
Default checks must stay offline and use no API credentials. Live smoke tests are opt-in and may incur charges.
The product only operates on local files; do not add Git/GitHub integration or subprocess execution to product code.

Preserve explicit provider selection: OpenAI, Anthropic, or Vercel AI Gateway. Never implicitly route through Gateway or load ambient credentials for another connection.
Keep docs/plan.md updated with evidence and unresolved gates; do not mark untested platforms as passed.

Required platform qualification is macOS and Linux. Windows is intentionally untested and is not a phase gate; do not claim verified Windows support. Use npm run test:linux for isolated Docker verification.
