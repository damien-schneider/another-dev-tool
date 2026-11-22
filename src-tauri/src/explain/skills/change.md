---
name: change
description: Explain a set of changes - uncommitted work, a commit, a branch, or a range. Use for "what does this commit do", "explain my changes", "what is different on this branch", "what did this PR change".
---

# Explain a change

Goal: the reader understands what the change does and why, grouped by intent, and what deserves a careful look.

## Find the change

- Uncommitted: `git status --porcelain`, `git diff --stat`, `git diff --cached --stat`.
- A commit: `git show --stat <rev>` (message, author, files), then `git show <rev> -- <path>` per file that matters.
- A branch: find its base with `git rev-parse --abbrev-ref origin/HEAD` (fall back to `main` or `master`), then `git log --oneline <base>..HEAD` and `git diff --stat <base>...HEAD`.
- Read the hunks of the files that carry the intent; skim lockfiles, generated files, and snapshots, and say you did.

## Understand it

- Group hunks by what they achieve (new behaviour, bug fix, refactor, tests, config), not by file.
- For each group: before, after, and why. Read the surrounding code when a hunk alone is ambiguous.
- Flag what a reviewer should check: changed contracts, migrations, removed checks, concurrency, error handling, missing tests.

## Answer shape

1. One sentence: what the change does for the user or the codebase.
2. A `files` block with `change` kinds and each file's role in the change.
3. Per intent group: 1 to 3 sentences, with refs to the new code.
4. Detailed and up: an `excerpt` of the most important new lines, and the risks worth checking.
