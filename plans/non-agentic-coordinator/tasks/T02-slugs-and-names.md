# T02 — slugs-and-names

**Phase:** 1 · **Runs:** auto · **Depends on:** — · **Weight:** medium

## Goal

Make a task's slug first-class and give workers readable names. Today a worker's name carries only
its number, so `claude agents` cannot tell what a worker is doing, and the separator is `·` only
because SendMessage once rejected `/`. With the down-channel gone, revert to `/` and add the slug: a
worker's name becomes `{repo} / {plan} / {task} / {slug} / {role}`. The task number stays the key the
program matches a worker on across a restart, so adding the slug must not break that.

**This task keeps the suite green while touching a shared helper.** `naming.mjs` is consumed all over
the harness, which is not reworked until T05. So this task's naming change is additive and
backward-tolerant: it does **not** delete `coordinatorName` or the `verify` role — those come out in
T05, once their last callers (in the harness and, for `coordinatorName`, `capture.mjs`) are gone. The
`verify` code path in the loop/platform is removed separately in T04.

## Design sections this implements

DESIGN §2.9 (task slugs and agent names). The `verify` role and `coordinatorName` deletions live in
T05, not here (see §2.5, §3.2).

## Files

- `src/core/naming.mjs` (+ `naming.test.mjs`) — the separator (`·`→`/`) and the worker-name shape (add
  the `slug` field to `workerName` and `parseAgentName`). Keep `coordinatorName` and the `verify` role
  defined (removed in T05). Keep parsing tolerant enough that the not-yet-migrated harness callers still
  round-trip, so the suite stays green until T05.
- `src/shell/loop.mjs` (+ `loop.test.mjs`) — at spawn, pass the task's slug (the parsed `PROGRESS.md`
  Task value) into `workerName`.
- `src/shell/coordinate.mjs` (+ `coordinate.test.mjs`) — if `main()` constructs or matches worker names,
  carry the slug through. Leave the `coordinatorName` startup log line to T03 (which removes the
  coordinator-session output when it rebuilds `main()`).

## Interface

```
const SEP = ' / ';
const WORKER_ROLES = ['implement', 'review', 'verify'];   // 'verify' stays until T05

workerName({ repo, plan, task, slug, role })
  → `${repo} / ${plan} / ${task} / ${slug} / ${role}`
  // task is a full id ('T05'); slug is kebab; role ∈ WORKER_ROLES.

parseAgentName(name) → { repo, plan, task, slug, role, matches }
  // split on ' / '; a 5-part name with task /^T\d+$/ and a known role → matches:true, slug carried.
  // The 5-field `/` form is the target. Keep the transition green: names the not-yet-migrated
  // harness still produces must not throw or mis-match; T05 migrates the harness to the 5-field form.

isWorkerOf(name, { repo, plan, role? }) → boolean   // by repo/plan (role optional)
// buildAssignments (loop.mjs) keys worker→task on parseAgentName(name).task — the NUMBER — so a
// slug in the name never changes which task a worker is matched to.
```

## Tests

- [ ] `parseAgentName(workerName(x))` round-trips every field, including the slug, across `/`.
- [ ] The task number is extracted correctly when a slug is present (`.task === 'T05'` for a name with
      slug `budget-ledger`).
- [ ] `isWorkerOf` matches a worker of this repo/plan and rejects another plan's worker and a
      malformed name.
- [ ] `buildAssignments` maps a live worker to its task by number when the name carries a slug
      (restart matching survives the slug).
- [ ] `loop` passes the task's slug into the spawned worker's name.
- [ ] `coordinatorName` and the `verify` role are still defined (their removal is T05); the full suite,
      including the harness tests, stays green.

## Done when

- [ ] Worker names are `{repo} / {plan} / {task} / {slug} / {role}`, `/`-separated; the number is
      still extracted for restart matching, and the slug does not affect worker→task matching.
- [ ] `npm test` is green — including the harness tests, which still call `coordinatorName` and build
      names until T05. (That `claude --bg -n` accepts a `/` at launch is confirmed live in T09.)
