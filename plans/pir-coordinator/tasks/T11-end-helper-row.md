# T11 — end-helper-row

**Phase:** 3 · **Depends on:** T06, T10 · **Blocks:** T09 · **Weight:** light

Added by the T07 worker with the person's approval (2026-09-27): FINDINGS (T06) and the T07 drill found
the main-sync worker has no row in `pir`, so a question the agent passes on from it can be answered only
on the phone, though the agent's pointer says "answer it in its conversation".

## Goal

The end-of-run helper workers, main-sync (T05) and tests-fix (T10), appear in the run's live view as a row
while they run, reading like a task row (`asking coordinator`, `asking you`, working), so the person can
select it and open its conversation with → and answer there, as for any task.

## Design sections this implements

DESIGN §2.5 (answer in the worker's conversation, in `pir` or on the phone) for the end-of-run workers;
§2.8.

## Files

- `src/shell/coordinate.mjs` `buildRunState`: the helper, while it has a worker, carries a row entry
  (`id` its task label `main-sync`/`tests-fix`, a slug naming what it does, its worker, `asking`, `holder`).
- `src/core/display.mjs`, `src/shell/render.mjs`, tests: the row renders below the tasks; it is not
  counted in `n/m done`; the footer's `asking you` pointer names it when it holds the person's question.
- `src/core/dashboard.mjs`, `src/shell/pir-tui.mjs`, tests: ↑↓ reaches the row and → opens its
  conversation like a task's worker.
- `src/shell/conversation-rig.mjs` or the T07 drill (`coordinator-drill.test.mjs`): an end-to-end case.
- `docs/human-flow.md` (or the `/docs` page on answering), `README.md` if it says where to answer.

## Tests

- [ ] Display: a helper row with holder person reads `asking you` and the footer points at it; the summary
      counts only plan tasks.
- [ ] Dashboard: → on the helper row opens its conversation.
- [ ] End to end at 80×24 and 120×40: a run whose end sync conflicts (or whose tests are red), the helper
      asks, the agent passes it on, the person opens the helper's row and answers it in `pir`.

## Done when

- [ ] Every test above passes in `npm test` at both sizes.
- [ ] `/docs` says the helper is answered in `pir` like a task.
- [ ] `./install.sh` run after the change.
