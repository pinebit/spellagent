# SpellAgent

Spelling and grammar correction for documentation, source comments, and docstrings,
delivered as **Codex and Claude Code plugins**. The host supplies authentication
and an inexpensive, overridable model; a shared local helper extracts prose and
will validate and apply minimal corrections. No SpellAgent API keys or standalone
CLI are part of the new product.

The maintained design is [docs/plan.md](docs/plan.md).

## Current status

Phase C's safe-editing implementation is now offline-verified: optional preferences,
local discovery, paged extraction, complete proposal validation, single-file
correction preview, freshness/policy checks, project locking, source-free logs,
and atomic per-file replacement. Checks passed on macOS and isolated Linux arm64.
The retired CLI and provider integration remain removed.

Phase C verification passed on 2026-09-21, including isolated Codex package checks.
Installed-host behavior remains unqualified. Codex host evidence and remaining
gates are recorded in the maintained plan. At the user's request, all Claude
qualification/tests are deferred until the entire project is implemented and a
subscription is available. Both host packages remain in implementation scope.
Nothing is published automatically.

The user experience is one `check` skill: `/spellagent:check` in Claude Code and
the corresponding installed skill in Codex. Normal invocation applies validated
corrections one file at a time; a plain preview is an offline scope inventory,
while a single-file correction preview uses a model and validates proposals
without writing source.
Optional preferences cover dialect, scope, hidden paths, and glossary.
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
`test:pack` builds both self-contained plugin directories and exercises the
Codex helper from an unrelated directory with spaces. Neither invokes an LLM nor installs a
plugin into a host. Host checks are separate, explicitly opted-in evaluations.

Build the development plugin artifacts explicitly with:

```sh
npm run build:plugins
```

Output: `build/plugins/codex/spellagent/` and
`build/plugins/claude/spellagent/`. Each contains a manifest, generated skill,
compiled helper, runtime dependencies, grammars, and licenses. Recipients should
not need npm or development dependencies. These are self-contained candidates,
not qualified releases. See [Phase C handoff](docs/phase-c.md).

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
- `src/core/`, `src/discovery/`, `src/editing/`, `src/plugin/`: shared contracts,
  local discovery, safe editing, protocol, and bundled synthetic fixtures.
- `plugins/`: host manifests and shared workflow/host instruction sources.
- `scripts/build-plugins.mjs`: self-contained artifact assembly.
- `docs/plan.md`: maintained design and phase evidence.

## Optional preferences and preview

No initialization is required. An optional root `.spellagentrc.json` uses
`schemaVersion: 2` and may set dialect, include/exclude globs, includeHidden,
and case-sensitive glossary terms. Invocation exclusions and glossary terms
extend project values. Old provider/limit configurations fail with migration
guidance and remain unchanged. See [protocol and preferences](docs/phase-b.md).

The installed helper accepts version-2 discover, extract, validate-file, and
apply-file requests over stdin.
Preview reports effective settings, per-format eligible coverage, reason-grouped
skips/failures, suppressed and unchecked coverage, and zero files changed. It
explains empty or unexpectedly narrow scope; `.txt` is explicitly unsupported in
v1. Symlinks, hard links, mandatory exclusions, unsupported encodings, and files
over 1 MiB are excluded. Version-1 synthetic fixtures remain available
for deferred host feasibility evaluations.

Claude tests are currently deferred by user instruction. Package checks default
to Codex only; `SPELLAGENT_TEST_HOSTS=codex,claude` restores both only after that
deferral is lifted. Building both packages does not run Claude or consume usage.

## Safety and privacy

The helper makes no network requests and launches no subprocesses. Model calls
happen within the host and follow its permissions, billing, and retention.
Extracted prose is untrusted input. Source/proposals are not saved as helper
state. Correction mode writes only validated source files plus source-free events
under `.spellagent/logs/`; it creates no backups and provides no rollback.

## License

[MIT](LICENSE). Bundled grammars retain their upstream licenses in
`runtime/assets/licenses/`; runtime dependency packages retain their own license
files. Generated inventories identify packaged dependencies and grammar hashes.
