# T13 — docs-and-install

**Phase:** 5 · **Depends on:** T12 · **Weight:** light

## Goal

Write the detached lifecycle into `/docs`, where parallel mode's behaviour is canonical, and make
`pir` installable. This is the task that stops the next session rediscovering how a detached run
works by reading the code. It comes last so it documents what was actually built, not what was
planned.

## Design sections this implements

DESIGN §2 as a whole (the behaviour to document), §2.9 (`bin/pir`), §3.5 (storage locations to
document and gitignore).

## Files

- `docs/detached-runs.md` — new: the `pir` front-end, the `~/.pir` index, the status snapshot, the
  crash/stop/keep-awake behaviour, and how it relates to `pir-coordinate`.
- `docs/README.md` — edit: add the new page to the index.
- `install.sh` — edit: install `bin/pir` on PATH the same way `bin/pir-coordinate` is installed,
  substituting the engine path.
- `.gitignore` — verify `plans/*/.parallel/` already covers `status.json` (it does per the survey);
  add a note only if a new path needs ignoring. `~/.pir` is outside the repo and needs nothing.

## Interface

Prose and config, not code. The docs page covers, in the flat house style: the two invocations;
run identity and the four states; the index under `~/.pir/runs/`; the snapshot at
`plans/{slug}/.parallel/control/status.json`; immediate stop and what it leaves; keep-awake via
`caffeinate -w`; and that a run is recovered by re-running its slug. Cross-link
`docs/run-lifecycle.md` and `docs/control-folder.md` rather than restating them.

## Tests

No automated tests — this is documentation and install wiring. The check is by reading (Done when).

## Done when

- [ ] `docs/detached-runs.md` exists, is linked from `docs/README.md`, and describes the lifecycle,
      the index, the snapshot, stop, keep-awake, and recovery, consistent with what was built.
- [ ] `install.sh` puts `bin/pir` on PATH with the engine path substituted, like `bin/pir-coordinate`.
- [ ] `.gitignore` is confirmed to keep `status.json` out of git (via `plans/*/.parallel/`).
- [ ] `npm test` still passes (nothing here should change it).
