# T10 — live-usage-check

**Phase:** 4 · **Depends on:** T08 · **Weight:** heavy

## Goal

See real numbers from real sessions come out of the API: a small live run on a scratch repo and a
scratch home, with this checkout's service beside it, must serve the newest `rate_limit_event` of the
run's own conversation logs, with `observed_at` moving while the run works. T08 proves the plumbing
with a fake event; only this shows that real Claude sessions send what §2.3 expects.

## Design sections this implements

DESIGN §1 success criteria (the first two), §2.3, §5.1, §5.3.

## Files

- `src/shell/harness/fixtures/usage-live.mjs` (new), registered in `FIXTURES`
  (`src/shell/harness/fixtures.mjs`), with its fixture test. Model it on `fixtures/parallel.mjs`
  without the kill switch: two independent trivial tasks at ceiling 2, `statusSnapshots: true` (so the
  run has `PIR_RUN=1` and a scratch `PIR_HOME`), no coordinator agent, no question, harness timeout 20 min.
- `src/shell/harness/usage-live-check.mjs` (new) and its test

## Interface

```js
// Starts the harness run as a child (`node src/shell/harness/run.mjs usage-live --into <into>`),
// starts startApiService on the run's scratch home ({into}/plans/usage-live/.parallel/pir-home, where
// the harness puts it for a statusSnapshots scenario), and polls GET /v1/usage every 5 s until the run
// exits, keeping each distinct observed_at. Then reads every conversations/*.ndjson of the run, takes
// the rate_limit_event entry with the greatest `t`, and compares.
export async function usageLiveCheck({ into, spawn, get, now, log }) // → { ok, polls, distinct, api, newest, text }

// node src/shell/harness/usage-live-check.mjs --into /tmp/usage-live → prints `text`, exits 0 or 1.
```

`ok` needs all of: the harness run passed; the final API body's `observed_at` equals the newest
entry's `t`; both windows equal that event's `unifiedWindows` (× 100, `resets_at` as given); at least
two distinct `observed_at` values were seen. When the logs hold no `rate_limit_event` at all, `text`
says so and names the login (`claude auth status`): that is a finding about the account, not a pass.

## Tests

- [ ] fixture test: two independent tasks, `statusSnapshots` on, registered under `usage-live`
- [ ] `usageLiveCheck` with a fake `spawn` and `get` and a prepared conversations folder: matching numbers and two distinct times → `ok`
- [ ] the API one event behind the log → not ok, the text shows both
- [ ] one distinct time only → not ok, the text says `observed_at` did not move
- [ ] no `rate_limit_event` in any log → not ok, the text names the login
- [ ] the run failing → not ok, whatever the numbers
- [ ] the service is closed and the child ended in `finally`

## Environment (the worker owns this)

```
claude auth status                                                # expect loggedIn true, authMethod claude.ai
node src/shell/harness/usage-live-check.mjs --into /tmp/usage-live
# teardown: the harness tears down on finish or timeout; then
touch /tmp/usage-live/plans/usage-live/.parallel/control/HALT 2>/dev/null; rm -rf /tmp/usage-live
```

Confirm afterwards that no worker of the run is alive and that `/tmp/usage-live` is gone.

## Outside actions

- Live harness run with real workers — `worker`
- Remove T10's scratch folder — `worker`

## Automated checks (the worker runs these)

The check's own exit code and printed `text`. Record in FINDINGS, dated and marked worker-driven:
how many events the run yielded, how many distinct `observed_at` values, whether every event carried
`unifiedWindows`, and the final comparison. If fewer than two events arrived in the run, that is a
result to report, not a reason to loosen the check: say so and ask the person whether a longer
fixture is wanted.

## Done when

- [ ] `npm test` is green with the cases above.
- [ ] The live check ran once on this machine and its result is a dated FINDINGS row.
- [ ] `/tmp/usage-live` is removed and no worker of the run is left.
