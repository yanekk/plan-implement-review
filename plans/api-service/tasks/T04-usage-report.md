# T04 — usage-report

**Phase:** 2 · **Depends on:** T01, T02 · **Weight:** medium

## Goal

A run saves every usage reading its workers hear to `usage.json`, without any caller of `startWorker`
knowing, and without any way for a failure to reach the run.

## Design sections this implements

DESIGN §2.4, §2.8 (usage-file column), §3.4.

## Files

- `src/shell/usage-report.mjs` (new), `src/shell/usage-report.test.mjs` (new)
- `src/shell/worker-proc.mjs`: a `reportUsage` parameter on `startWorker` and one call in the message loop
- `src/shell/worker-proc.test.mjs`: the wiring cases below

## Interface

```js
// null unless env.PIR_RUN === '1' and homeKind(env, osHome) is 'real' or 'scratch'. The returned
// function never throws: it builds the reading (core/usage readingFromEvent), returns on null, and
// writes apiFiles(dirname(indexDir({ env }))).usage with writeFileAtomic.
export function usageReporterFromEnv(env, { osHome = userInfo().homedir, write = writeFileAtomic } = {})
// → ((message, observedAt) => void) | null

// usageReporterFromEnv(process.env), computed once per process.
export function defaultUsageReporter()

// worker-proc.mjs
export function startWorker({ …, reportUsage = defaultUsageReporter() })
// in the stream loop:
//   const entry = log({ dir: 'in', event: m });
//   if (reportUsage) { try { reportUsage(m, entry.t); } catch {} }
```

The call sits after `log`, so a reading's `observed_at` is the log entry's `t` (§2.4). The `try`
around the call is deliberate although the reporter never throws: an injected one might.

## Tests

- [ ] `PIR_RUN` unset → null; `PIR_RUN=1` with a scratch `PIR_HOME` → a function
- [ ] `PIR_RUN=1`, home equal to `osHome`, `NODE_TEST_CONTEXT` set → null
- [ ] the reporter writes `{PIR_HOME}/.pir/usage.json`, creating `.pir`, and `parseReading` reads it back
- [ ] a second event overwrites the first; an event with no `unifiedWindows` leaves the file untouched
- [ ] a non-usage message writes nothing
- [ ] `write` throwing, and `PIR_HOME` pointing at a file rather than a folder → no throw
- [ ] no `.tmp` file is left behind after a write
- [ ] `startWorker` with the fake `claude` emitting two `rate_limit_event`s and an injected `reportUsage`: called twice, each with the message and the `t` of its log entry
- [ ] an injected `reportUsage` that throws: the worker's log, listeners and exit are unaffected
- [ ] `startWorker` with no `reportUsage` under the test runner writes nothing (the default is null here)

## Done when

- [ ] `npm test` is green with the cases above, and the existing `worker-proc`, `platform`, `plan-run` and `coordinator-agent` tests pass unchanged.
- [ ] `grep -rn "reportUsage" src --include='*.mjs'` shows it only in `worker-proc.mjs`, `usage-report.mjs` and their tests: no caller passes it.
