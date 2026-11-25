# Agents

## Dev app

- Every code change — here or in `../control-ui` — ends with `bun run install:dev`, before you report back. Never skip it, never leave it for later.
- It rebuilds `/Applications/Another Dev Tool Dev.app` against local control-ui, reinstalls it, and restarts it if it was running, since a running app keeps its old binary.
- Done means the command exited 0. If it fails, that blocks finishing, so don't just mention it in the report: fix the cause, rerun, and repeat until it passes.
- Usual cause: local control-ui raised a peer dependency (`packages/components/package.json` → `peerDependencies`) above what this repo installs. Bump the same package here to the same range and rerun.
- That bump can break `bun run build`, which uses the published `@ctrl-ui/react`, until control-ui publishes its matching release. Say so in the report.
