# T02 — end-sequence-no-wait

**Phase:** 1 · **Depends on:** T01 · **Weight:** light

## Goal

Stop the end of a run from moving one step per 5 s backstop. `endPass` advances `handoff.step` one case per
pass, and a pass that merged, spawned or closed something is often followed by a pass with work to do, but
nothing wakes the loop for it. After this task a pass that made progress wakes the loop once, so the next
step runs after the pass gap, and the drills pass with the backstop set to a minute.

## Design sections this implements

DESIGN §2.3, §2.6.

## Files

- `src/shell/coordinate.mjs` — in `main()`, after each pass: wake the waker when the pass progressed.
- `src/core/…` — a pure `passProgressed(before, after, actions)` if the comparison needs more than a line;
  put it beside the other run-state helpers and unit-test it.
- `docs/run-lifecycle.md` — the end-of-run section, if it describes steps a pass apart.

## Interface

```js
// passProgressed({ stepBefore, stateBefore, handoff, actions }) → boolean
// true when handoff.step or handoff.state differ from before the pass, or when actions contains a
// 'spawn', 'review', 'merge' or 'close' (the same set main() already calls productive).
```

The wake is one `waker.wake()` call after the pass, before the `waker.wait` that ends it. A pass that
changed nothing does not wake, so an idle run still sleeps on the backstop and `STALL_GRACE` still means
three quiet backstop periods.

## Tests

- [ ] passProgressed: a step change, a state change, and each productive action kind → true
- [ ] passProgressed: no change and only non-productive actions (e.g. `await-idle`) → false
- [ ] a stalled run (fake platform, nothing live, nothing to do) still ends after STALL_GRACE backstop
      waits, not sooner (the gap must not turn a stall into a spin)

## Done when

- [ ] `PARALLEL_POLL_MS=60000 node --test 'src/shell/coordinator-drill*.test.mjs'` is green (the glob
      matches the file before or after T03's split).
- [ ] `npm test` is green.
- [ ] The commit gives the drill times at the default backstop before and after, quiet machine.
