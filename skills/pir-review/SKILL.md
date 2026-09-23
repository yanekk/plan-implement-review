---
name: pir-review
description: Review one implemented (🔍) task with fresh eyes, fix what it finds, and mark it ✅. Invoked by the `pir-work` skill after it picks the lowest-numbered 🔍 task from plans/{slug}/PROGRESS.md — do not invoke it directly; run `pir-work` instead.
user-invocable: false
---

# review

**Invoked by the `pir-work` skill, which has already chosen the task.** If you reached this
without a task chosen by `pir-work`, stop and run `pir-work`.

**You must not have written the code you are reviewing.** If this session implemented it,
stop — a reviewer holding the implementation in context is not a reviewer. That the task is
🔍 and this is a fresh session is the entire mechanism.

## Called with an explicit task `Txx` (parallel mode)

**If you were invoked with a task id — `pir-review T05` — that argument IS the deliberate choice:
review that task, do not run `pir-work`, do not re-select.** A parallel-mode run dispatches
this way: the task is already chosen and you were spawned as a **fresh** session on the worker's
worktree, so the fresh-eyes guarantee holds by construction (DESIGN §2.1, §2.8). Two base rules bend
in this mode, and only in it:

- **The "reached without `pir-work` → stop" guard does not fire** — the named task IS the
  deliberate choice.
- **`CLAUDE.md § Where sessions run` does NOT bind you** — you review in the task-branch worktree
  the implementer used (DESIGN §2.9); do not stop on contact with it.

**The "you must not have written the code" rule still binds, always.** In parallel mode it is kept
a different way — *you* are a fresh session with no implementer context, never the session that
built the task. If by any chance you did implement this task, stop.

When the procedure below says "ask the user and wait", you drop a report file so the run sees you
are asking, then ask the person in this session and wait for them to answer it here (DESIGN §2.2,
`pir-worker` contract). **With no argument, everything below is classic mode, unchanged**: both
guards and the "main checkout, main branch" rule stand.

## The procedure

Read the task doc and the implementing commit (`git show`, and the full diff — not just the
summary), then check all four:

1. **Acceptance criteria** — walk the task's "Done when" and its checklist line by line.
   Each item is either verified, or verifiable only by hand and therefore *unverified* —
   there is no third state and no benefit of the doubt.
2. **Tests** — the test command passes, *and* the tests cover the cases the task doc lists. A
   green suite that tests nothing is the failure mode here. Read the tests for what they
   actually assert: a test that would still pass with the implementation gutted is not a
   test. And a number that moved because the behaviour changed is not the same as a number
   the test will defend — when a change makes something take longer or cost more, check that
   the assertion moved with it in both directions.
3. **The traps** — the testability boundary held, no reaching for a clock or the network
   from the pure side, whatever else `DESIGN.md` names, and whatever the project's `CLAUDE.md`
   lists as true because somebody measured it. Find that list by what it holds, not by its
   title — projects name it differently, and a check skipped because a heading did not match
   is a check that silently never ran. Every entry on it has already cost somebody a day.
   Read the rows the diff actually touches, not the whole list.
4. **Correctness generally** — read the diff adversarially for what the task doc did not
   anticipate: edge cases, concurrency, error paths, what happens at a boundary, what happens
   when the file is corrupt, what happens when the clock goes backwards or the network
   returns half an answer. Probe past the doc. **This is where reviews find real defects** —
   the first three checks mostly confirm; the fourth is the one that pays.

Check the deviations the implementing session recorded in `PROGRESS.md` — each one is a
decision that has not been reviewed yet. And check for deviations it did *not* record.

## Validating a task the implementer added (parallel mode)

A parallel-mode worker may, with the person's yes, add a *new* task while building its own — the one
sanctioned break from strict scope (`pir-worker` § When you find a task the plan is missing; DESIGN
§2.1, §2.4). A worker-introduced task does not go through `/pir-review-plan`; the person's in-session
approval is its gate, and **you are the check on its shape.** If this task's diff adds a task — a new
`⬜` row in `PROGRESS.md`, a `PLAN.md` row and a `tasks/T{nn}-{slug}.md` doc — validate the addition:

- **Every dependency of the new task names a task that already exists** — on the feature branch, or
  among tasks added in the same change. A dependency on an unknown task could never be dispatched.
- **The new task doc has all five parts** — goal, files, interface, tests, done-when — **and its slug
  matches both its filename and its `PROGRESS.md` row.**
- **Every existing task that needs the new one carries it through a `blocks` clause** on the new
  row (`T04; blocks T10`), not through a note in `FINDINGS.md` and not through an edit of that
  task's row. Ask which existing tasks exercise what the new task builds — an end-to-end or deploy
  check almost always does. A missing clause means that task is dispatched without the new work.
- **No existing task's row or doc was edited.** The carve-out is add-only: a changed slug, changed
  dependencies or a reused number on an existing task is forbidden.

These are the same conditions the coordinator enforces at merge (`adoptNewTaskRows`, DESIGN §2.2,
§2.5): a bad dependency, a forbidden edit or a duplicate number makes it reject the whole change
atomically and surface the error, and a number collision is left for the person to renumber, never
auto-fixed. So a malformed addition would be caught at merge regardless — but you catch it here, with
the task's context in front of you, and cheaper. A malformed addition is a review finding: fix it if
the fix is unambiguous, or escalate to the person like any other decision. This is a lighter check
than a full plan review, the deliberate trade for not stopping the run (DESIGN §2.4). It applies only
in parallel mode; classic mode has no worker-introduced task to validate.

## A suspected defect is a hypothesis until something outside the code agrees

Reading the diff is how you find a defect; it is not how you confirm one. The diff is the
same evidence that produced the code — reason from it alone and a wrong-but-plausible reading
confirms itself. Before you fix, get one fact the diff did not give you: run it and watch it
fail, write the failing test first and see it go red, reproduce the condition with a real
input, check the actual state on disk. That out-of-band fact is the fourth check's teeth.

Before a channel is "one this session cannot reach," you make it one you *can* — you build the
tool. Drive the program from a script, render the surface headless and diff the snapshot,
assert on what it would draw, reproduce the input, read the state off disk. This is the
print-vision trap: a reviewer who sees "look at the popover" and hands it straight to the user
has skipped the step where a scripted render settles it with no person at all. Only when no
tool you could write would settle it — a real screen to be *judged*, a device, a real account,
a paid call, a run only a person may watch — is it the hands-on-the-machine handover: ask, and
wait, with the seatbelt. See `CLAUDE.md`. **"I did not build the reproduction" is not "only a
person can see it."**

**A fix that went in on a reproduction says so in the cell** — "reproduced by <the channel>,
fixed, test locks it." A defect confirmed by a channel that did not raise it is a review that
found something real; one confirmed only by re-reading is a guess with a commit behind it.

## Fix what you find

**In a separate commit from the review verdict.** A defect recorded and left is a defect
rediscovered in three weeks. The fix itself goes in unreviewed — that is the accepted cost of
not stalling.

```
T05 review: fix warning threshold      ← a fix found while reviewing
T05 review: clean                      ← review found nothing; the PROGRESS update is the commit
```

If a finding is out of this task's scope, it goes in the findings log,
`plans/{slug}/FINDINGS.md` — **forty words, counted** — and is left alone. The scope rule
binds a review session exactly as it binds an implementing one.

A row there states what was found and what happened about it. It does not argue the case: a
finding that reads like it is making an argument is one somebody will skim, and it is being
re-read by every session from here on.

## Close it out

Mark the task ✅ in `PROGRESS.md` and **note in its cell what the review found** — including
"clean, no fix commit" when that is the answer, and including what you probed beyond the doc.
That note is what tells the next session whether a green tick means anything. Update the
`Next work will:` line and the review queue. Commit, report, stop.

**Sixty words in that cell, counted.** The verdict, the defects by name, and one clause for
what you probed — enough that the next session knows what the ✅ is worth. Flat prose, no
bold-per-clause: the reasoning goes in the review commit message, which is written for exactly
this and is already in `git log`.

**You are appending, so you compact** — `CLAUDE.md § Keeping them short is a duty`. The task
before this one is now two reviews back, so cut its cell to one line, and fix any over-budget
row you read on the way in. A review session is the right place for this: you have just read
both files with fresh eyes and you can see which rows have stopped earning their space.

**Do not start the next task.** The verdict is where a review session ends.

## Unverified halves stay unverified

A task whose automated half is green and whose hands-on half has never been seen is not ✅ on
the strength of the tests alone. Say which half is which — in `PROGRESS.md` and in the report
— and give the user the exact command with its seatbelt. Never run the unbounded dangerous
version to find out for yourself.

A hands-on half is one no tool you could write would have closed — a real screen to be judged,
a device, a real account, a paid or unwatchable run. A check you left to the user because you
did not build the harness is not an unverified half; it is an unfinished review. Reduce it to
a machine check first (above), and hand over only what stays genuinely person-only.

**Ask the moment you need it and wait for the answer.** The user is the hands on the real
machine and has asked to be stopped for, not handed homework at the end — see `CLAUDE.md`.
Finish anything that does not depend on the answer while you wait, then fold the answer in
and close the review with it. When it comes back it goes in `FINDINGS.md` with the date:
"verified by hand" is worth as much as any test, and only if it is written down.
