# SpellAgent

Spelling and grammar correction for documentation, source comments, and docstrings,
delivered as **Codex and Claude Code plugins**. The host supplies authentication
and an inexpensive, overridable model; a shared local helper extracts prose and
will validate and apply minimal corrections. No SpellAgent API keys or standalone
CLI are part of the new product.

The maintained design is [docs/new-plan.md](docs/new-plan.md). The previous CLI
design and its evidence are archived in [docs/old-plan.md](docs/old-plan.md).

## Current status

Repository migration and a Phase A implementation candidate are implemented.
The candidate only extracts **bundled synthetic fixtures**, with bounded JSON
pages. It does not scan projects, proofread user files, or apply edits.
On macOS arm64 and Linux arm64, typecheck/build, 35 tests, eight parser probes,
and both isolated plugin packages passed on 2026-09-21. Codex manifest/skill
validation and Claude manifest validation also passed on macOS.
Host installation and live model selection remain unverified.
Nothing is published or installed automatically.

The planned user experience is one `check` skill: `/spellagent:check` in Claude
Code and the corresponding installed skill in Codex. Normal invocation will
apply validated corrections one file at a time; preview will remain read-only.
Optional preferences will cover dialect, scope, hidden paths, and glossary.
Existing local modifications are allowed. English en-US/en-GB and macOS/Linux
are the intended initial scope; Windows remains untested.

## Development

Requires Node.js 24+ and npm. Dependency installation requires npm access:

```sh
npm ci
```

The repository disables dependency lifecycle scripts. Official grammar packages
supply WASM assets; no native compiler or grammar generation is required.

Do not run checks during an implementation session. Once the user explicitly
declares the session/work finished, run the applicable checks once:

```sh
npm run check
npm run test:pack
```

`check` typechecks, builds, runs offline tests, and runs synthetic parser probes.
`test:pack` builds self-contained plugin directories and exercises their helper
from an unrelated directory with spaces. Neither invokes an LLM nor installs a
plugin into a host. Host checks are separate, explicitly opted-in evaluations.

Build the development plugin artifacts explicitly with:

```sh
npm run build:plugins
```

Output: `build/plugins/codex/spellagent/` and
`build/plugins/claude/spellagent/`. Each contains a manifest, generated skill,
compiled helper, runtime dependencies, grammars, and licenses. Recipients should
not need npm or development dependencies. These are feasibility candidates,
not qualified releases. See [Phase A handoff](docs/phase-a.md).

For isolated Linux verification, after verification is authorized:

```sh
npm run test:linux
```

This prepares dependencies in Docker, then runs checks with container networking
disabled. Image/dependency preparation requires network access. No host
credentials are forwarded. Historical arm64 passes do not qualify this pivot,
other architectures, or installed host behavior.

## Repository layout

- `src/extractors/`: existing AST extraction, protection, and byte mappings.
- `src/plugin/`: read-only Phase A helper and synthetic fixtures.
- `plugins/`: host manifests and shared workflow/host instruction sources.
- `scripts/build-plugins.mjs`: self-contained artifact assembly.
- `docs/new-plan.md`: maintained design and phase evidence.

The old CLI, provider modules, configuration, and associated tests remain
temporarily for regression continuity. They are not shipped in plugin artifacts
and should not be extended. Phase B will migrate reusable discovery/contracts
and remove obsolete API/CLI code and dependencies. Legacy npm executable
metadata is transitional, not the distribution strategy. Do not use old `init`
or `run` instructions to configure the plugins.

## Safety and privacy

The helper makes no network requests and launches no subprocesses. Future model
calls happen within the host and follow its permissions, billing, and retention.
Extracted prose is untrusted input. Source/proposals must not be saved as helper
state. Phase A has no filesystem writes or application logs; later writes will
use source-free logs and per-file validation, not saved backups or rollback.

## License

[MIT](LICENSE). Bundled grammars retain their upstream licenses in
`runtime/assets/licenses/`; runtime dependency packages retain their own license
files. Generated inventories identify packaged dependencies and grammar hashes.
