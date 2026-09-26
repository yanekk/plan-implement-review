# T11 — dashboard-type

**Phase:** 2 · **Depends on:** T02, T07, T08, T10 · **Weight:** medium

## Goal

The dashboard shows planning runs beside builds: a TYPE column, the label for an unnamed plan, the
step a plan is on, the `your go` state, the waiting count, and a resume chord that restarts any stopped
or crashed run. This is how the person finds a planning run again after quitting `pir`.

## Design sections this implements

DESIGN §2.10, §2.14 (the chord and when it is offered), prototype scene 7.

## Files

- `src/core/dashboard.mjs`, `src/core/dashboard.test.mjs`
- `src/shell/pir-tui.mjs`, `src/shell/pir-tui.test.mjs`
- `src/shell/plan-rig.test.mjs` (end-to-end cases)

## Interface

```js
// core/dashboard.mjs
export function runDisplayState(view) → 'running'|'planning'|'reviewing'|'your-go'|'finished'|'stopped'|'crashed'
//   view = { state (classifyRun), record (kind, go), snap (runState.kind 'plan', step, outcome) }
export function planProgress(runState) → 'plan …' | 'plan ✓ review …' | 'plan ✓ review ✓' | 'plan ✗' | 'plan ✓ review ✗'
export function canResume(view) → boolean   // stopped | crashed | plan finished not-reviewed
// dashboardReducer gains { type: 'key', key: 'ctrl+r' } arming and confirming 'resume', like stop/remove,
//   returning { effect: { resume: runKey } } on the confirm
```

`pir-tui.mjs` paints TYPE (`plan` magenta, `work` blue, as the prototype), the label dimmed in quotes,
the display states with the colours of DESIGN §2.10, `· N waiting for you` in the counts line, `Ctrl+R
resume` in the footer, the armed line `⚠ Ctrl+R again to resume {name}`, and on the effect calls
`resumeRun(record)` (T08).

## Tests

- [ ] `runDisplayState` for every combination of kind, classification, step and outcome, and `go: 'declined'`.
- [ ] `planProgress` for each step and outcome.
- [ ] `canResume` true only where DESIGN §2.14 says.
- [ ] Reducer: Ctrl+R arms, a second Ctrl+R on the same row confirms, any other key cancels; not offered
      on a row where `canResume` is false.
- [ ] List frame: TYPE column present and aligned at 80 columns with a long label; old records show `work`.

## Done when

- [ ] Every row passes in `npm test`; existing dashboard and list-frame tests pass with the new column.
- [ ] The end-to-end cases below pass under the T10 rig.

## End to end (the worker drives this)

- suite: `src/shell/plan-rig.test.mjs` · sizes: 80×24, 120×40
- [ ] A planning run started with `startPlanRun` in the rig (script 'happy', planner waiting on its
      question) → the list shows `"<label>"  plan  planning … plan …`.
- [ ] After the fake planner and reviewer finish → the row reads `{slug}  plan  your go  plan ✓ review ✓`
      and the counts line shows `1 waiting for you`.
- [ ] Stop the run with Ctrl+S Ctrl+S mid-planner, then Ctrl+R Ctrl+R → the row returns to `planning`.
