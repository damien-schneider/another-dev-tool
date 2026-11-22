---
name: code
description: Explain a specific file, function, type, component, or snippet - what it does, why it exists, how it is used, and what to watch out for. Use when the question names or points at a piece of code.
---

# Explain a piece of code

Goal: the reader understands what the unit is for from its callers' point of view, how it works inside, and the one or two things that would trip them up.

## Gather (one parallel batch)

- Read the whole unit (function, type, component, or file section).
- `Grep` its name across the project to find callers and how they use it; that is where "why it exists" lives.
- `Glob`/`Grep` for its tests: they state the intended behaviour and edge cases.
- From the Detailed level up, its history: `git log -n 8 --format="%h %ad %s" --date=short -- <path>`; for a puzzling line, `git blame -L <start>,<end> -- <path>` then `git show --stat <hash>`.

## Explain

- Purpose: one sentence, in terms of what callers get from it.
- Contract: inputs, outputs, side effects (I/O, state, events), errors.
- Mechanism: only the steps that are not obvious from the names.
- Gotchas: invariants it relies on, ordering, performance traps, surprising defaults.

## Answer shape

1. The purpose sentence.
2. An `excerpt` of the core lines with `focus` on the heart of it.
3. Standard and up: who calls it (cite 1 to 3 call sites), the contract, the gotchas.
4. Detailed and up: a `steps` block for multi-stage logic, and the history when it explains a design choice.
