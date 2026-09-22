# T09 — stop-and-remove

**Phase:** 2 · **Depends on:** T05, T06 · **Weight:** medium

## Goal

The front-end side of stopping and removing a run. Stop is immediate: signal the coordinator to
shut the run down now, and if it does not exit within a grace period, force-kill it and reap the
run's workers directly so nothing is left burning tokens. Remove clears a non-running run's record
and snapshot without touching the plan. The coordinator's cooperative half of stop is T10; this is
the caller that drives it and the safety net when it does not answer.

## Design sections this implements

DESIGN §2.6 (stop — immediate), §2.7 (remove), §5.2 (stop grace + escalation).

## Files

- `src/shell/control-run.mjs` — new.
- `src/shell/control-run.test.mjs` — new.
- Reuses `src/shell/identity.mjs` (T05), `src/shell/index-store.mjs` (T06),
  `src/shell/snapshot-store.mjs` (T07) for removing the snapshot, and the worker-reap primitives
  from `createPlatform(...)` in `src/shell/platform.mjs` (its `.list()` / `.close(id)` methods — they
  are object methods, not standalone exports) with `src/core/naming.mjs` (`isWorkerOf`).

## Interface

```
stopRun(record, { kill, exec, now, sleep, graceMs = 4000, fs, platform } = {}) →
  { stopped:true, escalated:boolean }
  // 1. SIGTERM the coordinator pid (record.pid), if alive (T05).
  // 2. poll aliveness until it exits or graceMs elapses.
  // 3. if still alive: SIGKILL it, then enumerate this run's workers —
  //    platform.list().filter(w => isWorkerOf(w.name, { repo: record.repo, plan: record.slug }))
  //    — and platform.close(w.id) each — escalated:true. isWorkerOf takes the full worker NAME plus
  //    { repo, plan }, and close takes the session id (naming.mjs / platform.mjs signatures).
  // 4. leave the task worktrees in place (§2.6); the next start reconciles them.

removeRun(record, { fs } = {}) →
  { removed:true }
  // removeRecord (T06) + delete status.json (T07); the plans/{slug}/ files are untouched.
```

`graceMs` is the one open `how` (PLAN): 4 s default, long enough for the coordinator's own stop
handler (T10) to close its workers, short enough to feel immediate. `kill`, `exec`, `sleep`, `now`
and `platform` are injected so tests drive the timeline and the reap without real signals or a real
`claude agents` call.

Reason stop signals rather than kills first: the coordinator knows its own workers and closes them
as part of a clean stop (T10); force-kill plus a direct reap is the safety net for a wedged
coordinator, not the normal path (§2.6).

## Tests

- [ ] stop: coordinator exits within grace → one SIGTERM, no SIGKILL, `escalated:false`.
- [ ] stop: coordinator still alive after grace → SIGKILL sent and workers enumerated and closed,
      `escalated:true`.
- [ ] stop on a coordinator already gone → no signal, returns stopped (idempotent).
- [ ] stop never removes worktrees (assert no worktree-removal call is made).
- [ ] escalated reap closes only workers matching `isWorkerOf(w.name, { repo, plan: slug })`, not another run's.
- [ ] remove deletes the index entry and the snapshot and returns removed.
- [ ] remove leaves `plans/{slug}/` untouched (assert no write under it).

## Done when

- [ ] Stop is immediate with a bounded escalation to force-kill + worker reap, and never touches worktrees.
- [ ] Remove clears only the record and snapshot, never the plan.
- [ ] `npm test` passes.
