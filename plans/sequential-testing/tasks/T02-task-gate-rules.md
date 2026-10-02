# T02 — task-gate-rules

**Phase:** 1 · **Depends on:** — · **Weight:** medium

## Goal

The pure rules of the per-task test gate in a build: given what a task's gate knows (its role, the
reported head, the job's state and result, the current head and cleanliness, the tries used), the one
next step; the red, leftover and retest texts sent to workers; the stop reason; and the resume table that
sends an untested `🔍` or `✅` branch back to a fresh worker instead of onward. The loop (T05, T07) only
executes what this returns.

## Design sections this implements

DESIGN §2.1 (the review skip), §2.3, §2.4 (stop reason shape), §2.5, §2.9, §3.3.

## Files

- `src/core/tasktests.mjs` (new), `src/core/tasktests.test.mjs` (new)
- `src/core/resume.mjs`, `src/core/resume.test.mjs`

## Interface

```js
export const TRY_LIMIT = 3;
decideTaskTests({
  role,                 // 'implement' | 'review'
  report,               // { kind: 'implemented'|'done', head } | null — the latest accepted report not yet gated
  job,                  // { head, state: 'queued'|'running' } | { head, state: 'settled', result } | null
  head, clean,          // the task branch head and whether its worktree is clean, read this pass
  tries,                // reds used by this worker so far
  greenImplementSha,    // from the ledger, for the review skip
  onlyPlanFiles,        // true when every commit greenImplementSha..head touches only plans/{slug}/
}) → { step: 'idle' }                       // no report pending
   | { step: 'enqueue', head }              // start a run for head
   | { step: 'requeue', head }              // cancel the job for an older head, start one for head
   | { step: 'wait' }                       // queued or running for the current head
   | { step: 'skip', head }                 // review only: treated as green without a run (DESIGN §2.1)
   | { step: 'green', head }                // result ok at the head, clean
   | { step: 'rerun', head }                // result ok, head moved
   | { step: 'leftover', head }             // result ok at the head, dirty
   | { step: 'red', tryNo }                 // tryNo = tries + 1, below TRY_LIMIT
   | { step: 'stop', tryNo: TRY_LIMIT }     // the third red
failureReason(result) → string   // setup/test line and exit as runFeatureTests words it;
                                 // { timedOut, limitMs } → 'timed out after {n} min';
                                 // { killedByPerson } → 'stopped by you from the test queue'
redMessage({ sha, reason, tryNo, logPath, tail, kind }) → string      // DESIGN §2.9, verbatim
leftoverMessage({ sha, status, kind }) → string                       // DESIGN §2.9
retestNote({ role }) → string                                         // DESIGN §2.5; names the kind to report
stopReason({ task, taskSlug, role, reason, logPath }) → { kind: 'tests-red', task, taskSlug, role, reason, logPath, tries: 3 }
```

`resume.mjs`: `decideResume({ featureTasks, branchStates, ledger = {}, heads = {} })` returns
`{ merge, review, resume, retest: [{ num, role }] }`. A `🔍` branch goes to `review` only when
`ledger[num]?.implement?.greenSha === heads[num]`, else `retest` with role `implement`; a `✅` branch goes
to `merge` only when `ledger[num]?.review?.greenSha === heads[num]`, else `retest` with role `review`.
Callers that pass no ledger get every `🔍`/`✅` as retest; the existing call site is updated in T07.

## Tests

- [ ] no report → idle; report, no job → enqueue at the report's head
- [ ] job queued or running for the current head → wait; for an older head with a newer report → requeue
- [ ] settled ok, head unchanged, clean → green; dirty → leftover; head moved → rerun
- [ ] settled red with tries 0 → red tryNo 1; tries 1 → red 2; tries 2 → stop
- [ ] a settled result for a head that is not the current head and red → rerun, not red (stale result discarded)
- [ ] review with onlyPlanFiles and a greenImplementSha → skip; implement never skips; review without a green sha → enqueue
- [ ] failureReason: setup line, test line, timeout (30 and 45 min), killed by person
- [ ] redMessage exact text for tries 1 and 2, kinds implemented and done; tail of zero lines
- [ ] leftoverMessage with one and several status lines; retestNote for both roles names `implemented` / `done`
- [ ] decideResume: 🔍 + green at head → review; 🔍 + green at an older sha → retest implement; 🔍 + no ledger → retest
- [ ] decideResume: ✅ + review green at head → merge; ✅ + implement green only → retest review; existing rows unchanged otherwise
- [ ] decideResume output sorted by task order in every list

## Done when

- [ ] Every function above exists with the listed tests green in `npm test`.
- [ ] The texts match DESIGN §2.5 and §2.9 verbatim.
- [ ] Existing `resume.test.mjs` cases still pass, updated only for the new `retest` list and ledger argument.
