# plan-implement-review

A working method for Claude Code, packaged so it can be dropped into any project.

Work is planned once, then executed one task at a time by sessions that alternate between
building and reviewing. The session that reviews a task is never the session that wrote it —
that alternation is the whole point, and it is what buys a genuine fresh-eyes pass on every
task.

You act as product manager: you own *what* gets built and why. The sessions own *how*.

## The two commands

| Command | What it does |
|---|---|
| `/pir-plan` | Brainstorm the requirements, probe the tech on the actual machine, settle the architecture, split the work into session-sized tasks, write it all to `plans/{slug}/`. Writes no product code. |
| `/pir-work {slug}` | Do exactly one unit of work — implement the next task, or review the last one — then stop. |

`/pir-work` dispatches on the state table in `plans/{slug}/PROGRESS.md`:

```
any task 🔍 ?  → REVIEW the lowest-numbered one
else any 🟡 ?  → FINISH it
else           → IMPLEMENT the next ⬜ whose dependencies are ✅
```

Task states: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review ·
✅ reviewed and done · ⛔ blocked, needs a human.

`pir-implement` and `pir-review` are never invoked directly — `pir-work` chooses the
task, and that choice is what guarantees the alternation.

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
    → checkpoint: phase table and task list, you say yes
    → writes plans/screen-time/, commits, stops
                                             commit: plan(screen-time): …

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

## Layout of this repo

```
CLAUDE.md        the shared working method, appended into each project
install.sh       idempotent installer, per-project or --global
skills/
├── plan/        the seven-stage planning procedure
│   └── templates/   DESIGN, PLAN, PROGRESS, FINDINGS, TASK
├── work/        the dispatch — picks exactly one unit of work
├── implement/   build one task, hand it over unreviewed
└── review/      check someone else's task, fix what it finds, close it
```
