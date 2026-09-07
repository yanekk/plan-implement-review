# T06 — Real worktree create / integrate / merge / close

**Phase:** 3 · **Depends on:** T05 · **Weight:** medium · **Runs:** auto

## Goal

The real git plumbing behind the fake from T05, built before any live agent so a runaway or
abandoned worker can always be torn down. Create a worktree and branch off `main`, integrate the
latest `main` into a branch (surfacing a conflict rather than resolving it here), merge a clean
branch to `main` one at a time, and remove a worktree and branch. This is the recovery half of the
machine, and recovery is built before the thing that keeps agents alive.

## Design sections this implements

DESIGN §2.3 (create/close), §2.5 (serialized merge, conflict surfacing, crash cleanup), §3.2
(`worktree.mjs`), §6 (recovery).

## Files

- `src/shell/worktree.mjs` — the real implementation of the T05 worktree interface.
- `src/shell/worktree.test.mjs` — run against a scratch git repo in the test's temp dir.

## Interface

```
create(task) → { path, branch }        // git worktree add <path> -b <branch> off main
integrate(path) → { ok } | { conflict: [files] }   // merge main into the branch; report conflict
merge(branch) → { ok } | { conflict: [files] }     // merge branch into main; serialized by caller
remove({ path, branch }) → { ok }      // git worktree remove (force if needed) ; git branch -d/-D

Branch names derive from the task, e.g. "pir/T06". integrate and merge never auto-resolve; they
report conflicts so the worker (integrate) or the coordinator (merge) decides. remove force-drops
the worktree when needed, because claude rm keeps a dirty worktree (FINDINGS.md).
```

The tests operate on a throwaway repo under a temp dir — never the real project — which is the
seatbelt; no agent is spawned here.

## Tests

- [ ] `create` makes a worktree and branch off main in a scratch repo; `git worktree list` shows it.
- [ ] `integrate` brings a diverged main into the branch cleanly when there is no conflict.
- [ ] `integrate` reports the conflicting files when main and the branch touched the same lines.
- [ ] `merge` merges a clean branch to main and reports a conflict otherwise.
- [ ] `remove` deletes the worktree and branch, including a worktree with uncommitted changes.
- [ ] Two `merge` calls run one after another (the caller serializes; prove a second waits).

## Done when

- [ ] All four operations work against a scratch repo and conflicts are surfaced, not resolved.
- [ ] A created worktree can always be removed, including after a simulated abandonment.
- [ ] `npm test` is green.

## Needs a person

The automated tests use a scratch repo, so they are self-contained. What a person confirms is that
the same operations behave on the real project's git and `main` — once, lightly, never as part of
an agent run:

```
# in a scratch clone of THIS repo, not the working copy:
node -e "import('./src/shell/worktree.mjs').then(async m => { const w = await m.create('T99'); console.log(w); await m.remove(w); })"
```

Expect: a worktree and branch created and then cleanly removed, `git worktree list` clean.
Tell me: whether create-then-remove left anything behind on the real git.
