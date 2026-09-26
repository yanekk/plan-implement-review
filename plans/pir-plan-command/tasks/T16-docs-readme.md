# T16 — docs-readme

**Phase:** 3 · **Depends on:** T14, T15 · **Weight:** medium

## Goal

`/docs` and the README describe what the code now does: planning runs, the three commands, the TYPE
column, resume, the go, and where a build finds its plan. `/docs` is canonical for parallel-mode
behaviour and the README is how a new reader learns the feature exists, so neither may still say
`pir {slug}`.

## Design sections this implements

All of DESIGN §2, as built (the drill T14 may have changed details; the code wins).

## Files

- `docs/planning-runs.md` (new): a planning run start to finish, its control folder before and after the
  rename, the reports, the go, resume, stop and remove, known limitations
- `docs/README.md`, `docs/detached-runs.md` (commands, "there are no subcommands" removed, TYPE, resume
  chord, key table), `docs/run-lifecycle.md` (plan home in the pre-flight and end gate),
  `docs/branch-model.md` (plan branch cut and rename), `docs/task-state.md` (gate reads the plan home),
  `docs/control-folder.md` (`.parallel/plan/`, `plans/plan-{hex4}/` before the rename), `docs/restart-recovery.md` (resume)
- `README.md`: a section leading with `pir plan`, the command table, every `pir {slug}` → `pir start {slug}`

## Tests

- [ ] `grep -rn "pir {slug}\|pir <slug>" README.md docs/` finds no command-to-type use of the old form.
- [ ] Every key in the docs' key table matches the footers painted by `pir-tui.mjs` (checked by reading
      the footers, listed in the commit).

## Done when

- [ ] Each doc named above states the new behaviour and links `planning-runs.md` where relevant.
- [ ] README has a user-facing section on `pir plan` with a link to `docs/planning-runs.md`.
- [ ] Nothing in `/docs` describes behaviour the code does not have (spot-checked against the tests named).
