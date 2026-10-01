# T08 — usage-e2e

**Phase:** 3 · **Depends on:** T04, T05 · **Weight:** medium

## Goal

Prove inside `npm test`, with fake sessions, that the parts meet: a run process started the way `pir`
starts it writes readings, and the service program running beside it serves exactly those numbers.
T04 and T05 each prove their own half with an injected counterpart; nothing before this task runs both.

## Design sections this implements

DESIGN §1 success criteria (the first two, with fake sessions), §2.4 (who writes), §4.

## Files

- `src/shell/api-usage-e2e.test.mjs` (new)
- one fake-session script step per run kind, in the fixtures or rig helpers those tests already use
  (`src/shell/harness/`, `src/shell/plan-rig.mjs`); the fake itself (`fake/claude-stream.mjs`) needs no
  change, its `emit` step sends any message

## Interface

No new interface. The event to emit, with `{{session}}` as the fake substitutes it:

```json
{ "type": "rate_limit_event", "session_id": "{{session}}", "uuid": "00000000-0000-4000-8000-0000000000aa",
  "rate_limit_info": { "status": "allowed", "rateLimitType": "five_hour", "resetsAt": 1790334600,
    "unifiedWindows": { "five_hour": { "utilization": 0.2, "resetsAt": 1790334600 },
                        "seven_day": { "utilization": 0.11, "resetsAt": 1790830800 } } } }
```

## Tests

Each on a temp `PIR_HOME`, the service as a child process (`node src/shell/api-service.mjs`) found
through that home's `api.json`.

- [ ] service up, nothing written → 200 with nulls
- [ ] `startWorker` with the fake emitting the event, `reportUsage` from `usageReporterFromEnv({ PIR_RUN: '1', PIR_HOME })` → `/v1/usage` reads 20 and 11, and `observed_at` equals the `t` of that event's entry in the conversation log
- [ ] a second event with other numbers → the API serves the second, `observed_at` moved forward
- [ ] SIGTERM the service, start it again → the same reading, the same `observed_at`, a new `pid` in `api.json`
- [ ] a build run: one harness scenario with `statusSnapshots` (so `PIR_RUN=1` and a scratch `PIR_HOME`), a fake build worker whose script emits the event → `{pirHome}/.pir/usage.json` exists and parses, with no `reportUsage` passed anywhere
- [ ] a planning run: one plan-rig test whose fake planner emits the event → the rig home's `.pir/usage.json` exists and parses
- [ ] the person's real `~/.pir/usage.json` is not created or modified by the suite: record its mtime (or absence) before and after in this test file

## Done when

- [ ] `npm test` is green with the cases above, and no slower than 5 s more than before (the suite has a 1:30 budget, `plans/fast-tests`).
- [ ] The two run-kind tests fail when the `reportUsage` default in `worker-proc.mjs` is set to `null`: check it once by hand and say so in the commit message.
