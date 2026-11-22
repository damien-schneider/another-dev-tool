---
name: history
description: Explain how the code evolved - recent changes, why something is the way it is, activity over time, hotspots, and who knows which part. Use for "what changed lately", "why is it like this", "who wrote/owns X", "how active is this", or any chart of project activity.
---

# Code history

Goal: turn git history into a clear story, with numbers measured from git, never estimated.

## Recipes (run from the project root)

Recent activity:
- `git log --since="2 weeks ago" --no-merges --format="%h %ad %an %s" --date=short`
- `git log -n 15 --no-merges --format="%h %ad %an %s" --date=short`

Activity over time (chart data):
- Per month: `git log --no-merges --format=%ad --date=format:%Y-%m | sort | uniq -c`
- Per week, last 12 weeks: `git log --since="12 weeks ago" --no-merges --format=%ad --date=format:%G-W%V | sort | uniq -c`
- For one folder or file, append `-- <path>`.

Hotspots and ownership:
- Most changed files, last 6 months: `git log --since="6 months ago" --no-merges --name-only --format= | sort | uniq -c | sort -rn | head -10`
- Top authors: `git shortlog -sn --no-merges | head -8` (append `-- <path>` for one area)

Why a line is like this:
- `git blame -L <start>,<end> -- <path>`, then `git show --stat <hash>` for the commit message and what else changed with it.
- A file's story: `git log --follow -n 20 --format="%h %ad %an %s" --date=short -- <path>`

## Read the numbers

- `uniq -c` prints the count first: map it to the right field when you build chart rows.
- Months or weeks with no commits are missing from the output; add them with 0 when the gap matters to the story.
- Merges and bulk renames distort counts: say so when they dominate.

## Answer shape

1. One sentence with the takeaway ("Most of the work in the last month went into the sync engine.").
2. A `chart`: activity over time as `bar` (or `line` past about 18 points); hotspots as a `horizontal` bar; ownership as a bar, or a `donut` with at most 6 slices.
3. Recent changes: group commits by intent (feature, fix, refactor), not one line per commit; cite commit hashes in backticks.
4. Detailed and up: a `stats` block (commits, contributors, first commit, files touched) and the story behind the biggest changes.
