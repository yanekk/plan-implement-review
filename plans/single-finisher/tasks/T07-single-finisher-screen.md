# T07 — single-finisher-screen

**Phase:** 3 · **Depends on:** T05 · **Weight:** medium

## Goal

Show the new ending where the person already looks: a `sync` row and a finisher-owned `merge` row in the
single run's steps view, the new states and progress cells in the runs list, and `c` / `→` reaching the
finisher's conversation so the person can say `Go` (DESIGN §2.11).

## Design sections this implements

DESIGN §2.11.

## Files

- `src/shell/single-run.mjs` (`singleRunState`: the `sync` step entry, the `merge` entry from the finisher view)
- `src/core/plandisplay.mjs` (`buildSingleDisplay`; its row list `['build','review','merge']` gains `sync`), `src/core/display.mjs` (reuse the finisher row words: `FINISHER_WORDS`, `finisherLabel`, `finisherRow` are module-private today; export what is needed, no copy)
- `src/core/dashboard.mjs` (`runDisplayState` for single, `SINGLE_STEP_IDS` gains `sync`, `openAgent`/`openCoordinator` for a single run with a finisher (both return null for any single run today), the `c` reducer and `noCoordinatorNote`, no-session notes)
- `src/core/singleflow.mjs` (`singleProgress`, if T03's cells need adjusting to the snapshot)
- `src/shell/pir-tui.mjs` (`stateCell` words and colours for `syncing`, `finishing`, `not-ready`, `closed`; `ready-for-your-go` and `ready-to-merge` exist), `src/shell/conversation-view.mjs` (header `agent`: open the finisher with task id `FINISHER_ID`, not `merge`)
- tests beside each, and `src/shell/plan-rig-single-*.test.mjs` / `plan-rig-single-drill-helpers.mjs`

## Interface

```js
// singleRunState(...) step entries, in order: build, review, sync, merge.
{ id: 'sync', phase: 'pending'|'working'|'testing'|'asking'|'held'|'done'|'failed', text, since, worker, workers }
{ id: 'merge', phase: 'pending'|'finisher'|'ready'|'done', finisher: <finisher view> | null, text }
// runState.finisher: the finisher's view() while it is on, else null (T05)
// singleRunState's row list (today build, review, merge) gains sync.
```

Words and styles: DESIGN §2.11 tables, exactly. The `merge` row's finisher words come from the same
function the build's pinned row uses in `display.mjs`.

## Tests

- [ ] `singleRunState` for each sync phase and each finisher phase gives the DESIGN §2.11 text.
- [ ] `runDisplayState`: `syncing`, `ready-for-your-go` (only when nothing else asks), `asking-you` for a stuck finisher and for an asking helper, `finishing`, `ready-to-merge` on fallback, `not-ready`, `merged`, `finished`, `closed`; legacy `ready` unchanged.
- [ ] `singleProgress` cells per DESIGN §2.11.
- [ ] `c` on a single run with the finisher on opens the finisher; without it, `a single run has no coordinator agent.`
- [ ] `→` on `sync` opens the current helper, or the no-session note; on `merge` opens the finisher.

## End to end (the worker drives this)

- suite: the single-run pty rig (`plan-rig-single-*.test.mjs`, fake Claude, scratch repo) · sizes: 60×20, 80×24, 120×40
- [ ] a run with an unmoved base: the steps view shows `sync  up to date · tests green` and `merge  ◆ finisher  waiting for your go` in amber; the list reads `● ready for your go`.
- [ ] `→` on `merge` opens the finisher's conversation with its summary and steps; answering `Go` in the picker ends the run; the list reads `◌ finished`, PROGRESS `build ✓ review ✓ sync ✓ merge ✓`.
- [ ] a run whose base moved with a conflict: `sync  resolving a clash` while the helper works; `→` opens the helper's conversation.
- [ ] a red-after-fix run: `sync  not ready · tests red`, list `✗ not ready`, no merge line anywhere.
- [ ] nothing wraps or truncates mid-word at 60×20.

## Done when

- [ ] The tests and rig tests above pass.
- [ ] `./install.sh` run.
- [ ] `npm test` green.

## Outside actions

- Refresh the installed engine and skills — `ask` (DESIGN §5.3)
