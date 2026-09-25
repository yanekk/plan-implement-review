# T10 — runtime-deps

**Phase:** 1 · **Depends on:** T00 · **Weight:** light

## Goal

Make `@earendil-works/pi-tui` and `@anthropic-ai/claude-agent-sdk` real, pinned dependencies that the
installed engine can import, and keep the pure core free of packages. The project has never had a runtime
dependency, so the install path has to learn to put `node_modules` beside the engine. The SDK is installed
without its peers and without its bundled `claude` (DESIGN §5), so an `.npmrc` makes that the default for
every `npm ci`. T04 imports the SDK, so this task lands before it.

## Design sections this implements

DESIGN §3.1 (boundary extension), §5 (Dependencies), §5.3.

## Files

- `package.json` (`"dependencies": { "@earendil-works/pi-tui": "0.87.1", "@anthropic-ai/claude-agent-sdk": "0.3.282" }`,
  `"engines": { "node": ">=22.19" }`)
- `package-lock.json` (new, committed)
- `.npmrc` (new): `omit=peer` and `omit=optional`, with a comment line citing DESIGN §5
- `install.sh` (copy `package.json`, `package-lock.json` and `.npmrc` into the engine; run `npm ci --omit=dev` there)
- `src/shell/launcher.test.mjs` (assert the new install lines)
- `src/core/boundary.test.mjs` (forbid bare-specifier imports in `src/core/`)
- `.gitignore` (`node_modules/`)

## Tests

- [ ] boundary test fails on a fixture core file importing `@earendil-works/pi-tui`, the SDK, or any bare specifier
- [ ] launcher test: install.sh copies the three package files and runs `npm ci --omit=dev` in the engine dir
- [ ] a smoke test imports `TUI` from pi-tui and `query` from the SDK in `src/shell/` (proves both resolve in `npm test`)

## Done when

- [ ] `npm ci && npm test` green in a fresh clone; `node_modules` holds the two packages and pi-tui's own
      dependencies, and no `@modelcontextprotocol`, `zod` or `claude-agent-sdk-darwin-*` package
- [ ] pi-tui still loads its native `.node` binary with optionals omitted (it ships inside the package;
      confirm, and if it does not, stop and ask the user)
- [ ] after `HOME=/tmp/pir-live-workers-home ./install.sh`, both packages import with cwd
      `/tmp/pir-live-workers-home/.claude/pir-engine` (a scratch HOME: the real engine is not replaced during the parallel build)
- [ ] both versions are exact, not ranges, and the lockfile is committed

## Outside actions

- Install packages from npm — `ask`
- Scratch install — `worker` (PLAN.md build route)
