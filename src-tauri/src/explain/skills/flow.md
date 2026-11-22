---
name: flow
description: Trace a feature, request, or event end to end through the code. Use for "how does X work", "what happens when I click/call/run X", "where is X handled", "how does data get from A to B".
---

# Trace a flow

Goal: the reader can follow one concrete scenario from the trigger to its effect, and knows which file holds each step.

## Find the entry

Search for what the user would see or type, in parallel:
- UI text: button labels, menu items, error messages (`Grep` the exact string).
- Routes, CLI flags, command and event names, queue topics, cron names.
- If the question names a function or type, `Grep` its definition and its callers.

## Follow it

- Move one hop at a time: read the handler, find the next call, `Grep` its definition. Read only the relevant ranges.
- Note the boundaries where control leaves the project (database, network, filesystem, OS, a library) and name them; do not dive into dependencies.
- Watch for the parts that make it non-obvious: async hand-offs, events, caches, retries, error paths, feature flags.

## Answer shape

1. One sentence that summarizes the whole path ("Clicking Save sends the draft to the backend, which writes it atomically and re-indexes the file.").
2. A `steps` block, 3 to 8 steps, each with a `ref`. Use a `diagram` with `"direction": "right"` instead when several components talk back and forth.
3. Standard and up: one `excerpt` of the single most important step, with `focus` on the key lines.
4. Detailed and up: error paths, edge cases, and why it is built this way.
