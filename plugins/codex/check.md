---
name: check
description: Preview SpellAgent proofreading scope and prose coverage for local project files, or evaluate bundled synthetic fixtures. Automatic correction is not available yet.
---

# SpellAgent for Codex — Read-only preview

For project previews, read [workflow.md](workflow.md). For explicitly requested
bundled-fixture host/model evaluation, read [feasibility.md](feasibility.md). This installed skill's directory
is the base directory; resolve the helper at `../../runtime/dist/plugin/helper.js`.

For an offline project or fixture preview, run the helper yourself without delegating
or proofreading. For a requested host/model feasibility evaluation, explicitly
delegate to exactly one worker with `gpt-5.6-luna` and low reasoning effort,
unless the user explicitly selects another available model. Supply the complete
workflow, absolute helper path, chosen fixture names as an explicit array, and
expected summary. Copy the user-selected subset exactly into the worker task;
never replace it with the full list-fixtures catalog. Check that the returned
fixture names equal the selected array before accepting the summary.
Use a fresh worker context; do not rely on inherited conversation history or a
plugin-installed custom agent. No nested delegation or parallel workers.

Request model selection through the host's supported spawn interface; never
silently inherit the parent model. If selection is unavailable, rejected, or
known to be overridden, stop and report the blocker. If effective model metadata
is unavailable, report it as unverified, not as a successful model-selection gate.
Wait for the worker, then relay its summary and incomplete gates. Do not use
other tools to edit source or bypass the selected workflow scope. A helper invocation is the only authorized
product operation; do not search unrelated directories to locate an installed
plugin. If this skill has no installed base directory, report discovery unavailable.
