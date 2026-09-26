# T12 — plan-watch-view

**Phase:** 2 · **Depends on:** T07, T08, T10, T11 · **Weight:** heavy

## Goal

Opening a planning run shows its steps, each step opens its conversation, and a reviewed plan asks the
person for the go: start the build now, or not now. Start hands straight into the build's live view on
the same row. This is the screen where planning becomes building.

## Design sections this implements

DESIGN §2.8, §2.11, prototype scenes 3–6.

## Files

- `src/core/plandisplay.mjs` (new), `src/core/plandisplay.test.mjs` (new)
- `src/core/dashboard.mjs` (the open and go events), its test
- `src/shell/pir-tui.mjs`, its test
- `src/shell/plan-rig.test.mjs` (end-to-end cases)

## Interface

```js
// core/plandisplay.mjs
export function buildPlanDisplay(runState, { now, record, width }) →
    { header, rows: [{ id: 'plan'|'review'|'build', kind, text, clock }], footer, go: null | { slug, widthLine } }
//   kinds: 'active' | 'asking' | 'done' | 'failed' | 'pending'; go is set when runDisplayState is 'your-go';
//   widthLine = 'N tasks, longest chain M, up to W can run at once.' from analyzeParallelism over the
//   branch PROGRESS.md the shell passes in
// core/dashboard.mjs: watch view of a plan row takes { type: 'key', key: 'enter'|'n' } while go is set →
//   effect { start: slug } | effect { decline: key }; '→'/'enter' on a step row → openWorker of that step's
//   latest session (read-only when not live), as for a task row
```

`pir-tui.mjs` paints the frame with the task-row styles, and on `start` calls `startRun(slug, { cwd:
record.repoPath })` and switches the view to the build's live view of the same key; on `decline` calls
`updateRecord(..., { go: 'declined' })`. A refused `startRun` shows its reason in the footer and keeps
the question.

## Tests

- [ ] `buildPlanDisplay` rows for: planner busy, planner asking (question and permission), planner done
      and reviewer busy, reviewed with go, declined, no-plan, not-reviewed, crashed mid-review (stale).
- [ ] Clock stops while a step is asking (same rule as task rows, `stoppedAt`).
- [ ] Go keys only act while `go` is set; `esc` leaves the question in place.
- [ ] A step with no session yet → footer note, no open.

## Done when

- [ ] Every row passes in `npm test`.
- [ ] The end-to-end cases below pass under the T10 rig, the full one ending at a green hand-off.

## End to end (the worker drives this)

- suite: `src/shell/plan-rig.test.mjs` · sizes: 80×24, 120×40
- [ ] Open a planning run (script 'happy') → steps `plan` asking, `review` and `build` pending.
- [ ] `→` on `plan` → the planner's conversation with its question; answer it with `↵` → the planner
      continues; `←` → steps view.
- [ ] After the fake reviewer → the go question with a width line.
- [ ] `n` → row reads finished, stale note says `Build it with: pir start {slug}`.
- [ ] In a second run, `↵` → the row flips to `work`, the build's live view shows the fake plan's task
      running, and the run ends at the green `git merge pir/{slug}` footer with `main` unchanged.
