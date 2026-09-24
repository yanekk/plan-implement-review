---
name: pir-implement
description: Implement one task from a plan's tasks/ folder and hand it to the next session for review. Invoked by the `pir-work` skill after it picks a ⬜ or 🟡 task from plans/{slug}/PROGRESS.md — do not invoke it directly; run `pir-work` instead, so the queue chooses the task.
user-invocable: false
---

# implement

**Invoked by the `pir-work` skill, which has already chosen the task.** If you reached this
without a task chosen by `pir-work`, stop and run `pir-work` — the queue decides what
gets built, and picking out of order is how a task gets built ahead of its dependencies.

## Called with an explicit task `Txx` (parallel mode)

**If you were invoked with a task id — `pir-implement T05` — that argument IS the deliberate
choice, so the guard above does not apply: build that task, do not run `pir-work`, do not
re-select.** This is how a parallel-mode run dispatches: the task and phase are already decided
(`decideDispatch`), and the task is named for you rather than letting a worker self-select
(DESIGN §1, §2.1). Your logic below is otherwise unchanged — you implement the named task exactly
as you would the one `pir-work` would have handed you.

Two base rules bend in this mode, and only in it:

- **The "reached without `pir-work` → stop" guard does not fire.** The named task IS the
  deliberate choice; it is your instruction.
- **`CLAUDE.md § Where sessions run` — "main checkout, main branch, always; stop if you find
  yourself in a worktree" — does NOT bind you.** A parallel-mode worker runs in its own
  task-branch worktree by design (DESIGN §2.9); do not stop on contact with it and do not switch
  to `main`. The `pir-worker` contract skill is your standing rulebook here — chiefly: when the
  procedure below says "ask the user and wait", you drop a report file so the run sees you are
  asking, then ask the person in this session and wait for them to answer it here (DESIGN §2.2).

**With no argument, everything below is classic mode, unchanged**: the guard stands and the
"main checkout, main branch" rule stands in full.

The shared rules in `CLAUDE.md` apply in full and are not repeated here — scope, commit
messages, where sessions run (as carved out just above for parallel mode), and above all
**anything the tests cannot establish is verified with the user, not asserted.** The project's own rules and traps are in
`plans/{slug}/DESIGN.md` and in whatever the project's `CLAUDE.md` calls its list of things
that are true because somebody measured them. Find that list by what it holds, not by its
title — projects name it differently. Every entry on it has already cost somebody a day.

## The procedure

1. **Read the task doc first, in full** — `plans/{slug}/tasks/T<NN>-*.md`. Goal, files,
   interface, acceptance criteria, test list. Then read `DESIGN.md` for anything the task
   touches whose *why* you do not already hold, and the entries in `FINDINGS.md` that touch
   it. A task implemented from its title is a task reimplemented.
2. **If the task is 🟡**, read the commits already on it before writing anything. You are
   finishing someone's work, not restarting it — what is committed is a decision already
   made unless it is wrong.
3. **Implement only what the task specifies.** Not the obvious next thing, not the tidy-up
   next door. See *Scope* below.
4. **Write the tests the task doc lists**, plus the ones its edge cases imply. A green suite
   that tests nothing is the failure mode here — the whole point of the testability boundary
   is that a full run of behaviour is checkable in milliseconds.
5. **Leave the test command green.** It is the `test` lines of the block `DESIGN.md` opens
   with, run in order from the repo root, and it is the only evidence this session can produce
   on its own. If they cannot start because something is not installed (a `command not found`,
   a missing module), run the block's `setup` lines first, then the tests. If it is not green, the task is 🟡, not
   🔍 — hand over a half-built task honestly rather than a finished-looking one.
6. **Update `PROGRESS.md`:** mark the task **🔍**, and write in its Notes cell what you
   built, how many tests, and — the part that earns its keep — **every deviation from the
   task doc and why.** A deviation recorded is a review that starts from the right place; a
   deviation unrecorded is a defect the reviewer has to rediscover. Set the `Next work will:`
   line and the review queue.

   **Sixty words in that cell, counted, and one line per deviation.** Flat prose: the cell is
   an index for the next session, not the account of what you did. The account is the commit
   message you are about to write, and writing it twice is what turns a tracker into a history
   nobody reads. A deviation needing a paragraph needs the commit message; name it here and
   point there.

   **You are appending, so you compact** — `CLAUDE.md § Keeping them short is a duty`. Cut
   the previous task's cell to one line if you have just reviewed past it, and fix any
   over-budget row you read on the way in.
7. **Commit**, message `T<NN>: <what it does>`.
8. **Report and stop.** Do not review it. Marking 🔍 hands it to the next session.

## Deviating from the task doc

The task docs were written before the code and some of them are wrong. Deviating is allowed
and sometimes correct — **recording it is not optional.** Say in `PROGRESS.md` what the doc
said, what you did instead, and which rule or design section made you.

If the deviation is a disagreement with `DESIGN.md` rather than with a task doc, say so in
the report and do not quietly implement something else. DESIGN's rules were decided
deliberately and most carry a rationale.

## Scope is strict

`CLAUDE.md § Scope is strict` binds this session: touch only the task you picked up, and put
everything else you notice in the findings log, `plans/{slug}/FINDINGS.md` — **forty words,
counted, newest first.** The pull is strongest here, in an implementing session, because the
neighbouring code is open in front of you and the fix looks like it costs nothing. Log it and
leave it.

The one thing you may fix outside the task is an over-budget row in `PROGRESS.md` or
`FINDINGS.md` that you read on the way in. That is not scope creep and it needs no finding
logged; it is the maintenance those two files get instead of a session of their own.

**The one sanctioned exception to strict scope — parallel mode only, with the person's yes.** If,
building this task, you find the plan is missing a task that has to exist, you may add it — but only
after the person approves it in this session, and only as an addition: a new `⬜` row in `PROGRESS.md`,
a `PLAN.md` row, a full `tasks/T{nn}-{slug}.md` doc and a dated `FINDINGS.md` line, with the new task
depending only on tasks that already exist, and a `blocks` clause in its own `Depends on` cell
(`T04; blocks T10`) when an existing task must wait for it. You never edit an existing task, and you never add one
without the person's yes. The coordinator forces the adopted row to `⬜` and rejects a dependency on an
unknown task or any edit of an existing one, so a corner cut here does not land. The full contract —
how to propose it, and what the coordinator adopts and refuses — is in the `pir-worker` skill (§ When
you find a task the plan is missing). Outside parallel mode this exception does not exist: a classic
session logs the missing task as a finding and leaves it.

## Automate first — your hands are the first resort, the user's the last

This task is yours to finish. Before you hand *anything* to
the user, you build whatever tool makes the machine decide it — that is the job, not a favour
you ask the user for. A program that has to be launched, you drive from a script. A surface
that has to be looked at, you render headless and snapshot, or assert on what it would draw. A
state that has to be inspected, you seed and read back. A log that would say it worked, you
scrape. Standing up the environment to do any of this — a server, a fixture, a seeded database
— is yours too. **"I did not build the tool" is not "the tests cannot establish it."** The bar
for handing work to the user is that no tool you could write would close the gap — not that
writing one is inconvenient.

## Acting on the outside world — follow the bin

A deploy, a paid call, a DNS change, a message somebody receives: look up the action's row in
`DESIGN.md §5.3` and do what its bin says. Run the row's login check first; if it fails, ask the
user for exactly that login (`aws sso login --profile admin`), wait, re-check, and carry on
yourself.

- **`worker`** — run the wrapped command, then tell the user in one line what changed and the
  way back.
- **`ask`** — say in plain words what you are about to do, what it costs, who will see it and
  how it is undone, then run the wrapped command in the same turn. Its `ask` permission rule
  stops the machine for the user's approval, so that prompt *is* the yes; do not ask twice. If
  the rule is missing (the prompt did not appear last time, or the settings lack it), ask in
  words and wait for a yes before running. A refusal is an answer: do not retry, record it, and
  ask what they want instead.
- **`person`** — only a login, a device or a judgement. Hand over that one step and wait.
  **Never hand the user a command to paste that sits in the `worker` or `ask` bin.** Their yes
  is the grant; running it is your job.

An outside action with no row is treated as `ask`, and the missing row goes in `FINDINGS.md`.
A permission prompt on a `worker` command, or a classifier block on one, means the rule is
missing from `.claude/settings.json`: ask the user, do not work around it.

## What you genuinely may not claim

Some things no tool reaches: a real screen a person has to *judge* — not render, judge: "does
this look right" — a login only they hold, a second account, a reboot, a physical device, a
camera, a run only a person may watch. Those, and only those, are handed over —
with the exact command and its seatbelt, **the moment you need it, then wait for the answer**,
rather than left as homework at the end. Mark that half unverified in `PROGRESS.md` and in the
report. Never run the unbounded dangerous version to find out for yourself. See `CLAUDE.md`
for the handover format and `DESIGN.md § Environment` for this project's table and seatbelts.

The test command stays the only evidence this session asserts on its own, and a handover stays
the *last* resort, not the first — reached when the tools are written and the gap that is left
is genuinely one only a person can close.
