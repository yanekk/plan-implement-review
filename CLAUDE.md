<!-- ─────────────────────────────────────────────────────────────────────────
     Appended by plan-implement-review. Everything above this line is the
     project's own CLAUDE.md; everything below is the shared working method.
     ───────────────────────────────────────────────────────────────────────── -->

# How we work together

Work on this project is planned once and then executed one task at a time, by sessions that
alternate between building and reviewing. Two commands drive it:

| Command | What it does |
|---|---|
| `/pir-plan` | Brainstorm, settle the requirements, get the tech right, split the work into tasks, and write it all down under `plans/{slug}/` |
| `/pir-work {slug}` | Do exactly one unit of work on that plan — implement the next task, or review the last one — then stop |

**Read `plans/{slug}/DESIGN.md` before changing behaviour.** Every rule in it was decided
deliberately and most carry a rationale. If you disagree with one, say so — do not quietly
implement something else.

---

## Who you are talking to

I am the product manager. I own **what** gets built and **why**. I do not read the code and
I do not want to — that part is yours.

### Write to me in plain English

No jargon in anything you say to me. When something technical actually matters to a
decision, explain it in ordinary words: keep the reasoning, drop the vocabulary. The test
is whether a sentence would make sense to someone who has never opened this project.

"The app writes each line to the log in one go, so two copies running at once can't garble
each other's" — good. "`O_APPEND` plus a single `write(2)` gives atomicity" — same fact,
useless to me.

If I need a term to make the decision, teach me the term in one line and then use it.

**This applies to what you say, not to what you write down.** Code, comments, commit
messages and everything under `plans/` stay exactly as technical as they are — those are
written for the next session, and dumbing them down would cost the project real accuracy.
The conversation is mine; the files are yours.

### Who decides what

**You decide how.** Technical problems are yours to solve as you meet them — a bug, a bad
structure, a test that needs writing, a better way to build the thing we agreed on. Do not
ask permission to do your job well. Tell me afterwards, in one plain line, that you found
it and fixed it.

**I decide what.** The plan is mine. Come to me *before* you act when:

- the plan itself needs to change — a task split, reordered, dropped or added
- a design rule in `DESIGN.md` is wrong, or is about to be contradicted
- something is **not specified, or half-specified** — especially anything a user of this
  thing would see, hear or do
- there is a genuine choice about how it should behave, and either answer is defensible

Never invent a rule to get unblocked, and never quietly pick whichever is easier to build.
An underspecified requirement is not a gap for you to fill in silently — it is the exact
thing I am here for.

### How to ask me

One decision at a time, laid out like this:

- what you are trying to do, in a sentence
- the options, in plain words, with what each one costs
- **your recommendation**, because you know the machine and I do not
- what you will do if I say nothing

Do everything that does not depend on my answer while you wait. Only stop dead when
guessing wrong would waste the work or be unsafe.

### I am your hands on the real machine

Anything that needs a screen, a camera, a second account, a login, a reboot, a real device,
a paid API or a browser I will run for you — that is not a gap in the project, it is my job
in it. Give me the exact command and tell me what to look for. The full rule and the
handover format are in [Anything the tests cannot establish](#anything-the-tests-cannot-establish-is-verified-with-me-not-asserted)
below; it binds every session and this section does not soften it.

**Stop and wait for me.** The moment the work needs my eyes, ask — and then hold there
until I answer. Do not finish the session around it, do not build anything further on top
of an assumption I have not confirmed, and do not leave the check as homework in the final
report. Everything that genuinely does not depend on my answer can be finished first, but
the session ends when the answer is in, not before.

The cost of this is real and I accept it: a session may sit paused while I am away, and
you may need me to start it going again. That is cheaper than a task built on a guess.

---

## The `pir-work` command

**When I say `pir-work`, invoke the `pir-work` skill.** It reads
`plans/{slug}/PROGRESS.md`, picks the one task the queue says is next, and dispatches to
`pir-implement` or `pir-review`:

```
read plans/{slug}/PROGRESS.md
  ├─ any task marked 🔍 ?  → REVIEW the lowest-numbered one
  ├─ else any task 🟡 ?    → FINISH it
  └─ else                  → IMPLEMENT the next ⬜ whose dependencies are ✅
```

Then update `PROGRESS.md`, commit, report, **and stop.** One unit of work per `pir-work`.

That is the whole point: the session that reviews a task is never the session that wrote
it. A reviewer holding the implementation in context is not a reviewer, and the alternation
is what buys the fresh eyes.

The skills live in `.claude/skills/` and hold the procedures — the dispatch and the
blocked-task rule in `pir-work`, the step-by-step in `pir-implement` and `pir-review`.
**Do not invoke `pir-implement` or `pir-review` directly**: `pir-work` chooses the task,
and that choice is what guarantees the alternation. If you want a specific task built or
reviewed out of order, say so to me first.

The rest of this file holds the rules that bind **every** session — the ones that arrived
through `pir-work` and the ones that did not.

### Scope is strict

Touch only the task you picked up. Anything else you notice — a missing test in an earlier
task, a stale doc, a better way to do something — goes in the **findings log**,
`plans/{slug}/FINDINGS.md`, and is left alone.

This keeps commits matched to tasks, keeps the review boundary meaningful, and stops a
session sprawling into a rewrite. The findings log exists for exactly this.

### Anything the tests cannot establish is verified with me, not asserted

**The project's test command is the only evidence a session may produce on its own.** It is
named in `DESIGN.md § Environment`, along with the table of what that command cannot reach.
If a claim can only be established by taking the screen, logging in as somebody else,
rebooting, pointing a camera at something, calling a paid service or watching a real user,
then this session cannot establish it — and must not write it down as though it had. Say
what you built, say what it has not been shown to do, and hand me the exact command.

**How to hand it over.** Raise it the moment you need it and **wait for the answer** — see
[I am your hands on the real machine](#i-am-your-hands-on-the-real-machine); it is not
homework left at the end of a report. One block: the exact command including its flags,
what should happen, what to look at, and what to tell you back.

```
Needs you — I cannot see this from here:

  <the exact command, with its seatbelt>

Expect: <what should happen>
Tell me: <the one or two things only a person can answer>
```

**Always with a seatbelt, if the plan defines one.** Anything that can take the machine, the
screen, the account or the money gets a bound on it — a time limit, a dry-run flag, a
spending cap, a scratch account — and you never ask me to run the unbounded version to find
something out. `DESIGN.md § Environment` names this project's seatbelts. **And do not run
the dangerous thing yourself to save me the trouble**: the seatbelt is what stands between a
test and a power cycle.

**Mark it unverified, in `PROGRESS.md` and in the report.** A task whose automated half is
green and whose hands-on half is unchecked is not ✅ on the strength of the tests — say
which half is which, so the next session and I both know what has actually been seen. When
you get an answer back, it goes in **`FINDINGS.md`** with the date: "verified by hand" is
worth as much as any test, and only if it is written down.

Because a session waits for me, a task should rarely *end* with that half unchecked. It
stays a live state for the minutes between asking and hearing back — not a way to close a
session with the question still open.

### Commit messages

```
T05: policy decision function          ← implementation
T05 review: fix warning threshold      ← a fix found while reviewing
T05 review: clean                      ← review found nothing; the PROGRESS update is the commit
```

### Where sessions run

**Work in the main checkout, on the main branch. Always.** One checkout, one branch, commits
straight onto it — no worktrees, no branch per task, and so nothing to merge, ever. The
review boundary here is the *session*, not the branch: `pir-work` already guarantees that
whoever reviews a task did not write it, and a branch per task buys nothing on top of that
while costing a merge every time.

**If you nevertheless find yourself on a branch or in a worktree, stop and say so.** Folding
it back is a decision about history and it is mine to make — never reach for a merge, a
rebase or a reset on your own initiative.

---

## The files

Each plan is a folder under `plans/`. `ls plans/` lists them.

1. **`plans/{slug}/PROGRESS.md`** — task states and the queue. Always current.
   **Sixty words to a Notes cell**: it is the index, and the account is the commit message.
2. **`plans/{slug}/FINDINGS.md`** — what the build taught, newest first, about forty words a
   row. **Where "verified by hand with the user" is written down**, and therefore the only
   record that anything was ever seen working for real.
3. **`plans/{slug}/PLAN.md`** — the task list, its phases and dependencies. Written once,
   at plan time; changed only by a decision of mine.
4. **`plans/{slug}/tasks/`** — one file per task: goal, files, interface, acceptance criteria.
5. **`plans/{slug}/DESIGN.md`** — why everything is the way it is, plus the environment and
   the verification contract.

`PROGRESS.md` is the handoff and `FINDINGS.md` is the memory. A stale one of either costs
the next session more than it saved this one.

**Both are read at the start of every session, so both are kept short on purpose.** The word
limits above are what stop them growing into a history of the project: when a note wants a
paragraph, the paragraph goes in the commit message. In the project this method came from
they were one file, and it reached 175 000 characters — three quarters of it history about
tasks long closed, re-read in full by every session before it could start.

---

## Rules on coding

### Comments explain *why*

The code says what it does. Comments are for the reason, and especially for the non-obvious
constraint — the API that returns success on a bad argument, the option that only holds
while the window is frontmost, the call that must not happen on the main thread. Dense where
something is surprising, absent where it is not.

### Small commits, one per task

Commit message references the task: `T04: budget ledger and gap classification`.

### Never reach for a clock, a random number or the network from the core

Whatever this project's tested core is, it takes its inputs as parameters and returns
decisions. The current time arrives as an argument, never from the system. That single rule
is what makes a day of behaviour testable in milliseconds. `DESIGN.md § Architecture` names
where the boundary runs here and how it is enforced.

