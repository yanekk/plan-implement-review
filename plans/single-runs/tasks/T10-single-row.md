# T10 — single-row

**Phase:** 3 · **Depends on:** T04, T08 · **Weight:** heavy

## Goal

A single run on the dashboard: its row (TYPE, SLUG, STATE, PROGRESS, the waiting count), the `merged`
state once the person's merge lands, its steps view with the hand-off line, and stop, resume and remove
offered as for a planning run.

## Design sections this implements

DESIGN §2.8, §2.9 (testing is not asking), §2.11 (which rows offer which chord).

## Files

- `src/core/dashboard.mjs`, `src/core/dashboard.test.mjs` (`isSingle`, `runDisplayState`, `canResume`, `displayName`, tallies)
- `src/core/dashboard-state.mjs`, `src/core/dashboard-state.test.mjs`
- `src/core/plandisplay.mjs`, `src/core/plandisplay.test.mjs` (`buildSingleDisplay`)
- `src/shell/pir-tui.mjs`, `src/shell/pir-tui.test.mjs` (TYPE column, steps view, merged check)
- `src/shell/render.mjs` if the row painter needs the new states' styles
- `src/shell/plan-rig.test.mjs` (end-to-end cases)

## Interface

```js
isSingle(view) → boolean                       // record.kind, else snap.runState.kind
runDisplayState(view)  // single: 'building'|'testing'|'reviewing'|'asking-you'|'ready-to-merge'|'merged'|'finished'|'stopped'|'crashed'
  // view.merged: boolean|undefined, supplied by the shell's merged check
buildSingleDisplay(runState, { now, record, state, merged }) → the steps view model (rows build/review/merge, footer)
// pir-tui: mergedCheck(view, { now }) — baseContains(pir/{name}, { root, refs: [refs/heads/{base}] }) at most every 30 s per row, cached; true is final
```

## Tests

- [ ] runDisplayState for every single state in DESIGN §2.8, including asking over testing precedence (testing never asking)
- [ ] `ready-to-merge` and `asking-you` count in waiting; `merged` and dropped count in finished
- [ ] singleProgress drives PROGRESS; SLUG shows the quoted label before the rename
- [ ] canResume: stopped/crashed single yes; ready/dropped no
- [ ] buildSingleDisplay: each step's text (`testing…`, `tests red · round 2`, waits on), the merge row's hand-off line with the base, the dropped footer
- [ ] mergedCheck: asks git at most once per 30 s (injected clock), stops asking once true

## End to end (the worker drives this)

- suite: the planning rig (T08) · sizes: 80×24, 120×40
- [ ] `single-happy`: the row goes building → testing → reviewing → testing → ready to merge, TYPE `single`
- [ ] open the row: the steps view shows build ✓, review ✓, and `git switch main && git merge pir/rig-fix`; `→` opens the builder's conversation read-only
- [ ] merge the branch in the scratch repo → within the check interval the row reads `merged`
- [ ] `single-red`: the steps view shows `tests red · round 1`, then green
- [ ] `Ctrl+S` twice stops a running single run; `Ctrl+R` twice resumes it into the same conversation; `Ctrl+X` twice removes it and the branch stays

## Done when

- [ ] every DESIGN §2.8 state and cell is asserted in pure tests and seen in the rig at both sizes
- [ ] stop, resume and remove work on a single row in the rig
- [ ] `npm test` green
