---
type: llm
---
Pass if the Result line (the first line of the final summary) states both a
correction/file count and a "need attention" (or "needs attention") count
together in the same line, because locked.md could not be safely written
while sample/.spellagent/write.lock existed. Fail if the needs-attention
count is only mentioned later in the transcript, or not at all.
