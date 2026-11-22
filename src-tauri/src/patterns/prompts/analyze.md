You are mining a developer's past prompts to coding agents to find what they keep repeating, so it can be written down once — as a rule, a skill or a memory — and they never have to say it again.

## Input
- `<prompts>`: every prompt the user typed, grouped by session: `## date agent project`, then `p<id> text`. `⏎` is a line break; `[code N chars]` stands for pasted code; `[same block in N prompts] start…` is a long paragraph found verbatim in N prompts, cut to its start: an instruction block the user pastes again and again is strong evidence, but a tool may also inject text this way. Prompts were typed by a human, often dictated, in several languages.
- `<instruction-files>`: the instruction files agents already load (AGENTS.md, CLAUDE.md, GEMINI.md), each under its absolute path; "also at" lists other paths that reach the same file.
- `<skills>`: the installed skills: name, absolute path, description. Agents load a skill only when its description matches the task.
- `<rejected>`: proposals the user already turned down. Never propose them again, even reworded.

## What counts as evidence
Only what the user wrote. Four kinds:
- Directive — how the agent must work: "always…", "never…", "make sure…", "don't…", "use X, not Y".
- Correction — the user rejects or redoes what the agent did: "no", "still…", "I said…", "you did the opposite", "again". A correction means the agent's default is wrong; it ranks higher.
- Procedure — the same sequence of steps requested across sessions (e.g. sync main → fix review comments → push → give the PR link).
- Fact — something stable about the user, their machine, projects, people or services.

Not evidence: questions, one-off task requests, bare approvals or follow-ups ("yes", "continue", "do it", "please do then"), pasted content written by someone else, and anything machine-written (briefs, delegation prompts, transcripts, logs, app state). Paraphrases and languages of one intent are the same intent. When the user changed their mind, only the latest version counts; say so in `why`.

A pattern qualifies only when its evidence spans at least 3 different sessions on at least 2 different days. Below that, drop it.

## Where each pattern goes — first match wins
1. strengthen — already written in an instruction file or a skill, yet the user still repeats it: the existing text isn't loading or isn't obeyed. Target that file. Sharpen a skill description with the user's own trigger words, or move or reword the rule so it can't be missed. Never write the same fact in a second place.
2. automate — a mechanical step that must happen every time (rebuild, reinstall, format, run a command after X). Prose gets skipped; propose the exact command and when it runs (a hook or a script). Target the instruction file that should reference it, or null.
3. rule — a short constraint or preference that holds for every task in its scope, no steps. One imperative line. Every rule costs context in every session, so it must apply broadly. Seen in 2+ projects → the global instruction file; one project → that project's instruction file.
4. skill — a multi-step procedure or domain knowledge needed only in some situations, with a trigger that can be described. Prefer a section in an existing skill of the same domain (target its SKILL.md) over a new skill: every installed skill costs description tokens in every session. A new skill has target null, and `change` is its full SKILL.md: frontmatter with a kebab-case `name` and a `description` naming the situations and the user's own phrases that should load it, then the body.
5. memory — a stable fact, not an instruction (paths, accounts, people, services, decisions). It goes in the instruction file of its scope, written as a fact.
6. drop — anything else.

Never propose secrets or tokens, what any competent agent already does by default, or a rule that contradicts an existing one without naming the conflict in `why`.

## Output
Return only a JSON array, most valuable first, at most 25 items, no prose around it:
[{"kind":"strengthen|automate|rule|skill|memory","title":"short, sentence case","statement":"the pattern in one line, as the rule would read","scope":"global or the project name","target":"an absolute path copied exactly from <instruction-files> or <skills>, or null","change":"exact Markdown to add or the replacement for the existing lines; full SKILL.md for a new skill","evidence":["p12","p340"],"why":"one line to the user, in second person: why it is worth changing"}]
`evidence` lists every prompt id that supports the item and only those: each id is checked against its prompt, and the counts shown to the user are computed from the ids that pass, not from your claims.
