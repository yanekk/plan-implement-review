# T06 — Feature branch + task worktree create / integrate / merge / promote

**Phase:** 3 · **Depends on:** T05 · **Weight:** medium · **Runs:** auto

## Goal

The real git plumbing behind the fake from T05, built before any live agent so a runaway or
abandoned worker can always be torn down. It implements the branch model of DESIGN §2.9: open a
feature branch for the plan off `main`; create a task worktree and branch off the feature branch;
integrate the feature branch into a task branch (surfacing a conflict, not resolving it); merge a
task branch into the feature branch one at a time; promote the feature branch to `main` once; and
remove a worktree and branch. This is the recovery half of the machine, and recovery is built
before the thing that keeps agents alive.

## Design sections this implements

DESIGN §2.9 (the branch model and promotion), §2.3 (create/close), §2.5 (serialized merge into the
feature branch, conflict surfacing, crash cleanup), §3.2 (`worktree.mjs`), §6 (recovery).

## Files

- `src/shell/worktree.mjs` — the real implementation of the T05 worktree interface.
- `src/shell/worktree.test.mjs` — run against a scratch git repo in the test's temp dir.

## Interface

```
openFeature(plan) → { path, branch }      // create pir/{plan} off main IN ITS OWN WORKTREE (the
                                          //   coordinator works there; the user's main checkout
                                          //   stays on main, §2.9); reuse both if they already
                                          //   exist (restart re-opens the same feature worktree)
createTask(plan, task) → { path, branch } // worktree on pir/{plan}-T{nn}, cut from the feature branch
integrate(path) → { ok } | { conflict: [files] }   // merge the FEATURE branch into the task branch
mergeTask(taskBranch) → { ok } | { conflict: [files] }  // merge task branch into the feature branch
promote(plan) → { ok } | { conflict: [files] }     // merge pir/{plan} into main — the one merge to main
remove({ path, branch }) → { ok }         // git worktree remove (force if needed) ; git branch -d/-D

integrate and mergeTask never auto-resolve; they report conflicts so the worker (integrate) or the
coordinator (mergeTask) decides. promote is called only when the plan is complete; the coordinator
runs the tests before calling it. remove force-drops a dirty worktree, because claude rm keeps one
(FINDINGS.md).
```

The tests operate on a throwaway repo under a temp dir — never the real project — which is the
seatbelt; no agent is spawned here.

## Tests

- [ ] `openFeature` creates `pir/{plan}` off main in its own worktree, leaves the current checkout
      on main, and a second call reuses that worktree, not a duplicate.
- [ ] `createTask` makes a worktree and `pir/{plan}-T{nn}` off the FEATURE branch, not main.
- [ ] `integrate` brings a diverged feature branch into the task branch cleanly, and reports the
      conflicting files when both touched the same lines.
- [ ] `mergeTask` merges a clean task branch into the feature branch and reports a conflict otherwise.
- [ ] `promote` merges the feature branch to main, and main is unchanged until promote is called.
- [ ] `remove` deletes the worktree and branch, including a worktree with uncommitted changes.
- [ ] Two `mergeTask` calls run one after another (the caller serializes; prove a second waits).

## Done when

- [ ] All operations work against a scratch repo; conflicts are surfaced, not resolved; and main is
      untouched until `promote`.
- [ ] A created task worktree can always be removed, including after a simulated abandonment.
- [ ] `npm test` is green.

## Needs a person

The automated tests use a scratch repo, so they are self-contained. What a person confirms is that
the same operations behave on the real project's git — once, lightly, never as part of an agent run:

```
# in a scratch clone of THIS repo, not the working copy:
node -e "import('./src/shell/worktree.mjs').then(async m => { const f = await m.openFeature('demo'); const w = await m.createTask('demo','T99'); console.log({f,w}); await m.remove(w); await m.remove(f); })"
```

Expect: a feature-branch worktree and a task worktree created off it, both cleanly removed,
`git worktree list` clean, and the current checkout still on main throughout.
Tell me: whether openFeature+createTask+remove left anything behind, whether the checkout stayed on
main (openFeature did not switch it), and whether main stayed clean.
