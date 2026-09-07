# T05 — Fake spawn/message/list/close + the coordinator loop

**Phase:** 2 · **Depends on:** T03 · **Weight:** medium · **Runs:** auto

## Goal

Build the seatbelt and the loop together: a fake platform that stands in for real agents and real
git, and the coordinator cycle that drives the pure decisions against it. The fakes answer spawn /
send-message / list / close and a scratch git repo answers worktree create / integrate / merge /
close, so the whole loop runs with zero live paid agents and no touch of the real `main`. Wired to
the fakes, a fake plan of several tasks with dependencies drains to all-`✅`, and a `you` task is
surfaced rather than dispatched. This is the end-to-end proof of the wiring before anything real,
and the fakes are built before the real platform so the dangerous capability is rehearsable first.

## Design sections this implements

DESIGN §5.2 (the `PARALLEL_DRY_RUN` seatbelt), §3.2 (`loop.mjs` and the shell interface the fakes
mirror), §3.3 (the decision function in its loop), §2.4 (ceiling, halted), §2.5 (serialized
merge), §2.6 (surfacing `you` tasks), §2.9 (feature branch, task branches, promotion).

## Files

- `src/shell/loop.mjs` — the coordinator cycle, taking its platform as an injected dependency.
- `src/shell/fake/platform.mjs` — fake spawn / send / list / close, scriptable.
- `src/shell/fake/worktree.mjs` — fake worktree/merge against a scratch repo.
- `src/shell/loop.test.mjs` and the fakes' tests.

## Interface

```
The fakes present exactly the shell interface T06/T08 give the real platform, so the loop is
written once and run against either:

  platform: spawn(cwd, task, phase) → id     // phase: "implement"|"review"; spawn sets the worker's
            name to @{repo}/{plan}/T{nn} (naming.mjs). send(name|id, msg) ;
            list() → [{id,name,cwd,status,state,live}] ; close(id) ; inbox() → [message]
  worktree: openFeature(plan) → {path,branch} ; createTask(plan,task) → {path,branch} ;
            integrate(path) → {ok|conflict} ; mergeTask(taskBranch) → {ok|conflict} ;
            promote(plan) → {ok|conflict} ; remove({path,branch})   // DESIGN §2.9 branch model

runPass({ platform, worktree, repo, slug, maxWorkers, now }) → { actions, log }
  // gather: parse PROGRESS; list workers and rebuild assignments via parseAgentName over their
  //   names (task identity) plus the phase tracked from inbox messages; read the control flag →
  //   decideDispatch →
  // execute: openFeature once at start (in the coordinator's own worktree), spawn auto tasks (as
  // pir-implement Txx) on task branches off the feature branch, surface you tasks, spawn a fresh
  // reviewer (pir-review Txx) for review-ready workers AND close their implement session, merge one
  // done task branch into the feature branch, close finished/dead, and when all ✅ promote the
  // feature branch to main → reconcile merged rows → actions + log.
  // a surfaced you task the user reports done is marked ✅ on the feature branch via
  // reconcileTaskRow (coordinator stays the single writer), unblocking its dependents next pass.
drain(...) → summary   // repeat runPass until no ready tasks and no live workers, or halted.

A fake worker, when spawned for a phase and messaged, advances (implement → review-ready →
[fresh reviewer] reviewing → done) and can be scripted to raise a question or a merge conflict.
```

## Tests

- [ ] A fake plan of e.g. 5 tasks with a dependency chain drains to all-`✅` on the feature branch,
      then promotes to the scratch main exactly once; main is untouched until that promotion.
- [ ] Task branches are cut from the feature branch and merge back into it, not into main.
- [ ] Two independent ready tasks are worked concurrently (two fake workers live at once).
- [ ] Fake workers are named `@{repo} / {plan} / T{nn}`; the loop rebuilds which worker holds which
      task from those names, and identifies its own workers by the `@{repo} / {plan} /` prefix.
- [ ] Each implemented task gets a fresh reviewer worker (a distinct id, same task name) before merge.
- [ ] The implement session is closed when its reviewer spawns, so a task in review holds one slot.
- [ ] A `you` task with deps met is surfaced, never spawned, and does not consume a slot.
- [ ] A surfaced `you` task reported done is marked `✅` on the feature branch and unblocks the tasks
      that depend on it (a `you` task on the critical path gates its dependents until then).
- [ ] The ceiling is respected; merges are serialized (two done ≠ two merges per pass).
- [ ] A scripted worker question surfaces via the inbox and a sent answer resumes that worker.
- [ ] A scripted merge conflict surfaces as a decision, not a merge onto scratch main.
- [ ] Setting the control flag mid-drain stops dispatch and closes every fake worker.
- [ ] With `PARALLEL_DRY_RUN=1` nothing calls a real `claude` or the real repo.

## Done when

- [ ] `drain` takes a fake plan to all-`✅` with dependencies, ceiling, serialized merges into the
      feature branch and fresh review before merge all respected, `you` tasks surfaced not spawned,
      and a single promotion to main at the end.
- [ ] Questions, conflicts and the kill switch are handled in the loop and every event logged.
- [ ] `npm test` is green.
