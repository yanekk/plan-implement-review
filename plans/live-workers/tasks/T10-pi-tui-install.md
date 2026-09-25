# T10 — pi-tui-install

**Phase:** 3 · **Depends on:** T00 · **Weight:** light

## Goal

Make `@earendil-works/pi-tui` a real, pinned dependency that the installed engine can import, and keep
the pure core free of packages. The project has never had a runtime dependency, so the install path has
to learn to put `node_modules` beside the engine.

## Design sections this implements

DESIGN §3.1 (boundary extension), §5 (Dependencies), §5.3.

## Files

- `package.json` (`"dependencies": { "@earendil-works/pi-tui": "0.87.1" }`, `"engines": { "node": ">=22.19" }`)
- `package-lock.json` (new, committed)
- `install.sh` (copy `package.json` and `package-lock.json` into the engine; run `npm ci --omit=dev` there)
- `src/shell/launcher.test.mjs` (assert the new install lines)
- `src/core/boundary.test.mjs` (forbid bare-specifier imports in `src/core/`)
- `.gitignore` (`node_modules/`)

## Tests

- [ ] boundary test fails on a fixture core file importing `@earendil-works/pi-tui` or any bare specifier
- [ ] launcher test: install.sh copies both package files and runs `npm ci --omit=dev` in the engine dir
- [ ] a smoke test imports `TUI` from the package from `src/shell/` (proves the dependency resolves in `npm test`)

## Done when

- [ ] `npm ci && npm test` green in a fresh clone
- [ ] after `HOME=/tmp/pir-live-workers-home ./install.sh`, `node -e "import('@earendil-works/pi-tui')"` succeeds with cwd
      `/tmp/pir-live-workers-home/.claude/pir-engine` (a scratch HOME: the real engine is not replaced during the parallel build)
- [ ] the version is exact, not a range, and the lockfile is committed

## Outside actions

- Install pi-tui from npm — `ask`
- Scratch install — `worker` (PLAN.md build route)
