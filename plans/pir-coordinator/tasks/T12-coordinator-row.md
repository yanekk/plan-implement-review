# T12 — coordinator-row

**Phase:** 3 · **Depends on:** T06, T11 · **Blocks:** T13, T14 · **Weight:** light

Added after T09 with the person's approval (2026-09-28): the agent's conversation is reachable only by
the `c` key, so it is the one conversation in a run the person cannot find by looking at the list.

## Goal

A build run with the coordinator agent shows the agent as a pinned row in the live view, set apart from
the tasks by a separator line, selectable with ↑↓ and opened with → like a task's worker. The `c` key
stays as a shortcut to the same conversation.

## Design sections this implements

DESIGN §2.8 (the agent is one more conversation in the run's `pir` screen), as amended 2026-09-28.

## What the person sees (decided with the person, 2026-09-28)

Row order in the live view:

```
  T01  config-loader       ✔ done            4m
  T02  api-routes          ● asking coord…   1m
  T03  ui-shell            ⠋ working         2m
  ──────────────────────────────────────────
  ◆ coordinator agent      holding 1 question
  main-sync  resolve-main-merge  ⠋ working
```

- The plan's tasks, then a separator line, then the agent's row, then the end-of-run helper rows (T11)
  while they run. The helpers move below the agent; they are no longer directly under the tasks.
- The separator is not selectable; ↑↓ steps over it. It spans the row width and uses the idle style.
- The row states what the agent is doing and how much it holds:
  - up, holding nothing: `on duty`
  - up, holding items: `holding N question(s)`, where N counts every waiting item it holds (questions,
    question sets, permission requests, report parks); singular for 1
  - restarting (not alive, not given up): `restarting`
  - given up (§2.11): `given up · questions come to you`, in the idle style
- No clock on the row.
- The row appears once the agent has started (`runState.coordinator` non-null) and stays for the rest of
  the run, including `ready to merge`. Before the agent starts there is neither row nor separator.
- With `--no-coordinator` (or a planning run) nothing is shown: no separator, no row. The screen is
  exactly as it is without the agent today.
- The row is not counted in `n/m done`, running, waiting or the `asking you` tally, and never turns the
  run amber.

Exact wording and glyph may be adjusted by the drill against this doc; the order, the separator, the
states listed and the no-agent case may not.

## Files

- `src/shell/coordinator-agent.mjs`: `view()` also returns `state` (`up` | `restarting` | `given-up`). It
  returns the given-up state (with the last `coordinator-{n}.ndjson`, if any) also when the agent was given
  up before any launch in this process (a pir restart inside the hour), where it returns null today.
- `src/shell/coordinate.mjs`: `holding` is the size of `startCoordinator`'s `held` map (not `justSettled`),
  added to the `coordinator` entry `buildRunState` carries. The agent module cannot count it: its `briefed`
  map also holds reserved and already-answered items.
- `src/core/display.mjs`: `rowEntries` and `buildDisplay` produce tasks, a separator entry, the agent's
  entry, then helpers; `askingCount` and the summary ignore the separator and the agent.
- `src/shell/render.mjs`: draws the separator and the agent's row; column widths (T07/T11) unchanged for
  the task rows.
- `src/core/dashboard.mjs`, `src/shell/pir-tui.mjs`: ↑↓ skips the separator and reaches the agent's row;
  → on it opens the same view as `c` (`openWorker.taskId 'coordinator'`).
- `src/shell/coordinator-drill.test.mjs` (T07's drill): an end-to-end case.
- `docs/coordinator-agent.md` (§ The agent's own conversation; the "The helpers' rows" paragraph in § The end
  of the run), `docs/human-flow.md`
  if it lists the live view's rows, `README.md`.

## Tests

- [ ] Display: with an agent, rows are tasks, separator, agent, helpers, in that order; with no agent, no
      separator and no agent row.
- [ ] Display: each state's label (`on duty`, `holding 1 question`, `holding 2 questions`, `restarting`,
      `given up · questions come to you`).
- [ ] Display: the summary and `askingCount` are unchanged by the agent row.
- [ ] Dashboard: ↑↓ skips the separator; → on the agent row opens the agent's conversation; `c` still does.
- [ ] Drill at 80×24 and 120×40: the separator and the agent's row are on screen during the build, while a
      helper runs, and in `ready to merge`; a run with `--no-coordinator` shows neither.

## Done when

- [ ] Every test above passes in `npm test` at both sizes.
- [ ] `/docs` and `README.md` say the agent has its own row and how to open it.
- [ ] `./install.sh` run after the change.
