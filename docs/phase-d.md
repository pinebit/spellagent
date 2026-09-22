# Phase D qualification handoff

Status: qualification and measurement work is complete for both hosts; the
measured precision/recall does not yet meet plan.md section 12's release
targets, and one `claude plugin eval` sandbox bug remains open (see below).
This document accumulates evidence as it is gathered; see docs/plan.md's
status line and section 18 for the closing summary.

## Claude Code installed-host smoke test — 2026-09-21

Environment: Claude Code 2.1.278, macOS (Darwin) 27.0 arm64, model
`claude-haiku-4-5-20251001` (the host's `haiku` alias).

Registered the repository as a local marketplace (`.claude-plugin/marketplace.json`,
`source` paths relative to the marketplace root, not the `.claude-plugin/`
directory — an initial attempt using a `../`-relative source failed validation
with "source: Invalid input" until corrected) and installed `spellagent` at
`user` scope so it is available outside the repository itself. An initial
install at `local` scope did not activate the skill when invoking from an
unrelated scratch directory; `user` scope is required for a workflow that
targets arbitrary project roots the way this plugin is designed to.

**Headless invocation finding:** a plain natural-language `-p` prompt (e.g.
"Preview the scope of /tmp/...") run headlessly under `--model haiku` did not
reliably auto-select the installed skill — the model answered with its own ad
hoc directory summary instead of invoking SpellAgent. Prefixing the prompt with
the explicit skill invocation, `/spellagent:check <request>`, reliably
triggered the skill every time. Interactive Claude Code sessions may have
different auto-selection behavior; this finding is specific to headless `-p`
invocation and is recorded here as a harness detail for reproducing this
evidence, not as a workflow-instruction defect.

Ran all three modes against a scratch fixture at `/tmp/spellagent-claude-smoke/README.md`
(one file, two deliberate misspellings: "documnet" → "document", "mstake" → "mistake"):

- **Scope preview** (`/spellagent:check preview the scope of ...`): reported
  "1 eligible file with 2 segments; 6 paths skipped (unsupported formats); no
  files changed; zero model-reviewed segments," correct effective settings, and
  made no model call. File confirmed byte-identical afterward (md5
  `50c6219e044033ea499f8fb6a09e5f8e` before and after).
- **Correction preview** (`/spellagent:check preview corrections for
  .../README.md`): validated both corrections with categories and reasons,
  reported "no files changed," and the file was confirmed unchanged afterward.
- **Correct** (`/spellagent:check check /tmp/spellagent-claude-smoke`): applied
  both corrections, reported "2 corrections applied across 1 file" with a
  per-file breakdown and coverage summary, and the file's on-disk content was
  independently confirmed corrected. `.spellagent/logs/2026-09-21.jsonl` was
  created under the scratch project with exactly two source-free events
  (`write_intent`, `write_complete`) containing only timestamps, path, hashes,
  and proposal count — no prompts, source text, or proposals.

**Minor observation:** the Correct run's final response appended an unprompted
sentence suggesting a `--recursive` flag ("add `--recursive` to expand the
search scope") that is not part of SpellAgent's actual interface — a small
model-invented addition, not a workflow-instruction defect (no such flag
appears in `plugins/shared/workflow.md`). Noted here as a limitation of
model-generated prose; not a correctness issue since no such flag was invoked
or implied to exist as fact.

This closes Phase A's previously open "installed plugin discovery/invocation,"
"foreground summary return," and "read-only installed directory" gates for
Claude Code (see docs/plan.md section 14's unresolved-gates list), and lifts
the user's standing deferral of Claude qualification recorded in section 15.

The plugin was uninstalled from both `local` and `user` scope after this
evidence was gathered, at the user's explicit request, pending full review of
this session's changes; the `spellagent-marketplace` local marketplace
registration was left in place for convenience when reinstalling.

## Live cancellation test — 2026-09-21

Environment: Claude Code 2.1.278, macOS (Darwin) 27.0 arm64, model `haiku`.
Built a 12-file scratch fixture (`/tmp/spellagent-cancel-smoke/doc1.md`…`doc12.md`),
each with one deliberate misspelling, started `/spellagent:check check
/tmp/spellagent-cancel-smoke` headlessly, polled every 10s for the first
completed file, and sent `SIGINT` to the running `claude` process (via `pkill
-INT -f`) the moment exactly one file had changed (at ~50s into the run).

**On-disk safety, independently verified:** exactly one file (`doc1.md`) was
cleanly corrected end-to-end (its sentence reads correctly, both misspelling
and typo fixed); the other 11 files were untouched, byte-identical to their
original content; `.spellagent/logs/2026-09-21.jsonl` contains exactly one
matched `write_intent`/`write_complete` pair for `doc1.md` and nothing else;
no `write.lock` or other temporary file was left behind. This matches the
required safety property from docs/plan.md section 8: previously completed
files remain changed, no partial or corrupted write occurred, and there is no
false claim of repository-wide atomicity.

**Gap — conversational cancellation report not captured:** `claude -p
--output-format json` returned an effectively empty result envelope
(`num_turns: 0`, no `result` text) for the interrupted run, both in this
attempt and two earlier attempts that were killed too early to make any
progress. This indicates headless `-p` mode does not give the agent a chance
to produce a graceful final Result/What changed/Needs attention/Coverage
report after `SIGINT` — the process appears to terminate immediately rather
than run the same interrupt-and-summarize path an interactive session might.
This is recorded as an open gap in this specific test method, not a verified
pass or fail of the workflow instruction itself (docs/plan.md section 2's
cancellation reporting requirement): the on-disk safety behavior is confirmed;
the conversational report text was not observed and would need an interactive
session (outside this headless harness) to verify directly.

## Claude behavioral eval suite (Section 2/17 UX contract) — 2026-09-21

Built six `claude plugin eval` cases under `plugins/claude/spellagent/evals/`
(propagated into the build output and the installed plugin so they ship with
the package) covering the six Section 2/17 UX behaviors: mode/target
disambiguation, correction progress reporting, needs-attention-upfront
reporting, cancellation report structure, suppression discoverability, and
privacy-notice cadence.

Two early schema issues were found and fixed: a `regex` grader's `target`
field shape was rejected by `claude plugin eval` with "graders.0.target:
Invalid input" (replaced both affected graders with `type: llm` graders,
which validated correctly), and case fixture directories originally named
`fixture/` caused the model under test to conflate them with SpellAgent's own
internal Phase A "bundled fixtures" terminology (`plugins/shared/feasibility.md`'s
`list-fixtures` protocol operation) and attempt the wrong workflow entirely;
renaming them to `sample/` resolved that specific confusion.

**Update — 2026-09-22, one real bug found and fixed, one confirmed and still
open.**

**Bug 1 (fixed): the eval was run against the wrong directory.** The prior
session's `claude plugin eval` invocation targeted `plugins/claude/spellagent`
— the raw plugin source, which has no `skills/` directory at all (that is
generated by `npm run build:plugins` into `build/plugins/claude/spellagent`).
Confirmed by comparing directory listings: the raw source has only
`.claude-plugin/` and `evals/`, no `skills/`. Every case's zero-tool-call,
"skill isn't installed in this session" behavior traced directly to this: the
eval loaded a plugin manifest with no skill to invoke. Re-running `claude
plugin eval build/plugins/claude/spellagent` (the built output) against a
single case (`mode-ambiguity`, one run, `--ablation none`) fixed this
immediately: the trace showed `plugins:[{name:"spellagent",...,version:"0.1.0"}]`
resolving correctly, and the agent genuinely invoked the skill and asked a
real disambiguation question — a substantive interaction, not an empty
sandbox complaint. That single-case run's grader still failed (see next
paragraph), but for a real behavioral reason, not an infrastructure one.

**Real behavioral finding (mode-ambiguity):** given "sample maybe, not sure if
I want a preview or the real thing," the skill correctly asked the user to
disambiguate scope-preview vs. correction-preview, but offered generic
placeholder examples (`docs/`, `src/`) instead of copyable examples naming the
user's own referenced target ("sample"). This is a real, actionable gap
against the section 2/17 UX contract's requirement to restate ambiguity using
the user's own target — not an eval-harness artifact.

**Bug 2 (confirmed, still open): `context.add_dirs` does not populate the
sandbox.** Running the full six-case suite against the corrected build-output
target, all six cases still failed — five of six with the agent explicitly
reporting the sandboxed working directory is empty and no `sample` directory
exists. This was independently re-confirmed by re-running one case
(`correction-progress`) with `--keep-temp`, then `chmod 700`-unsealing the
kept scratch tree's `sealed/home/cwd` and running `find` on it directly: it
has zero children. `context.add_dirs: [sample]` in each case's `case.yaml`
is not copying that case's `sample/` directory into the sandboxed working
directory on this machine/CLI version (2.1.278). A parallel investigation via a specialized Claude Code tooling guide confirmed
this repository's `case.yaml` syntax (`context: { add_dirs: [sample] }`)
matches the documented schema exactly (per Claude Code's own plugin-evals
documentation), with no undocumented prerequisite or companion key found; a
version-specific bug in `claude plugin eval` on CLI 2.1.278 was the guide's own
assessment. This is recorded as a genuine, reproduced infrastructure gap in
`claude plugin eval`'s sandbox on this CLI version, not a case-authoring
mistake here. A documented workaround exists (`context.scaffold_script` with
the `--scaffold` flag, to create fixture files programmatically instead of via
`add_dirs`) but was not applied this session — it would require rewriting all
six cases and re-running further live-model evaluations beyond this session's
remaining scope.

This is recorded as an open infrastructure gap, not a pass or fail of the five
still-blocked workflow behaviors (correction progress, needs-attention,
cancellation structure, suppression discoverability, privacy-notice cadence)
— those were separately, directly exercised via the headless `-p`/`codex exec`
smoke tests above and behaved correctly there for the scenarios those simpler
tests covered (scope preview, correction preview, correction, with correct
settings/coverage reporting), though none of those five specific UX behaviors
were exercised by the simpler smoke tests. The sixth behavior (mode
ambiguity) now has a real, confirmed finding (above) independent of the
sandbox gap. The eval suite's case/grader files remain in the repository as a
maintained, ready-to-run asset for whoever resolves the `add_dirs` sandbox
issue (or reruns on a newer Claude Code CLI); always target the built plugin
output directory, never the raw `plugins/claude/spellagent` source.

## Measured proofreading quality — 2026-09-22

**Status: complete (single pass per file).** All three sets — 18 corpus
files, 6 held-out files, 6 Phase 1 safety fixtures — were run to completion
with `scripts/run-quality-eval.mjs --model haiku` and scored with
`scripts/score-quality.mjs` against `gold.json` / `gold-held-out.json` /
`safety-gold.json` respectively. One corpus file (`rs/rs-2-en-gb.rs`) failed
its first attempt on an unrelated harness quirk (`claude -p` warned "no stdin
data received in 3s" and exited without a result) and was re-run individually
to completion; all 18 corpus files have real scored predictions.

| Set | Precision | Recall | TP | FP | FN |
| --- | --- | --- | --- | --- | --- |
| Corpus (18 files, 342 segments) | 64.2% | 42.0% | 68 | 38 | 94 |
| Held-out (6 files, 126 segments) | 72.7% | 26.7% | 16 | 6 | 44 |
| Safety fixtures (6 files, 0 expected corrections) | 0% | 100% | 0 | 1 | 0 |

**These numbers do not meet plan.md section 12's release targets (≥95%
precision, ≥80% recall, zero protected-syntax modifications) as measured.**
Reported honestly rather than adjusted, with two real caveats that likely
mean true quality is higher than the raw numbers show:

1. **Scorer granularity mismatch inflates both false positives and false
   negatives.** `scoreQuality` requires an exact string match on both
   `original` and `replacement` between a gold entry and a predicted
   proposal. Several "unexpected changes" (counted as false positives) are
   the *same* correction as an unmatched gold entry (counted as a false
   negative) at a different text-span granularity — e.g. gold labels a whole
   clause (`"we cant find the file"` → `"we can't find the file"`) while the
   model proposes just the word (`cant` → `can't`). This is a semantically
   correct catch that the exact-match scorer counts as two errors instead of
   one match. This was not fixed mid-run, since doing so would require
   redesigning the matcher's semantics without being able to verify the fix
   against a held-back label set — recorded here as a known limitation of the
   current scoring method, not a hidden adjustment to the numbers above.
2. **Several "false positives" are legitimate dialect corrections the gold
   corpus doesn't label.** Both `gold.json` and `gold-held-out.json` were
   built without deliberately seeding every British-spelling word in
   nominally en-US files (e.g. `organise` → `organize`, `colour` → `color`,
   `favourite` → `favorite`); the model catching these is arguably correct
   behavior, not a quality defect, but the scorer has no way to know that and
   counts every one as a false positive. A large fraction of both sets'
   false-positive lists (see the raw scorer output) are entries of this
   shape.

**Real finding — `haiku` correction-preview output is non-deterministic
across calls on identical input**, confirmed both during this run and in an
earlier partial run: `go/go-1-en-us.go` returned 0 proposals in an earlier
attempt and 11 in an immediate independent re-run of the same file (this
run's actual scored result for that file was 11, matching the higher-quality
outcome). A single pass per file — which is what was run here, given the
session's available capacity — is not a fully reliable quality signal; a
future run should average multiple passes per file before treating precision/
recall as final release numbers.

**Safety-fixture finding — one false positive, not a protected-syntax
violation.** `safety.rs`'s doc-comment title `//! Crate résumé 😀 prose.` was
flagged with a *preview-only* proposal (`` `Crate résumé` `` → `` `Crate's
résumé` ``, category "grammar") — an unnecessary possessive that changes the
title's meaning. No file was written (this was correction preview, not
correct), and the flagged text is plain prose, not protected syntax (no code
identifiers, URLs, or other protected ranges were touched), so this is a
precision miss against the safety-gold baseline, not the kind of
protected-syntax modification plan.md section 12's zero-tolerance target is
about. The other 5 of 6 safety fixtures produced zero proposals, as expected.

`scripts/run-quality-eval.mjs`'s incremental-write fix (from the earlier
partial run) and table-parser fix (covered by `tests/run-quality-eval.test.ts`,
3/3 passing) both held up correctly across all three full runs in this
session.

**Remaining for a release-quality number:** average multiple passes per file
given the confirmed non-determinism, and either relabel the gold sets to
include unlabeled-but-correct dialect catches or adjust the scorer's matching
granularity (span-overlap rather than exact string) — both left undone this
session as genuine methodology decisions rather than session-time expedients.

## Codex installed-host smoke test — 2026-09-22

Environment: Codex CLI 0.155.1, macOS (Darwin) 27.0 arm64, worker model
`gpt-5.6-luna` (low reasoning effort, spawned via Codex's `collab: SpawnAgent`
interface per `plugins/codex/check.md`).

**Root-cause found and fixed — marketplace path escaping the marketplace
root.** The Codex qualification blocker recorded on 2026-09-21 (`codex plugin
add` reporting "plugin `spellagent` was not found in marketplace
`spellagent-codex-marketplace`") was not a manifest-shape problem as first
suspected. Comparing against a real working local marketplace already
registered on this machine (`openai-bundled`, plugin `browser-use`) showed an
identical manifest shape to this repository's `.codex-plugin/plugin.json` —
the difference was that this repository's marketplace catalog referenced its
plugin with a `../../`-relative `source.path` that escaped the marketplace
root directory (`marketplace/codex/.agents/plugins/marketplace.json` pointing
at `../../build/plugins/codex/spellagent`), while every working example used a
path staying inside the marketplace root (`./plugins/<name>`). Codex silently
drops such an entry at resolution time rather than erroring at registration
(unlike Claude Code, which rejected an escaping path outright with a visible
validation error during the 2026-09-21 Claude smoke test).

**Fix:** moved the Codex marketplace catalog to the repository root
(`.agents/plugins/marketplace.json`, mirroring where `.claude-plugin/marketplace.json`
already lives for Claude) with `source.path` set to `./build/plugins/codex/spellagent`
— relative to the marketplace root and never escaping it. The old
`marketplace/codex/` subdirectory approach was removed. Registering the repo
root (`codex plugin marketplace add /Users/pinebit/spellagent`) and installing
(`codex plugin add spellagent@spellagent-codex-marketplace`) both succeeded
immediately after this change, with no manifest changes needed.

**Headless invocation finding (same shape as Claude's):** a plain
natural-language prompt ("Check /private/tmp/spellagent-codex-smoke") did not
invoke the installed skill — the agent inspected the directory with ad hoc
shell commands and suggested a correction in prose without calling the
helper or spawning a worker. Prefixing the request with an explicit skill
reference ("Use the SpellAgent check skill to check ...") reliably triggered
the skill, including the real `collab: SpawnAgent`/`collab: Wait`/`collab:
CloseAgent` worker-delegation sequence. Recorded as a harness/prompting detail
for headless `codex exec`, not a workflow-instruction defect.

**Symlink finding:** the helper rejected `/tmp/...` as a discovery root with
`{"ok":false,"code":"symlink"}`, because macOS `/tmp` is itself a symlink to
`/private/tmp` — the project's "do not follow symlinks" policy applying to the
root path itself. The Codex agent noticed, diagnosed it with a few shell
commands, and retried with the resolved physical path
(`/private/tmp/spellagent-codex-smoke`), which succeeded. Not seen during the
Claude smoke test (Claude's scratch fixture path did not go through a
symlinked root). Recorded as a real, reproducible interaction between macOS's
`/tmp` symlink and this project's symlink policy — worth knowing for anyone
writing fixtures under `/tmp` on macOS, not a defect in the policy itself.

Ran all three modes against a fresh scratch fixture at
`/private/tmp/spellagent-codex-smoke/README.md` (one file, two deliberate
misspellings: "documnet" → "document", "mstake" → "mistake"):

- **Scope preview:** reported 1 eligible file, 1 eligible segment, 0
  model-reviewed segments, `en-US` dialect, empty glossary, 0 files changed —
  and made no model/worker call (offline helper `discover` only). File
  confirmed byte-identical before and after (md5 `d460cb49c2ee68342bfad69d71fea439`).
- **Correction preview:** spawned a worker, validated both corrections with
  categories, reported "no files changed." File confirmed unchanged afterward
  (same md5 as above).
- **Correct:** spawned a worker, applied both corrections, reported "2
  spelling corrections applied... Coverage was complete: 1 segment reviewed,
  1 file changed, no files needing attention." On-disk content independently
  confirmed corrected (`This document has a mistake in it.`).
  `.spellagent/logs/2026-09-22.jsonl` was created with exactly one matched
  `write_intent`/`write_complete` pair containing only timestamps, path,
  hashes, and proposal count — no prompts, source text, or proposals.

This closes Task 6 and Phase A's previously open Codex-side installed-host
gates (installed plugin discovery/invocation, foreground summary return,
read-only installed directory). The plugin was removed from this machine's
Codex config after gathering this evidence; the `spellagent-codex-marketplace`
local marketplace registration (now pointing at the repository root) was left
in place for convenience when reinstalling.
