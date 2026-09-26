# T05 — live-asking-check

**Phase:** 3 · **Depends on:** T04 · **Weight:** medium

## Goal

See the whole rule on a real run: rows turn `asking you` only when a worker is waiting, and come back
off it at the right moment for each way the person answers, while a background wake-up leaves the row
asking. This is the final deliverable.

## Design sections this implements

DESIGN §1 success criteria, §5.2, §5.3.

## Files

- `src/shell/harness/fixtures/real-asking.mjs` (new), registered where the other fixtures are.
- `src/shell/harness/fixtures.test.mjs` if fixtures are enumerated there.

## Fixture

Two independent tasks at ceiling 2, harness timeout 15 min:

- T01: its wording is unspecified; the worker drops a `question` report, keeps working briefly (writes a
  placeholder file), then asks the person in plain text and ends its turn.
- T02: the worker starts a background `sleep 60`, then drops a `question` report asking for a choice and
  ends its turn; the sleep finishes and wakes it.

## Tests

- [ ] The fixture parses and registers (`fixtures.test.mjs`).

## Done when

- [ ] Run captured: T01 read `building` until its turn ended, then `asking you`; after the phone answer,
      `building` within one pass (from `status.json` snapshots in the run's control folder).
- [ ] T02 stayed `asking you` across the wake-up, and left it on the person's answer in `pir`.
- [ ] FINDINGS.md has the dated verified-by-hand row.

## Environment (the worker owns this)

```
node src/shell/harness/run.mjs real-asking --into /tmp/real-asking-live
# teardown: the harness tears down on finish or timeout; then confirm no worker is left
touch /tmp/real-asking-live/plans/real-asking/.parallel/control/HALT 2>/dev/null; rm -rf /tmp/real-asking-live
```

## Automated checks (the worker runs these)

- Read the run's `status.json` history or log lines and confirm each transition above with timestamps.

## Outside actions

- Live harness run, `worker` bin (DESIGN §5.3).

## Needs a person

- When T01 reads `asking you`: "Answer T01's question on your phone, in the Claude app session named
  after T01." Tell me: when you sent it.
- When T02 has been woken by its background job: "Open T02 in `pir` and answer its question there."
- Tell me: whether your phone was notified for T01 only once its turn had ended, not while it was
  still working.
