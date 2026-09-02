# plan-implement-review

A working method for Claude Code, packaged so it can be dropped into any project.

Work is planned once, read back once before anything is built, then executed one task at a
time by sessions that alternate between building and reviewing. The session that reviews a task is never the session that wrote it —
that alternation is the whole point, and it is what buys a genuine fresh-eyes pass on every
task.

You act as product manager: you own *what* gets built and why. The sessions own *how*.

## The three commands

| Command | What it does |
|---|---|
| `/pir-plan` | Brainstorm the requirements, confirm the direction with a throwaway mock when the thing has a feel to it, probe the tech on the actual machine, survey what the codebase already does so nothing gets built twice, settle the architecture, split the work into session-sized tasks, write it all to `plans/{slug}/`. Writes no product code. |
| `/pir-review-plan {slug}` | Read the finished plan back with fresh eyes, before a line of it is built. Fixes what has one right answer, brings everything else to you as a decision, applies what you decide, marks the plan reviewed. Runs once. |
| `/pir-work {slug}` | Do exactly one unit of work — implement the next task, or review the last one — then stop. |

`/pir-work` dispatches on the state table in `plans/{slug}/PROGRESS.md`:

```
plan not reviewed ?  → STOP — /pir-review-plan runs first
any task 🔍 ?        → REVIEW the lowest-numbered one
else any 🟡 ?        → FINISH it
else                 → IMPLEMENT the next ⬜ whose dependencies are ✅
```

Task states: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review ·
✅ reviewed and done · ⛔ blocked, needs a human.

## Why the plan gets reviewed too

A defect in a plan is copied into every task built from it, and the build-review alternation
cannot catch it: `pir-review` checks a task *against* the plan, so a wrong plan passes review
task after task, correctly. `/pir-review-plan` is the only pass that questions the plan itself,
and it runs in a session that did not write it. It looks for four things:

- **whether the documents agree** — dependencies pointing at tasks that exist and come
  earlier, one interface described the same way in both tasks that meet at it, no task quietly
  breaking a rule in `DESIGN.md`, every "Done when" checkable by somebody who was not there
- **whether the requirements are complete** — the unhappy path nobody specified, the thing a
  user would see that was never described, the choice the plan made silently. These are never
  filled in; each one is a question for you
- **whether the machine claims still hold** — the test command runs here, the versions are
  what `DESIGN.md` says, the seatbelts it names actually exist
- **whether any of it is already built** — every task checked against the code that is
  actually there, searching by what a thing *does* rather than what the plan calls it, because
  the near-duplicate is never named the same. A task that rebuilds what the repo already has
  passes every other check and still ships a second copy of something to maintain; the
  recommendation is to extend

It fixes what has exactly one right answer and tells you afterwards. Everything that changes
*what gets built* comes to you — the whole list first, so you can see its size, then one
decision at a time. Then it applies what you decided and stops.

It refuses to run in the session that wrote the plan, and refuses to run once building has
started. Its account lives in its commit message; there is no review report file to maintain.

`pir-implement` and `pir-review` are never invoked directly — `pir-work` chooses the
task, and that choice is what guarantees the alternation. Both are marked
`user-invocable: false`, so they do not appear in the `/` menu and cannot be typed as slash
commands: the only way in is through `pir-work`. The model still reaches them via the Skill
tool, which is the whole point.

## Install

Into one project — copies the skills to `.claude/skills/` **and** appends the working method
to that project's `CLAUDE.md`:

```sh
./install.sh /path/to/project
```

Globally — skills only, available in every project:

```sh
./install.sh --global
```

`CLAUDE.md` is per-project by design, so a global install still needs it appended per project:

```sh
cat /path/to/plan-implement-review/CLAUDE.md >> /path/to/project/CLAUDE.md
```

Both forms are idempotent: re-running upgrades the skills in place and never appends
`CLAUDE.md` twice. Skills are read at session start — install, then start a **new** session.

## What `/pir-plan` produces

```
plans/{slug}/
├── DESIGN.md        why everything is the way it is — every rule carries its reason,
│                    plus the environment, the test command and the verification table
├── PLAN.md          phases, task table, dependency graph, critical path
├── PROGRESS.md      task states and the queue — the handoff between sessions
├── FINDINGS.md      what the build taught, newest first — and the only place a
│                    hand-verification is ever recorded
├── prototype/       a throwaway mock that confirmed the direction, kept as a
│                    non-binding reference for the UI — only when the thing has a feel
└── tasks/
    ├── T00-*.md     one file per task: goal, files, interface, done-when, test list
    └── …
```

`PROGRESS.md` is the handoff; `FINDINGS.md` is the memory. Both are read at the start of
every session, so both are kept short on purpose — sixty words to a Notes cell, forty to a
finding. When a note wants a paragraph, the paragraph goes in the commit message.

## What a run actually looks like

```
/pir-plan
    → conversation: what it is for, the unhappy paths, what is deliberately not built
    → probes the machine for versions and the test command
    → checkpoint: requirements played back in plain English, you say yes
    → the thing has a screen, so it builds a clickable mock and waits: you open it,
      say the direction is right; the mock is parked at prototype/
    → searches the code for what already does part of this: finds the existing
      usage log covers two thirds of T03, asks whether to extend it or start clean
    → checkpoint: phase table and task list, you say yes
    → writes plans/screen-time/, commits, stops
                                             commit: plan(screen-time): …

/pir-review-plan screen-time
    → fresh session, did not write the plan
    → reads DESIGN, PLAN, every task, and re-measures the machine
    → fixes 6 mechanical things: T07 depended on T09, two names for the same file
    → puts 3 decisions to you, one at a time: what happens when the log is corrupt,
      what the child sees at the daily limit, whether T04 covers the weekend rule
    → applies your answers, marks the plan reviewed, stops
                                             commit: plan-review(screen-time): 6 fixes, 3 decisions

/pir-work screen-time
    → T00 is ⬜ and has no dependencies → implement
    → writes the spike, runs the test command, marks T00 🔍, stops
                                             commit: T00: prove the ground

/pir-work screen-time
    → T00 is 🔍 → review (fresh session, did not write it)
    → walks the acceptance criteria, reads the tests for what they assert,
      probes past the doc for edge cases; finds nothing
    → marks T00 ✅, stops
                                             commit: T00 review: clean

/pir-work screen-time
    → T01 next; its dependency T00 is ✅ → implement
    → …
```

One task per invocation. A session never implements and reviews in the same run, and never
starts the next task after closing a review.

## Rules worth remembering

The full set is in [CLAUDE.md](CLAUDE.md) — it is appended into each project and binds every
session. The ones that bite most often:

- **Scope is strict.** A session touches only the task it picked up. Everything else it
  notices goes in `FINDINGS.md` and is left alone.
- **The test command is the only evidence a session can produce on its own.** Anything
  needing a screen, a login, a second account, a reboot, a real device or a paid API is
  verified *with you* — the session hands you the exact command with a seatbelt on it, and
  waits for the answer rather than leaving it as homework.
- **Main checkout, main branch, always.** The review boundary is the session, not the
  branch, so there is nothing to merge, ever.
- **Nothing unspecified gets invented.** A half-specified requirement is a question for you,
  not a gap for a session to close quietly.
- **No plan gets built unread.** `/pir-work` stops on a plan that has never been through
  `/pir-review-plan`, and says so.

## Layout of this repo

```
CLAUDE.md        the shared working method, appended into each project
install.sh       idempotent installer, per-project or --global
skills/
├── pir-plan/          the eight-stage planning procedure
│   └── templates/     DESIGN, PLAN, PROGRESS, FINDINGS, TASK
├── pir-review-plan/   read the plan back before anything is built
├── pir-work/          the dispatch — picks exactly one unit of work
├── pir-implement/     build one task, hand it over unreviewed
└── pir-review/        check someone else's task, fix what it finds, close it
```
