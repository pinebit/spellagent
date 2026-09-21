# Phase A implementation and verification handoff

Historical Phase A handoff; see plan.md section 15 for the subsequent
qualification attempt, Phase B changes, and user-directed Claude deferral.

Status at the original handoff: implementation candidate, 2026-09-21. macOS/Linux arm64 offline checks,
packaged extraction, Codex manifest/skill validation, and Claude manifest validation
passed; live host gates remain unresolved.
[plan.md](plan.md#14-adoption-and-phase-a-status) records the
verification evidence and remains the governing design. No host installation or
live model evaluation has been performed.

## Scope

This is an installation, parser, transport, and model-selection feasibility slice,
not a proofreading release. Ten bundled synthetic fixtures exercise eight parser
formats, multiple pages, Unicode/CRLF, and an oversized-segment skip. Arbitrary
paths, project configuration, source text input, and writes are not supported.
The provisional fixture operations are development-only and will be replaced by
the discover/extract/apply interface in subsequent phases.

## Source and package layout

`plugins/shared/workflow.md` is the single maintained workflow. Host instruction
sources are `plugins/codex/check.md` and `plugins/claude/check.md`. Packaging copies
them into each artifact as `skills/check/SKILL.md` and adjacent `workflow.md`.
Edit these sources, not generated artifacts. Manifests live under the respective
`plugins/<host>/spellagent/` directories. These source directories alone are not
installable; they lack generated skills and runtime dependencies.

`npm run build:plugins` assembles `build/plugins/<host>/spellagent/`:

```text
spellagent/
  [host manifest]
  LICENSE
  skills/check/{SKILL.md,workflow.md}
  runtime/
    package.json
    dependencies.json
    dist/{plugin,extractors}/
    assets/                 # grammar WASM, licenses, hash inventory
    node_modules/           # locked parser/runtime dependency closure
```

Codex includes root `plugin.json` plus `.codex-plugin/plugin.json` compatibility
metadata. Claude includes `.claude-plugin/plugin.json`. Versions are generated
from package.json. Package assembly is offline after dependencies are installed;
it refuses missing/changed dependency versions and unreviewed optional packages.
Dependency package contents retain upstream licenses and runtime WASM.

No personal marketplace or host settings are modified. Distribution catalogs
and publication are later work. Node.js 24+ is required on the recipient machine.

## Provisional JSON protocol

Invoke `node <installed-plugin>/runtime/dist/plugin/helper.js` with exactly one
UTF-8 JSON document on stdin, then close stdin. No command arguments. Input is
bounded to 4 KiB. Stdout is one JSON object with `ok` and `protocolVersion: 1`.
Errors have source-free `code` and exit 2; success exits 0. Never interpret parser
exceptions or stack traces as protocol output.

List fixtures:

```json
{"protocolVersion":1,"operation":"list-fixtures"}
```

First extraction page:

```json
{"protocolVersion":1,"operation":"extract-fixture","fixture":"pages","cursor":0}
```

For continuation, send the returned `nextCursor` and `snapshotHash`. Stop when
nextCursor is null. Each response contains totalSegments, editable segments,
readOnlyContext, skipped segment IDs/reasons, diagnostics, and notices. At most
32 segment/skip records and 12,000 UTF-16 code units of prose/context per page;
JSON metadata/escaping are additional overhead. Oversized segments are explicitly
skipped in Phase A, not truncated. Source maps stay internal. Hashes identify
fixture bytes, not user-file freshness qualification.

No config, source, proposal, or log files are written. Host conversation/tool
retention is outside the helper's control. The helper has no LLM, networking, or
subprocess path. Scripts under scripts/ are development tools, not product code.

## Offline verification

The user authorized end-of-session verification on 2026-09-21. `npm run check`
and `npm run test:pack` passed on macOS arm64 (Node 24.14.1, npm 11.12.1).
After Docker was started and sandbox socket access authorized, `npm run test:linux`
passed on Linux arm64 (Node 24.14.1, npm 11.11.0), including the same 35 tests,
eight parser probes, and both plugin package checks with networking disabled.
The new package check copies artifacts outside the repository
and invokes Node from an unrelated directory with spaces, without host credentials.
It is not proof of host installation or model selection.

The Codex plugin-creator and skill-creator validators passed after PyYAML was
fetched into an isolated temporary uv environment. No system or project
dependencies or host configuration were changed. This checks the compatibility
manifest and skill structure, not portable-manifest ingestion or agent behavior.
Claude Code 2.1.261's `claude plugin validate` passed for the generated Claude
artifact. This is manifest validation, not proof of fork/frontmatter behavior,
model selection, or installed skill execution.

`scripts/test-pack.mjs`, `prepare:pack-cache`, and `pack:local` retain the historical
npm CLI packaging workflow temporarily. `npm run test:pack` now points to
`scripts/test-plugin-pack.mjs`; Linux no longer prepares a CLI install cache.
Legacy CLI/provider dependencies and tests remain until Phase B removes them.

## Opt-in host matrix

Only after explicit permission to install/run a live evaluation, test each host
on macOS and Linux. Copy/load the built artifact using the selected host's current
documented local-plugin workflow. Do not install the incomplete source template.
Record client versions and installation commands actually used; no minimum Codex
version has been qualified. Claude foreground fork configuration requires
2.1.218+ according to its current documentation, but is not yet locally verified.

For each host/platform:

1. Confirm discovery of check and resolution of the packaged helper from a
   read-only installed directory and unrelated working directory with spaces.
2. Invoke a synthetic preview and account for all pages/skips without truncation
   or source-bearing transport files. Confirm no runtime npm install/download.
3. Explicitly evaluate one worker: Codex requests gpt-5.6-luna/low; Claude's fork
   requests haiku and foreground return. Record the effective model if exposed.
   Unknown effective identity is unverified, not a pass. Exercise user override,
   unavailable model, and organizational policy substitution without fallback.
4. Confirm summary reaches the invoking turn, zero source writes, no nested
   delegation, and correct disclosure of the deliberately skipped fixture.
5. Record OS/architecture, Node/client versions, requested/effective model,
   date, outcomes, and unresolved gates in plan.md. Do not record private
   source/transcripts or invent cost/usage measurements.

The Claude wrapper cannot change a fork's model through prose arguments after
launch. Host-level override behavior is an explicit feasibility gate; if the
selected client cannot support it without silently substituting a model, stop
and revisit the wrapper before marking Phase A complete.

## Documentation basis

Host configuration was informed by the current [OpenAI plugin packaging guide](https://developers.openai.com/plugins/build/plugins),
[Codex subagent guide](https://learn.chatgpt.com/docs/agent-configuration/subagents),
and [Claude skill reference](https://code.claude.com/docs/en/skills).
Instruction and manifest structure are implementation choices, not evidence of
successful installed behavior. No automatic cheapest-model guarantee is made.
