# T07 — Live restart drill, judged by a person

**Phase:** 3 · **Runs:** you · **Depends on:** T06 · **Weight:** heavy

## Goal

Prove the one thing no automated test can: that a real crashed run, restarted, actually resumes over
real paid agents instead of rebuilding from the first task. Everything up to here is proven against
scratch git and the fakes; this task runs the restart drill (T06's mechanism and fixture) over real
`claude` workers and has a person judge that the resume happened and looks right. It is a `you` task
because it spawns live paid agents and the final judgement — did it truly pick up where it left off —
is a person's, matching every other live-harness run.

## Design sections this implements

DESIGN §4 (live-only fact), §5.1 (what the test command cannot reach), §5.2 (seatbelts), §2 (the
resume behaviour being verified).

## Environment (the worker owns this)

Standing the scratch environment up and tearing it down is mechanical, not a judgement, so the
hands-on worker does it — not the person. Guaranteed teardown is the seatbelt that lets the drill run
a live coordinator against real agents at all.

```
# bring-up (worker runs before the hand-off): the harness restart runner installs the scratch fixture
# into a throwaway dir and stands nothing else up.
node src/shell/harness/run.mjs restart --into <scratch-dir>
#   PARALLEL_LIVE=1 and the scenario's low ceiling are set by the runner; the wall-clock timeout arms
#   HALT so a hung worker cannot run or cost unboundedly (DESIGN §5.2). Refuses the canonical repo
#   without --into / PARALLEL_ALLOW_HERE=1.

# teardown (worker runs before marking the task done, and confirms it is down):
#   the runner tears every worker down on exit; the worker then confirms with
claude agents --json      # no restart-scenario worker of this run remains
git -C <scratch-dir> worktree list   # no leaked scratch worktrees
#   If teardown cannot be confirmed, the worker escalates instead of marking the task done.
```

## Automated checks (the worker runs these)

A machine can decide most of the drill; the worker runs these and records the pass/fail it observed,
separately from the person's judgement, and never rounds an ambiguous result up.

```
# the restart runner's own fact report over the captured bundle (T06):
#   resumedNotRebuilt  — the 🔍 task's original implement commit survived; it was reviewed/merged,
#                        not re-implemented after the restart.
#   noRebuildFromT01   — a task already ✅+merged before the kill was not rebuilt.
#   feedsCleared       — no stale pre-kill control-feed entry was acted on after the restart.
#   leftoverSessionsReaped — the dead run's still-alive sessions were stopped on restart; the live
#                        worker count stayed within the ceiling across the relaunch.
# the runner exits non-zero if any fact fails; the worker records the fact report verbatim.
```

## Needs a person

This is a `you` verify task in a build→verify split (DESIGN §2.6): the worker stands the scratch up,
drives the live restart, runs the automated facts, and tears down; the person watches the live run and
judges what a machine cannot — that the coordinator genuinely resumed the in-flight work rather than
quietly starting over, and that the run's plain-English narration of the restart made sense.

```
Watch the live restart drill the worker drives on the scratch plan:
  - a task reaches "built" (🔍) on its branch, then the coordinator is killed (a simulated crash);
  - the coordinator is relaunched on the same scratch;
  - confirm the relaunched coordinator picks the built task up for review/merge and does NOT
    re-implement it from scratch, and does not rebuild any task that was already done before the kill.
Seatbelt: scratch repo, low ceiling, kill switch armed by the harness timeout — never run this against
the real project.
```

Expect: after the relaunch, the built task is reviewed and merged (or merged, if it was already
reviewed) and the plan promotes; no task is rebuilt from the first task; the coordinator's narration
names the resume.

Tell me: (1) did the restarted run resume the in-flight task rather than rebuild it — yes/no, and what
you saw that shows it; (2) did anything about the restart read as wrong, confusing, or lost — a task
silently redone, a stale message from before the crash, a step that looked like starting over.

The scribe records the automated fact report and the person's yes/no as two separate confirmations in
`FINDINGS.md` with the date, and never inflates an ambiguous reply into "verified".

## Tests

No automated test is added by this task; its evidence is the live run plus the person's judgement. The
automated facts it runs are built and tested in T06.

## Done when

- [ ] the live restart drill has been run over real agents on the scratch plan, with the harness
      seatbelts on.
- [ ] the automated fact report (`resumedNotRebuilt`, `noRebuildFromT01`, `feedsCleared`,
      `leftoverSessionsReaped`) is recorded, and the person has judged that the run resumed rather than
      rebuilt.
- [ ] both confirmations — the fact report and the person's yes/no, with the date — are written to
      `FINDINGS.md`; the scratch environment is confirmed torn down.
</content>
