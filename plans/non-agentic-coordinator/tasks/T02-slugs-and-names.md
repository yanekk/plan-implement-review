# T02 — slugs-and-names

**Phase:** 1 · **Runs:** auto · **Depends on:** — · **Weight:** medium

## Goal

Make a task's slug first-class and give workers readable names. Today a worker's name carries only
its number, so `claude agents` cannot tell what a worker is doing, and the separator is `·` only
because SendMessage once rejected `/`. With the down-channel gone, revert to `/` and add the slug: a
worker's name becomes `{repo} / {plan} / {task} / {slug} / {role}`. The task number stays the key the
program matches a worker on across a restart, so adding the slug must not break that. This also drops
the coordinator name (the coordinator is a plain process, never a session) and the `verify` role (no
hands-on worker), since both live in `naming.mjs` and this task reworks that file once.

## Design sections this implements

DESIGN §2.9 (task slugs and agent names) and §2.5 (the `verify` role removal, folded here because it
is the same file).

## Files

- `src/core/naming.mjs` (+ `naming.test.mjs`) — the separator, the worker-name shape, the parse, the
  role set; remove `coordinatorName` and the `verify` role.
- `src/shell/loop.mjs` (+ `loop.test.mjs`) — at spawn, pass the task's slug (the parsed `PROGRESS.md`
  Task value) into `workerName`.
- `src/shell/coordinate.mjs` (+ `coordinate.test.mjs`) — the startup log line that printed
  `coordinatorName(...)` prints the plain plan name instead.

## Interface

```
const SEP = ' / ';
const WORKER_ROLES = ['implement', 'review'];   // no 'verify'

workerName({ repo, plan, task, slug, role })
  → `${repo} / ${plan} / ${task} / ${slug} / ${role}`
  // task is a full id ('T05'); slug is kebab; role ∈ WORKER_ROLES.

parseAgentName(name) → { repo, plan, task, slug, role, matches }
  // split on ' / '; exactly 5 parts and task matching /^T\d+$/ and a known role → matches:true.
  // anything else (a `·`-separated legacy name, a 2-part name, junk) → all-null, matches:false.

isWorkerOf(name, { repo, plan, role? }) → boolean   // by repo/plan (role optional)
// buildAssignments (loop.mjs) keys worker→task on parseAgentName(name).task — the NUMBER — so a
// slug in the name never changes which task a worker is matched to.
```

## Tests

- [ ] `parseAgentName(workerName(x))` round-trips every field, including the slug, across `/`.
- [ ] The task number is extracted correctly when a slug is present (`.task === 'T05'` for a name with
      slug `budget-ledger`).
- [ ] `isWorkerOf` matches a worker of this repo/plan and rejects another plan's worker and a
      malformed or `·`-separated name.
- [ ] `WORKER_ROLES` has no `verify`; a `verify` role is rejected; `coordinatorName` is gone.
- [ ] `buildAssignments` maps a live worker to its task by number when the name carries a slug
      (restart matching survives the slug).
- [ ] `loop` passes the task's slug into the spawned worker's name.

## Done when

- [ ] Worker names are `{repo} / {plan} / {task} / {slug} / {role}`, `/`-separated; the number is
      still extracted for restart matching, and the slug does not affect worker→task matching.
- [ ] `naming.mjs` has no coordinator name and no `verify` role.
- [ ] `npm test` is green. (That `claude --bg -n` accepts a `/` at launch is confirmed live in T09.)
