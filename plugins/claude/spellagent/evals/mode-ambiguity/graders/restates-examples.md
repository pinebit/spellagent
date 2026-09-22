---
type: llm
---
Pass if the response explicitly asks the user to disambiguate between a scope
preview and a correction preview, offers at least one copyable example request
for each interpretation naming the sample directory or one of its files, and
does not claim to have found or applied any corrections. Fail if it guesses a
mode and proceeds, or if it fails to name the user's own target in its
examples.
