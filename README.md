# Another Dev Tool

[![Download for macOS](https://img.shields.io/github/v/release/damien-schneider/another-dev-tool?label=Download%20for%20macOS&style=for-the-badge&logo=apple&color=black)](https://github.com/damien-schneider/another-dev-tool/releases/latest/download/another-dev-tool_universal.dmg)

Browse, edit, deduplicate and sync the skills scattered across your machine — skills (any `SKILL.md`), Claude agents, Cursor rules, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`. Universal binary for Apple Silicon and Intel, signed and notarized by Apple, with built-in automatic updates.

It indexes `~/.claude`, `~/.agents`, `~/.codex`, `~/.cursor`, `~/.gemini` and your usual project folders on first launch, with nothing to set up. Open a project from the top of the library to list only its files next to your personal ones; starred projects stay first, and worktrees sit inside the repository they belong to. A person icon marks the project skills every project gets through your personal agent folders, and skills no agent loads from where they sit are dimmed. Arranged by folder, the library starts at the open project's own folders, like an editor's file tree; turn on Show → Other files to also list everything else on disk, dimmed, folder by folder as you open them. Skills open in a visual editor that writes back only the lines you changed; name and description are edited as fields and checked against the skill rules. `⌘K` finds any file or project, `⌘N` starts a new skill in the open project, `⌘S` saves.

Grant Accessibility access once, then select text in any macOS app—including Claude Code, Codex, and terminal sessions—and tap Shift twice to save it to local Prompt history. When direct selection access is unavailable, Another Dev Tool briefly invokes Copy and restores the previous clipboard afterward.

Patterns finds what you keep telling your agents. It reads the prompts you typed into Claude Code, Codex, omp, Mastra Code and Pencil, and Claude Opus (through your Claude Code CLI) proposes, for each instruction you repeat across sessions, where it belongs: a sharper existing skill or rule, a new rule line, a skill, or a fact for `AGENTS.md`. A second pass throws out every quoted prompt that doesn't actually say it, and a pattern needs 3 sessions on 2 days to stay. Open one and the target file opens with Ask Claude pre-filled; nothing is written until you review the diff and save. A run covers your most recent prompts (about 135k tokens), takes a few minutes and uses about $2 of Claude usage; only the quoted prompts are kept in the app.

Explain answers questions about any folder on your Mac, git repository or not. Pick a project, ask how something works, where it lives or why it is built that way, and Claude (through your Claude Code CLI, read-only: it can search, read and run `git log`-style commands, never write) finds the relevant code and answers in plain words. The Detail slider sets the length, from a one-line gist to a deep dive; Shorter and Deeper redo the last answer one level down or up. Answers draw diagrams, step-by-step walkthroughs, charts and headline numbers from what Claude actually read or measured, and every `path:line` citation opens the real file at those lines beside the answer. Conversations are kept per project.

## Development

Requires [Bun](https://bun.sh), [Rust](https://rustup.rs) and the Xcode command line tools.

```bash
bun install
bun run dev
```

| Script | What it does |
| --- | --- |
| `bun run dev` | Run the app with hot reload. Uses a sibling `../control-ui` checkout (or `CTRL_UI_PATH`) as live source for `@ctrl-ui/react` when present |
| `bun run install:dev` | Build `Another Dev Tool Dev.app` against the same control-ui source, install it in `/Applications`, and reopen it if it was running |
| `bun run test` | Frontend tests (Vitest) |
| `bun run test:rust` | Backend tests (cargo) |
| `bun run check-types` | TypeScript check |
| `bun run lint:rust` | Clippy, warnings as errors |
| `bun run lint:fix` | Format and lint the frontend (Biome) |
| `bun run version <x.y.z>` | Bump the version everywhere it lives |
| `bun run release` | Build, sign, notarize and publish a GitHub release |

`src/` is the React frontend, `src-tauri/` the Rust backend.

## License

[MIT](LICENSE)
