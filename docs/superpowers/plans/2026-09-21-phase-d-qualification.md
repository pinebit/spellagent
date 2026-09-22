# Phase D Qualification and Release Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close Phase D (docs/plan.md section 11) — measured proofreading quality, installed-host qualification on both Codex and Claude Code, versioned release artifacts and marketplace catalogs, documented limitations — and finish the user-requested repository cleanup (retire remaining npm-package-era artifacts, rewrite README.md as a pure end-user install/usage guide).

**Architecture:** No engine/protocol changes are anticipated. Phase D adds: a labeled quality corpus + scoring harness (offline, reusable), real local installs of the built plugin packages into this machine's actual Codex CLI and Claude Code CLI configuration, headless invocations of both hosts to produce measured evidence, a `claude plugin eval` behavioral suite for the Section 2/17 UX contract, documentation of results, and a cleanup/README pass. All live-model work runs against scratch fixture directories outside the repo, never against the repo's own source tree.

**Tech Stack:** Existing TypeScript engine (`src/`), Node.js 24+, `codex` CLI 0.155.1, `claude` CLI 2.1.278, Vitest.

**Spec:** `docs/plan.md` (sections 1–17, especially 11 "Phase D", 12 "Verification and acceptance"), `docs/phase-c.md`.

## Global Constraints

- Node.js 24+ required; no user-side npm install or native build in shipped packages (plan.md section 3).
- SpellAgent never reads provider credentials, makes network calls, or spawns non-Node subprocesses from the helper (plan.md sections 3, 9).
- Never fabricate cost, duration, qualification results, effective model, or "fully local" privacy claims (plan.md section 4, workflow.md).
- Release quality targets: ≥95% correction precision, ≥80% recall of labeled in-scope errors, zero protected-syntax modifications in safety fixtures (plan.md section 12).
- Do not run `npm run check` / `npm run test:pack` / `npm run test:linux` mid-implementation; only once explicitly declared finished (AGENTS.md, plan.md section 12).
- Do not commit, push, publish, or change external marketplaces without explicit approval (AGENTS.md). This plan's tasks make working-tree changes only; no task step commits or pushes.
- All live-host experiments target scratch directories under the session scratchpad or `/tmp`-style throwaway paths, never this repository's own tracked files.
- The user has authorized (this session): lifting the Claude qualification deferral, live model calls against a labeled corpus, and installing the built packages into local Codex/Claude Code host configuration for real invocation testing.

---

### Task 1: Labeled quality corpus and safety-fixture confirmation

**Files:**
- Create: `tests/fixtures/quality/corpus/md/*.md`, `.../ts/*.ts`, `.../go/*.go`, `.../rs/*.rs`, `.../java/*.java`, `.../py/*.py`
- Create: `tests/fixtures/quality/held-out/` (same six subfolders, smaller)
- Create: `tests/fixtures/quality/gold.json`
- Reference (do not duplicate): `tests/fixtures/phase1/safety.{go,java,md,py,rs,ts}` — the existing zero-protected-modification safety fixtures.

**Interfaces:**
- Produces: `gold.json` shape consumed by Task 2's scorer:
  ```ts
  interface GoldFile {
    path: string;          // relative to tests/fixtures/quality/
    dialect: 'en-US' | 'en-GB';
    corrections: Array<{
      segmentHint: string; // a short unique substring of the segment, for human traceability
      original: string;    // exact phrase expected to be flagged
      replacement: string; // exact expected replacement
      category: 'spelling' | 'grammar' | 'punctuation' | 'capitalization' | 'usage';
    }>;
    // segments with no corrections.corrections entries are implicitly "expect no change";
    // list their count explicitly so the scorer can compute true negatives:
    cleanSegmentCount: number;
  }
  ```

- [ ] **Step 1: Write corpus fixture files**

  Create at least 300 total labeled segments across the six subfolders of `tests/fixtures/quality/corpus/`, split roughly evenly by format, with both `en-US` and `en-GB` dialect examples. Each file mixes:
  - Clean prose with zero errors (true negatives).
  - Prose with exactly one to three deliberate, unambiguous English spelling/grammar/punctuation/capitalization/usage errors with an obvious single correction (true positives).
  - At least one glossary-style technical term per file (e.g. `SpellAgent`, `Tree-sitter`) left uncorrected, to test terminology preservation.
  - Content shaped like real documentation/comments/docstrings for that language, following the same comment/docstring conventions already handled by `src/extractors/*` (reuse the shape of `tests/fixtures/phase1/*` as a model for what each extractor accepts).

  Example `tests/fixtures/quality/corpus/md/guide-en-us.md` excerpt:
  ```markdown
  <!-- spellagent-dialect: en-US -->
  # User Guide

  This tool helps you procces documents quickly and consistantly. It relies on
  `SpellAgent` and `Tree-sitter` to find prose safely.

  Configuration is optional and works without any setup.
  ```
  with gold entries `{"original": "procces", "replacement": "process", "category": "spelling"}` and `{"original": "consistantly", "replacement": "consistently", "category": "spelling"}`, plus `cleanSegmentCount` counting the untouched sentence and the glossary-term sentence.

- [ ] **Step 2: Write `tests/fixtures/quality/gold.json`**

  One `GoldFile` entry per corpus file created in Step 1, matching the exact `original`/`replacement` strings written into each fixture.

- [ ] **Step 3: Create the held-out subset**

  Repeat Step 1's process for `tests/fixtures/quality/held-out/`, producing roughly 20% of the total corpus segment count (so the full corpus is ≥300 segments and held-out is a genuinely separate, never-tuned-against sample). Add corresponding `GoldFile` entries to a second file, `tests/fixtures/quality/gold-held-out.json`.

- [ ] **Step 4: Confirm safety fixtures are sufficient for zero-protected-modification scoring**

  Read `tests/fixtures/phase1/safety.{go,java,md,py,rs,ts}` and `tests/phase1-extractors.test.ts`'s assertions about them. Confirm each file already contains protected constructs (code blocks, URLs, paths, placeholders, identifiers) interleaved with a small amount of genuinely correctable prose. If any of the six safety fixtures contains **no** correctable prose at all (i.e. it cannot show a false positive), add one deliberately misspelled sentence outside any protected span to that file and a matching entry in a new `tests/fixtures/quality/safety-gold.json` (same `GoldFile` shape, `path` pointing at the `phase1/safety.*` file). Do not otherwise modify the existing phase1 safety fixtures or their existing tests.

- [ ] **Step 5: Verify corpus line/word counts**

  Run a quick count to confirm scale:
  ```sh
  node -e "const g=require('./tests/fixtures/quality/gold.json'); console.log('files', g.length, 'corrections', g.reduce((n,f)=>n+f.corrections.length,0), 'clean', g.reduce((n,f)=>n+f.cleanSegmentCount,0))"
  ```
  Expected: `corrections + clean` totals at least 300 for `gold.json` alone (held-out is additional).

---

### Task 2: Quality scoring harness

**Files:**
- Create: `scripts/score-quality.mjs`
- Test: `tests/score-quality.test.ts`

**Interfaces:**
- Consumes: `GoldFile[]` from Task 1's `gold.json`/`gold-held-out.json`/`safety-gold.json`.
- Consumes: a `PredictionFile[]` produced by Task 8's harness:
  ```ts
  interface PredictionFile {
    path: string;
    proposals: Array<{ original: string; replacement: string; category: string }>;
    // true if the file was left fully unchanged (no proposals at all)
  }
  ```
- Produces: `scoreQuality(gold: GoldFile[], predictions: PredictionFile[]): { precision: number; recall: number; truePositives: number; falsePositives: number; falseNegatives: number; unexpectedChanges: Array<{ path: string; original: string; replacement: string }> }` exported from `scripts/score-quality.mjs`, plus a CLI entry point.

- [ ] **Step 1: Write the failing test**

  ```ts
  // tests/score-quality.test.ts
  import { describe, expect, it } from 'vitest';
  import { scoreQuality } from '../scripts/score-quality.mjs';

  describe('scoreQuality', () => {
    it('computes precision and recall against gold labels', () => {
      const gold = [
        {
          path: 'a.md',
          dialect: 'en-US',
          corrections: [
            { segmentHint: 's1', original: 'teh', replacement: 'the', category: 'spelling' },
            { segmentHint: 's2', original: 'recieve', replacement: 'receive', category: 'spelling' },
          ],
          cleanSegmentCount: 1,
        },
      ];
      const predictions = [
        {
          path: 'a.md',
          proposals: [
            { original: 'teh', replacement: 'the', category: 'spelling' },
            { original: 'clean', replacement: 'clean-but-wrong', category: 'spelling' },
          ],
        },
      ];
      const result = scoreQuality(gold, predictions);
      expect(result.truePositives).toBe(1);
      expect(result.falseNegatives).toBe(1);
      expect(result.falsePositives).toBe(1);
      expect(result.precision).toBeCloseTo(0.5);
      expect(result.recall).toBeCloseTo(0.5);
      expect(result.unexpectedChanges).toHaveLength(1);
    });

    it('flags any change inside a safety fixture as an unexpected change', () => {
      const gold = [{ path: 'safety.ts', dialect: 'en-US', corrections: [], cleanSegmentCount: 3 }];
      const predictions = [{ path: 'safety.ts', proposals: [{ original: 'x', replacement: 'y', category: 'other' }] }];
      const result = scoreQuality(gold, predictions);
      expect(result.unexpectedChanges).toHaveLength(1);
      expect(result.falsePositives).toBe(1);
    });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**

  Run: `npx vitest run tests/score-quality.test.ts`
  Expected: FAIL — `scripts/score-quality.mjs` does not exist yet.

- [ ] **Step 3: Implement the scorer**

  ```js
  // scripts/score-quality.mjs
  export function scoreQuality(gold, predictions) {
    const predByPath = new Map(predictions.map((p) => [p.path, p]));
    let truePositives = 0;
    let falseNegatives = 0;
    let falsePositives = 0;
    const unexpectedChanges = [];

    for (const file of gold) {
      const prediction = predByPath.get(file.path) ?? { path: file.path, proposals: [] };
      const remainingProposals = [...prediction.proposals];
      for (const expected of file.corrections) {
        const index = remainingProposals.findIndex(
          (p) => p.original === expected.original && p.replacement === expected.replacement,
        );
        if (index >= 0) {
          truePositives += 1;
          remainingProposals.splice(index, 1);
        } else {
          falseNegatives += 1;
        }
      }
      for (const leftover of remainingProposals) {
        falsePositives += 1;
        unexpectedChanges.push({ path: file.path, original: leftover.original, replacement: leftover.replacement });
      }
    }

    const precision = truePositives + falsePositives === 0 ? 1 : truePositives / (truePositives + falsePositives);
    const recall = truePositives + falseNegatives === 0 ? 1 : truePositives / (truePositives + falseNegatives);
    return { precision, recall, truePositives, falsePositives, falseNegatives, unexpectedChanges };
  }

  if (import.meta.url === `file://${process.argv[1]}`) {
    const [goldPath, predictionsPath] = process.argv.slice(2);
    const { readFile } = await import('node:fs/promises');
    const gold = JSON.parse(await readFile(goldPath, 'utf8'));
    const predictions = JSON.parse(await readFile(predictionsPath, 'utf8'));
    const result = scoreQuality(gold, predictions);
    console.log(JSON.stringify(result, null, 2));
  }
  ```

- [ ] **Step 4: Run test to verify it passes**

  Run: `npx vitest run tests/score-quality.test.ts`
  Expected: PASS

---

### Task 3: Versioned build artifacts

**Files:**
- Modify: `package.json:2` (`"version": "0.0.0"` → `"version": "0.1.0"`)

**Interfaces:**
- Consumes: nothing new.
- Produces: `build/plugins/codex/spellagent/plugin.json`, `.codex-plugin/plugin.json`, and `build/plugins/claude/spellagent/.claude-plugin/plugin.json` all carrying `"version": "0.1.0"` (via the existing `scripts/build-plugins.mjs` version-stamping logic already read in this session).

- [ ] **Step 1: Bump the version**

  Edit `package.json` to set `"version": "0.1.0"`. This is the first versioned candidate release, matching plan.md section 3's "Keep version numbers synchronized across both artifacts."

- [ ] **Step 2: Rebuild plugin artifacts**

  Run: `npm run build:plugins`
  Expected: succeeds, producing/refreshing `build/plugins/codex/spellagent/` and `build/plugins/claude/spellagent/`.

- [ ] **Step 3: Verify version stamping**

  Run: `grep -h version build/plugins/codex/spellagent/plugin.json build/plugins/codex/spellagent/.codex-plugin/plugin.json build/plugins/claude/spellagent/.claude-plugin/plugin.json`
  Expected: all three show `"version": "0.1.0"`.

---

### Task 4: Host-specific marketplace catalogs

**Files:**
- Create: `.claude-plugin/marketplace.json` (repo root — Claude Code's local-marketplace convention; confirmed schema below from `~/.claude/plugins/marketplaces/claude-tts-marketplace/.claude-plugin/marketplace.json`).
- Create: `marketplace/codex/marketplace.json` (Codex local-marketplace manifest; verify exact schema per Step 1 before writing, since Codex's manifest shape was not directly inspected this session).

**Interfaces:**
- Consumes: `build/plugins/{codex,claude}/spellagent/` from Task 3.
- Produces: catalogs that `claude plugin marketplace add <path>` and `codex plugin marketplace add <path>` can register directly (verified in Tasks 5/6).

- [ ] **Step 1: Inspect one real Codex marketplace manifest for its exact schema**

  Run: `find ~/.codex -path '*openai-curated*' -iname '*.json' | xargs grep -l '"plugins"' 2>/dev/null | head -3` and read one match to confirm field names (expect something structurally close to the Claude schema: a top-level object with a `plugins` array of `{name, version, source, description}`-shaped entries, but confirm before writing rather than assuming). If no local Codex marketplace manifest example is found on this machine, fall back to `codex plugin marketplace add --help` output for the authoritative field list.

- [ ] **Step 2: Write the Claude Code marketplace catalog**

  ```json
  {
    "$schema": "https://anthropic.com/claude-code/marketplace.schema.json",
    "name": "spellagent-marketplace",
    "metadata": {
      "description": "SpellAgent: safe local proofreading for documentation, comments, and docstrings."
    },
    "owner": {
      "name": "SpellAgent contributors"
    },
    "plugins": [
      {
        "name": "spellagent",
        "description": "Correct local prose with validated per-file edits.",
        "version": "0.1.0",
        "author": {
          "name": "SpellAgent contributors"
        },
        "source": "../build/plugins/claude/spellagent",
        "category": "productivity"
      }
    ]
  }
  ```

  Adjust the `source` relative path so it correctly resolves from `.claude-plugin/marketplace.json` to `build/plugins/claude/spellagent`.

- [ ] **Step 3: Write the Codex marketplace catalog**

  Using the schema confirmed in Step 1, create `marketplace/codex/marketplace.json` pointing its plugin entry's source at `../../build/plugins/codex/spellagent` (adjust the relative path to actually resolve), name `spellagent`, version `0.1.0`.

- [ ] **Step 4: Verify both catalogs are valid JSON**

  Run: `node -e "JSON.parse(require('fs').readFileSync('.claude-plugin/marketplace.json'))" && node -e "JSON.parse(require('fs').readFileSync('marketplace/codex/marketplace.json'))"`
  Expected: no errors.

---

### Task 5: Claude Code local install and headless smoke test

**Files:**
- Create (scratch, outside repo): a fixture project directory, e.g. `/tmp/spellagent-claude-smoke/` with 2-3 small Markdown/TS files containing obvious spelling errors.
- Create: `docs/phase-d.md` (started here, completed in Task 10) — record this task's evidence.

**Interfaces:**
- Consumes: `.claude-plugin/marketplace.json` and `build/plugins/claude/spellagent/` from Tasks 3–4.
- Produces: recorded evidence of real Claude Code installed-plugin invocation for all three modes.

- [ ] **Step 1: Register the local marketplace and install the plugin**

  ```sh
  claude plugin marketplace add /Users/pinebit/spellagent
  claude plugin install spellagent@spellagent-marketplace -s local -y
  claude plugin list --json | grep -A5 spellagent
  ```
  Expected: `spellagent` appears installed and enabled.

- [ ] **Step 2: Create a scratch fixture project**

  ```sh
  mkdir -p /tmp/spellagent-claude-smoke
  cat > /tmp/spellagent-claude-smoke/README.md <<'EOF'
  # Sample

  This documnet has a typo and another mstake for testing purposes.
  EOF
  ```

- [ ] **Step 3: Headless scope preview (no model, no writes)**

  ```sh
  claude -p "Preview the scope of /tmp/spellagent-claude-smoke" \
    --model haiku --permission-mode acceptEdits --output-format json \
    --add-dir /tmp/spellagent-claude-smoke > /tmp/spellagent-claude-smoke/preview.json
  ```
  Inspect `preview.json`: confirm the skill/plugin fired (look for a `Skill` tool-use entry referencing `spellagent`), confirm the response reports eligible files/segments and explicitly "no files changed", and confirm `git status`-equivalent (`ls -la /tmp/spellagent-claude-smoke`) shows README.md is byte-identical to Step 2 (no write occurred).

- [ ] **Step 4: Headless correction preview (model-backed, no writes)**

  ```sh
  claude -p "Preview corrections for /tmp/spellagent-claude-smoke/README.md" \
    --model haiku --permission-mode acceptEdits --output-format json \
    --add-dir /tmp/spellagent-claude-smoke > /tmp/spellagent-claude-smoke/preview-corrections.json
  ```
  Confirm the response lists proposed original/replacement pairs for "documnet"/"mstake" and confirm README.md is still unchanged on disk.

- [ ] **Step 5: Headless correction (model-backed, writes)**

  ```sh
  claude -p "Check /tmp/spellagent-claude-smoke" \
    --model haiku --permission-mode acceptEdits --output-format json \
    --add-dir /tmp/spellagent-claude-smoke > /tmp/spellagent-claude-smoke/correct.json
  cat /tmp/spellagent-claude-smoke/README.md
  ```
  Confirm README.md now has both words corrected, the response's Result line states a correction/file count, and `.spellagent/logs/` exists under `/tmp/spellagent-claude-smoke/` with a source-free JSONL entry (no prose/proposals inside it — verify with `cat` and eyeball for absence of the original sentence text).

- [ ] **Step 6: Record evidence**

  Start `docs/phase-d.md` with a "Claude Code installed-host smoke test" section: Claude Code version (`claude --version`), model, OS/arch, date, and a one-paragraph summary of Steps 3–5's outcomes (this closes one of Phase A's long-open gates recorded in plan.md section 14).

---

### Task 6: Codex local install and headless smoke test

**Files:**
- Create (scratch, outside repo): a second fixture project directory, e.g. `/tmp/spellagent-codex-smoke/`.
- Modify: `docs/phase-d.md` (append Codex section).

**Interfaces:**
- Consumes: `marketplace/codex/marketplace.json` and `build/plugins/codex/spellagent/` from Tasks 3–4.

- [ ] **Step 1: Register the local marketplace and install the plugin**

  ```sh
  codex plugin marketplace add /Users/pinebit/spellagent/marketplace/codex
  codex plugin add spellagent@<marketplace-name-from-manifest>
  codex plugin list --json | grep -A5 spellagent
  ```
  (Use the exact marketplace `name` field written in Task 4 Step 3 in place of `<marketplace-name-from-manifest>`.)

- [ ] **Step 2: Create a scratch fixture project**

  ```sh
  mkdir -p /tmp/spellagent-codex-smoke
  cat > /tmp/spellagent-codex-smoke/notes.md <<'EOF'
  # Notes

  This sentance contains an obvoius error.
  EOF
  ```

- [ ] **Step 3: Headless scope preview**

  ```sh
  codex exec "Preview the scope of /tmp/spellagent-codex-smoke" \
    -m gpt-5.6-luna -C /tmp/spellagent-codex-smoke -s workspace-write \
    --skip-git-repo-check -o /tmp/spellagent-codex-smoke/preview.txt
  ```
  Confirm the output names eligible files/segments and "no files changed"; confirm `notes.md` unchanged.

- [ ] **Step 4: Headless correction preview**

  ```sh
  codex exec "Preview corrections for /tmp/spellagent-codex-smoke/notes.md" \
    -m gpt-5.6-luna -C /tmp/spellagent-codex-smoke -s workspace-write \
    --skip-git-repo-check -o /tmp/spellagent-codex-smoke/preview-corrections.txt
  ```
  Confirm proposed corrections for "sentance"/"obvoius" appear and `notes.md` is unchanged.

- [ ] **Step 5: Headless correction**

  ```sh
  codex exec "Check /tmp/spellagent-codex-smoke" \
    -m gpt-5.6-luna -C /tmp/spellagent-codex-smoke -s workspace-write \
    --skip-git-repo-check -o /tmp/spellagent-codex-smoke/correct.txt
  cat /tmp/spellagent-codex-smoke/notes.md
  ```
  Confirm both words corrected and `.spellagent/logs/` created under the scratch project.

- [ ] **Step 6: Record evidence**

  Append a "Codex installed-host smoke test" section to `docs/phase-d.md`: Codex CLI version, model, OS/arch, date, outcome summary of Steps 3–5. Note explicitly that `codex exec` has no built-in per-run cost cap (confirmed this session), so this smoke test's cost exposure is bounded only by its three small single/few-file runs.

---

### Task 7: Claude behavioral eval suite for the Section 2/17 UX contract

**Files:**
- Create: `evals/mode-ambiguity/case.yaml`, `evals/mode-ambiguity/graders/restates-examples.md`
- Create: `evals/correction-progress/case.yaml`, `evals/correction-progress/graders/reports-progress.md`
- Create: `evals/needs-attention-upfront/case.yaml`, `evals/needs-attention-upfront/graders/count-in-result-line.md`
- Create: `evals/cancellation-structure/case.yaml`, `evals/cancellation-structure/graders/structured-report.md`
- Create: `evals/suppression-discoverability/case.yaml`, `evals/suppression-discoverability/graders/mentions-suppression.md`
- Create: `evals/privacy-notice-cadence/case.yaml`, `evals/privacy-notice-cadence/graders/notice-then-reminder.md`
- Create: fixture directories each case's `context.add_dirs` points at, e.g. `evals/mode-ambiguity/fixture/`, seeded with 2-3 small files.

**Interfaces:**
- Consumes: the installed `spellagent` plugin from Task 5 (`claude plugin eval` resolves installed or skills-dir plugins by name).
- Produces: a `claude plugin eval` run report used as Phase D behavioral evidence.

- [ ] **Step 1: Write `evals/mode-ambiguity/case.yaml`**

  ```yaml
  schema_version: "1.1"
  name: mode-ambiguity
  description: >
    A vague request naming a directory should never guess between scope preview
    and correction preview; it must restate both interpretations as copyable
    examples naming the user's own target and take no action.
  tags: [ux, section2]
  context:
    add_dirs: [fixture]
  execution:
    prompt: |
      Check fixture maybe, not sure if I want a preview or the real thing.
    max_turns: 10
    timeout_seconds: 300
    allowed_tools: [Read, Glob, Grep, Skill, Task]
  runs: 3
  expected_outcome: >
    The response asks the user to choose, offering both a scope-preview and a
    correction-preview phrasing that name "fixture" or one of its files, and
    performs no file writes.
  ```

  Seed `evals/mode-ambiguity/fixture/README.md` with one short paragraph of clean prose plus one typo, so a wrongly-guessed correction run would be observable as a file write.

- [ ] **Step 2: Write its grader**

  ```markdown
  ---
  type: llm
  ---
  Pass if the response explicitly asks the user to disambiguate between a scope
  preview and a correction preview, offers at least one copyable example request
  for each interpretation naming the fixture directory or one of its files, and
  does not claim to have found or applied any corrections. Fail if it guesses a
  mode and proceeds, or if it fails to name the user's own target in its examples.
  ```

- [ ] **Step 3: Repeat Steps 1–2 for the remaining five cases**

  - `correction-progress`: prompt `Check fixture` against a fixture directory of 6+ files each with one typo; grader (`llm`) passes if the transcript shows incremental per-file progress (e.g. "Reviewed N of M files") before the final summary, not silence until the end.
  - `needs-attention-upfront`: fixture includes one file the plugin cannot resolve (e.g. a file matching an excluded pattern once locked, or a segment with an intentionally unresolvable proposal shape is hard to force live — instead use a file with a pre-existing `.spellagent/write.lock` placed by the case's fixture to force one file into "needs attention"); grader (`regex`, `target: {source: response}`) passes if the Result line's own text contains both a correction/file count and a "need attention" (or "needs attention") count together, not only later in the transcript.
  - `cancellation-structure`: this case cannot script a mid-run SIGINT inside `claude plugin eval`'s own runner; instead assert the workflow instructions are followed by using a fixture large enough (10+ files) that at minimum the Result/What changed/Needs attention/Coverage section headers appear in order in a normal completed run; treat true interrupted-run evidence as covered by Task 9 instead, and note that explicitly in this case's `description`.
  - `suppression-discoverability`: fixture directory includes at least one line wrapped in `spellagent-disable-next-line`; prompt `Preview the scope of fixture`; grader (`regex`, target response) passes if the response's suppressed-segment count is paired with a mention of `spellagent-disable` in the same response.
  - `privacy-notice-cadence`: two-turn case — first prompt `Check fixture/a.md`, second prompt (same conversation) `Check fixture/b.md`; grader (`llm`) passes if the first response shows the full privacy notice (mentions host model processing and retention) and the second shows only a one-line reminder, not the full notice repeated.

- [ ] **Step 4: Run the suite**

  ```sh
  claude plugin eval spellagent --eval-dir evals --runs 3 --model haiku \
    --threshold 0.8 --json --report docs/phase-d-eval-report.html
  ```
  Expected: exits 0 (all cases ≥0.8) or reports specific failing cases with their transcripts.

- [ ] **Step 5: Record evidence**

  Append an "Claude behavioral eval suite" section to `docs/phase-d.md` summarizing per-case pass/fail, the report path, model, and date. If any case scores below threshold, fix the underlying `plugins/shared/workflow.md` or `plugins/claude/check.md` instruction gap (not the eval case) and re-run before proceeding.

---

### Task 8: Quantitative quality measurement (both hosts)

**Files:**
- Create: `scripts/run-quality-eval.mjs`
- Modify: `docs/phase-d.md` (append quality results section).

**Interfaces:**
- Consumes: `tests/fixtures/quality/{corpus,held-out}/`, `gold.json`, `gold-held-out.json`, `safety-gold.json` from Task 1; `scoreQuality` from Task 2; the installed plugins from Tasks 5–6.
- Produces: `PredictionFile[]` JSON per host/split, plus final precision/recall/safety numbers.

- [ ] **Step 1: Write the harness script**

  `scripts/run-quality-eval.mjs` should, given a `--host claude|codex`, a source directory (corpus, held-out, or the phase1 safety fixtures), and an output path:
  1. Copy the source directory into a fresh scratch temp dir (`node:fs/promises` `cp` into `os.tmpdir()`), so the real fixtures under `tests/` are never written to.
  2. For each file in the scratch dir, invoke the host headlessly requesting a correction preview of that one file (reusing the exact command shapes verified in Task 5 Step 4 / Task 6 Step 4), capturing the reported original/replacement pairs from the response text (parse the `--output-format json` result for Claude; parse the `-o` output text for Codex using the same original/replacement-pair line format the workflow's correction-preview report uses per `plugins/shared/workflow.md` section 4).
  3. Write a `PredictionFile[]` array to the given output path.

  Keep parsing intentionally simple (regex over the documented correction-preview report shape: `original` → `replacement`) since the report format is controlled by this repo's own `workflow.md`, not third-party text.

- [ ] **Step 2: Run against the main corpus for Claude**

  ```sh
  node scripts/run-quality-eval.mjs --host claude \
    --source tests/fixtures/quality/corpus --model haiku \
    --output /tmp/spellagent-quality/claude-corpus-predictions.json
  ```

- [ ] **Step 3: Score it**

  ```sh
  node scripts/score-quality.mjs tests/fixtures/quality/gold.json \
    /tmp/spellagent-quality/claude-corpus-predictions.json
  ```
  Record precision/recall.

- [ ] **Step 4: Repeat Steps 2–3 for Claude held-out, Claude safety fixtures, and all three for Codex**

  Six total runs: `{claude, codex} × {corpus, held-out, safety}`, each producing a predictions file and a scored result. Use `gold-held-out.json` for held-out and `safety-gold.json` for the safety-fixture run.

- [ ] **Step 5: Verify release targets**

  Confirm every corpus/held-out run reaches ≥95% precision and ≥80% recall, and every safety-fixture run reports zero `unexpectedChanges`. If a target is missed, this is a real finding, not a plan defect — record the exact numbers and the specific failing original/replacement pairs in `docs/phase-d.md` rather than adjusting the corpus to make numbers pass.

- [ ] **Step 6: Record evidence**

  Add a "Measured proofreading quality" section to `docs/phase-d.md` with a table of all six runs (host, split, precision, recall, unexpected-change count, model, date), matching the reporting format plan.md section 12 requires ("Record exact counts and repeated-run results per host/model").

---

### Task 9: Live interruption/cancellation test

**Files:**
- Modify: `docs/phase-d.md` (append cancellation section).

**Interfaces:**
- Consumes: the Claude installed-host setup from Task 5.

- [ ] **Step 1: Build a larger scratch fixture**

  ```sh
  mkdir -p /tmp/spellagent-cancel-smoke
  for i in $(seq 1 12); do
    printf '# File %d\n\nThis sentance has an obvoius mstake number %d.\n' "$i" "$i" > /tmp/spellagent-cancel-smoke/doc$i.md
  done
  ```

- [ ] **Step 2: Start a Correct run and interrupt it partway through**

  ```sh
  claude -p "Check /tmp/spellagent-cancel-smoke" --model haiku \
    --permission-mode acceptEdits --output-format json \
    --add-dir /tmp/spellagent-cancel-smoke > /tmp/spellagent-cancel-smoke/run.json &
  PID=$!
  sleep 6
  kill -INT "$PID"
  wait "$PID" 2>/dev/null
  ```
  (Adjust the `sleep` duration if 6 seconds is too early/late to land mid-run on this machine; the goal is to interrupt after at least one but before all twelve files complete — check `ls /tmp/spellagent-cancel-smoke/*.md` timestamps if needed to calibrate.)

- [ ] **Step 3: Inspect the result**

  Read `/tmp/spellagent-cancel-smoke/run.json`'s final assistant text. Confirm it uses the Result/What changed/Needs attention/Coverage structure (plan.md section 2, "Progress during correction") and explicitly states which files finished, which was in progress, and which were never reached — not a bare interruption message. Check `ls /tmp/spellagent-cancel-smoke/*.md` to independently confirm the actual on-disk state matches what the report claims.

- [ ] **Step 4: Record evidence**

  Add a "Live cancellation test" section to `docs/phase-d.md`: outcome, whether the report matched on-disk reality, model, date. If the report structure doesn't match the required Result/What changed/Needs attention/Coverage shape, treat it as a workflow-instruction defect and fix `plugins/shared/workflow.md` (or `plugins/claude/check.md`), then re-run this task's Steps 1–3 once before recording final evidence.

---

### Task 10: Phase D documentation and plan.md updates

**Files:**
- Modify: `docs/phase-d.md` (finalize — this file has been accumulating evidence since Task 5).
- Modify: `docs/plan.md` (status line at top; section 11 Phase D subsection; add a new dated section after section 17 recording Phase D closure and the lifted Claude deferral).

**Interfaces:** none (documentation only).

- [ ] **Step 1: Finalize `docs/phase-d.md`**

  Follow the structure of `docs/phase-a.md`/`docs/phase-b.md`/`docs/phase-c.md`: a status line, then sections for each piece of evidence already appended in Tasks 5, 6, 7, 8, 9, plus a closing "Remaining limitations" section listing anything Phase D intentionally leaves open (e.g. Windows untested, x64 untested if this machine is arm64, any quality target that needed a documented exception).

- [ ] **Step 2: Update `docs/plan.md`'s top status line**

  Replace the current status line (line 3) with one recording: Phase D quality/host/eval evidence gathered on today's date, the Claude qualification deferral lifted, and a pointer to `docs/phase-d.md`.

- [ ] **Step 3: Add a new dated section to `docs/plan.md`**

  Append `## 18. Phase D qualification and release packaging — 2026-09-21` summarizing what Tasks 1–9 did and measured, in the same evidence-recording style as sections 14–17, explicitly stating the user's authorization this session for live model calls and real host installs, and linking `docs/phase-d.md`.

- [ ] **Step 4: Update `AGENTS.md`'s Claude-deferral language**

  `AGENTS.md` currently states Claude qualification is deferred until a subscription is available. Since that condition is now met and lifted this session, update the relevant paragraph to reflect that Claude qualification has been performed, referencing `docs/phase-d.md`, and remove the now-stale "Package checks currently default to Codex only" sentence if Task 12 also updates the default test-host behavior (check `scripts/test-plugin-pack.mjs` / `SPELLAGENT_TEST_HOSTS` handling — if it's an env-var-gated default, update the default to include Claude now that qualification is complete, in a small follow-up edit here).

---

### Task 11: Repository cleanup of legacy npm-package-era artifacts

**Files:**
- Delete: `.env.example` (leftover provider-API-key template from the retired standalone-CLI design; SpellAgent never reads provider credentials — confirmed in `plugins/shared/workflow.md` and plan.md section 9).
- Modify: any remaining stale references found in Step 2.

**Interfaces:** none.

- [ ] **Step 1: Remove the dead provider-credential template**

  ```sh
  git rm .env.example
  ```
  Confirm nothing references it: `grep -rn "\.env" --include="*.md" --include="*.json" --include="*.mjs" --include="*.ts" . | grep -v node_modules | grep -v /.git/`. If `.gitignore` still has a `.env` entry, leave it (harmless, no product surface implies otherwise); only remove the example template itself.

- [ ] **Step 2: Grep for other CLI/provider-era mentions**

  ```sh
  grep -rniE "provider|scheduler|32.?worker|standalone cli|api.?key" \
    --include="*.md" README.md AGENTS.md docs/*.md plugins/**/*.md 2>/dev/null | grep -v node_modules
  ```
  Review each hit. Historical evidence sentences describing the *retired* design (e.g. "the retired CLI and provider integration remain removed") are fine to keep as historical record in `docs/plan.md`'s dated sections — do not edit past dated sections. Anything in current-state prose (README.md's non-historical sections, AGENTS.md) that still frames the product around the old CLI/provider design should be corrected; most of this should already be resolved by Task 12's README rewrite.

- [ ] **Step 3: Confirm no other dead code paths remain**

  ```sh
  find src -type d -empty
  grep -rn "commander\|vercel/ai\|@ai-sdk" package.json package-lock.json | head
  ```
  Expected: no empty `src/` directories (the `src/cli`, `src/llm`, `src/ui` cleanup already happened per plan.md section 17), and no leftover CLI/provider dependencies in `package.json` (only the five runtime dependencies already listed: `remark-gfm`, `remark-parse`, `unified`, `web-tree-sitter`, `zod`).

- [ ] **Step 4: Confirm package.json metadata fits the plugin product**

  Read `package.json`. Since it's `"private": true` and has no `"bin"` field, it already reflects "not an npm-published CLI." No change needed unless Step 2/3 found something to fix here.

---

### Task 12: Rewrite README.md as a pure end-user guide

**Files:**
- Modify: `README.md` (full rewrite).
- Create: `docs/development.md` (receives the current README's build/test/contributor content).

**Interfaces:** none.

- [ ] **Step 1: Move developer content out of README.md**

  Create `docs/development.md` containing the current README's "Development" section (npm ci, check/test:pack/test:linux commands, build:plugins, repository layout) plus a pointer to `docs/plan.md` for the maintained design and phase evidence and `docs/phase-d.md` for qualification evidence. This is where a contributor looks; end users installing the plugin never need it.

- [ ] **Step 2: Write the new user-focused README.md**

  Structure, using the real copyable examples from `plugins/claude/check.md`, `plugins/codex/check.md`, and `plugins/shared/workflow.md` (read these three files fresh before writing, so examples match the actual shipped skill wording rather than being invented):

  ```markdown
  # SpellAgent

  Safe, local proofreading for your documentation, source comments, and
  docstrings — as a plugin for Claude Code and Codex. Your existing host
  handles authentication and model access; SpellAgent finds prose safely and
  applies only validated corrections, one file at a time.

  ## What it corrects

  - Markdown and GFM
  - JavaScript, TypeScript, JSX, TSX comments
  - Go, Rust, Java comments and documentation comments
  - Python comments and docstrings

  English spelling, grammar, punctuation, capitalization, and usage only — no
  translation, rewriting, identifier renaming, or factual correction. Code
  examples, URLs, paths, placeholders, and identifiers are always protected.

  ## Install

  ### Claude Code

  \`\`\`sh
  claude plugin marketplace add https://github.com/pinebit/spellagent
  claude plugin install spellagent@spellagent-marketplace
  \`\`\`

  ### Codex

  \`\`\`sh
  codex plugin marketplace add https://github.com/pinebit/spellagent
  codex plugin add spellagent@<marketplace-name>
  \`\`\`

  Requires no separate API keys, no npm install, and no compiler — the plugin
  ships its own runtime dependencies and grammar files.

  ## Use it

  In Claude Code:

  \`\`\`
  /spellagent:check
  Preview the scope of docs/
  Preview corrections for README.md
  Check docs/ using en-GB; treat SpellAgent and Tree-sitter as glossary terms.
  \`\`\`

  In Codex, ask the same requests in ordinary language; the installed skill
  responds the same way.

  Three modes:

  | Ask for | What happens |
  | --- | --- |
  | "Check ..." / "Correct ..." | Reviews eligible files and applies validated corrections automatically. |
  | "Preview the scope of ..." | Offline inventory of what would be reviewed and why other content is skipped. No model call, no writes. |
  | "Preview corrections for \<one file\>" | Reviews and shows proposed corrections for exactly one named file. No writes. |

  ## Preferences (optional)

  Add an optional \`.spellagentrc.json\` at your project root:

  \`\`\`json
  {
    "schemaVersion": 2,
    "dialect": "en-GB",
    "includeHidden": false,
    "glossary": ["SpellAgent", "Tree-sitter"]
  }
  \`\`\`

  Everything works with sensible defaults if you skip this file.

  ## Suppressing a specific line or region

  \`\`\`
  <!-- spellagent-disable-next-line -->
  This line is intentionally left as-is.
  \`\`\`

  \`spellagent-disable\` / \`spellagent-enable\` mark a suppressed region; source
  files use their own language's comment syntax with the same directive text.

  ## Privacy

  Correction and correction-preview modes send extracted prose to your selected
  host model; scope preview never does. Model retention follows your host or
  organization's policy — SpellAgent doesn't control it. The local helper
  itself makes no network calls, stores no prompts or source text, and never
  stages, commits, or publishes changes; inspect what changed with your own
  tools.

  ## Contributing

  See [docs/development.md](docs/development.md) for build/test commands and
  [docs/plan.md](docs/plan.md) for the maintained design.

  ## License

  [MIT](LICENSE). Bundled grammars retain their upstream licenses under the
  packaged runtime assets.
  ```

  Replace the placeholder `<marketplace-name>` / repository URL with the actual values once Task 4's Codex marketplace `name` field and this repo's real distribution location are known; if the repo is not yet publicly hosted, use the local-path install form instead (`claude plugin marketplace add /path/to/spellagent`, `codex plugin marketplace add /path/to/spellagent/marketplace/codex`) and say so explicitly rather than inventing a GitHub URL that doesn't yet serve the marketplace catalog.

- [ ] **Step 3: Cross-check every command in the new README**

  Re-run each install/use command from Step 2 against what Tasks 4–6 actually verified works (exact marketplace names, exact install flags). Fix any drift between the README's prose and the verified commands.

---

### Task 13: Final verification and review checkpoint

**Files:** none (verification only).

**Interfaces:** none.

- [ ] **Step 1: Stop and summarize for the user**

  Per this repo's verification cadence (AGENTS.md, plan.md section 12) and CLAUDE.md's "never commit unless explicitly asked," do not run `npm run check` / `npm run test:pack` / `npm run test:linux` or make any commit as part of this task. Instead, present a summary of Tasks 1–12's evidence (quality numbers, installed-host results, eval suite results, cleanup diff) and explicitly ask the user to declare the work finished before running checks, and separately ask before any commit/push.

- [ ] **Step 2: On explicit go-ahead, run checks once**

  ```sh
  npm run check
  npm run test:pack
  ```
  (and `npm run test:linux` if the user wants Linux re-verification too, per the same authorization pattern as prior phases). Record results in `docs/phase-d.md`.

- [ ] **Step 3: On separate explicit go-ahead, commit**

  Follow the repository's existing commit conventions (see `git log` for style); do not push unless separately authorized.

---

## Self-review notes

- **Spec coverage:** Task 1–2 cover plan.md section 12's quality corpus/target requirements; Tasks 5–6 cover section 11 Phase D's "installed-package portability, host invocation" and close Phase A's long-open installed-host gates (section 14); Task 7 covers the Section 2/17 UX contract verification explicitly flagged as "not yet re-verified" in plan.md's status line; Task 8 covers "effective model behavior" and the measured quality gate; Task 9 covers "interruption handling"; Tasks 3–4 cover "versioned artifacts and marketplace catalogs ready for review"; Task 10 covers "documented limitations" and updates the maintained plan; Tasks 11–12 cover the user's separate cleanup/README request.
- **Deferred-condition check:** the user explicitly lifted the standing Claude-qualification deferral (plan.md section 15) for this session before Task 5 was written; Task 10 Step 4 updates `AGENTS.md` to stop describing it as deferred.
- **No fabricated evidence:** every task that produces a number or pass/fail (Tasks 5, 6, 7, 8, 9) ends with a "record evidence" step naming exact host/model/OS/date fields, per plan.md section 12's reporting requirement.
