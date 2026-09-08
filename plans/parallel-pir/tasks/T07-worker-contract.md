# T07 — `pir-worker` contract skill + cross-session wiring

**Phase:** 3 · **Depends on:** T00 · **Weight:** light · **Runs:** auto

## Goal

The worker's rulebook, the thin wiring that lets it talk to the coordinator, and the small change
that lets the coordinator name the task a worker runs. A worker does not choose its own task: the
coordinator sends it `pir-implement Txx` to build, `pir-review Txx` to review, or `pir-verify Txx`
to run a hands-on `you` task, and the worker runs exactly that. Two more things differ from classic
mode: when a skill would "ask the user and wait", the worker messages the coordinator and waits,
because there is no interactive user at its terminal; and when its task is reviewed clean it
integrates the feature branch and messages "done". The implement and review procedures are the
stock ones — only their entry point changes so they accept an explicit task rather than being
reached only through `pir-work`'s selection.

**The hands-on mode (`pir-verify Txx`) is how a `you` task runs (§2.6).** Here the person, not the
worker, runs the live/seatbelted commands — an agent must not spawn real paid agents against real
branches on its own (§5.2), and only a person can watch. So the worker is the scribe: it presents
the task's "Needs a person" block to the user, waits while the user runs it, records what the user
reports into `FINDINGS.md` on the task branch, marks the task row done, and messages the
coordinator `done`. Unlike `pir-implement`, it produces no code and gets no fresh-review session —
the recorded observation is the deliverable, and the coordinator folds the branch back and marks
`✅` (§2.6). The user talks to this worker directly, which is what keeps the exploration out of the
coordinator's context.

## Design sections this implements

DESIGN §2.1 (coordinator names the task and phase), §2.2 (cross-session messaging both ways), §2.5
(worker resolves a conflict or escalates), and the two stance bullets on dispatch and the bent base
rule in §1.

## Files

- `skills/pir-worker/SKILL.md` — the worker contract (new skill).
- `skills/pir-verify/SKILL.md` — the hands-on procedure for a `you` task (new skill): present the
  task's "Needs a person" block, let the user run it, record findings on the task branch, report
  done. Produces no code and no review session (§2.6).
- `skills/pir-implement/SKILL.md`, `skills/pir-review/SKILL.md` — a small additive change: accept
  an explicit `Txx` argument so the coordinator can name the task; their logic is unchanged.
- `src/shell/platform.mjs` — the send/inbox half of the platform wrapper (spawn/list/close in T08).
- `src/shell/platform.test.mjs` — the parts testable without a live agent.

## Interface

```
pir-worker SKILL.md contract:
  - the coordinator sends `pir-implement Txx` (build), `pir-review Txx` (review), or
    `pir-verify Txx` (run a hands-on `you` task); run exactly that task and phase. Do NOT run
    `pir-work` and do NOT pick a task yourself.
  - `pir-verify Txx` (hands-on, §2.6): the USER runs the live/seatbelted commands; you do not run
    them and do not spawn real agents yourself (§5.2). Present the task's "Needs a person" block,
    wait, record what the user reports into FINDINGS.md on your task branch, mark the task done, and
    message the coordinator (kind: done). No code, no fresh-review session.
  - you run in your task's own worktree on branch `pir/{plan}-T{nn}`. The base rule in CLAUDE.md
    § Where sessions run — "main checkout, main branch, always; stop if you find yourself in a
    worktree" — does NOT bind a parallel-mode worker; DESIGN §2.9 replaces it with the branch
    model. Do not stop and do not fold the worktree back; commit on your task branch as normal.
  - after implementing (task marked 🔍), message the coordinator that Txx is implemented; the
    coordinator spawns a FRESH session to review it (you do not review your own work in the same
    session).
  - whenever a stock skill would "ask the user and wait", instead message the coordinator
    (kind: question|decision) and wait for the answer, then continue.
  - on a merge conflict while integrating the feature branch: attempt resolution; if unresolved,
    message the coordinator (kind: conflict) and wait.
  - when reviewed clean: integrate the feature branch, then message the coordinator (kind: done).

pir-implement / pir-review: accept `Txx`. Given it, operate on that task instead of the one
pir-work would have selected, skip the "reached without pir-work → stop" guard (the coordinator is
the deliberate caller), and do not apply the base "work on main / stop in a worktree" expectation,
because a worker runs them in its task worktree (§2.9). With no argument the guard and the base rule
both stand, and they behave exactly as today (classic mode).

platform.mjs (send/inbox half):
  send(name, { kind, task, body }) → ok           // addressed by agent name (§2.8), via T00 handshake
  inbox() → [ { from, kind, task, body } ]        // messages workers sent the coordinator
  resolveSameRepo(agentsJson) → [workers in this repo]  // via git rev-parse --git-common-dir,
                                                        //   NOT --cwd (FINDINGS.md)
```

The worker addresses the coordinator as `{repo} · {plan}` (naming.mjs, from T03), which it can
build itself from the repo and plan — it is not told an id. The coordinator passes the worker its
own name at spawn for clarity, but the scheme is what removes id-passing. The separator is `·`,
not `/`: T00 found `SendMessage` rejects a name containing `/` (§2.8). This task confirms live
that `·` is accepted when it exercises the real send/inbox handshake — the tests in T03 only
prove the names are built with `·`, not that the address parser takes them.

## Tests

- [ ] `pir-implement Txx` / `pir-review Txx` operate on the named task; with no arg, classic
      behaviour is unchanged (a regression test on the existing selection).
- [ ] `pir-verify Txx` records the user's reported findings to FINDINGS.md on the task branch and
      messages the coordinator `done`, producing no code and requesting no review session.
- [ ] With an explicit `Txx` the "reached without pir-work → stop" guard does not fire; with no
      argument it still does.
- [ ] A constructed message carries from/kind/task/body and parses back.
- [ ] Same-repo resolution: two worktrees of one repo resolve equal; a different repo does not.
- [ ] `--cwd` is not used for same-repo filtering (guard against the known gotcha).
- [ ] Parsing a sample `claude agents --json` yields id/cwd/status/state correctly.

## Done when

- [ ] `skills/pir-worker/SKILL.md` states the contract: run the coordinator's `pir-implement Txx` /
      `pir-review Txx` / `pir-verify Txx`, never `pir-work`; escalate via messages; report done.
- [ ] `skills/pir-verify/SKILL.md` states the hands-on procedure: user runs the commands, worker
      records findings on the task branch and reports done; no code, no review.
- [ ] `pir-implement` / `pir-review` accept an explicit task and are unchanged with no argument.
- [ ] The send/inbox half and same-repo resolution are unit-tested and green.
- [ ] `npm test` is green.
