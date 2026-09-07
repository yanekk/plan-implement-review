# T06 — `pir-worker` contract skill + cross-session wiring

**Phase:** 3 · **Depends on:** T00 · **Weight:** light

## Goal

The worker's rulebook, and the thin wiring that lets it talk to the coordinator. A spawned worker
runs the stock `pir-work` unchanged, but two things differ in parallel mode: when a skill would
"ask the user and wait", the worker must instead message the coordinator and wait, because there
is no interactive user at its terminal; and when its task is reviewed clean it must integrate
`main` and message "done". The `pir-worker` skill states this contract, and the coordinator hands
each worker its own id and the coordinator's id at spawn so the messaging has an address. The
stock skills are not modified — the contract wraps them, using whatever messaging handshake T00
confirmed.

## Design sections this implements

DESIGN §2.1 (the worker's run), §2.2 (cross-session messaging both ways), §2.5 (worker resolves a
conflict or escalates), and the "workers run stock skills unchanged" stance in §1.

## Files

- `skills/pir-worker/SKILL.md` — the worker contract (new skill, not a change to pir-work).
- `src/shell/platform.mjs` — the send/inbox half of the platform wrapper the worker and
  coordinator share (spawn/list/close are added in T07).
- `src/shell/platform.test.mjs` — the parts testable without a live agent (message construction,
  same-repo cwd resolution, parsing `claude agents --json`).

## Interface

```
pir-worker SKILL.md contract:
  - run `pir-work {slug}` as normal; it implements the one task and marks it 🔍.
  - report implemented by messaging the coordinator; the coordinator spawns a FRESH session on
    this worktree to review (the worker does not review its own work in the same session).
  - whenever a stock skill would "ask the user and wait", instead message the coordinator
    (kind: question|decision) and wait for the answer, then continue.
  - on a merge conflict while integrating main: attempt resolution (you hold the task context);
    if unresolved, message the coordinator (kind: conflict) and wait.
  - when reviewed clean: integrate main, then message the coordinator (kind: done).

platform.mjs (send/inbox half):
  send(workerId, { kind, task, body }) → ok      // coordinator → worker, via the T00 handshake
  inbox() → [ { from, kind, task, body } ]        // messages workers sent the coordinator
  resolveSameRepo(agentsJson) → [workers in this repo]  // via git rev-parse --git-common-dir,
                                                        //   NOT --cwd (FINDINGS.md)
```

The message "kind" is a light convention inside the plain-text messaging, not a custom transport
— the platform carries the text; this task only agrees on the small shape.

## Tests

- [ ] A constructed message carries from/kind/task/body and parses back.
- [ ] Same-repo resolution: two worktrees of one repo resolve equal; a different repo does not.
- [ ] `--cwd` is not used for same-repo filtering (guard against the known gotcha).
- [ ] Parsing a sample `claude agents --json` yields id/cwd/status/state correctly.
- [ ] Bad message shape (missing kind or task where required) is rejected with a clear message.

## Done when

- [ ] `skills/pir-worker/SKILL.md` states the contract and cites the T00 messaging handshake,
      without modifying pir-work / pir-implement / pir-review.
- [ ] The send/inbox half and same-repo resolution are unit-tested and green.
- [ ] `npm test` is green.
