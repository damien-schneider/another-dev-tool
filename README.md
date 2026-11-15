# Another Dev Tool

[![Download for macOS](https://img.shields.io/github/v/release/damien-schneider/another-dev-tool?label=Download%20for%20macOS&style=for-the-badge&logo=apple&color=black)](https://github.com/damien-schneider/another-dev-tool/releases/latest/download/another-dev-tool_universal.dmg)

Browse, edit, deduplicate and sync the skills scattered across your machine — skills (any `SKILL.md`), Claude agents, Cursor rules, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`. Universal binary for Apple Silicon and Intel, signed and notarized by Apple, with built-in automatic updates.

It indexes `~/.claude`, `~/.agents`, `~/.codex`, `~/.cursor`, `~/.gemini` and your usual project folders on first launch, with nothing to set up. Skills open in a visual editor that writes back only the lines you changed; name and description are edited as fields and checked against the skill rules. `⌘K` finds any file, `⌘N` starts a new skill, `⌘S` saves.

Grant Accessibility access once, then select text in any macOS app—including Claude Code, Codex, and terminal sessions—and tap Shift twice to save it to local Prompt history. When direct selection access is unavailable, Another Dev Tool briefly invokes Copy and restores the previous clipboard afterward.

## Development

Requires [Bun](https://bun.sh), [Rust](https://rustup.rs) and the Xcode command line tools.

```bash
bun install
bun run dev
```

| Script | What it does |
| --- | --- |
| `bun run dev` | Run the app with hot reload |
| `bun run test` | Frontend tests (Vitest) |
| `bun run test:rust` | Backend tests (cargo) |
| `bun run check-types` | TypeScript check |
| `bun run lint:rust` | Clippy, warnings as errors |
| `bun x ultracite fix` | Format and lint the frontend |
| `bun run version <x.y.z>` | Bump the version everywhere it lives |
| `bun run release` | Build, sign, notarize and publish a GitHub release |

`src/` is the React frontend, `src-tauri/` the Rust backend.

## License

[MIT](LICENSE)
