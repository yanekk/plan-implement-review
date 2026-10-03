# T15 — docs-readme

**Phase:** 5 · **Depends on:** T06, T07, T08, T09, T10, T11, T12 · **Weight:** medium

## Goal

Carry what was built into `/docs`, which is canonical for how parallel mode behaves, and into the
README, which is how a new reader learns the feature exists. A new page for the queue, and the pages
whose behaviour changed updated in place.

## Design sections this implements

All of DESIGN §2, as built.

## Files

- `docs/test-queue.md` (new): the queue, the slot, order and bump, the limit and the kill, the screen, the storage, recovery by hand, known limitations
- `docs/run-lifecycle.md` (the gate between report and hand-off or merge; the end gate queued), `docs/task-state.md` (the `tests` phase), `docs/restart-recovery.md` (the retest row of the resume table), `docs/human-flow.md` (the stop alert), `docs/detached-runs.md` (the pinned line, the queue view keys, the stopped-tests-red row), `docs/single-runs.md` (queued runs, the limit, the kill), `docs/control-folder.md` (`tests.json`, `tests-T{nn}-{n}.log`), `docs/README.md` (index)
- `README.md`
- `src/shell/test-queue-docs.test.mjs` (new)

## Tests

- [ ] `src/shell/test-queue-docs.test.mjs` (new), in the style of `single-docs.test.mjs`: every text
  `docs/test-queue.md` quotes (pinned line, queue view keys, row texts, the red message's last line) is
  the code's; `docs/README.md` and `README.md` link `docs/test-queue.md`

## Done when

- [ ] Every behaviour in DESIGN §2 is described in `/docs` as the code does it today, with the function names a reader would grep for.
- [ ] `README.md` has a user-pitched paragraph on pir testing each task and the machine-wide queue, linking `docs/test-queue.md`.
- [ ] Every known limitation found during the build is listed in `docs/test-queue.md`.
