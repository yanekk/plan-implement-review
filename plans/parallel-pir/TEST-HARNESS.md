# The live-scenario test harness — operator guide

This is the guide for the **person launching the scenarios** (DESIGN §4.1, §5.2). The harness runs
the real parallel-PIR coordinator over **real Claude workers** through a scratch fixture, captures
everything the run produced, and checks it against the facts that scenario must show. One fixture per
run. Because every run spawns real paid `claude --bg` agents, you launch each one attended, one at a
time — no session starts it unattended.

Each fixture is its own task (T18–T23); a fixture is **done ✅ when its captured fact report is
all-green** and you have recorded the verdict + bundle path in `FINDINGS.md`.

## Running a scenario

```
node src/shell/harness/run.mjs <fixture> [--into <dir>]
```

Fixtures, in the order to work through them (small first, the kill-switch drill last):

```
single → review-queue → clean-merge → human-decision → merge-conflict → parallel
```

**Seatbelts, all automatic (§5.2):** the runner builds a throwaway scratch repo (a fresh temp dir
unless you pass `--into`), sets `PARALLEL_LIVE=1` and the scenario's own low ceiling, and arms a
wall-clock timeout (10 min) that auto-creates the `HALT` flag so a hung run cannot cost unboundedly.
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
  one ISO-stamped line per action: `open-feature`, `spawn`, `hello`, `review`, `merge`, `close`,
  `surface`, `promote`, `teardown`.
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
- **merge-conflict** — hands-off; the point is that the second merge conflicts, the coordinator
  **surfaces and parks it**, and no bad merge lands.
- **human-decision** — the worker deliberately asks an underspecified question and the coordinator
  surfaces it. **You answer it:** append one JSON line to
  `$S/plans/human-decision/.parallel/control/answers` — `{"task":"T01","text":"<the decision>"}` — or
  reply through the coordinator session. The worker then resumes and the plan promotes.
- **parallel** — this is the old T10 full drill. Multiple workers run within the ceiling. **To drill
  the kill switch,** mid-run create the HALT flag: `touch $S/plans/parallel/.parallel/control/HALT`.
  Every worker should stop, nothing should promote, and `main` should be untouched. Launch this one
  with `--into <dir>` so you know `$S` ahead of time.

## When it fails

A failed fact is a real finding — either a bug in the framework or a fixture that does not force its
path. Read the flow log and the coordinator transcript in the bundle (that is how the first two live
failures were diagnosed: a missing `src/` in the scratch, then the runner HALTing the coordinator
before it could promote). Log it, fix it, and re-run. A real model may occasionally not hit a
fixture's path on a given run; a re-run is expected, not a failure of the harness.

## Cleanup

Closed sessions can linger as `stopped` — `claude rm <id>` clears the record. Scratch repos sit in a
temp dir; delete them when you are done. A leaked feature worktree: `git worktree remove --force`.
