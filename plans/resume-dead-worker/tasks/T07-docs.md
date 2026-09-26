# T07 — docs

**Phase:** 4 · **Depends on:** T05, T06 · **Weight:** light

## Goal

Bring `/docs` and the README to the shipped behaviour: a mid-run death keeps the branch, revives once,
falls back, gives up at three; a restart revives too.

## Files

- `docs/run-lifecycle.md` ("Clean up dead workers" bullet)
- `docs/restart-recovery.md` (reconciliation, the restart revive from the conversation log)
- `docs/human-flow.md` (what the person sees: §2.6 lines, the gave-up row, the restarted tag, the
  `revived` line in the conversation view)
- `docs/task-state.md` if it describes the dead path
- `README.md` (a sentence and a link: a worker that dies is woken where it left off, and its work is
  never thrown away; CLAUDE.md § The README follows every major feature)

## Done when

- [ ] No doc says a dead worker's worktree or branch is removed.
- [ ] Every claim traces to shipped code; the sealed plans' DESIGN files are untouched.
- [ ] The README names the behaviour for a user and links to the doc that specifies it.
- [ ] `npm test` green (docs-only diff).
