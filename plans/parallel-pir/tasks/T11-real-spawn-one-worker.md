# T11 — One real worker, one trivial task, seatbelted

**Phase:** 3 · **Depends on:** T09, T10 · **Weight:** heavy

## Goal

The first time any of this touches a real agent, and it is deliberately the smallest possible
version: the real `agents.mjs` (spawn / drive / list / close) built against the T00 findings,
wired into the T08 loop in place of the fake, driving exactly one worker through one trivial
task on a scratch plan, with the ceiling at its minimum and the kill switch wired. This is the
dangerous capability built small before full size, and its second half can only be verified by a
person watching.

## Design sections this implements

DESIGN §2.3 (real create / drive / close), §2.2 (real down-channel per T00), §3.2
(`agents.mjs`), §5.1 and §5.2 (this is the hand-verified, seatbelted row).

## Files

- `src/shell/agents.mjs` — the real implementation of the T07 agent interface, using the
  mechanisms T00 established (`claude --bg`, the chosen drive channel, `claude stop`+`rm`).
- `src/shell/agents.test.mjs` — only what can be tested without a live agent (argument
  construction, parsing `claude agents --json`, the same-repo cwd resolution from §5.1).

## Interface

```
spawn(cwd, prompt) → id        // claude --bg with cwd in the worktree; returns the printed id
drive(id, prompt) → { ok }     // the T00-chosen channel (--resume -p or attach-injection)
list() → [{ id, name, cwd, live }]   // from `claude agents --json`; resolve same-repo via
                                     //   git rev-parse --git-common-dir, NOT --cwd (FINDINGS)
close(id) → { ok }             // claude stop <id> ; claude rm <id>
```

Only the pure-ish parts (building argv, parsing `--json`, cwd resolution) are unit-tested; the
live spawn/drive/close is hand-verified below. The same-repo resolution must use the `cwd` field
and the shared git dir, because `--cwd` matches the repo root and returns `[]` for a worktree
(FINDINGS.md, 2026-09-07).

## Tests

- [ ] argv for spawn/drive/close is built exactly as the T00 findings specify.
- [ ] Parsing a sample `claude agents --json` yields id/name/cwd/live correctly.
- [ ] Same-repo resolution: two worktrees of one repo resolve equal; a different repo does not.
- [ ] `--cwd` is not used for same-repo filtering (guard against the known gotcha).

## Done when

- [ ] The argv, json parsing and same-repo resolution are unit-tested and green.
- [ ] The live one-worker-one-task run has been done with the user and its result recorded in
      FINDINGS.md with the date; PROGRESS.md marks the hand-verified half done.
- [ ] Every scratch worker was closed and every scratch worktree removed.

## Needs a person

This spawns a real agent, so a person runs it and watches. Seatbelt: a scratch plan with one
trivial task, ceiling at 1, the kill switch flag ready, run in a scratch repo.

```
PARALLEL_DRY_RUN=0 node src/shell/loop-once-scratch.mjs   # spawns ONE worker on the scratch plan
# watch: claude agents --json   (the worker appears, cwd is the worktree)
# to abort at any time:  touch plans/scratch/.parallel/control/HALT
```

Expect: one worker spawns in its worktree, implements the trivial task (🔍), resets and reviews
it (✅), integrates and reports done; the coordinator merges the scratch branch and closes the
worker; `claude agents --json` and `git worktree list` end clean.
Tell me: did the worker act on the driven turns, did the fresh-context review actually re-read
with fresh eyes, and did close leave nothing behind. Anything that differed from the T00 spike.
