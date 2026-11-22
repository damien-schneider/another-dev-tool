---
name: tour
description: Orient someone in an unfamiliar project - what it is, how it is organized, where to start reading. Use for "what is this project", "give me a tour", "how is this organized", "where do I start".
---

# Project tour

Goal: in one screen, the reader knows what the project does, its main parts, how they connect, and which files to open first.

## Gather (one parallel batch)

- `Glob` for `README*`, `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING*`, `docs/*.md` at the root; read the README and any agent instructions (they state conventions).
- Read the manifests that exist: `package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`, `Gemfile`, `pom.xml`, `build.gradle*`, `composer.json`, `*.csproj`. Scripts and dependencies reveal the stack and the entry points.
- `ls` the root, then `git ls-files | cut -d/ -f1 | sort | uniq -c | sort -rn | head -15` to see where the code mass is.

## Then

- Find the entry points: app root, `main`, server bootstrap, CLI parser, route table, command registry. Read just enough of each to name what it wires together.
- Pick 4 to 9 major parts. A part is something with its own responsibility (UI shell, API layer, storage, worker, shared lib), not a folder for its own sake.
- From the Detailed level up, measure a few headline numbers: `git ls-files | wc -l`, `git rev-list --count HEAD`, `git shortlog -sn --no-merges | head -5`, first commit date with `git log --reverse --format=%ad --date=short | head -1`.

## Answer shape

1. One sentence: what the project is for, from its user's point of view.
2. A `diagram` of the major parts and how data or control flows between them (`group` by layer when there are layers).
3. A `files` block: 4 to 8 "start here" files, each with its role.
4. Detailed and up: a `stats` block, the conventions worth knowing, and what is surprising or non-obvious.
