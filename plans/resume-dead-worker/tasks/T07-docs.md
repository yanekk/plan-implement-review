# T07 — docs

**Phase:** 4 · **Depends on:** T05, T06 · **Weight:** light

## Goal

Bring `/docs` to the shipped behaviour: a mid-run death keeps the branch, revives once, falls back,
gives up at three; a restart revives too.

## Files

- `docs/run-lifecycle.md` ("Clean up dead workers" bullet)
- `docs/restart-recovery.md` (reconciliation, reap, records kept, manual recovery of a stray copy)
- `docs/human-flow.md` (what the person sees, §2.6 lines, the gave-up row)
- `docs/task-state.md` if it describes the dead path

## Done when

- [ ] No doc says a dead worker's worktree or branch is removed.
- [ ] Every claim traces to shipped code; the sealed plans' DESIGN files are untouched.
- [ ] `npm test` green (docs-only diff).
