# T15 — sunset-pir-coordinate

**Phase:** 4 · **Depends on:** T10 · **Weight:** light

## Goal

Remove the deprecated foreground launcher. Under live workers its live mode strands any question a worker
asks, and the user chose to retire the command whole, rehearsal included. `pir {slug}` is the only
launcher afterwards.

## Design sections this implements

DESIGN §2.13.

## Files

- `bin/pir-coordinate` (deleted); `bin/pir` (its header comment names it)
- `install.sh` (stop installing it: `LAUNCHERS`, both closing messages and the project heredoc; remove an
  installed `pir-coordinate` launcher from `~/.local/bin` and `~/.claude/bin`, both of which install_launcher
  may have used. `ORPHAN_SKILLS` keeps `pir-coordinate`: that is the old skill's removal)
- `src/shell/launcher.test.mjs` (today asserts `LAUNCHERS` is `pir` and `pir-coordinate`, and that install.sh
  mentions `pir-coordinate {slug}` at least twice; install.sh's closing messages carry those lines)
- `src/shell/pir.test.mjs` (a comment naming the launcher)
- comments naming it: `src/shell/coordinate.mjs` (it prints no guidance), `src/shell/pir-tui.mjs`,
  `src/shell/harness/fixtures.mjs` and its test, `src/shell/harness/run.test.mjs`. The dry path stays where
  tests use it

## Tests

- [ ] launcher test: install.sh installs `pir` only, and removes a stale `pir-coordinate`
- [ ] no user-facing message in `src/` tells the person to run `pir-coordinate`

## Done when

- [ ] `npm test` green
- [ ] `grep -rn "pir-coordinate" bin install.sh src` finds only the launcher removal, the `ORPHAN_SKILLS`
      entry and history comments
- [ ] with a stale `pir-coordinate` planted in a scratch HOME's bin dir, `HOME=/tmp/pir-live-workers-home ./install.sh`
      removes it and installs `pir` only

## Outside actions

- Scratch install — `worker` (PLAN.md build route)
