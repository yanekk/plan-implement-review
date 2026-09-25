# T18 — live-run

**Phase:** 4 · **Depends on:** T08, T13, T14, T16, T17 · **Weight:** medium

## Goal

See the whole thing work for real: a small practice plan built by live workers from `pir {slug}`, with a
worker asking the person a question set and a permission, both answered in `pir`, an interrupt, a
message from the person, and the run ending on a green feature branch. This is the only proof that the
parts add up.

## Design sections this implements

DESIGN §1 Success criteria, §5.1.

## Files

- A harness fixture that forces one question set and one permission request (new
  `src/shell/harness/fixtures/live-workers-demo.mjs`, id and slug `live-workers-demo`), and its test.

## Environment (the worker owns this)

```
bring-up: `npm ci` in this task's worktree (no ./install.sh during the parallel build, PLAN.md); materialise
          the fixture in a trusted scratch path with harness/fixtures.mjs `installFixture`, which carries this
          worktree's skills/ (a harness run writes no index record, so `pir` would not list it);
          PARALLEL_MAX_WORKERS=2 node <worktree>/src/shell/pir.mjs live-workers-demo   (detached, cwd the scratch repo)
teardown: Ctrl+S twice in pir or touch <scratch>/plans/<slug>/.parallel/control/HALT;
          confirm no pid in workers.json is alive; delete the scratch copy
```

## Automated checks (the worker runs these)

```
node src/shell/harness/run.mjs live-workers-demo --into <scratch>   # fixture seatbelts: ceiling 1, 10-min timeout
```

Record: the run's terminal state, the bundle path, and that every conversation log parses.

## Needs a person

```
node <worktree>/src/shell/pir.mjs        # open the scratch run
```

Expect: tasks build; one row shows `asking you · a question`, another `asking you · allow a command?`;
opening each shows the picker or the gate; answering lets the worker continue; Esc on a busy worker stops
it and a typed instruction is followed; the run ends green with the merge hand-off.
Tell me: did every step happen as described, and anything that confused you on the way.

## Done when

- [ ] the automated check reached `completed` and its bundle holds every conversation log
- [ ] the person's verdict is a dated ✅ (or 🐞) row in FINDINGS, and `PROGRESS.md` says which half was seen
- [ ] no worker process or scratch folder is left

## Outside actions

- Install packages from npm — `ask` (`npm ci` in the worktree)
- Live harness run — `worker`
- T18 end-to-end run — `ask`
