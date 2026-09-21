---
name: check
description: Preview SpellAgent prose extraction on bundled synthetic fixtures when asked to evaluate the SpellAgent plugin. Not for correcting project files yet.
---

# SpellAgent for Codex — Phase A

Read [workflow.md](workflow.md) before execution. This installed skill's directory
is the base directory; resolve the helper at `../../runtime/dist/plugin/helper.js`.

For an explicitly offline preview, run the helper yourself without delegating or
proofreading. For a requested host/model feasibility evaluation, explicitly
delegate to exactly one worker with `gpt-5.6-luna` and low reasoning effort,
unless the user explicitly selects another available model. Supply the complete
workflow, absolute helper path, chosen fixture names, and expected summary.
Use a fresh worker context; do not rely on inherited conversation history or a
plugin-installed custom agent. No nested delegation or parallel workers.

Request model selection through the host's supported spawn interface; never
silently inherit the parent model. If selection is unavailable, rejected, or
known to be overridden, stop and report the blocker. If effective model metadata
is unavailable, report it as unverified, not as a successful model-selection gate.
Wait for the worker, then relay its summary and incomplete gates. Do not use
other tools to edit source or bypass the helper's synthetic-only scope.
