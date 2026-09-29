# T01 — wake-on-activity

**Phase:** 1 · **Depends on:** — · **Weight:** heavy

## Goal

Make the coordinator loop wake the moment something happens that its next pass would act on or show: a
worker's request, output, turn end or exit, the coordinator agent's events and decisions, the person's
forwarded input, a setup child settling. Today these wait out the 5 s backstop, which is most of a drill's
wall time and the reason a worker's question reaches a real person's screen up to 5 s late.

## Design sections this implements

DESIGN §2.1, §2.2, §2.6, §3.2.

## Files

- `src/shell/drop-folder.mjs` — `createWaker` moved here from `plan-run.mjs`, exported, with a pass gap.
- `src/shell/plan-run.mjs` — imports `createWaker`; its local copy is deleted.
- `src/core/stream.mjs` — `wakesLoop(entry)`.
- `src/shell/platform.mjs` — `onActivity` option on `createPlatform`.
- `src/shell/coordinator-agent.mjs` — `onActivity` option on `startCoordinatorAgent`.
- `src/shell/person-inbox.mjs` — `onActivity` option on `startPersonInbox`.
- `src/shell/commands.mjs` — `onSettled` option on `startLines`.
- `src/shell/coordinate.mjs` — `main()` owns one waker and passes `waker.wake` to every hook; both
  `waitForReport` calls become `waker.wait`; `makePrepare` threads `onSettled`.
- Unit tests beside each (`drop-folder` tests live in the file that tests `waitForDrop` today; add
  `drop-folder.test.mjs` if there is none).
- `docs/run-lifecycle.md`, `docs/control-folder.md` (the "outside the 5 s pass" line), `docs/human-flow.md`
  (the "loop polls every 5 s" line), `README.md` (one sentence where it describes the run reacting to
  workers).

## Interface

```js
// drop-folder.mjs
// createWaker({ minGapMs = 0, now = Date.now, setTimer = setTimeout }) → {
//   wake(),                                   // resolve a pending wait; with none pending, mark early
//   wait(dirs, timeoutMs, { watch, signal, unref }) → Promise<void>,
// }
// wait() returns at once if a wake arrived since the last wait returned, otherwise on the first of: wake(),
// a drop in `dirs` (waitForDrop), timeoutMs, signal abort. It never returns sooner than minGapMs after the
// previous wait returned: a wake inside the gap is held until the gap ends (DESIGN §2.2).
export function createWaker(opts)

// stream.mjs (pure)
// wakesLoop(entry) → boolean: false for entry.dir === 'note' and for anything that is not an object,
// true otherwise.
export function wakesLoop(entry)

// platform.mjs
// createPlatform({ …, onActivity = () => {} }): every spawned worker's onEvent calls onActivity() when
// wakesLoop(entry), and its onExit calls onActivity() after the bookkeeping. A throwing onActivity never
// breaks the grant answer or workers.json.

// coordinator-agent.mjs
// startCoordinatorAgent({ …, onActivity = () => {} }): the agent worker's onEvent (wakesLoop) and onExit
// call it, and so does a file landing in decisions/ (watch the folder, or add it to the dirs the loop
// waits on; pick one, say which in the commit).

// person-inbox.mjs
// startPersonInbox({ …, onActivity = () => {} }): called after a watch-triggered drain that forwarded at
// least one input (not after the loop's own backstop drain, which runs inside a pass).

// commands.mjs
// startLines(lines, { …, onSettled = () => {} }): called once when the handle's result is set (ok or not).
```

In `main()`, the stall count (`STALL_GRACE`) and the runaway grace (`OVER_GRACE`, `runawayVerdict`) keep
their wall-clock meaning (DESIGN §2.6): each fires only once its condition has held for at least grace ×
`POLL_MS` since the first pass it held on, as well as for grace passes. Otherwise a review hand-off, which
holds ceiling + 1 while the implementer exits, aborts as a runaway within a second of wake-driven passes.

In `main()`: `const waker = createWaker({ minGapMs: PASS_MIN_GAP_MS })` with `PASS_MIN_GAP_MS = 250`, built
before the platform so `onActivity: () => waker.wake()` can be passed to it; `plan-run.mjs` keeps
`minGapMs` 0 so its behaviour is unchanged.

## Tests

- [ ] waker: wake before wait makes the next wait return at once, and only that one
- [ ] waker: wake during wait resolves it; two wakes during one wait give one return and no early flag
- [ ] waker: a wait with no wake ends on the timeout (backstop unchanged) and on a drop in a watched dir
- [ ] waker: with minGapMs, a wake 50 ms after the last return resolves at the gap's end, not before
- [ ] waker: signal abort resolves the wait
- [ ] wakesLoop: note → false; request, out (result and text), in, a non-object → as specified
- [ ] platform: a fake worker's request, output and exit each call onActivity; a note entry does not; an
      onActivity that throws does not stop workers.json being written
- [ ] coordinator agent: its worker's event and a decision file landing each call onActivity
- [ ] person inbox: a watch-triggered drain that forwarded calls onActivity; an empty drain does not
- [ ] startLines: onSettled fires once on success, once on a failing line, once on a spawn error
- [ ] runawayVerdict (or its caller): ceiling + 1 over three passes inside grace × POLL_MS does not abort;
      held past grace × POLL_MS it does; ceiling + 2 still aborts at once
- [ ] stall: three quiet wake-driven passes inside grace × POLL_MS do not end the run
- [ ] plan-run: its existing tests still pass on the moved waker

## Done when

- [ ] Every event in DESIGN §2.1's table reaches `waker.wake()` in `coordinate.mjs main()`, each covered
      by a unit test above.
- [ ] A review hand-off with passes 250 ms apart is not aborted as a runaway, and a run is not declared
      stalled before STALL_GRACE × POLL_MS of quiet (the two grace tests above).
- [ ] `npm test` is green, and the coordinator drill file(s) are measurably faster at the default
      `PARALLEL_POLL_MS` (before and after times in the commit, taken back to back, quiet or under load per DESIGN §5 Measuring time).
- [ ] The three docs lines and the README sentence describe the loop waking on activity with the 5 s
      timer as a backstop.
