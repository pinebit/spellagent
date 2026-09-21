# SpellAgent: Plugin Product and Implementation Plan

Status: adopted implementation design, 2026-09-21, following the user's repository-pivot request. Phase B read-only implementation candidate; editing is not implemented or qualified. See sections 14–15 for evidence, unresolved gates, and user-authorized deferrals.

## 1. Product direction

SpellAgent becomes a plugin for local Codex and Claude Code users. Each host supplies authentication, model access, agent execution, and the conversational interface. SpellAgent supplies a focused proofreading skill and a deterministic helper for extracting prose and safely applying corrections.

The user installs the plugin, invokes its skill on selected local files or directories, and receives corrected files plus a coverage summary. Corrections apply automatically after local validation, without a separate review/apply prompt. Host permission controls still apply.

There is no standalone SpellAgent CLI, service, API integration, or mandatory initialization.

### Confirmed scope

- Distribute plugins for both Codex and Claude Code.
- Share one parsing, validation, and editing engine.
- Prefer inexpensive host models, with explicit selection and user overrides.
- Support macOS and Linux.
- Process local documentation, comments, and supported docstrings.
- Apply corrections incrementally, completing one file before moving to the next.
- Preserve existing local modifications and detect changes during processing.

### Implementation defaults

- English spelling and grammar; `en-US` by default, with `en-GB` available.
- Minimal corrections that preserve meaning, voice, and technical terminology.
- One worker per invocation; no nested delegation or parallel file editing in v1.
- Optional project preferences, with safe defaults when absent.
- Node.js 24 or newer required.
- No translation, stylistic rewriting, identifier renaming, or factual correction.

These defaults guide implementation and remain revisable; they are not measured quality claims.

## 2. User experience

Expose one proofreading skill per plugin. In Claude Code, a plugin named `spellagent` with a skill named `check` provides `/spellagent:check`. Codex exposes the corresponding installed skill through its skill picker.

Users can request:

- Correction of specific files or directories.
- Correction of the current working directory.
- An offline scope preview.
- A dialect or additional glossary terms for that invocation.

Normal invocation authorizes correction. Preview only enumerates files and extracts coverage information; it does not proofread or modify source.

The working directory is the default root. Explicitly requested roots are supported. All target paths must remain inside that root. Do not infer roots through Git or silently search parent directories.

The final response reports:

- Files reviewed, changed, skipped, and failed.
- Applied correction totals.
- Unsupported or excluded content.
- Incomplete processing and files remaining unchecked.
- Relevant notices, including potentially changed Markdown heading anchors.

“No corrections found” applies only to successfully reviewed text. Empty scope is reported as “no eligible text,” not “all clear.”

Users inspect resulting changes using their own tools. SpellAgent never stages, commits, pushes, publishes, or rolls back source changes.

## 3. Architecture and distribution

Maintain one TypeScript codebase and produce two self-contained release packages.

| Component | Responsibility |
| --- | --- |
| Shared engine | Discovery, extraction, source mapping, proposal validation, file writes, diagnostics |
| Shared workflow | Proofreading policy, data handling, completeness requirements, reporting |
| Codex wrapper | Skill invocation and explicit sub-agent model selection |
| Claude Code wrapper | Skill invocation, forked execution, and host model settings |
| Release packaging | Host manifests, compiled helper, runtime dependencies, WASM assets, licenses |

Both packages use the same engine version. Generate shared workflow content from one maintained source, with small host-specific additions.

Ship compiled JavaScript and all required runtime dependencies and parser assets. Installation must not require dependency installation, compiler tools, native builds, lifecycle scripts, or runtime grammar downloads.

Resolve helper dependencies and assets relative to the installed package, not the project or current working directory. The installed plugin directory is read-only during use.

### Plugin packaging

- Use the supported OpenAI plugin manifest format for the Codex artifact, with compatibility metadata where required by the qualified client.
- Use `.claude-plugin/plugin.json` for Claude Code.
- Bundle the skill and helper within each artifact.
- Maintain host-specific marketplace catalogs for initial distribution.
- Keep version numbers synchronized across both artifacts.
- Treat submission to official public directories as a separate distribution step.
- Do not add an MCP server, hooks, or background service for v1.

Plugin installation and updates belong to the host. The helper performs no Git operations, network requests, or child-process execution.

## 4. Host integration and model policy

### Codex

The skill explicitly delegates proofreading to one sub-agent using the configured inexpensive model. The worker receives the root, scope, effective preferences, helper location, and complete workflow instructions.

Do not assume installing a plugin registers a custom agent definition. The initial implementation uses supported explicit delegation from skill instructions; package-installed agent registration is not a dependency.

Initial candidate: `gpt-5.6-luna`, with low reasoning effort.

### Claude Code

Use a forked skill with an explicit model and foreground completion so the invocation waits for its summary. Select a tool-capable agent that can execute the helper and apply corrections.

Initial candidate: the host’s `haiku` alias.

### Common policy

- Users may explicitly override the worker model.
- Never switch to another provider or read provider credentials.
- Never silently fall back to an expensive parent model.
- If the requested worker model is unavailable or host policy overrides it, stop and explain the supported choice needed.
- Host configuration and organizational policy remain authoritative.
- Record the effective model when the host exposes it; do not invent verification.
- Measure model quality before calling either candidate qualified.
- Make no automatic “cheapest available” guarantee.

The host handles inference billing, quotas, and authentication. SpellAgent does not implement a provider scheduler, dollar budget, or token accounting service.

## 5. Shared helper interface

The helper is an internal script invoked by the skill, not an installed public executable. Use a versioned JSON request/response protocol over stdin/stdout.

Provide three internal operations:

| Operation | Behavior |
| --- | --- |
| Discover | Resolve preferences and enumerate eligible files with skip reasons |
| Extract | Return a bounded page of prose segments for one file and its snapshot hash |
| Apply file | Reconstruct current segments, validate complete responses, and apply one file’s corrections |

Requests include an explicit root and root-relative targets. Extraction returns deterministic segment IDs, a content hash, extraction/policy version, editable prose, and clearly separated read-only context.

Model responses contain one record per requested segment, with zero or more proposals containing `original`, `replacement`, `category`, and `reason`. The model supplies no authoritative byte offsets.

Each application request identifies the source snapshot and includes all segment responses for that file. The helper independently reconstructs mappings and validates completeness.

### Transport and batching

- Page extraction output to avoid host tool-output truncation.
- Use deterministic segment ordering.
- Bound each page to 32 segments and approximately 12,000 characters of prose and context.
- Split oversized prose at safe sentence or paragraph boundaries while preserving source mappings.
- Disclose segments that cannot be split safely.
- Do not treat missing or truncated output as successful review.
- Transfer JSON using safe stdin transport; never interpolate prose as executable shell syntax.
- Keep proposals and extracted content out of persistent project files.

These are internal transport bounds, not user-facing token configuration.

The helper can reconstruct state between calls. It requires no daemon, saved source snapshots, or resumable result store.

## 6. File scope and extraction

Retain the existing coverage:

- Markdown and GFM.
- JavaScript, TypeScript, JSX, and TSX comments.
- Go comments and documentation.
- Rust comments and rustdoc.
- Java comments and supported Javadoc.
- Python comments and syntactically identified docstrings.

Retain Tree-sitter WASM for code and remark for Markdown.

Use syntax trees to locate eligible prose and patch original bytes. Never reserialize a whole document or source file through an AST printer.

Preserve existing protections for code examples, directives, URLs, paths, placeholders, identifiers, documentation markup, and glossary terms. Uncertain constructs are skipped with diagnostics.

Default exclusions include hidden paths, generated files, dependencies, build output, version-control metadata, credential files, lockfiles, binaries, and unsupported encodings. Explicit targets cannot bypass mandatory exclusions. Do not follow symlinks.

Keep the 1 MiB source-file limit. Accept strictly decoded UTF-8 and preserve BOM, existing line endings, and final-newline state.

Generated-file detection retains explicit exclusions, filename rules, and syntax-aware marker detection. Repeat policy checks before writing.

Markdown headings may change implicit anchors. Python docstring edits change observable `__doc__` values. Rust documentation comments can affect documentation tooling and macros. Report these limitations without promising behavioral equivalence.

## 7. Preferences and migration

Use optional root-level `.spellagentrc.json` with a new schema version.

Supported preferences:

- Dialect.
- Include/exclude globs.
- Hidden-path inclusion.
- Case-sensitive glossary terms.

Defaults work without creating a file. Invocation preferences override corresponding project preferences, except exclusions remain additive and mandatory protections always win. Invocation glossary terms extend the project glossary.

Validate unknown keys strictly. Existing configurations containing provider, pricing, scheduler, or removed limit fields receive an actionable migration error before processing. Do not silently reinterpret or overwrite them.

No provider credentials, models, request limits, storage controls, or concurrency settings belong in this project file. Worker model choice belongs to the host integration.

Retain existing inline suppression directives and their syntax-aware interpretation.

## 8. Validation and incremental editing

The unit of completion is one file.

1. Extract all eligible segments against one content hash.
2. Have the worker review every segment in bounded batches.
3. Require an explicit response for every segment, including unchanged ones.
4. Validate proposals and completeness.
5. Re-read the file and reconstruct extraction from current source.
6. Build and validate the candidate.
7. Replace that file and continue.

Malformed output, missing or duplicate records, unknown IDs, rejected proposals, or overlapping changes leave that file unresolved and unchanged. Continue to independent files after file-specific failures; stop on cancellation, host/model failure, or systemic storage/logging failure.

Do not automatically issue repair requests or retry unresolved files in v1.

Validation must:

- Resolve each original phrase uniquely within its segment.
- Reject matches in neighboring context.
- Reject protected ranges and unmappable spans.
- Preserve exact leading/trailing whitespace.
- Reject unsafe delimiters, control characters, and structural changes.
- Bound replacements to prevent paragraph rewrites.
- Verify all bytes outside accepted ranges remain identical.
- Reparse the combined candidate and verify format-specific invariants.

Apply edits with UTF-8 byte slices. Preserve mode, BOM, line endings, and untouched bytes.

Use a project write lock, secure temporary files beside the target, final freshness checks, and per-file atomic replacement. Reject symlink traversal, hard-linked targets, root escapes, changed policy, and changed input.

The lock coordinates SpellAgent writes, not arbitrary editors. Document the residual race between the final freshness check and replacement.

Previously completed files remain changed if later files fail. Never imply repository-wide atomicity.

## 9. Data, permissions, and diagnostics

The host receives extracted prose and bounded context for inference. The helper makes no network calls. Host conversation storage and retention are outside SpellAgent’s control.

Treat repository prose as untrusted data. Instructions inside extracted text must never alter the workflow or authorize unrelated actions.

Require corrections to pass through the helper. This is a workflow constraint, not a claim that a tool-enabled host agent is technically confined to that interface.

Keep source-free application logs under `.spellagent/logs/`, containing paths, hashes, counts, diagnostic codes, and write outcomes. Do not store prompts, source text, proposals, replacements, snapshots, or backups.

Write intent and completion events around replacements. Stop further writes if logging fails. Clean owned temporary files during normal failure handling; report possible leftovers after a crash.

Do not implement automated rollback, replay, recovery commands, or result resumption. A subsequent invocation performs fresh extraction and never applies saved suggestions.

## 10. Existing work and migration

Reuse discovery, generated-file detection, extractors, source mapping, protection policies, parser assets, and applicable fixtures.

Remove the standalone CLI, interactive initialization, provider adapters, API probes, model suggestions for external APIs, and obsolete provider/scheduler contracts once the plugin foundation is established.

Replace CLI tests with helper-protocol and plugin-package tests.

Historical evidence records the existing Phase 1 passing on macOS arm64 and Linux arm64 with Node 24.14.1, 30 tests, eight parser probes, and offline packed-install checks. Historical passes do not qualify new plugin integration or editing.

Documentation adoption (completed 2026-09-21; see section 14):

- This document is the maintained design.
- README and AGENTS.md reference it.
- Mandatory CLI initialization, provider selection, 32-worker scheduling, and whole-run application requirements are superseded.

No commit, push, publication, or external marketplace change occurs without explicit authorization.

## 11. Implementation phases and gates

### Phase A — Plugin and transport feasibility

Build minimal packages for both hosts using the shared bundled parser helper. Prove installation, asset resolution, JSON transport, paged extraction, worker model selection, and summary return on synthetic fixtures.

Exit: both hosts can invoke the installed plugin and extract prose without separate dependency installation or API configuration. No source editing yet.

A failure of model selection or source-free JSON transport blocks this gate; do not quietly introduce a service or persistent proposal files.

### Phase B — Shared offline engine

Decouple discovery/extraction from the old config and CLI. Implement optional preferences, migration errors, protocol contracts, pagination, coverage accounting, and offline preview.

Exit: existing language coverage and protections pass adapted offline fixtures; all eligible segments are accounted for.

### Phase C — Safe automatic editing

Implement proposal validation, structural checks, freshness protection, locking, atomic writes, logs, cancellation, and per-file completion.

Exit: both host workflows can correct synthetic local files through the helper, with failure behavior matching this design.

### Phase D — Qualification and release packaging

Evaluate proofreading quality, installed-package portability, host invocation, effective model behavior, interruption handling, and documented limitations.

Exit: required host/platform checks pass, quality targets are measured, and versioned artifacts and marketplace catalogs are ready for review.

Publication remains a separate authorized action.

## 12. Verification and acceptance

Respect the repository’s verification cadence: do not run checks during implementation. After the user explicitly declares the requested work or session finished, run applicable checks once.

Retain `npm run check`, `npm run test:pack`, and `npm run test:linux`, adapting packaging checks to plugin artifacts. Default checks remain offline and credential-free. Live host evaluations require explicit opt-in and may consume paid usage.

Required coverage:

- Parser and byte-mapping fixtures for Unicode, BOM, CRLF, repeated text, and protected constructs.
- Malformed, missing, duplicate, unknown, and overlapping proposal records.
- Multiple extraction pages and complete-file coverage.
- Stale files, changing exclusions, symlinks, hard links, root escapes, lock contention, and interrupted writes.
- Byte-identical content outside approved ranges.
- No source-bearing persistent state or helper network/subprocess activity.
- Packaged runtime dependencies, WASM assets, licenses, paths with spaces, and unrelated working directories.
- Installed skill behavior in both Codex and Claude Code on macOS and Linux.
- Existing modifications preserved without consulting Git.

Use the existing quality target: a labeled corpus of at least 300 English segments, with clean prose, terminology, both dialects, and every supported language family. Reserve a held-out subset.

Release targets are at least 95% correction precision, 80% recall of labeled in-scope errors, and zero protected-syntax modifications in safety fixtures. Record exact counts and repeated-run results per host/model.

Report host/client versions, model identifiers, OS/architecture, runtime version, and dates. Report usage only when exposed by the host; do not fabricate cost estimates.

Windows remains untested. Existing arm64 evidence does not imply x64 qualification.

## 13. Reference documentation

Host behavior must be rechecked against the client versions selected for release:

- [Codex skills](https://developers.openai.com/codex/skills)
- [Codex subagents and model selection](https://learn.chatgpt.com/docs/agent-configuration/subagents)
- [OpenAI plugin packaging](https://developers.openai.com/plugins/build/plugins)
- [Claude Code skills](https://code.claude.com/docs/en/skills)
- [Claude Code plugins](https://code.claude.com/docs/en/plugins)
- [Claude Code plugin reference](https://code.claude.com/docs/en/plugins-reference)

## 14. Adoption and Phase A status

2026-09-21: adopted this design and updated README.md and AGENTS.md. The old
mandatory CLI initialization, provider selection, 32-worker scheduler, and
whole-run application design are superseded.

Phase A candidate scope is deliberately synthetic-only: a versioned stdin/stdout
helper lists and extracts bundled fixtures for all eight parser formats, with
snapshot hashes and bounded pages. It accepts no project paths or source text
and exposes no apply operation. Production discovery/preferences and safe
oversized-segment splitting remain Phase B; editing remains Phase C.

Packaging copies only extractor/helper code and their runtime dependency closure,
not CLI/provider modules. Host skill documents are generated from one shared
workflow plus host-specific frontmatter and orchestration instructions. No new
runtime dependency or bundler is required. Artifacts use the package version and
include portable/compatibility Codex manifests and a Claude manifest. Marketplace
catalog release work remains Phase D; no personal marketplace or installed host
configuration is modified here.

See [phase-a.md](phase-a.md) for protocol and verification handoff.

### End-of-session verification — 2026-09-21

User explicitly requested verification before a later commit/push. Environment:
macOS (Darwin) arm64, Node v24.14.1, npm 11.12.1.

- `npm run check`: passed typecheck, build, 35 tests across seven files, and all
  eight parser probes. Includes the five new synthetic protocol tests.
- `npm run test:pack`: passed for both Codex and Claude artifacts, exercising
  ten fixtures, paginated coverage, oversized skips, malformed/invalid UTF-8/
  oversized requests, and isolated dependency/asset resolution with spaces in
  paths and an unrelated working directory. No host installation or LLM calls.
- Claude Code 2.1.261: `claude plugin validate build/plugins/claude/spellagent`
  passed manifest validation only.
- `git diff --check`, shell syntax validation for the Linux script, and Node
  syntax validation for both new packaging scripts passed.
- `npm run test:linux`: passed after the user started Docker and sandbox socket
  access was authorized. Linux aarch64/arm64, Node v24.14.1, npm 11.11.0; 35 tests
  across seven files, eight parser probes, and both isolated plugin packages.
  Dependency preparation used network access; checks ran with container networking
  disabled. Temporary containers and their dependency volume were cleaned up by
  the script. This does not qualify Linux host integration or x64.
- Codex plugin-creator compatibility-manifest validator and skill-creator
  validator: passed on the generated Codex artifact. Initial attempts were blocked
  by missing PyYAML/cache permissions; resolved by fetching PyYAML into an isolated
  temporary uv environment. No system/project dependencies or host settings were
  changed. Portable root-manifest ingestion still needs host verification.

Unresolved gates:

- Portable Codex manifest ingestion and Claude skill frontmatter/fork behavior
  in the actual hosts; structural validators do not establish these behaviors.
- Installed plugin discovery/invocation on both hosts, foreground summary return,
  safe JSON transport without output truncation or source-bearing temp files.
- Explicit Codex model selection and Claude Haiku selection/policy behavior;
  user overrides and unavailable/overridden model stop behavior.
- Read-only installed directory, paths with spaces, unrelated working directory,
  and no dependency installation at use time.

No host sessions, installation, or live model evaluations were run. Phase A is
not complete until its remaining gates have measured evidence. Existing legacy
tests remain temporary regression coverage; they do not reinstate the retired
CLI design. No commits, pushes, publication, or external marketplace changes
were performed.

## 15. Phase A continuation and Phase B implementation — 2026-09-21

The user authorized completing Phase A as needed and proceeding with Phase B,
including necessary local plugin installation and live host evaluation. During
this session, the user explicitly deferred **all Claude qualification/tests**
until after the entire project is implemented and a Claude subscription is
available. This is a qualification deferral, not a Claude pass or removal of
Claude implementation scope. Future phases must preserve that distinction.

Phase B's offline implementation is now a candidate: strict optional schema-2
preferences and migration guidance, root-relative discovery, secure bounded
reads, paged discover/extract protocol, deterministic sentence/paragraph splitting
with byte maps, explicit skip/failure coverage, diagnostics/notices pagination,
and shared offline preview instructions. Source-free hashes invalidate stale
scope, policy, and extraction continuations. The helper remains read-only.

Removed the old public CLI, initialization flow, provider adapters/probes,
provider/scheduler contracts, API SDK/commander dependencies, executable metadata,
and CLI packaging/cache scripts. The lockfile was updated offline without
lifecycle scripts. Build output is cleaned before compilation; packages explicitly
include only the shared engine/helper and their runtime closure. Protocol 1
remains synthetic-only for deferred feasibility evaluation.

Added/adapted offline tests and Codex package verification, including read-only
installed paths and an unrelated working directory with spaces. Both artifacts
are still built; package tests default to Codex only under the Claude deferral.
See [phase-b.md](phase-b.md) for the protocol and verification handoff.

**Verification status:** Phase B offline checks passed after the user's explicit
end-of-implementation authorization; evidence follows below. Phase C editing
and Phase D release/quality qualification have not been started.

### Continuation review — 2026-09-21

Reviewed the pending Phase B source, protocol, packaging, and regression fixtures.
Fixed directory-only exclusions so explicit descendant targets cannot bypass
the policy used during directory traversal. Hardened brace globs to reject
unmatched/nested braces and unsafe expanded alternatives, and enforce the
256-alternative bound before allocating the Cartesian product. Added regression
cases for these behaviors; they passed in the verification below.

Phase A's installed-host/model gates remain unresolved; no new host evidence
was produced in this review, and Claude qualification remains deferred.
No commit, push, installation, or marketplace change was performed.

### Authorized verification — 2026-09-21

The user explicitly approved ending implementation and running verification.

- macOS (Darwin) arm64, Node v24.14.1, npm 11.12.1: `npm run check`
  passed typechecking, build, 26 tests across six files, and eight parser probes.
  `npm run test:pack` built both artifacts and passed the isolated Codex package
  checks from a read-only package directory and unrelated working directory with
  spaces. Includes fixture/project protocols, migration, and source preservation.
- Linux aarch64/arm64, Node v24.14.1, npm 11.11.0: `npm run test:linux`
  passed the same 26 tests, eight parser probes, and Codex package checks.
  The initial sandbox attempt could not access Docker's socket; the authorized
  escalation succeeded. Dependency preparation used network access; checks ran
  with container networking disabled. The script cleaned up its temporary volume.
- No host/client or model was exercised by these offline checks. Claude packages
  were built but not tested, preserving the user's deferral. No x64, Windows,
  installed-host, or live-model pass is inferred.

Phase B's offline exit gate is satisfied for the tested arm64 platforms. This
does not close Phase A's outstanding installed-host/model gates or qualify a
proofreading release. The changes are ready for commit review with those limits.
