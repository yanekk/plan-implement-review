# T16 — Scenario fixtures: scratch plans that force each path with real workers

**Phase:** 6 · **Depends on:** T15 · **Weight:** medium · **Runs:** auto

## Goal

Build the six fixtures the live runner (T17) drives — each a self-contained scratch plan plus its
scenario spec (T15). A fixture is what makes a **real** Claude worker reliably hit one path, since
the PM's decision is all-real workers (DESIGN §4.1): the task docs and seeded repo state are
engineered so the behaviour under test is forced, not hoped for.

Building a fixture and asserting over a canned bundle is `auto` and testable; running it against real
agents is T17. This task ships the fixtures and proves their **setup** is correct (the plan parses,
the seeded state is what each scenario needs, the spec's facts are well-formed) without spawning an
agent.

## Do

Each fixture is a directory with a ready-to-run scratch plan (`PROGRESS.md` marked reviewed, task
docs, a seeded git state) and a scenario spec naming its facts (T15). The six, and how each forces
its path with a real worker:

- **single** — one trivial `⬜ auto` task. Forces: spawn → hello → implement → `🔍` → fresh review →
  merge → promote → idle-gated close. (Subsumes T13's live comms proof.)
- **parallel** — several independent `⬜` tasks, ceiling ≥ 2. Forces concurrent workers, the ceiling,
  per-worker naming. The **kill-switch drill** lives here: the spec includes a `HALT` step and the
  `killSwitchStoppedAll` fact. (Subsumes T10's full drill.)
- **review-queue** — a short dependency chain so one task reaches `🔍` and a fresh reviewer takes it
  over while another builds; forces the implement→review handoff and the implementer's idle-gated
  close.
- **clean-merge** — two independent tasks touching **different** files; forces two serialized, clean
  merges into the feature branch and one promotion.
- **merge-conflict** — two tasks whose docs make each edit the **same line** of the same file; forces
  the second merge to conflict, the coordinator to surface it and park, and no bad merge to land.
- **human-decision** — one task doc that deliberately leaves a single user-facing choice unspecified
  (the shape that arose on its own in the stopped drill: "which greeting wording?"). Forces a real
  worker to send a `question`, the coordinator to surface it, and — with a scripted user answer fed
  through the control `answers` file — the answer to reach the worker and it to resume to `done`.

- **A fixture loader / installer** that copies a fixture into a scratch repo and seeds its git state,
  used by T17. Keep the fixtures' skills available to the spawned workers the way the drill harness
  does (the parallel skills are not installed in `~/.claude/skills/`; a fixture carries them, per the
  T10 carry-note in PROGRESS).
- The **human-decision** answer is scripted (a fixed line written to the `answers` file at the right
  moment) so the scenario is repeatable without a live human in the loop; the runner (T17) performs
  it. The worker asking, and the answer arriving, are still real.

## Acceptance (build / fakes)

- Each fixture's `PROGRESS.md` parses (reuse `parseProgress`), is marked reviewed, and its task graph
  is what the scenario needs (e.g. merge-conflict's two tasks target the same file+line; clean-merge's
  target different files) — a test asserts the seeded shape per fixture, no agent spawned.
- Each fixture ships a valid scenario spec (T15) whose facts are the ones named above.
- The loader installs a fixture into a temp scratch repo and seeds its git state deterministically; a
  test checks the installed tree and that the parallel skills are present for the workers.

## Files (expected — the implementing session confirms)

- `src/shell/harness/fixtures/<name>/…` — the six fixture plans + specs.
- `src/shell/harness/fixtures.mjs` — the loader/installer.
- `src/shell/harness/fixtures.test.mjs`.

## Done when

- [ ] All six fixtures exist with a valid scratch plan and a scenario spec.
- [ ] Each fixture's seeded shape is asserted by a test (the conflict really conflicts, the clean
      merge really doesn't, the decision task is really underspecified) — no agent spawned.
- [ ] The loader installs and seeds deterministically, skills carried; `npm test` green.

## Needs a person

None here — this task proves fixture **setup** only. Running a fixture against real workers is T17.
