# The live-scenario test harness — operator guide

This is the guide for the **person launching the scenarios** (DESIGN §4.1, §5.2). The harness runs
the real parallel-PIR coordinator over **real Claude workers** through a scratch fixture, captures
everything the run produced, and checks it against the facts that scenario must show. One fixture per
run. Because every run spawns real paid `claude --bg` agents, you launch each one attended, one at a
time — no session starts it unattended.

Each fixture is its own task (T18–T23); a fixture is **done ✅ when its captured fact report is
all-green, you have run the reflection pass (below), and you have recorded the verdict + bundle path +
the reflection's findings in `FINDINGS.md`.** A green report is necessary, not sufficient — the
reflection is where the run actually hardens the workflow (DESIGN §4.1).

## Running a scenario

```
node src/shell/harness/run.mjs <fixture> [--into <dir>]
```

Fixtures, in the order to work through them (small first, the kill-switch drill last):

```
single → review-queue → clean-merge → human-decision → merge-conflict → parallel → hands-on
```

**Seatbelts, all automatic (§5.2):** the runner builds a throwaway scratch repo (a fresh temp dir
unless you pass `--into`), sets `PARALLEL_LIVE=1` and the scenario's own low ceiling, and arms a
wall-clock timeout (10 min, or the scenario's own — `hands-on` takes 25 min because a person drives it)
that auto-creates the `HALT` flag so a hung run cannot cost unboundedly.
It refuses to run inside the canonical repo unless you pass `--into <dir>` or set
`PARALLEL_ALLOW_HERE=1`. It tears every worker (and the coordinator) down on exit.

## What you'll see

It prints the scratch dir, then `launching coordinator "…"`, then **goes quiet while the run
proceeds** — build → fresh review → merge → promote. That silence is normal and can last a few
minutes; it is not a hang. At the end it prints a fact-by-fact report ending in `PASS` or `FAIL` and
the bundle path, and exits non-zero on any failed fact.

To watch it live, open a second terminal and run `claude agents --json`. The coordinator and its
workers live **inside the scratch repo**, so a plain `claude agents` run from anywhere else will not
list them — that is expected, not a failure.

## Where the logs are

Call the scratch dir the runner printed `$S`. For fixture `<fx>`:

- **Flow log** (the coordinator's own action record): `$S/plans/<fx>/.parallel/control/log` —
  one ISO-stamped line per action: `open-feature`, `spawn`, `review`, `merge`, `answer`, `send-failed`,
  `close`, `halt-close`, `surface`, `promote`, `teardown`. (No `hello` — the spawn ping was retired in
  T30; `send-failed Txx` marks an answer down-send the coordinator could not deliver.)
- **The capture bundle** (dated, self-contained): the runner prints its exact path; it lives under
  `$S/plans/<fx>/.parallel/control/capture/<ISO>/` and holds `flow.log`, `agents-timeline.jsonl`
  (the sampled status timeline), `agents-final.json`, `git-log.txt`, `manifest.json`, and
  `transcripts/*.jsonl` (one per session — the coordinator's is `coordinator.jsonl`).
- **Transcripts** also survive on disk at `~/.claude/projects/<cwd, every '/' and '.' → '-'>/<sessionId>.jsonl`,
  even after a worker is killed and its worktree removed.
- **Git state:** `$S` has `main` plus the feature branch `pir/<fx>`. A green run leaves exactly one
  promote merge on `main`; a task branch never merges to `main` directly.

## Reading the fact report

`[PASS]`/`[FAIL]` header, then one line per fact — `✓`/`✗`, its label, and a detail. A failing fact
prints the evidence that broke it underneath. Exit 0 means every fact passed.

## Per-fixture notes and the two that need you mid-run

- **single** — hands-off. Also proves by-name addressing and the idle-gated close (the old T13 live
  half).
- **review-queue / clean-merge** — hands-off.
- **merge-conflict** — **interactive** (like human-decision), not hands-off. The second merge conflicts;
  the coordinator keeps that worker alive and parks it, surfaces the conflict, and needs a **decision** to
  finish (DESIGN §2.5 Option 2, T28). The runner **feeds a scripted decision automatically** the moment
  the conflict surfaces — the fixture's `scriptedAnswer`, written to the control `answers` file for
  whichever task conflicted (which of the two is a timing race). So it still runs to a verdict without you
  typing, but if you are attended you may also answer through the coordinator. The decided side
  (`hello there`) must resolve, merge, and reach `main` — the fact checks the final `greeting.txt`, exactly
  one implementer per task (no respawn), and one promotion.
- **human-decision** — the worker deliberately asks an underspecified question and the coordinator
  surfaces it. The runner also feeds the fixture's scripted answer when it surfaces; **or you answer it**
  by appending one JSON line to `$S/plans/human-decision/.parallel/control/answers` —
  `{"task":"T01","text":"<the decision>"}` — or replying through the coordinator session. The worker then
  resumes and the plan promotes.
- **parallel** — this is the old T10 full drill. Multiple workers run within the ceiling. **To drill
  the kill switch,** mid-run create the HALT flag: `touch $S/plans/parallel/.parallel/control/HALT`.
  Every worker should stop, nothing should promote, and `main` should be untouched. Launch this one
  with `--into <dir>` so you know `$S` ahead of time. The runner seals a HALT run only AFTER the
  coordinator writes its own `halt-close` line (plus a short grace), not on the bare HALT flag, so the
  captured `flow.log` actually contains `halt-close` (T29; before, the seal beat it by ~4s and
  `killSwitchStoppedAll` false-failed). The wall-clock timeout still ends a run whose coordinator never
  confirms. Its `noHelloEver` fact (T30, replacing the old `helloPerSpawn`) asserts the flow log holds
  zero `hello` lines over a run that did spawn workers — the spawn ping is retired, so there is nothing
  for the kill switch to interrupt, which is one moving part fewer that could fail silently.
- **hands-on** — **attended**, and the only fixture that needs you to *do* something outside the
  coordinator, not just answer a question. Its plan is one `auto` build (T01: `greet.mjs`, which prints
  `hello from the agent`) then one `you` verify (T02) depending on it. The `auto` half runs itself:
  build → fresh review → merge. Then the coordinator spawns a **hands-on verify worker** for T02 and the
  runner prints `=== HANDS-ON: go drive worker "<repo> · hands-on · T02 · verify" for T02 ===`. That
  worker is a `claude` session — talk to it (it presents T02's "Needs a person" block, i.e. run `node
  greet.mjs` in the T02 worktree and confirm the line); it records a `✅` row into `FINDINGS.md`, marks
  the row `✅`, and reports `done`. There is **no review** — it folds straight to merge and the plan
  promotes. The manual channel is driving that named verify worker; there is **no auto-drive channel by
  design** (a `you` task emits no `surface` line, so the scripted-answer injector the interactive
  fixtures use cannot drive it — PM decision 2026-09-14). The wall-clock budget is a roomier 25 min so a
  human-speed drive is not guillotined; the kill switch and teardown-on-exit still hold. The facts: T02's
  worker was a verify session (not an implementer), T02 merged with no `review` line, one promotion, the
  ceiling held, and the `✅` row reached `main`.

## When it fails

A failed fact is a real finding — either a bug in the framework or a fixture that does not force its
path. Read the flow log and the coordinator transcript in the bundle (that is how the first two live
failures were diagnosed: a missing `src/` in the scratch, then the runner HALTing the coordinator
before it could promote). Log it, fix it, and re-run. A real model may occasionally not hit a
fixture's path on a given run; a re-run is expected, not a failure of the harness.

## The reflection pass

A green report says the declared facts held; it does not say the run was clean or cheap. After a PASS,
and before you mark the fixture ✅, reflect on the bundle — this is where a passing run still hardens
the workflow (DESIGN §4.1). It is part of the fixture task, not extra.

**Read, from the bundle:** `flow.log` (how the run flowed), `git-log.txt`, `agents-timeline.jsonl`
(when each session was busy/idle), and `transcripts/` — but **only this run's own sessions**:
`coordinator.jsonl` and the `T*-implement.jsonl` / `T*-review.jsonl` workers. **Ignore any
`role:foreign` transcripts** (unrelated Claude sessions the capture currently sweeps in — the manifest
tags them `foreign`; a known bloat, logged in FINDINGS).

**The transcripts are large** (hundreds of KB each). Delegate the trawl to a subagent so the raw JSONL
stays out of your context and only the findings come back; have it parse each line for text and
`tool_use` calls with `python3` rather than dumping raw JSON.

**Look for three things, with quoted evidence + session + timestamp for each claim:**
1. **Flow** — what each session actually did: did each worker build the right thing and hand off, did
   each reviewer do a genuine fresh review, did the coordinator dispatch/merge/close/promote correctly.
2. **Getting lost** — where the coordinator or a worker hesitated, retried, guessed at an ambiguity,
   sent a malformed message, addressed the wrong session, waited too long, or did redundant work. Even
   on a pass, capture the near-misses.
3. **Waste** — wall-clock or tokens spent for no gain (relay overhead, sleep-polls, redundant
   messaging, avoidable serial work). Quantify with timestamps.

**Then:** record the verdict, bundle path, and the key findings in `FINDINGS.md` with the date (newest
first, forty words a row; compact the file first if it is over ceiling). Surface any hardening or
efficiency change to the PM, one decision at a time, with a recommendation. **Do not implement the fix
in the fixture session** — that is scope creep; it becomes its own hardening task, the way T19's
reflection produced T25 and T26. Each fixture's own doc names what to scrutinise for its path.

## Cleanup

Closed sessions can linger as `stopped` — `claude rm <id>` clears the record. Scratch repos sit in a
temp dir; delete them when you are done. A leaked feature worktree: `git worktree remove --force`.
