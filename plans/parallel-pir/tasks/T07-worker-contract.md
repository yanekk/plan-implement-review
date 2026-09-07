# T07 — `pir-worker` contract skill + cross-session wiring

**Phase:** 3 · **Depends on:** T00 · **Weight:** light · **Runs:** auto

## Goal

The worker's rulebook, the thin wiring that lets it talk to the coordinator, and the small change
that lets the coordinator name the task a worker runs. A worker does not choose its own task: the
coordinator sends it `pir-implement Txx` to build or `pir-review Txx` to review, and the worker
runs exactly that. Two more things differ from classic mode: when a skill would "ask the user and
wait", the worker messages the coordinator and waits, because there is no interactive user at its
terminal; and when its task is reviewed clean it integrates `main` and messages "done". The
implement and review procedures are the stock ones — only their entry point changes so they accept
an explicit task rather than being reached only through `pir-work`'s selection.

## Design sections this implements

DESIGN §2.1 (coordinator names the task and phase), §2.2 (cross-session messaging both ways), §2.5
(worker resolves a conflict or escalates), and the two stance bullets on dispatch and the bent base
rule in §1.

## Files

- `skills/pir-worker/SKILL.md` — the worker contract (new skill).
- `skills/pir-implement/SKILL.md`, `skills/pir-review/SKILL.md` — a small additive change: accept
  an explicit `Txx` argument so the coordinator can name the task; their logic is unchanged.
- `src/shell/platform.mjs` — the send/inbox half of the platform wrapper (spawn/list/close in T08).
- `src/shell/platform.test.mjs` — the parts testable without a live agent.

## Interface

```
pir-worker SKILL.md contract:
  - the coordinator sends `pir-implement Txx` (build) or `pir-review Txx` (review); run exactly
    that task and phase. Do NOT run `pir-work` and do NOT pick a task yourself.
  - after implementing (task marked 🔍), message the coordinator that Txx is implemented; the
    coordinator spawns a FRESH session to review it (you do not review your own work in the same
    session).
  - whenever a stock skill would "ask the user and wait", instead message the coordinator
    (kind: question|decision) and wait for the answer, then continue.
  - on a merge conflict while integrating main: attempt resolution; if unresolved, message the
    coordinator (kind: conflict) and wait.
  - when reviewed clean: integrate main, then message the coordinator (kind: done).

pir-implement / pir-review: accept `Txx`. Given it, operate on that task instead of the one
pir-work would have selected. With no argument they behave exactly as today (classic mode).

platform.mjs (send/inbox half):
  send(name, { kind, task, body }) → ok           // addressed by agent name (§2.8), via T00 handshake
  inbox() → [ { from, kind, task, body } ]        // messages workers sent the coordinator
  resolveSameRepo(agentsJson) → [workers in this repo]  // via git rev-parse --git-common-dir,
                                                        //   NOT --cwd (FINDINGS.md)
```

The worker addresses the coordinator as `@{repo} / {plan}` (naming.mjs, from T03), which it can
build itself from the repo and plan — it is not told an id. The coordinator passes the worker its
own name at spawn for clarity, but the scheme is what removes id-passing.

## Tests

- [ ] `pir-implement Txx` / `pir-review Txx` operate on the named task; with no arg, classic
      behaviour is unchanged (a regression test on the existing selection).
- [ ] A constructed message carries from/kind/task/body and parses back.
- [ ] Same-repo resolution: two worktrees of one repo resolve equal; a different repo does not.
- [ ] `--cwd` is not used for same-repo filtering (guard against the known gotcha).
- [ ] Parsing a sample `claude agents --json` yields id/cwd/status/state correctly.

## Done when

- [ ] `skills/pir-worker/SKILL.md` states the contract: run the coordinator's `pir-implement Txx` /
      `pir-review Txx`, never `pir-work`; escalate via messages; report done.
- [ ] `pir-implement` / `pir-review` accept an explicit task and are unchanged with no argument.
- [ ] The send/inbox half and same-repo resolution are unit-tested and green.
- [ ] `npm test` is green.
