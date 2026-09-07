# T08 — One real worker, one trivial task, seatbelted

**Phase:** 3 · **Depends on:** T06, T07 · **Weight:** heavy · **Runs:** auto

## Goal

The first time any of this touches a real agent, and it is deliberately the smallest possible
version: the real spawn / list / close half of `platform.mjs` built on the T00 findings, wired
into the T05 loop in place of the fake, driving exactly one worker through one trivial task on a
scratch plan — the coordinator sends `pir-implement Txx`, then on implemented spawns a fresh
session and sends `pir-review Txx`, then merges and closes — with the ceiling at 1 and the kill
switch wired. This is the dangerous capability built small before full size, and its second half
can only be verified by a person watching.

## Design sections this implements

DESIGN §2.1 (coordinator names task and phase; real create / drive / close), §2.2 (real
messaging), §3.2 (`platform.mjs` spawn/list/close), §5.1 and §5.2 (the hand-verified, seatbelted
row).

## Files

- `src/shell/platform.mjs` — add the real spawn / list / close (using `claude --bg`, the T00
  messaging handshake, `claude stop` + worktree removal). Send/inbox came in T07.
- `src/shell/platform.test.mjs` — extend with what is testable without a live agent.
- A tiny `src/shell/spawn-one-scratch.mjs` entry for the hand-verified run.

## Interface

```
spawn(cwd, task, phase) → id   // claude --bg in the worktree; phase decides pir-implement Txx vs
                               //   pir-review Txx in the worker's opening instruction; returns the id
list() → [{ id, cwd, status, state, live }]   // claude agents --json, same-repo resolved
close(id) → { ok }             // claude stop <id> ; remove the worktree (force if dirty)
```

Only argv construction and json parsing are unit-tested; the live spawn / message / review / close
is hand-verified below.

## Tests

- [ ] argv for spawn (implement and review phases) and close is built as the T00 findings specify.
- [ ] Parsing a live-shaped `claude agents --json` yields id/cwd/status/state/live correctly.
- [ ] `list()` returns only same-repo workers (reuses the T07 resolution).

## Done when

- [ ] The argv and json parsing are unit-tested and green.
- [ ] The live one-worker-one-task run has been done with the user and its result recorded in
      FINDINGS.md with the date; PROGRESS.md marks the hand-verified half done.
- [ ] Every scratch worker was closed and every scratch worktree removed.

## Needs a person

This spawns a real agent and exchanges real messages, so a person runs it and watches. Seatbelt: a
scratch plan with one trivial task, ceiling 1, the kill switch flag ready, in a scratch repo.

```
PARALLEL_DRY_RUN=0 node src/shell/spawn-one-scratch.mjs   # spawns ONE worker on the scratch plan
# watch: claude agents --json   (the worker appears, cwd is the worktree)
# to abort at any time:  touch plans/scratch/.parallel/control/HALT
```

Expect: one worker spawns and is told `pir-implement Txx`, implements the trivial task (🔍); a
fresh session is told `pir-review Txx` and reviews it (✅); the worker integrates and reports done;
the coordinator merges the scratch branch and closes the worker; `claude agents --json` and
`git worktree list` end clean.
Tell me: did the worker act on the sent `pir-implement`/`pir-review` messages, did the fresh-session
review read with genuinely fresh eyes, and did close leave nothing behind. Anything that differed
from the T00 spike.
