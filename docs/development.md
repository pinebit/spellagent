# Development

Requires Node.js 24+ and npm. Dependency installation requires npm access:

```sh
npm ci
```

The repository disables dependency lifecycle scripts (`.npmrc`). Official
grammar packages supply WASM assets; no native compiler or grammar generation
is required.

Do not run checks during an implementation session. Once the user explicitly
declares the session/work finished, run the applicable checks once:

```sh
npm run check
npm run test:pack
```

`check` typechecks, builds, runs offline tests, and runs synthetic parser
probes. `test:pack` builds both self-contained plugin directories and
exercises the Codex helper from an unrelated directory with spaces. Neither
invokes an LLM nor installs a plugin into a host. Host checks are separate,
explicitly opted-in evaluations.

Build the development plugin artifacts explicitly with:

```sh
npm run build:plugins
```

Output: `build/plugins/codex/spellagent/` and `build/plugins/claude/spellagent/`.
Each contains a manifest, generated skill, compiled helper, runtime
dependencies, grammars, and licenses. Recipients should not need npm or
development dependencies. These are self-contained candidates, not qualified
releases. See [Phase C handoff](phase-c.md) and [Phase D handoff](phase-d.md).

For isolated Linux verification, after verification is authorized:

```sh
npm run test:linux
```

This prepares dependencies in Docker, then runs checks with container
networking disabled. Image/dependency preparation requires network access. No
host credentials are forwarded.

## Repository layout

- `src/extractors/`: AST extraction, protection, and byte mappings.
- `src/core/`, `src/discovery/`, `src/editing/`, `src/plugin/`: shared
  contracts, local discovery, safe editing, protocol, and bundled synthetic
  fixtures.
- `plugins/`: host manifests and shared workflow/host instruction sources.
- `scripts/build-plugins.mjs`: self-contained artifact assembly.
- `scripts/score-quality.mjs`, `scripts/run-quality-eval.mjs`: offline quality
  scoring and the live-host quality measurement harness (see
  [Phase D handoff](phase-d.md)).
- `tests/fixtures/quality/`: labeled corpus and held-out set used for measured
  correction precision/recall.
- `docs/plan.md`: maintained design and phase evidence.

## Optional preferences and preview

No initialization is required. An optional root `.spellagentrc.json` uses
`schemaVersion: 2` and may set dialect, include/exclude globs, includeHidden,
and case-sensitive glossary terms. Invocation exclusions and glossary terms
extend project values. Old provider/limit configurations fail with migration
guidance and remain unchanged. See [protocol and preferences](phase-b.md).

The installed helper accepts version-2 discover, extract, validate-file, and
apply-file requests over stdin. Preview reports effective settings, per-format
eligible coverage, reason-grouped skips/failures, suppressed and unchecked
coverage, and zero files changed. It explains empty or unexpectedly narrow
scope; `.txt` is explicitly unsupported in v1. Symlinks, hard links, mandatory
exclusions, unsupported encodings, and files over 1 MiB are excluded.

## Safety and privacy

The helper makes no network requests and launches no subprocesses. Model
calls happen within the host and follow its permissions, billing, and
retention. Extracted prose is untrusted input. Source/proposals are not saved
as helper state. Correction mode writes only validated source files plus
source-free events under `.spellagent/logs/`; it creates no backups and
provides no rollback.
