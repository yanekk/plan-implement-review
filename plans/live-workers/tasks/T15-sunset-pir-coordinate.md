# T15 — sunset-pir-coordinate

**Phase:** 4 · **Depends on:** T10 · **Weight:** light

## Goal

Remove the deprecated foreground launcher. Under live workers its live mode strands any question a worker
asks, and the user chose to retire the command whole, rehearsal included. `pir {slug}` is the only
launcher afterwards.

## Design sections this implements

DESIGN §2.13.

## Files

- `bin/pir-coordinate` (deleted)
- `install.sh` (stop installing it; remove an installed `pir-coordinate` launcher it finds in the bin dir)
- `src/shell/launcher.test.mjs`
- `src/shell/coordinate.mjs` only if its bin section prints `pir-coordinate` guidance; the dry path stays
  where tests use it

## Tests

- [ ] launcher test: install.sh installs `pir` only, and removes a stale `pir-coordinate`
- [ ] no user-facing message in `src/` tells the person to run `pir-coordinate`

## Done when

- [ ] `npm test` green
- [ ] `grep -rn "pir-coordinate" bin install.sh src` finds only the removal line and history comments
- [ ] after `./install.sh`, `command -v pir-coordinate` finds nothing

## Outside actions

- `./install.sh` — `worker`
