# T04 — Fake spawn/message/list/close + the coordinator loop

**Phase:** 2 · **Depends on:** T03 · **Weight:** medium

## Goal

Build the seatbelt and the loop together: a fake platform that stands in for real agents and real
git, and the coordinator cycle that drives the pure decisions against it. The fakes answer spawn
/ send-message / list / close and a scratch git repo answers worktree create / integrate / merge
/ close, so the whole loop runs with zero live paid agents and no touch of the real `main`. Wired
to the fakes, a fake plan of several tasks with dependencies drains to all-`✅`. This is the
end-to-end proof of the wiring before anything real, and the fakes are built before the real
platform so the dangerous capability is rehearsable first.

## Design sections this implements

DESIGN §5.2 (the `PARALLEL_DRY_RUN` seatbelt), §3.2 (`loop.mjs` and the shell interface the fakes
mirror), §3.3 (the decision function in its loop), §2.4 (ceiling, halted), §2.5 (serialized
merge).

## Files

- `src/shell/loop.mjs` — the coordinator cycle, taking its platform as an injected dependency.
- `src/shell/fake/platform.mjs` — fake spawn / send / list / close, scriptable.
- `src/shell/fake/worktree.mjs` — fake worktree/merge against a scratch repo.
- `src/shell/loop.test.mjs` and the fakes' tests.

## Interface

```
The fakes present exactly the shell interface T05/T07 give the real platform, so the loop is
written once and run against either:

  platform: spawn(cwd, task) → id ; send(id, msg) ; list() → [{id,cwd,status,state,live}] ;
            close(id) ; inbox() → [message]      // messages workers "sent" the coordinator
  worktree: create(task) → {path,branch} ; integrate(path) → {ok|conflict} ;
            merge(branch) → {ok|conflict} ; remove({path,branch})

runPass({ platform, worktree, slug, maxWorkers, now }) → { actions, log }
  // gather (parse PROGRESS, list workers, read inbox, read control flag) → decideDispatch →
  // execute spawn/send/spawn-review/merge/close → reconcile merged rows → return actions + log.
drain(...) → summary   // repeat runPass until no ready tasks and no live workers, or halted.

A fake worker, when spawned and messaged, advances its phase (implementing → review-ready →
[fresh review] reviewing → done) and can be scripted to raise a question or a merge conflict, so
the loop's unhappy paths run without a real agent.
```

## Tests

- [ ] A fake plan of e.g. 5 tasks with a dependency chain drains to all-`✅`.
- [ ] Two independent ready tasks are worked concurrently (two fake workers live at once).
- [ ] Each implemented task gets a fresh review worker before it is merged.
- [ ] The ceiling is respected across passes; merges are serialized (two done ≠ two merges/pass).
- [ ] A scripted worker question surfaces via the inbox and a sent answer resumes that worker.
- [ ] A scripted merge conflict surfaces as a decision, not a merge onto scratch main.
- [ ] Setting the control flag mid-drain stops dispatch and closes every fake worker.
- [ ] With `PARALLEL_DRY_RUN=1` nothing calls a real `claude` or the real repo.

## Done when

- [ ] `drain` takes a fake plan to all-`✅` with dependencies, the ceiling and serialized merges
      all respected, and fresh review before merge.
- [ ] Questions, conflicts and the kill switch are handled in the loop and every event logged.
- [ ] `npm test` is green.
