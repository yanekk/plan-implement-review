# T02 — row-hits

**Phase:** 1 · **Depends on:** — · **Weight:** medium

## Goal

A click or a hover must know which run, task or step sits on a screen line. The frame builders already
decide every line's place, so they tag the row lines they emit with a `hit`, and a click on a task row
needs the reducer's existing `select` event to work in a run's live view as it does in the list. All
pure, so every layout, including the windowed list, is proven in milliseconds before any screen wiring.

## Design sections this implements

DESIGN §2.1, §3.3, §3.4.

## Files

- `src/shell/pir-tui.mjs` — `windowListBlock`, `buildListFrame`, `buildWatchFrame`, `buildPlanWatchFrame`, new `hitAt`
- `src/core/dashboard.mjs` — `dashboardReducer` `select`
- `src/shell/pir-tui.test.mjs`, `src/core/dashboard.test.mjs`

## Interface

```
line.hit = { kind: 'run', index }    // buildListFrame (both forms): index into dashboard.rows
line.hit = { kind: 'task', index }   // buildWatchFrame: rows 1..n of the render block (rowEntries); index into openTasks;
                                     // the separator line has none; the agent's and helpers' rows have one
line.hit = { kind: 'step', index }   // buildPlanWatchFrame: step rows; index into buildPlanDisplay rows

export function hitAt(frame, y) → { kind, index } | null   // frame[y]?.hit ?? null; y out of range → null

dashboardReducer(ui, { type: 'select', index }, views)
  list view:  unchanged (sel = clamp(index))
  watch view: taskSel = clamp(index, openTasks(views, ui).length), armed cleared, sel unchanged;
              an index on the separator leaves taskSel where it was
  worker view: unchanged (inert, clears armed)
```

Only row lines carry `hit`. Title, header, blank lines, `↑/↓ n more` markers, summary, notes, counts,
footer and the go question's lines do not. `hit` is a property on the span array, so no builder output
changes shape for existing callers.

## Tests

- [ ] list, no box form: every run row has the right `hit.index`; header, title, counts, footer have none
- [ ] list with a `rows` budget that windows (e.g. 20 runs, budget 8, sel 10): visible rows carry their
      true indices, the `↑ n more`/`↓ n more` lines carry none, and dropped spacer lines shift nothing
- [ ] empty list: no line has a hit
- [ ] build live view with a coordinator agent and a helper: the separator line has no hit; the agent's row
      carries the index of its `openTasks` entry, and so does each helper's row
- [ ] list with a `ready-to-merge` row (COL_READY widths): every run row still carries its index
- [ ] build live view: task i's line carries `{ kind: 'task', index: i }`, the summary line and the stale/crash
      notes and log tail carry none; the selected task line keeps its `▎` span and its hit
- [ ] planning steps view, with and without the go question: step i carries `{ kind: 'step', index: i }`;
      the question and `↵ start · n not now` lines carry none
- [ ] `hitAt` returns null for negative y, y past the end, and a line without a hit
- [ ] reducer: `select` in watch sets `taskSel`, clamps past the end and on an empty task list, clears `armed`;
      `select` then `open` on a task with a worker yields the worker view; on a task without one, the note;
      `select` on the agent's entry then `open` yields the worker view with `openWorker.taskId 'coordinator'`,
      or `noCoordinatorNote` when it has no session; `select` on the separator changes nothing

## Done when

- [ ] Every row line of the four builders carries the `hit` above, and no other line does.
- [ ] `select` moves `taskSel` in the live view with the tests above.
- [ ] `npm test` is green, and the frames' visible text is byte-identical to before (existing tests unchanged).
