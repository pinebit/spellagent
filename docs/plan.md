# SpellAgent: Product and Implementation Design

Status: Phase 1 implementation candidate, 2026-09-20. The revised Phase 0 is complete on macOS arm64 and Linux arm64; Phase 1 offline discovery/extraction is implemented but awaits the single end-of-session verification run requested by repository policy. Windows is intentionally untested. This document defines the intended v1, phased work, and implementation evidence. Planned behavior is not a claim of verified functionality. See sections 11–12 for current evidence.

## 1. Product decisions

SpellAgent helps developers correct spelling and grammar in repository prose without losing control of their source files. The primary experience is: initialize, optionally inspect scope, run corrections, and manually review the resulting local file changes.

Confirmed choices:

- First-release scope is documentation plus code comments and docstrings.
- `run` authorizes inference and automatic application of locally validated corrections. There is no interactive review, selection, or apply step. Users manually review local changes and decide what to keep or commit. Model confidence never replaces validation.
- SpellAgent operates on local files only. It never invokes Git or a GitHub client/API, inspects version-control state, stages files, creates branches/commits/PRs, pushes changes, or publishes results. The correction result is locally modified files; configuration and run logs also stay local. Configured LLM inference remains the only intended runtime network interaction.
- Initial code coverage spans five language families: JavaScript/TypeScript (counted together), Python, Java, Go, and Rust. JavaScript/TypeScript, Go, and Rust are explicit requirements; Python and Java are the selected additions for broad adoption. This is a product coverage choice, not a claim that these are the literal top five in a single market ranking.

Adopted defaults where the discussion did not specify a preference:

- Markdown documentation accompanies all five language families, including JSX/TSX comments. English with `en-US` or `en-GB` dialects; default `en-US`.
- Cloud inference is acceptable. Support direct OpenAI, direct Anthropic, and Vercel AI Gateway as first-release provider options through Vercel AI SDK. The user explicitly selects the connection, model, and credentials. Gateway is optional; there is no SpellAgent service.
- `init` is always interactive; `run` supports terminals and headless use with the same automatic correction behavior. Release hardening comes later.
- Default `limits.maxAgents` is 32 simultaneous model workers, editable during `init` and in config. This is an upper bound, not a throughput target or a rate-limit guarantee.
- Hidden files and directories are excluded by default. `includeHidden: true` opts them into normal scope rules; mandatory safety exclusions still win.
- Distribute an npm CLI for macOS and Linux using Node.js 24 LTS. Windows remains untested and is outside required qualification at the user's request; do not claim verified Windows support. Verify dependency compatibility when implementing.
- Optimize for trustworthy, minimal corrections and few false positives. Preserve voice, meaning, technical terminology, and dialect. Style rewriting, translation, factual correction, and identifier renaming are out of scope.

A model is an editor proposing changes, not an autonomous agent with filesystem or shell access. Concurrent batches are a scheduling choice. A second reviewer model is a later, measured enhancement, not a prerequisite.

## 2. User experience and commands

The only product commands are `init` and `run`:

```sh
spellagent init
spellagent run --dry-run
spellagent run
spellagent run docs src --format json
```

### Setup and scope

`init` is always interactive, including when driven by scripted answers or a pseudo-terminal. There is no `--yes`, noninteractive mode, or provider/model flag shortcut. Prompt for every required choice and consume answers through the same prompt flow; EOF or cancellation aborts without writing a config. A terminal UI may use a line-oriented prompt fallback for scripted stdin. Preview and confirm the configuration write; refuse to overwrite an existing config.

Create `.spellagentrc.json` under the explicit `--root` or cwd. The config is a root-level JSON file; run logs live separately under `.spellagent/logs/`. Do not read or modify `.gitignore` or other version-control configuration. Prompt for connection (OpenAI, Anthropic, or Vercel AI Gateway), suggest a bundled low-cost model, allow a custom model, and require explicit upstream routes for Gateway. Prompt for `maxAgents` (default 32), dialect, scope/exclusions, and hidden-file inclusion. Never prompt for an API key; explain the selected connection's environment variable. Initialization makes no API calls.

Explain that eligible prose and bounded context go to the configured provider (through Vercel and the allowed upstreams for Gateway), that `run` modifies local files, and that run logs contain paths, counts, usage, and diagnostics. No background uploads or telemetry.

Every `run`, including `--dry-run`, requires a valid `.spellagentrc.json` created by setup. Missing config fails with exit 2 and an instruction to run `spellagent init`, before discovery, credential access, inference, or source writes. Config existence and schema validity are the setup marker; no extra hidden initialization flag. Do not search parent directories or load alternate config locations.

`run --dry-run` resolves config, enumerates files, extracts eligible prose, and reports counts, exclusions, unsupported files, warnings, and estimated request volume. It performs no inference, needs no credentials, and never changes source. Do not present a precise final cost before output usage is known.

### Run and local review

`run` shows provider/model, scope, progress, usage, changed files, and actionable failures. It validates proposals, revalidates current file contents, and applies corrections automatically without prompts. There are no `review`, `apply`, `runs`, or `recover` commands, saved selections, or resumable result files. Users inspect and edit resulting local files with their own tools. Existing local modifications are ordinary input; SpellAgent never checks whether files are committed.

Terminal and headless runs share behavior. `--format json` changes reporting only; it does not make a run read-only. No arguments show help rather than starting a paid run. All proposals stay in memory; cancellation or incomplete inference before application writes no source. A new invocation recomputes proposals rather than resuming old ones. Application failures may leave a disclosed subset of files changed (section 7).

Honor `NO_COLOR`, sanitize control characters in paths and diagnostics, restore terminal state on exit, and support narrow terminals. A plain text reporter is always available. There is no raw-input review UI or freeform replacement editor. Users edit glossary/config directly between runs.

### Reports and exit codes

Human output includes coverage, changed-file totals, known/estimated usage and cost, run ID, and log path. JSON stdout is one versioned object; progress/diagnostics go to stderr. Results are ordered by normalized path and source location, independent of request completion order. Reports may show ephemeral corrections, but SpellAgent does not save them. Redirecting a report is the user's explicit export.

| Code | Meaning |
| --- | --- |
| 0 | Complete dry run or run; all validated corrections were applied, or none were needed |
| 2 | Configuration, authentication, operational, stale-input, or incomplete-run failure |
| 130 | User cancelled the operation |

An empty scope is `no_eligible_text` and returns 2, never “all clear.” Expected exclusions and unsupported extensions are coverage information. Failure to parse/read a selected supported file, unresolved model output, or exhausted budget makes the run incomplete and prevents application. Cancellation logs completed work and any already replaced files without saving proposals for resumption. Neither incomplete nor cancelled status is erased by partial file writes.

## 3. Discovery and extraction contract

The project root is an explicit `--root`, otherwise cwd. Load `.spellagentrc.json` only from that root; never discover roots through version-control metadata or search parent directories implicitly. Paths and globs in config are root-relative. CLI path arguments are cwd-relative and must resolve inside the root. A project has one config in v1; no nested config inheritance. When invoked from a subdirectory, users can set `--root` explicitly to use the parent project configuration.

Discover files through a local filesystem walk. Scope is determined only by CLI paths, config `include`/`exclude` globs, built-in exclusions, and generated-file rules. Use documented glob semantics: `/`-separated root-relative paths, `**` for recursive matching, braces for extension alternatives, any dot-prefixed path component excluded unless `includeHidden` is true, and exclusions always winning. No negated reinclusion rules in v1. Do not read `.gitignore`, Git indexes, attributes, history, remotes, or tracking status. Explicit paths cannot bypass exclusions, including hidden-path filtering. `includeHidden` permits eligible prose in hidden paths such as `.vscode/notes.md`; it never overrides mandatory exclusions. The same directory contents and SpellAgent configuration must produce the same scope regardless of whether version control is installed or initialized.

Always exclude version-control metadata by literal path names (`.git`, `.hg`, `.svn`, `.gitignore`, `.gitattributes`, `.gitmodules`) without opening them, `.spellagent/`, dependency/build directories (`node_modules/`, `vendor/`, `dist/`, `build/`, `target/`, `.venv/`, `venv/`, `__pycache__/`), lockfiles, known credential files such as `.env*`, binary files, and files over the configured size limit. Do not follow symlinks. Nested directories otherwise follow the same filesystem rules; exclude vendored or nested projects through config paths, without consulting submodule metadata. Exclude generated files using the layered policy below; exclude known minified filenames separately. Include prose in tests by default. A dry run explains every skip reason and reports unsupported formats in aggregate.

Accept strictly decoded UTF-8, preserving BOM and existing line endings. Reject undecodable input. Initial limit: 1 MiB per file; exceeding it is a disclosed exclusion. Never silently truncate eligible prose to fit a request: split on paragraph/sentence boundaries, or mark the segment unsupported with a coverage warning.

| Format | Eligible prose | Protected/excluded content |
| --- | --- | --- |
| `.md` | Paragraphs, lists, blockquotes, headings, link labels, image alt text, GFM table prose | Fenced/indented code, inline code, URLs/link destinations, HTML, frontmatter, reference identifiers, structural Markdown |
| `.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, `.cjs`, `.mts`, `.cts` | Prose in line/block comments and JSDoc descriptions | Strings, template literals, JSX text/attributes, identifiers, types, JSDoc tags/types/parameter names, compiler/linter directives, examples/code blocks |
| `.go` | Prose in ordinary comments and Go doc comments | String literals, `//go:` directives, legacy `// +build`, line/tool directives, cgo preambles, code examples, documentation link targets |
| `.rs` | Prose in ordinary comments and rustdoc comments (`///`, `//!`, `/** */`, `/*! */`) | Strings/raw strings, explicit `#[doc = ...]` attributes, macro token-tree content, nested-comment delimiters, rustdoc code blocks/doctests (including hidden lines), intra-doc link targets |
| `.java` | Prose in ordinary comments and supported Javadoc descriptions | Strings/text blocks, identifiers, annotations, Javadoc tags/references/parameter names, `{@code}`, `{@literal}`, `{@snippet}`, HTML/code examples, Unicode-escape-containing comment spans |
| `.py`, `.pyi` | Comment prose and actual module/class/function docstrings | Other strings, byte/formatted strings, doctests, code blocks, encoding/shebang/type directives, Sphinx roles/targets/field names and parameter names |

Language-specific documentation parsing is required: Rust doc comments use Markdown with rustdoc extensions, Go doc comments use Go documentation conventions, and Javadoc mixes prose with tags and HTML. Protect complete constructs when an adapter cannot confidently identify their prose. Support Java Markdown documentation comments only after the selected grammar and protection adapter pass fixtures; otherwise disclose them as unsupported. Never invoke `go generate`, rustdoc doctests, Javadoc snippets, or project build tools to extract prose.

Python docstrings are syntactically identified first-statement string expressions, not every triple-quoted string. Initially support single literal docstrings; skip implicit concatenation and spans with escapes that cannot be mapped safely. Docstring edits change observable `__doc__` values: syntax preservation is not a promise of identical program behavior.

Markdown heading edits may change implicit anchor IDs. Show an `anchor_may_change` notice in the run report and source-free diagnostic log. Do not rewrite backlinks automatically. Skip explicit anchor syntax and Markdown constructs whose prose boundaries cannot be established reliably. `.mdx`, HTML documents, notebooks, localization files, and standalone reStructuredText are deferred.

Each extractor returns source-mapped prose segments and protected ranges. Group related prose into paragraphs without losing exact mapping through comment prefixes or markup. Give the model read-only neighboring prose when useful; do not send full files or unrelated code by default. URLs, paths, inline identifiers, placeholders, and recognized markup are protected. If protection leaves too little useful prose, skip with a reason.

Syntax-aware extraction narrows the editable surface; it cannot establish semantic safety. For any uncertain boundary, skip rather than fall back to regular-expression extraction of arbitrary source text.

### Generated-file exclusion

Generated output must be excluded before prose extraction, batching, or inference, regardless of version-control status. Classification depends only on local paths, content markers, and SpellAgent configuration. Reading a file locally to classify it is allowed; sending its content as editable prose or neighboring context is not.

Apply these independent exclusion layers; any match excludes the whole file:

1. **Project paths:** the root-relative `exclude` globs are authoritative, including for explicitly named CLI files. Projects must list custom generator output directories or exact outputs here. For example, `"exclude": ["src/generated/**", "internal/protogen/**", "sdk/autogen/**"]`. These examples are project choices, not assumptions that every directory named `proto` contains generated output.
2. **Bundled filename rules:** maintain a versioned, fixture-backed rule registry. Initial protobuf/gRPC rules include `**/*.pb.go`, `**/*_grpc.pb.go`, `**/*_pb2.py`, `**/*_pb2.pyi`, `**/*_pb2_grpc.py`, `**/*_pb.js`, `**/*_pb.ts`, `**/*_pb.d.ts`, and `**/*_grpc_pb.*`. Also exclude explicit generation suffixes such as `**/*.generated.*` and `**/*.gen.go`. These rules intentionally favor skipping over editing; no `--force` bypass in v1.
3. **Content markers:** use language-aware lexical/header inspection for conventional generator banners and standalone generated markers, including Go's `Code generated ... DO NOT EDIT.` convention, protoc's generated-code banner, and `@generated` in a file header. Inspect the complete leading comment region after any BOM/shebang, not an arbitrary first-N-lines window, so license notices cannot hide a later banner. Use exact, versioned marker patterns rather than treating every occurrence of “generated” as a marker. A known generated-region marker anywhere in an actual comment excludes the entire mixed file in v1. A matching phrase inside a string or a fenced documentation example does not mark the containing file as generated.

Some generators emit ordinary filenames, especially Java and Rust outputs; suffix detection cannot cover them. Missing or stripped generator headers cannot be inferred reliably. The enforceable guarantee for such projects is explicit exclusion of their generator outputs, ideally under dedicated directories. Do not infer output paths by executing generators or build scripts. Protobuf source `.proto` files are distinct from generated outputs and remain unsupported in v1, rather than being mislabeled generated.

Dry-run and JSON coverage expose `generated_path`, `generated_marker`, or `config_exclude`, together with the matching rule ID/glob and marker location where applicable. Show excluded-file counts and paths without copying source contents. `init` explains custom output exclusions; it does not silently rewrite generator configuration. A classification read failure makes a selected supported file unresolved/incomplete; never send the file because marker inspection failed.

Keep the generated-detection rule version in the in-memory run. Before writing, repeat path, policy, and generated-marker checks; newly excluded files must not be edited.

Phase 1 acceptance requires fixtures for protobuf outputs anywhere in the project, headers after long license notices, ordinary Java/Rust generated filenames, custom output paths, mixed generated regions, explicit-path attempts to bypass exclusions, and handwritten files quoting generator banners. A fake-provider integration test in Phase 2 must prove that excluded content appears in neither inference requests nor read-only context. Test that generated files remain byte-identical throughout a run.

## 4. Correction policy and model pipeline

Pipeline: discover → extract → filter glossary/suppressions → batch → propose → validate → revalidate → apply → log summary.

Use one bounded model call per batch. Group segments from the same file where practical. Keep editable segment IDs distinct from read-only context using separate structured request fields. If rendered as XML-style prompt sections, escape source text so it cannot close or introduce tags. Context is never an editable segment; prompt delimiters are guidance, not a validation boundary. Structured responses contain a `results` array with exactly one expected record per requested segment: `{ segmentId, proposals: [...] }`. An empty proposals array explicitly acknowledges review with no proposed changes. Each proposal contains `original`, `replacement`, `category` (`spelling` or `grammar`), and a short user-facing `reason`. The model does not provide authoritative filesystem paths or offsets. Never request hidden reasoning or use a model's self-reported confidence as an editing permission.

For each proposal, the validator must:

1. Check schema, size limits, known segment ID, allowed category, and nonempty/nonidentical strings.
2. Resolve `original` to exactly one occurrence inside the in-memory editable text of the record's requested segment ID, never in neighboring context or the whole file. Ambiguous occurrences are rejected rather than guessed; a wider original phrase can disambiguate.
3. Map to original UTF-8 byte ranges using extractor mappings. Never confuse JavaScript UTF-16 indices, parser offsets, bytes, and displayed columns.
4. Reject overlaps, protected-range changes, new delimiters/markup/control characters, and replacements that cross unmappable spans.
5. Require identical leading and trailing whitespace sequences in `original` and `replacement`, comparing exact characters without trimming or normalization. Preserve glossary tokens and syntax, and bound replacement length to prevent paragraph rewrites. Legitimate proposals exceeding limits are rejected with a diagnostic, not silently truncated.
6. Build a candidate file and verify format-specific invariants. Code outside permitted prose remains byte-identical; non-comment syntax stays identical, with a narrow allowance for eligible Python docstring contents. Markdown structure/destinations and documentation markup remain intact. Rust doc comments have a narrow allowance for prose changes in their desugared documentation attributes; preserve all other attribute and macro syntax. Such comments can be observed by documentation tooling and procedural macros, so do not claim universal behavioral equivalence. Combined corrections are validated again before writing.

Accept partial batches at proposal granularity while tracking coverage separately. Parse a complete, bounded JSON envelope first, then validate records and proposals independently rather than letting one invalid item reject the entire response. Provider adapters must preserve a parseable response for this validation even if whole-response schema validation fails. Retain in memory every independently valid, nonconflicting proposal from an unambiguously identified requested segment. Missing records remain unreviewed; rejected proposals leave their segment unresolved even when sibling proposals survive. Duplicate records for a segment invalidate that segment's records; reject unknown IDs and report a batch protocol error without discarding unrelated valid findings. Reject all proposals participating in an overlap rather than choosing by response order. Batch protocol errors and unresolved segments make the run incomplete, with exit 2; no corrections are applied from an incomplete run.

For example, if 48 of 50 requested segments return valid records and two are omitted, retain all validated corrections from the 48, report 48 reviewed and two unreviewed, and mark the run incomplete. An explicit empty proposals array counts as reviewed; an omitted segment does not. Coverage describes protocol completion, not a guarantee that the model detected every error. Keep per-segment coverage and safe rejection reasons in memory; report coverage counts and rejection codes in logs and JSON output. No automatic retry or repair request is added for missing records.

Malformed or truncated JSON is not salvaged with substring parsing, regex, or speculative repair; none of that response's proposals become eligible for application. Already validated findings from other responses survive. Models receive repository text strictly as data and have no tools, executable actions, or ability to change configuration. Prompt-injection defenses rely on these capability and validation limits, not prompts alone.

English text only in v1. Ask the model to leave other languages unchanged; do not claim reliable automatic language detection. Dialect selection avoids unsolicited dialect conversion. The glossary preserves exact, case-sensitive terms by default, including phrases; it is not a dictionary of forced replacements.

Support `spellagent-disable` / `spellagent-enable` as standalone comments appropriate to the file format, and `spellagent-disable-next-line` for the next physical line. Directives are protected and never sent as editable prose. Recognize them only in actual comments, not code examples. Disabled spans extend to EOF if not reenabled, with a warning; malformed/nested directives get diagnostics. Config path exclusions and glossary entries cover the other initial suppression needs. Persistent per-finding baselines are deferred.

## 5. Architecture and stack

Use one npm package with internal modules, not a service or a multi-package platform.

| Component | Choice and responsibility |
| --- | --- |
| Runtime/build | Node.js 24 LTS, TypeScript strict mode, ESM, npm lockfile; publish compiled JS |
| CLI | Commander; argument parsing and mapping errors to documented exit codes |
| UI | Interactive setup prompts; plain text/JSON run reporters; no review UI |
| Configuration/contracts | Zod schemas; reject unknown config keys and unsupported schema versions |
| Code parsing | Tree-sitter with pinned compatible JS/TS/TSX/Python/Java/Go/Rust grammars behind extractor adapters |
| Markdown parsing | Unified/remark parser with GFM support and positional source mapping; patch original source rather than serialize the AST |
| LLM access | Vercel AI SDK with direct OpenAI/Anthropic and explicit AI Gateway adapters; structured output validation |
| Local state | `.spellagentrc.json` and `.spellagent/logs/<run-id>.jsonl`; no result store or database |
| Verification | Vitest for core/fixture tests, CLI integration tests, and targeted terminal interaction tests |

Prefer packaged WASM Tree-sitter grammars to avoid user-side native builds. Phase 0 must prove runtime/grammar compatibility, package asset resolution, source positions, installation, and redistribution licenses. If WASM packaging fails the gate, record and validate a native-binding alternative before implementing extraction; never download grammars during a run. Exact package versions belong in the lockfile; section 11 records the dated feasibility inventory. The pinned web-tree-sitter WASM binding reports UTF-16 indices and columns, verified by Unicode probes; convert explicitly to UTF-8 byte offsets. Do not assume native binding offset conventions apply.

Suggested layout:

```text
src/
  cli/          # commands, exit codes, dependency composition
  core/         # contracts, policies, scheduler, lifecycle/events
  discovery/    # filesystem paths, include/exclude globs, explicit root
  extractors/   # markdown, javascript/typescript, python, java, go, rust, mapping
  llm/          # providers, prompts, structured responses, usage
  validation/   # proposed edit checks, format invariants
  apply/        # preflight and atomic per-file writes
  logging/      # audit events and summaries, no source/result persistence
  ui/           # setup prompts and plain/JSON reporters
  probes/       # developer-only parser and optional live probes
```

Core code must not import terminal UI modules or process-global CLI state. Inject provider, filesystem/logging, clock, and cancellation dependencies where tests need control. Emit typed events (`fileSkipped`, `batchCompleted`, `findingValidated`, `runFinished`) for reporters. Use a bounded worker queue, not unbounded `Promise.all` over a repository.

Core data contracts:

- `FileSnapshot`: normalized root-relative path, SHA-256 of original bytes, format, encoding/BOM/EOL metadata.
- `Segment`: deterministic ID, file snapshot reference, editable text, source map, protected ranges, bounded context.
- `Finding`: run-local stable ID, resolved byte range, exact original/replacement, category/reason, validation version, application disposition, notices.
- `Run`: ephemeral schema/tool/extractor/prompt versions, effective config, generated-detection version, scope, snapshots, findings, coverage, usage, timestamps, and status (`completed`, `incomplete`, `cancelled`, `failed`). Never serialize this source-bearing state to disk.
- `RunLog`: versioned, source-free audit summary with explicit provider/model/routes, times, status, coverage/finding/application counts, usage, and per-file before/after hashes and write states. Append sanitized diagnostic codes and write-intent/completion events during execution; logs are not executable input or replayable corrections.

Public reports use 1-based line/column locations, with columns defined as Unicode code points; byte offsets are explicitly named. IDs need only remain stable within one process run. Source changes require a new run.

## 6. Configuration and resource limits

Illustrative configuration after interactive setup. Model suggestions are bundled, dated choices; prices are not silently copied into billing configuration.

```json
{
  "schemaVersion": 1,
  "language": "en",
  "dialect": "en-US",
  "include": ["**/*.md", "**/*.{js,jsx,ts,tsx,mjs,cjs,mts,cts,py,pyi,java,go,rs}"],
  "exclude": [],
  "includeHidden": false,
  "glossary": ["authZ", "AST", "Vercel", "headless"],
  "provider": {
    "name": "openai",
    "model": "gpt-5.4-nano"
  },
  "limits": {
    "maxFileBytes": 1048576,
    "maxAgents": 32,
    "timeoutMs": 60000,
    "maxRetries": 2,
    "maxEstimatedUsd": null
  },
  "pricing": null
}
```

Precedence: explicit CLI overrides > project config > documented defaults. Environment variables provide secrets only; load a dotenv file only through explicit `--env-file`, without overriding existing environment variables. Keys never enter config, reports, prompts, or diagnostics. Do not load executable JS config or run repository scripts. No custom endpoint support in v1; local/provider-compatible servers are a later adapter feature.

Provider configuration is a discriminated union. Direct `openai` and `anthropic` connections use their native model IDs and `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`. The `gateway` connection uses a namespaced `vendor/model` ID and only `AI_GATEWAY_API_KEY`; direct-provider keys are not required or forwarded. Require an explicit nonempty `only` upstream allowlist for Gateway and pass it as `providerOptions.gateway.only`; a preference order alone does not constrain recipients. For example, replace the provider block with:

```json
{
  "name": "gateway",
  "model": "openai/YOUR_MODEL_ID",
  "only": ["openai"]
}
```

The placeholder must be replaced. Use an explicitly constructed AI SDK provider instance in every mode; never let a bare model string choose an implicit Gateway connection. Do not silently fall back between direct and Gateway connections or between models. Do not use ambient Vercel OIDC or per-request BYOK in v1. Model/route capability qualification must establish structured output, output limits, warnings, and usage handling. Gateway support does not imply every catalog model is qualified. Persist safe selected model and routing metadata where supplied; never persist gateway credentials or raw provider metadata wholesale.

`init` and dry-run remain offline even for Gateway: no catalog, model capability, pricing, credits, or authentication fetch. User-supplied pricing with an `asOf` date remains authoritative for local reservations. Gateway prices must cover the selected model on every allowed route and applicable billable token categories; unsupported charges preclude a dollar budget. Gateway-managed routing and server-side work may continue beyond the client's view or cancellation; preserve the existing distinction between estimated local spend and actual billing.

A non-null dollar budget requires explicit pricing for the selected model: `inputUsdPerMillionTokens`, `outputUsdPerMillionTokens`, and `asOf` date. Treat all input as uncached for conservative estimates. Models with extra charge categories require an adapter that accounts for them or cannot use a dollar budget. Unknown pricing must never be shown as zero cost.

Before each dispatch, reserve estimated input plus the adapter-computed output maximum against the run budget. Reservations include concurrent calls and retries. Reconcile with reported billable usage; retain the reservation as estimated spend when usage is unavailable, including ambiguous network failures. Report known and estimated usage separately. No promise of a hard provider billing cap: token estimation, pricing changes, hidden billable categories, and server-side work after cancellation can affect charges.

Use a model-compatible tokenizer where available, otherwise a documented conservative estimator. Reject unsupported model settings instead of silently discarding required output/usage limits. Input limits include instructions, schema, context, and text. Split batches to fit; never discard content silently.

Count every dispatched attempt in usage, including retries. There is no user-configurable total request cap. Disable SDK-level retries and implement one scheduler retry policy: retry transient network errors, 429s, and retryable 5xx responses with jitter and bounded `Retry-After`, at most twice and within the total request timeout. No automatic retry on authentication, schema, or policy errors. No hidden output-repair loop. Stop scheduling when a resource limit is hit; preserve completed work and mark the run incomplete.

### Model suggestions and scheduling

Bundled suggestions checked 2026-09-20: direct OpenAI `gpt-5.4-nano`, direct Anthropic `claude-haiku-4-5-20251001`, Gateway `openai/gpt-5.4-nano` with a separately confirmed `only: ["openai"]`. These are initial low-cost, fast candidates, not a claim of measured best quality or minimum total cost for this workload. Official references: [OpenAI nano](https://developers.openai.com/api/docs/models/gpt-5.4-nano), [Anthropic Haiku](https://platform.claude.com/docs/en/models/haiku-4-5/overview), [Gateway listing](https://vercel.com/ai-gateway/models/gpt-5.4-nano). Setup offers a custom model override. Updating recommendations is a reviewed release change and never changes existing config. Phase 2 live capability checks and Phase 4 precision/recall and cost measurements must qualify these candidates before v1.

`limits.maxAgents` defaults to 32 and accepts any positive safe integer; users may raise or lower it during setup. It caps simultaneous model calls, including retries, not autonomous agents with tools or separate OS processes. The scheduler starts conservatively, ramps within this ceiling, respects available provider request/token reset information and `Retry-After`, and lowers dispatch pressure after 429s. Limits vary by account, model, and Gateway route; a static worker count cannot establish RPM/TPM compliance. Setup explains this without fetching account limits.

Remove `concurrency`, `maxRequests`, `maxInputTokensPerRequest`, `maxOutputTokensPerRequest`, and `storage` from the public schema; reject them as unknown keys. Model adapters own documented, tested context/batch/output bounds and include instructions, schema, and context in calculations. These internal bounds remain necessary for safe requests and budget reservations; removing config knobs does not mean unlimited token generation. Qualify bounds per supported model; unsupported custom models fail with an actionable capability error instead of silently ignoring limits. Scheduling, adaptive throttling, and these production capabilities are Phase 2 work, not claimed by Phase 0.

## 7. Safe application and local logs

`run` works on current local contents, including pre-existing edits. It does not inspect version-control status or require a clean working directory. After complete inference and validation, apply all accepted nonconflicting corrections automatically. A dry run never writes source; an incomplete inference run also never writes source.

1. Acquire a project application lock under `.spellagent/`. Preflight the entire set of corrections before the first write. Reject root escapes, symlinks, hard-linked targets, changed roots/config, generated files, and invalid source mappings. Check config/log paths against symlink traversal too.
2. Compare complete current-file hashes with the in-memory snapshots. Any file changed since discovery rejects the entire preflight; do not rebase offsets or fuzzy-match. This protects concurrent edits, not a version-control baseline.
3. Re-extract current source, verify permitted ranges and syntax, reject overlaps, and build each candidate using UTF-8 `Buffer` byte slices and `Buffer.concat`. Never apply byte offsets to JavaScript string slicing or rebuild untouched bytes by decoding/re-encoding. Preserve unrelated bytes, BOM, line endings, final newline, and mode.
4. Write and flush a source-free intent log with before/after hashes before replacement. Prepare temporary files in target directories, recheck hashes immediately before replacement, and use per-file atomic rename. Record and flush each completed replacement. If logging fails, stop before further writes. A lock coordinates SpellAgent processes only; arbitrary editors can still race between the final check and rename. Document this limitation.
5. On write failure or cancellation, stop further replacements and report exactly which files were replaced, pending, or uncertain. Multi-file writes are not globally atomic. After a crash, the next `run` validates logs as untrusted data (schema, root-relative paths, no symlink traversal) and reconciles unfinished intents against before/after hashes, reports uncertainty/conflicts, and exits 2 before starting inference. Users inspect affected files and archive the unresolved log before a fresh run. Never automatically roll back or overwrite later user edits.

Configuration persists in root-level `.spellagentrc.json`; append-only run logs persist under `.spellagent/logs/`, using restrictive permissions where supported. No saved findings, selections, source snapshots, full prompts, raw provider bodies, backups, recovery journal, result cache, or retention configuration. Temporary candidate files exist only for atomic writes; clean up owned temporaries on normal exit and report possible leftovers after a crash. Logs contain paths, locations/counts, hashes, provider/model, usage/cost, bounded diagnostic codes, and write outcomes; omit prose excerpts, replacements, secrets, and arbitrary provider error strings. The final `RunLog` summary is schema validated. Logs remain until users delete/archive them manually; there is no automatic pruning or run-management command. They cannot resume inference or reapply edits. Users review local changes with their own tools.

## 8. Quality and release acceptance

Deterministic tests require no credentials or network. Use a fake provider with fixtures for malformed output, partial completion, duplicate text, overlapping edits, timeouts, rate limits, cancellation, and missing usage. Real-provider evaluations are explicit, cost-limited developer commands, never default unit tests.

Partial-batch contract tests must cover 48 returned records out of 50, explicit empty proposal arrays, missing/unknown/duplicate segment IDs, invalid proposals alongside valid siblings, overlapping proposals, and truncated JSON. Assert retained findings, per-segment coverage, incomplete exit status, and no source writes for incomplete inference. Include whitespace-boundary changes and context-only matches as rejected proposals, and multibyte text before multiple edits to verify Buffer-based patching.

Safety fixtures must cover CRLF/LF, UTF-8 BOM, emoji/non-Latin prefixes, repeated words, comment prefixes, protected directives, Go build/embed/generate directives and cgo preambles, Rust nested comments and rustdoc hidden test lines, Java Unicode escapes and Javadoc snippets, escaped/concatenated Python strings, doctests, Markdown links/code/tables, newly introduced delimiters, dirty files, stale hashes, symlink/path escapes, interrupted writes, log failures, and crash reconciliation conflicts. Assert that all bytes outside accepted ranges remain identical and executable syntax is unchanged under the documented Python docstring and Rust documentation exceptions.

CLI tests must prove operation without Git installed, no subprocess invocation or GitHub network requests, no reads/writes of version-control metadata, and identical scope with or without a `.git` directory. CLI tests also cover interactive-only initialization (including scripted answers and EOF), missing/invalid config before discovery or credential access, hidden defaults/override, and non-TTY runs, JSON purity, exit precedence, empty scopes, ignored versus failed files, and deterministic ordering. Terminal tests cover setup prompts, confirmation cancellation, scripted input, resize, and restoration after Ctrl+C. Run tests prove no review/apply prompts in TTY or headless mode. Validate installation from `npm pack` on macOS and Linux, including bundled parser assets. Windows testing is not required; report it as unverified.

Create a manually labeled evaluation corpus of at least 300 English prose segments (at least 40 per code-language family and 40 Markdown segments, with the remainder distributed across edge cases) covering every initial extractor, both dialects, clean prose, domain terminology, genuine errors, and protected syntax. Reserve a held-out subset. Before v1, target at least 95% precision among emitted corrections and 80% recall of labeled, in-scope spelling/grammar errors; report exact counts, categories, and multiple runs instead of claiming universal accuracy. Require zero protected-syntax edits in the safety fixture suite. These are release targets to measure, not current results. If unmet, narrow supported patterns or improve prompts/extraction and reevaluate.

Record elapsed time, request counts, tokens, and cost on a fixed public fixture repository for each supported provider/model pair. Bundled low-cost suggestions require release qualification; they are not automatically changing remote defaults.

## 9. Phased implementation with Codex CLI

Each phase is a bounded implementation task. Read this design and repository instructions first, implement only the phase and its prerequisites, run its relevant checks, and report changed files, evidence, and remaining limitations. Update this document when a proven technical constraint changes a decision. Do not commit or push without explicit user approval. Do not proceed past a failing phase gate by silently dropping a requirement.

### Phase 0 — Feasibility and contracts

Create the TypeScript package skeleton, schemas, fake provider, and small extraction/packaging probes. Prove WASM parser compatibility for every initial language family (including TSX) plus Markdown positions, including Unicode/CRLF. Verify pinned AI SDK structured output and direct OpenAI/Anthropic plus Gateway provider option handling using mocks; provide an optional live smoke command using existing credentials. Establish package asset/license inventory and document resolved versions.

Exit: a packed installation can parse fixtures and map exact bytes on the required macOS and Linux targets, contracts are typechecked, and parser packaging choice is settled. No paid call is required for the default checks.

### Phase 1 — Offline discovery and extraction

Implement root/config resolution, `init`, `run --dry-run`, filesystem-only inclusion/exclusion semantics, all initial extractors, glossary/protection/suppression policy, and coverage reporting. Build the safety fixture corpus alongside the adapters. Implement in reviewable slices: Markdown and JS/TS first, then Go and Rust, then Python and Java. All five code-language families are required before closing this phase; the slices are not separate reductions in v1 scope.

Exit: dry run is useful without credentials, explains scope, and every emitted editable span round-trips to its exact original bytes. Unsupported/unsafe patterns are visible and never treated as editable prose.

### Phase 2 — Proposals, scheduling, and logs

Add production direct OpenAI/Anthropic and Gateway adapters, model-specific internal bounds, `maxAgents` scheduling with rate-limit feedback, resource accounting, structured validation, source-free run logs, text/JSON reporting, cancellation, and run exit codes. Source editing remains unavailable at this intermediate development gate; clearly label that limitation until Phase 3 completes the intended `run` behavior. No resumable results.

Exit: all three adapters pass contracts; opt-in live qualification works for selected models; malformed/partial/failed batches have correct coverage/status; interruption preserves audit logs without source excerpts; files remain byte-identical; mock tests prove active requests never exceed `maxAgents` and throttling/retries respect limits.

### Phase 3 — Automatic safe application: first usable release

Complete `run` with automatic application, whole-run preflight, project lock, per-file atomic writes, durable write events, and crash reconciliation. No interactive review, separate apply command, saved selections, backups, or recovery command.

Exit: an initialized developer can run corrections on already modified files and inspect local changes afterward. TTY and headless behavior agree. Incomplete inference does not edit files. Stale inputs, conflicting edits, crashes, partial writes, and logging failures satisfy section 7. All safety tests pass.

### Phase 4 — v1 qualification

Qualify the evaluation corpus, macOS/Linux packaging, accessible/plain rendering, performance, error guidance, and documentation. Document interactive setup, normal runs, offline scope previews, and manual review of local changes. `run --format json` applies corrections; `run --dry-run --format json` is offline and read-only. Document scripted answers through the same setup prompts.

Exit: section 8 targets are measured and met, install/use and interrupted-write instructions are reproducible, and a supported provider/model matrix with evaluation dates is published. Package publication requires separate authorization.

### Later, only after v1 evidence

Evaluate an optional reviewer pass that can accept/reject existing proposals, with its own budget reservation; require a measured improvement before enabling it. Consider changed-file scanning using local content-hash snapshots (never Git history/status), persistent baselines, inference caching, local models/custom endpoints, more languages, marked user-facing strings, and SARIF. Each expansion must define its own extraction, privacy, accounting, and edit-safety contracts. Confidence-only editing and general-purpose agent tool execution remain outside this design.

## 10. Technical references

References checked during design; reverify version-specific APIs at implementation time.

- [Node.js release status](https://nodejs.org/en/about/previous-releases): Node.js 24 is LTS; Node.js 18 is end-of-life.
- [Tree-sitter Node bindings](https://tree-sitter.github.io/node-tree-sitter/index.html): parsers require language-specific grammars; bindings and source positions must be validated in the packaging probe.
- [AI SDK structured output](https://ai-sdk.dev/docs/reference/ai-sdk-core/output): schema-backed structured generation; application validation remains required.
- [AI SDK settings](https://ai-sdk.dev/docs/ai-sdk-core/settings): output limits and retry controls vary in provider support; adapters must check capabilities.

- [2025 Stack Overflow technology survey](https://survey.stackoverflow.co/2025/technology): an adoption reference for language selection, not a universal market ranking.
- [Go documentation comments](https://go.dev/doc/comment) and [Go comment directives](https://go.dev/wiki/Comments): protect tool directives and documentation structure.
- [Rust documentation tests](https://doc.rust-lang.org/rustdoc/documentation-tests.html): documentation code blocks can be executable tests and must remain protected.
- [JavaDoc guide](https://docs.oracle.com/en/java/javase/24/javadoc/javadoc-guide.pdf): documentation tags and snippets require dedicated protection.

- [Protobuf Go generated-code guide](https://protobuf.dev/reference/go/go-generated/): standard Go protobuf output uses `.pb.go` filenames.
- [Go generated-file detection](https://pkg.go.dev/go/ast#IsGenerated): the standard library recognizes the conventional generated-code comment.

- [AI SDK Gateway provider](https://ai-sdk.dev/providers/ai-sdk-providers/ai-gateway): explicit Gateway instances, namespaced models, and API key authentication.
- [Gateway routing](https://vercel.com/docs/ai-gateway/models-and-providers/provider-options): use a hard upstream allowlist rather than only provider preferences.
- [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs): provider schema constraints do not replace local edit validation.

## 11. Phase 0 implementation evidence

Recorded 2026-09-20. The original Phase 0 baseline passed implementation, contract, and
packed-install checks on macOS arm64 and Linux arm64. Windows testing was
removed from required qualification at the user's request on 2026-09-20; it remains
unverified. This does not claim coverage of other CPU architectures or Linux distributions.
The revised Phase 0 also passed on both targets on 2026-09-20 with Node 24.14.1:
`npm run check` (24 tests and eight parser probes), `npm run test:pack`, and
`npm run test:linux` (Docker Linux arm64 checks plus local/global packed installs
with networking disabled after dependency/cache preparation). No live inference,
publication, commits, or pushes were performed for this revision.

The revision replaces concurrency/request/token/storage configuration with
`maxAgents` (default 32), adds hidden-path opt-in and explicit root config/separate log paths,
removes saved-selection/application-journal contracts, introduces a separate
source-free log summary, and bundles dated model suggestions. Parser probes now
run through `npm run probe` / `dist/probes/offline.js`, outside the product CLI.
Regression tests cover rejected legacy config keys, valid/invalid agent ceilings,
hidden defaults/override, excluded source-bearing log fields, and unavailable CLI
commands. `init` and `run` remain later-phase work; no new runtime feature or live
model qualification is implied by these contract checks.

The subsequent config-location correction restores root-level `.spellagentrc.json`
and keeps logs in `.spellagent/logs/`. Host checks and offline packed installs
passed again; Linux was not rerun for this path-constant/documentation correction.

### Delivered foundation

- One private MIT-licensed npm package, strict TypeScript ESM, Node.js 24 minimum,
  pinned dependencies and lockfile, an executable CLI with help/version and a separate developer-only offline probe.
- Versioned Zod contracts for config, snapshots, segments/source maps, ephemeral findings/runs,
  per-segment coverage, usage, and source-free run-log summaries; typed lifecycle events.
  Schemas establish data shapes and basic invariants. They are not a substitute for
  the filesystem, cross-reference, source-map, and patch validation required in later phases.
- A deterministic fake provider and AI SDK transport probes for direct OpenAI,
  direct Anthropic, and Vercel AI Gateway. Mocked HTTP exercises each real adapter,
  schema output, required options, usage, and disabled SDK retries. Complete JSON
  survives item-schema failure via `NoObjectGeneratedError.text`; malformed JSON is
  rejected. These are untrusted transport results, not application-ready findings. Proposal
  salvage, coverage aggregation, budgets, and production adapter qualification remain Phase 2.
- An optional explicit `--allow-paid` smoke command, with existing environment keys,
  a synthetic sentence, one client dispatch, 512 maximum output tokens, and a
  30-second timeout. Gateway additionally requires `--only` upstream selection.
- Seven official packaged WASM grammars, their MIT notices, and a generated asset
  inventory with SHA-256 hashes. No native build, install lifecycle script, or parser
  download at runtime. Markdown parsing uses remark with GFM positions.
- README development/distribution instructions, `.env.example`, `.gitignore`, and
  AGENTS instructions. These three Markdown documents (AGENTS, README, this plan)
  are the maintained documentation; LICENSE and generated upstream notices are legal artifacts.

### Evidence and outstanding gates

| Gate | Result |
| --- | --- |
| Strict typecheck and offline tests | Passed: 24 tests on both macOS arm64 and Linux arm64 / Node 24.14.1 |
| JS, TS, TSX, Python, Java, Go, Rust WASM compatibility | Passed with Unicode and LF/CRLF fixtures |
| Exact source-byte mapping | Passed: accented text, emoji, combining characters, CRLF; surrogate-splitting offsets rejected |
| Markdown/GFM positions | Passed for Unicode/CRLF paragraph and table fixtures |
| Provider contracts | All three connections pass mocked transport checks; no live models qualified yet |
| Packed installation, macOS arm64 | Passed: isolated local and global production-only installs, executable shims, unrelated working directory, all eight parser probes |
| Packed installation, Linux arm64 | Passed in Docker: local/global production-only installs, executable shims, unrelated cwd, all eight parser probes, networking disabled |
| Packed installation, Windows | Unverified; intentionally not tested and not a required gate |
| Runtime/grammar packaging choice | Official packaged WASM chosen; no native fallback needed on tested host |
| Licenses | Project and bundled grammars MIT; verbatim grammar notices included and checked |

Repeat host checks using Node.js 24 and npm. Explicit cache preparation accesses
the npm registry; subsequent checks and packed installs work offline:

```sh
npm ci
npm run prepare:pack-cache
npm run check
npm run test:pack
```

Record OS, architecture, Node version, and pass/fail evidence here when changing
the qualified platform matrix. The packaging test installs into temporary local and global prefixes,
uses only npm's populated cache, disables install scripts, checks license assets,
and resolves parsers independently of cwd. It never installs into the user's normal
global prefix. Windows-specific branches in the packaging script remain unexecuted;
no Windows testing or support claim is part of the current qualification scope.
The suite is portable, but portability is not evidence that an untested OS passed.

### Linux Docker verification

Run `npm run test:linux` with Docker running. The development script uses the official
`node:24.14.1-bookworm-slim` image pinned to manifest digest
`sha256:b506e7321f176aae77317f99d67a24b272c1f09f1d10f1761f2773447d8da26c`.
The recorded run used Linux aarch64, Node 24.14.1, and npm 11.11.0 on Docker Desktop.

Source inputs are copied without macOS extended attributes or AppleDouble sidecars.
No host `node_modules`, credentials, run logs, or version-control metadata are copied.
A temporary volume holds the Linux installation and npm cache. Network access is
available only for initial image/dependency/cache preparation; a second container
runs `npm run check` and `npm run test:pack` with `--network none`. Both containers
use a project path containing spaces. Containers and volume are removed on completion;
the image remains in Docker's cache.

A clean `npm ci` alone does not populate all package metadata needed to resolve a
fresh packed installation. `npm run prepare:pack-cache` explicitly warms that cache
using a temporary install and checks the archive. It permits registry access;
`npm run test:pack` never implicitly fetches missing entries.

Recorded offline result:

```text
Platform: linux/arm64; Node v24.14.1; npm 11.11.0
Strict typecheck and build: passed
Test files: 4 passed; tests: 24 passed
Parser probes: 8 passed (7 code grammars and Markdown)
Local and global packed installs: passed
Production-only dependencies: passed
Offline installation: passed with Docker networking disabled
```

### Resolved dependency inventory

This table is a dated implementation record, not a floating upgrade recommendation.
`package-lock.json` remains authoritative for exact direct/transitive versions and
registry integrity hashes. Build output `assets/inventory.json` adds WASM file hashes.
The runtime WASM belongs to the installed `web-tree-sitter` package and retains its
license; copied grammar assets carry licenses in `assets/licenses/`.

| Dependency | Resolved version | License | Role |
| --- | --- | --- | --- |
| `@ai-sdk/anthropic` | 4.0.58 | Apache-2.0 | Runtime |
| `@ai-sdk/openai` | 4.0.71 | Apache-2.0 | Runtime |
| `ai` | 7.0.107 | Apache-2.0 | Runtime |
| `commander` | 15.0.0 | MIT | Runtime |
| `remark-gfm` | 4.0.1 | MIT | Runtime |
| `remark-parse` | 11.0.0 | MIT | Runtime |
| `unified` | 11.0.5 | MIT | Runtime |
| `web-tree-sitter` | 0.27.0 | MIT | Runtime |
| `zod` | 4.6.5 | MIT | Runtime |
| `@types/node` | 24.13.6 | MIT | Development/build only |
| `tree-sitter-go` | 0.25.0 | MIT | Development/build only |
| `tree-sitter-java` | 0.23.5 | MIT | Development/build only |
| `tree-sitter-javascript` | 0.25.0 | MIT | Development/build only |
| `tree-sitter-python` | 0.25.0 | MIT | Development/build only |
| `tree-sitter-rust` | 0.24.0 | MIT | Development/build only |
| `tree-sitter-typescript` | 0.23.2 | MIT | Development/build only |
| `typescript` | 7.0.2 | Apache-2.0 | Development/build only |
| `vitest` | 5.0.1 | MIT | Development/build only |
| `@ai-sdk/gateway` (via `ai` export) | 4.0.87 | Apache-2.0 | Runtime transitive adapter |

No Ink/React dependency is needed for a removed review UI. Interactive setup, discovery, generated-file exclusion, prose protection, automatic application, logging, and production scheduling/inference are not implemented in Phase 0.

## 12. Phase 1 implementation evidence

Implemented and verified 2026-09-20. The final offline checks passed on the required
macOS and Linux platforms; no credentialed or paid live probe was run.

### Implemented scope

- `spellagent init` is a line-oriented interactive setup flow for terminals and
  scripted stdin. It refuses overwrites, makes no API calls, previews the strict
  configuration, explains provider disclosure/local writes/source-free logs, and
  writes root-level `.spellagentrc.json` with restrictive permissions where supported.
- `spellagent run --dry-run` requires and validates that root's config before
  discovery. It performs no credential access, inference, logging, or source writes,
  and emits either plain text or one versioned JSON object. Non-dry execution remains
  explicitly unavailable until Phases 2–3.
- Discovery uses only local filesystem APIs and explicit root/cwd path resolution.
  It does not follow symlinks or inspect Git metadata. Root-relative brace and `**`
  globs, hidden-path policy, mandatory safety exclusions, config exclusions, supported
  formats, strict UTF-8, BOM/EOL metadata, binary detection, and the 1 MiB default
  limit are applied deterministically. Explicit paths cannot bypass exclusions.
- Generated-file policy includes versioned protobuf/gRPC/minified/generated filename
  rules and syntax-aware inspection of actual comments/Markdown HTML comments for
  conventional generated markers. Reports include the matching rule or marker line.
- Markdown extraction covers AST text in headings, paragraphs, lists, blockquotes,
  link labels, image alt text, and GFM tables while protecting frontmatter, HTML,
  inline/indented/fenced code, destinations, definitions, explicit anchors, and
  structural markup. Heading segments carry `anchor_may_change`.
- Tree-sitter adapters cover JavaScript/TypeScript/TSX, Go, Rust, Python, and Java.
  They restrict editable text to comments plus syntactically identified Python
  docstrings, and conservatively protect compiler/tool directives, doc examples,
  Go directives/cgo preambles, rustdoc fences/hidden lines, Javadoc markup/snippets,
  Java Unicode escapes, Python doctests, and unsafe escaped docstrings.
- Standalone suppression directives, case-sensitive glossary terms, URLs, paths,
  placeholders, and CLI-style identifiers are protected. Every emitted segment has
  a deterministic file-scoped ID and an exact UTF-16-to-UTF-8 source map; protected
  and unsupported constructs produce source-free diagnostic codes.
- A six-format safety fixture corpus and offline discovery/extractor tests were added
  for Unicode, exact byte round trips, protected syntax, hidden/config/generated
  exclusions, symlinks, and explicit-path bypass attempts.

### Verification evidence

- macOS arm64, Node 24.14.1: `npm run check` passed typecheck, build, all 30
  tests across 6 files, and the offline probe for all 8 parser targets.
- macOS arm64, Node 24.14.1: `npm run test:pack` passed offline local and global
  tarball installs with no development dependencies required.
- Linux arm64 (`node:24.14.1-bookworm-slim`): `npm run test:linux` passed the same
  30 tests and 8-parser probe, then passed the packed local/global install check in
  a fresh container with networking disabled.
- `git diff --check` passed. Phase 1 has no unresolved automated platform gate.
