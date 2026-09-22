---
type: llm
---
Pass if the transcript contains at least one incremental progress update
naming a partial file count (such as "Reviewed 3 of 6 files" or similar)
issued before the final Result/coverage summary. Fail if the only output is
the final summary with no intermediate progress statement.
