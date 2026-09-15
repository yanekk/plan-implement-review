# T35 — Harness runner false-stalls in the worker gap while the coordinator is idle

**Phase:** 8 (coverage: hands-on verification) · **Depends on:** T33 · **Weight:** light · **Runs:** auto

## Why this exists

The T34 confirmation rerun stalled (2026-09-15, bundle `pir-t17-hands-on-3nyF3G/…/2026-09-15T12-14-55-197Z`):
the flow log ran `spawn T01 … merge T01 … close T01` and then stopped — no `spawn T02`, no promote. The
run was declared `stalled` and torn down ~6s after `close T01`, before the T02 hands-on worker could spawn.

Root cause is in the harness runner's stall detector, `waitForCompletion` in `src/shell/harness/run.mjs`,
not in the product. The detector keeps a run alive while a worker is live OR the coordinator is "active",
and judged the coordinator active only when `coord.state !== 'done'`. But after the coordinator launches the
bin it ends its opening turn and watches the flow log via a Monitor, so `claude agents --json` reports it
`state:'done'` (turn finished; `status` still `busy`/`idle`) for essentially the whole run. So the runner
read the still-driving coordinator as gone, and the run stayed alive only while a worker was live. The
instant the build worker closed and before the verify worker's slow `claude --bg` cold-start appeared —
no worker live AND coordinator `done` — the detector counted `stallGrace` (3) quiet polls (~6s) and HALTed.

Evidence, from the captured `agents-timeline.jsonl`: the coordinator is `('done','busy')` on every sample,
including while workers were active; the run stalled the poll after the last worker vanished (12:19:04 →
12:19:08). `startupGrace` (~90s) covers only the FIRST spawn; a later spawn after a worker gap gets only
the ~6s `stallGrace`, far short of a cold-start. T33 passed only because that gap happened to be short.

The product is unaffected: the bin's own dispatch (`decideDispatch`) would spawn T02 from the correct
committed state (T01 ✅, T02 ⬜); a real coordinator run has no such runner. This is harness flakiness that
false-fails (and, by timing luck, once false-passed) the hands-on path and any fixture with a worker gap.

## What "done" must behave like

- The runner treats the coordinator as active whenever it is present in the agent list and not `stopped`
  (drop the `state !== 'done'` condition). A live-but-watching coordinator keeps the run active through the
  gap between one worker closing and the next spawning.
- A genuinely hung coordinator (alive, not promoting) is still ended by the wall-clock timeout
  (`isTimedOut`), and a finished run still returns first on its `promote` / `halt-close` hard terminal — so
  the change removes the false stall without masking a real end.
- No behaviour change to the startup-grace path, the HALT/`halt-close` path, or the timeout backstop.

## Files

- `src/shell/harness/run.mjs` — `waitForCompletion`: `coordActive = !!coord && coord.state !== 'stopped'`.
- `src/shell/harness/run.test.mjs` — a regression test reproducing the captured timeline (coordinator
  `state:'done'` throughout; a worker gap longer than `stallGrace`; a later worker + promote). It reaches
  `promoted` with the fix and would have `stalled` under the old guard.

## Tests

`npm test` green, including the new test. The fix is unit-provable (the wait loop runs on injected timers
and a faked agent list), so no live run is needed to prove the detector itself.

## Confirmation

The end-to-end proof is the T34 attended rerun reaching the hands-on handoff instead of stalling — the same
rerun that confirms T34's announcement. Both fixes ride the one rerun.

## Done when

- [ ] `waitForCompletion` counts a present, non-`stopped` coordinator as active; regression test added.
- [ ] `npm test` green.
- [ ] The T34 rerun reaches the hands-on step (no gap-stall) — recorded in FINDINGS with the date.
