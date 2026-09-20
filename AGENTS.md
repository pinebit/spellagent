# Repository instructions

Do not commit or push anything without the user's explicit approval.

Use README.md for development commands and docs/plan.md for design, phase gates, and implementation evidence. These and AGENTS.md are the maintained project documents. Do not silently expand phase scope.
Do not run checks or tests during an implementation session. Wait until the user
explicitly says the session or requested work is finished, then run the applicable
checks once. At that point, run npm run check and npm run test:pack for parser,
contract, or packaging changes.
Default checks must stay offline and use no API credentials. Live smoke tests are opt-in and may incur charges.
The product only operates on local files; do not add Git/GitHub integration or subprocess execution to product code.

Preserve explicit provider selection: OpenAI, Anthropic, or Vercel AI Gateway. Never implicitly route through Gateway or load ambient credentials for another connection.
Keep docs/plan.md updated with evidence and unresolved gates; do not mark untested platforms as passed.

Required platform qualification is macOS and Linux. Windows is intentionally untested and is not a phase gate; do not claim verified Windows support. Use npm run test:linux for isolated Docker verification.

The intended product commands are only `init` and `run`. Initialization is always
interactive and writes `.spellagentrc.json`; every run requires that config.
Run applies locally validated corrections without review/apply prompts. Existing
local modifications are allowed; preserve freshness and byte/syntax safety checks.
Default to excluding all hidden paths; `includeHidden` cannot bypass mandatory
safety exclusions. `limits.maxAgents` defaults to 32 and is user-configurable;
adaptive rate limiting belongs to the scheduler, not a fixed account-limit claim.
Keep config in root-level `.spellagentrc.json` and source-free logs in `.spellagent/`, never run results,
selections, source snapshots, or backups. Do not reintroduce storage/retention,
request/token-limit config knobs, or separate review/apply/runs/recover commands.
Keep parser/live probes as developer entry points outside the product CLI.
Bundled inexpensive model suggestions must remain overridable and offline during
setup; do not claim model qualification without measured evidence.
