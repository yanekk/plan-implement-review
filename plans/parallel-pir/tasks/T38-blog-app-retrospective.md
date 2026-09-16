# T38 — Full retrospective on the blog-app capstone run

**Phase:** 10 · **Depends on:** T37 · **Weight:** medium · **Runs:** auto

## Goal

Read the capstone run's own record and judge whether the method did what it was supposed to — beyond
the green fact report. T37 passed, but a PASS only proves the checks the harness knows how to make. This
task inspects the transcripts, the flow log, and the actual code the workers built, and answers a set of
questions the facts do not: did each task deliver its contract, did the e2e test really run, did the
parallel workers cohere, did review review. It is analysis only — it writes a verdict and surfaces
concrete improvements as future tasks, and fixes nothing itself (scope).

## The evidence (preserved out of git)

Everything is at `~/pir-retro/blog-app-2026-09-16/` — kept outside the repo by PM decision, so the plan
carries the pointer, not the bytes. If the folder is gone, this task cannot run; say so and stop.

- `scratch-repo.bundle` — a git bundle of the whole scratch repo: **the code the workers built, with full
  history**. Restore it read-only into a temp dir and inspect (do not clone into this repo):
  `git clone ~/pir-retro/blog-app-2026-09-16/scratch-repo.bundle /tmp/blog-app-retro`
  `main` (2ace385) is the promoted blog; `pir/blog-app` is the feature branch.
- `bundle/` — the run's capture: `coordinator.jsonl` and `T01..T07` implement/review/verify transcripts,
  `flow.log` (the spawn/merge/promote timeline), `git-log.txt`, `agents-timeline.jsonl`, `manifest.json`,
  `final-files.json`. Unrelated ("foreign") sessions were stripped before storage.
- `runner-stdout.log` — the run's console output, including the two `HANDS-ON` lines and the PASS block.

The task docs the workers built against are inside the bundle's history (`plans/blog-app/tasks/` on any
ref), and the fixture source is in this repo under the harness fixtures for cross-reference.

## The questions to answer

Per task where it applies, with the evidence cited (a transcript line, a commit, a file):

1. **Delivery.** Did each unit (T01–T07) do what its task doc's acceptance criteria asked — no more, no
   less? Name any criterion left unmet or any scope a worker invented.
2. **Did the e2e test actually run?** Did T06 write a browser test that genuinely drives the running app
   (real HTTP against the live stack, real DOM assertions) rather than a stub or a mock that always
   passes? Did T07's check-in actually execute it against a live stack, and is the reported pass real?
   Read the test file in the restored repo, not just the transcript's claim.
3. **Contract adherence.** Did T02/T03/T04 build strictly against T01's shared contract, or did any of
   them drift from it, duplicate it, or quietly edit it? The parallel model depends on that one point.
4. **Did review review?** For each `auto` task, did the fresh-eyes reviewer inspect the work, or
   rubber-stamp "clean"? Flag any review that passed code with a real defect.
5. **Integration truth.** Did the three parallel branches merge without hidden fixup commits, and does
   the assembled app cohere end to end (frontend → backend → db)?
6. **Integrity of the `you` path.** Do T05 and T07's scribe `✅` rows reflect what the operator actually
   did and saw, or are they generic/assumed? Cross-check against the verify transcripts.
7. **Deliverable quality.** Is the blog itself correct? Look for bugs the e2e missed — input validation,
   error handling, injection, edit/delete edge cases, persistence gaps.
8. **No fabricated evidence.** Did any worker assert a test pass, a build result, or a hand-verification
   it did not actually perform (the anti-assertion rule in CLAUDE.md and DESIGN)?
9. **Parallelism payoff and cost.** Did running three-wide actually beat the serial critical path in
   wall-clock (use `flow.log` timestamps), and at what token/$ cost (use the harness token accounting if
   present)? Note the T01 serial prefix and whether the trio truly overlapped.
10. **Coordinator behavior.** Wasted turns, redundant polling, mis-dispatches, ceiling/dependency
    respect, and the known check-in-#2 stall where `await-idle` polled ~4.5 min until the operator ran
    `docker compose down`.

## Method

- Restore the bundle read-only to a temp dir; never clone it into this repo.
- Answer each question from the evidence, quoting the specific line/commit/file. An unanswerable question
  is a finding in itself (the capture did not record it).
- If verifying the e2e claim needs the app actually running (Docker), do not run it here — note it as a
  `you` follow-up. Reading the test source is enough to judge whether it *could* be real.

## Output

Write `~/pir-retro/blog-app-2026-09-16/RETRO.md` (outside git, beside the evidence). One section per
question above, each with: verdict (held / gap / can't tell), the evidence, and — where it found a gap —
a one-line proposed future task. End with a short overall verdict on whether the capstone shows the
method working, and a numbered list of the proposed follow-up tasks.

## Done when

- [ ] `RETRO.md` exists at the path above and answers all ten questions with cited evidence.
- [ ] Every proposed improvement is listed as a candidate future task (surfaced to the PM), not fixed here.
- [ ] A one-line pointer to the retro and its overall verdict is appended to this plan's `FINDINGS.md`
      with the date (the evidence path, not the bytes).
- [ ] The temp restore dir is removed after (`rm -rf /tmp/blog-app-retro`).

## Scope

Analysis only. This task changes no product code and fixes nothing it finds — the whole value is an
honest read, and a fix folded in here would be a fix nobody reviewed against the plan. Improvements
become their own tasks by PM decision.
