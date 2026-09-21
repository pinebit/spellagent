# Phase B implementation handoff

Status: the read-only offline engine and its expanded preview contract were
verified on macOS/Linux arm64 on 2026-09-21. See plan.md section 15 for actual
evidence and user-authorized deferrals. Automatic editing, including the
single-file correction preview, is Phase C and is not implemented.

## Product interface

Invoke `node <installed-plugin>/runtime/dist/plugin/helper.js`, with one strict
UTF-8 JSON document on stdin and no arguments. Node.js 24+ is required. Requests
are limited to 64 KiB. A successful response has `ok: true`; source-free errors
have `ok: false`, a diagnostic `code`, and exit status 2. Legacy preference errors
also return actionable migration guidance. No helper state or logs are written.
Invalid invocation glossary terms return `invalid_glossary` with source-free
indexes so the host can identify rejected terms from the user's original request
without the helper echoing them.

Version 2 exposes `discover` and `extract`. Version 1 retains bundled-fixture
operations for the deferred host feasibility qualification; it cannot accept
project paths, preferences, arbitrary source text, or write requests.
The current extraction and policy revisions are `phase-b-2`; their hashes prevent
continuing a preview created under the earlier Phase B contract.

### Discover

```json
{"protocolVersion":2,"operation":"discover","root":"/absolute/project","targets":["docs","src"],"cursor":0}
```

`root` must be an absolute, normalized physical directory path. No root is inferred
from Git or a parent config. Targets are normalized root-relative paths or `.`;
when omitted they default to `["."]`. Absolute targets and `..` are rejected.
Paths containing symlinks, including root ancestors, are rejected. On macOS use
physical paths such as `/private/tmp`, not the `/tmp` symlink.

Optional invocation `preferences` contains only dialect, include, exclude,
includeHidden, and glossary. The helper loads only the root's optional config.
A discover response contains:

- `items`: eligible files with snapshot/coverage metadata, skipped paths with
  reasons, and failed paths. Each record identifies its known path type. Skipped
  directories account for a subtree, not a fabricated descendant-file count. No
  source is returned by discover. Requested `.txt` files use the explicit
  `plain_text_unsupported` reason rather than a generic unsupported-format result.
- `summary`: eligible-file, skipped/failed-path, eligible/skipped/suppressed-segment,
  diagnostic, and notice totals; per-format eligible coverage; skipped/failed
  reason totals; known file count; a narrow-coverage signal; zero reviewed
  segments; and zero files changed.
- `status`: preview, no_eligible_text, or incomplete (file failures).
- `noEligibleTextReason` when no segments are eligible, distinguishing unsupported
  types, exclusions, no extractable prose, suppression, encoding/size, unavailable
  prose, extraction failure, and a genuinely empty scope.
- `effectiveScope`: physical root, targets, dialect, hidden-path policy, and the
  exact merged case-sensitive glossary honored for the preview.
- `totalRecords`, `cursor`, `nextCursor`, `scopeHash`, and `policyHash`.

Continue with the same root, targets, and invocation preferences, adding both
hashes and nextCursor. A changed reconstructed scope or policy invalidates the
continuation. A stateless preview is a point-in-time observation, not a locked
repository snapshot. It never certifies proofreading or editing safety.

### Extract

```json
{"protocolVersion":2,"operation":"extract","root":"/absolute/project","path":"docs/guide.md","cursor":0}
```

Use discovery's policyHash and the file's snapshot.sha256 as snapshotHash when
available, including on the first page. Subsequent pages require both hashes.
Responses contain snapshot metadata, effective dialect and glossary, coverage, totalSegments,
totalRecords, policy/extraction versions, and paged `items`:

| Kind | Payload |
| --- | --- |
| segment | segmentId, editable prose, separate readOnlyContext |
| skipped | segmentId and reason for unsplittable/unmappable prose |
| diagnostic | source-free code and optional line number |
| notice | source-free limitation code |

All record kinds count toward totalRecords. Segments plus skips count toward
totalSegments. Suppressed prose is counted in coverage but is not emitted as a
source-bearing record. Diagnostics and notices can occupy pages without prose.
Source maps and protected byte ranges remain internal for future application.
Segment IDs are deterministic for a source snapshot, policy, and extraction
version; consumers must not treat IDs alone as freshness evidence.

Pages contain at most 32 records, at most 12,000 UTF-16 code units of prose/context,
and at most 96 KiB of serialized item data (plus bounded envelope metadata).
Oversized segments split at sentence/paragraph boundaries without cutting
protected spans or changing source bytes; an unsafe remainder causes the entire
original segment to be disclosed as skipped. Split records preserve exact byte
mappings, including Unicode and BOM offsets. No text is silently truncated.

Consumers must count records/IDs across pages and stop on incomplete JSON,
repeated IDs, missing records, or changed hashes. A preview never means
"no corrections found"; empty scope means "no eligible text".

The packaged workflow leads with eligible files/segments and “no files changed,”
then shows per-format and per-file coverage, reason-grouped skips/failures,
effective settings, and incomplete content. It warns when no files are eligible or
when fewer than half of at least ten known file records are eligible. Collapsed
directory exclusions remain paths/subtrees and are not fabricated as file counts.
It documents all three inline suppression directives and never invents a duration
estimate. Offline scope preview sends no project prose to a proofreading model.

## Preferences and migration

No initialization is required. An optional root `.spellagentrc.json` uses:

```json
{
  "schemaVersion": 2,
  "dialect": "en-US",
  "include": ["**/*.md", "**/*.{js,jsx,ts,tsx,mjs,cjs,mts,cts,py,pyi,java,go,rs}"],
  "exclude": [],
  "includeHidden": false,
  "glossary": []
}
```

Only schemaVersion is required in an existing file. Unknown fields fail strictly.
Schema 1 or legacy provider/pricing/limit/storage fields fail with migration
guidance before discovery. The helper never overwrites the old file. Invocation
include/dialect/includeHidden override the corresponding project values;
exclusions and case-sensitive glossary terms are additive. Model selection stays
in the host, not project configuration.

Supported globs are root-relative `*`, `**`, `?`, and bounded brace alternatives.
Negation, absolute paths, backslashes, traversal, and nested braces are rejected.
Mandatory exclusions, generated-file rules, syntax-aware markers, and inline
suppression remain effective with explicit targets and includeHidden.
Directory exclusions ending in `/` also exclude explicitly targeted descendants.
Brace alternatives are validated after expansion; expansion stops before
allocating more than 256 alternatives per pattern.

## Filesystem and packaging boundaries

Only regular files with one hard link, at most 1 MiB, and valid non-binary UTF-8
are extracted. BOM, line endings, and final-newline state are preserved because
Phase B never writes source. The reader bounds allocation, refuses symlinks at
all inspected components, uses no-follow opens, compares file identities, and
rechecks the path chain. Node has no portable openat traversal; these checks do
not claim confinement against an adversarial process swapping ancestors between
checks. Host filesystem permissions remain authoritative. Phase C must add its
write lock, final policy/freshness checks, logs, and atomic replacement.

Discovery holds one file's source at a time and a source-free manifest. It
reconstructs that manifest for continuation; large scopes trade repeated parsing
for no persisted state. A 100,000-entry/128-level internal traversal guard fails
explicitly rather than emitting incomplete success. Preferences and glob
expansion also have internal transport/resource bounds, not user tuning knobs.

Both artifacts now package core, discovery, extractors, plugin protocol, runtime
dependencies, WASM grammars, and licenses. Builds clear stale dist output first.
The old CLI, interactive initializer, provider adapters/probes, scheduler
contracts, provider dependencies, executable metadata, and CLI packaging scripts
have been removed. Shared parser/protection regression fixtures remain.

## End-of-session verification — 2026-09-21

After the user explicitly authorized verification, `npm run check`,
`npm run test:pack`, and `npm run test:linux` passed. macOS arm64 used Node
v24.14.1/npm 11.12.1; Linux arm64 used Node v24.14.1/npm 11.11.0. Both ran
26 tests across six files, eight parser probes, and isolated Codex package checks.
No installed-host session or model evaluation ran. Tests cover migration,
preferences, generated/mandatory/hidden exclusions, symlink ancestors, hard
links, invalid UTF-8/binary/oversized files, stale scope/policy/source, multiple
pages, diagnostics-only pages, Unicode split byte mappings, no writes, and
isolated packaged execution from a read-only directory with spaces.

The user deferred **all Claude qualification/tests** until after the entire
project is implemented and a subscription is available. Packaging continues to
build both artifacts. Package verification defaults to Codex only, including in
Docker. When the user lifts that deferral, run with
`SPELLAGENT_TEST_HOSTS=codex,claude`; this does not itself authorize live inference.

## UX reconciliation verification — 2026-09-21

After the maintained plan's preview UX was expanded, Phase B added effective-scope
echoing, per-format and per-reason summaries, explicit empty-scope explanations,
narrow-coverage signaling, separate suppression counts, and a dedicated `.txt`
exclusion reason. The shared/host skill sources now include ordinary-language
examples, glossary confirmation, suppression help, outcome-first reporting, and
the offline/model-retention distinction. Tests and isolated package assertions were
updated for the new contract.

After implementation ended, `npm run check` and `npm run test:pack` passed on
macOS Darwin arm64 with Node v24.14.1/npm 11.12.1. The final check ran 27 tests
across six files and all eight parser probes. The first check exposed one stale
test expectation for a correctly identified excluded directory; after correcting
that assertion, the full check passed. The isolated Codex package check exercised
the new summary and invalid-glossary contracts from a read-only artifact.

`npm run test:linux` initially could not access the Docker socket in the sandbox.
The authorized retry passed on Linux aarch64/arm64 with Node v24.14.1/npm 11.11.0:
the same 27 tests, eight parser probes, and isolated Codex package check. Dependency
preparation used network access; the actual checks ran with container networking
disabled. Phase A installed-host/model gates and the Claude deferral are unchanged.
