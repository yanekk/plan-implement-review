---
name: pir-review-plan
description: Review a finished plan for gaps, contradictions, claims the machine does not support, and tasks that rebuild what the codebase already has, before any of it gets built. Runs once, between /pir-plan and the first /pir-work, in a session that did not write the plan. Fixes what has only one right answer, brings everything else to the user as a decision, applies what they decide, and marks the plan reviewed so /pir-work will start.
---

# review-plan

**This session changes documents, not code.** Not the product, not scaffolding, not the
"obviously needed" first file. The plan is the only thing in front of you.

It runs **once, between `/pir-plan` and the first `/pir-work`**. `pir-work` refuses to build
a plan that has not been through here — the line this session writes into `PROGRESS.md` is
what releases it.

The reason it exists: a defect in a plan is copied into every task built from it, and the
alternating build-review pass will not catch it. `pir-review` checks a task against the plan.
Nothing, until now, checked the plan.

---

## Before you start — three ways this session must refuse

**1. You must not have written the plan you are reviewing.** If `/pir-plan` ran in this
session, stop and say so: the user starts a new session and runs `/pir-review-plan` there. A
session holding its own reasoning re-reads it and agrees with it — that is not a review, and
it is the exact failure the whole method is built around.

**2. Not once building has started.** Read `plans/{slug}/PROGRESS.md`. If any task is in any
state but ⬜ — 🟡 🔍 ✅ ⛔ — the plan is in flight and this session stops. Say which task and
why: this pass may change the plan that the built tasks were built against, and rewriting the
ground under finished work is worse than the gap it would close. Amending a live plan is a
decision of the user's, through `/pir-plan`.

*(If the only thing stopping you is a ⛔ task that was never actually started, say exactly
that and let the user decide. Do not decide it yourself.)*

**3. Nothing to review.** No slug argument: list `plans/`. Exactly one plan — use it and say
which in your first line. Several — show them and **ask**. None — say so and point at
`/pir-plan`.

A plan that has already been reviewed but has still not been built may be reviewed again;
that is what happens after an amendment. Say in your first line that it is a re-review.

---

## What binds this session

**The user decides *what*. You decide *how*.** The whole of `CLAUDE.md § Who you are talking
to` applies, and here it is the entire job: telling the two apart is what this session is
for. A gap in the requirements is a question. It is never a gap for you to close quietly,
and the pressure to close one is highest at exactly the moment you have found it.

**Plain English to the user, technical in the files.** The conversation is theirs; the
documents are yours.

**Read everything before you say anything.** The first thing the user hears from this session
is the whole list of what needs deciding — see *Stage 4*.

---

## Stage 1 — Read the whole plan

In this order, in full, before forming a view: `DESIGN.md`, `PLAN.md`, every file in
`tasks/`, `PROGRESS.md`, `FINDINGS.md`.

**Then the repo the plan lands in**, and not as a glance: its README, its build and dependency
files, the shape of its source tree, what its tests already cover. Pass 4 is only as good as
this reading, and a plan reviewed without it will approve a task that rebuilds what is already
there. If the repo is large, read the parts each task claims to touch, and read them before
you judge that task.

Keep a scratch list as you go. Every entry gets sorted in Stage 3, and you cannot sort what
you did not write down.

## Stage 2 — The four passes

### Pass 1 — Do the documents agree with each other

The whole of `plans/{slug}/` has to describe one buildable thing. Check:

- **The dependency graph.** Every `Depends on` points at a task that exists and comes
  earlier. No cycles. No task number used twice.
- **The three lists match.** Every task in `PLAN.md` has a file in `tasks/` and a row in
  `PROGRESS.md`, and nothing appears in one that is missing from the others.
- **Every task has all five** — goal, the files and the actual interfaces, a "Done when",
  a test list, its dependencies. A task with no test list is a green suite waiting to happen.
- **Every "Done when" is checkable by somebody who was not there**, without asking the
  author and without reading the implementation.
- **Names hold across files.** A file path, a function signature, a data shape or an endpoint
  described in two places is described the same way in both. Two tasks that meet at an
  interface agree on it exactly.
- **No task contradicts a rule in `DESIGN.md`** — the testability boundary, the dependency
  policy, the storage format, the crash behaviour, the seatbelts.
- **Every rule in `DESIGN.md` carries its reason.** One that does not will be overturned by
  the first session that finds it inconvenient, and the plan will not survive the discovery.
- **The ordering holds.** Everything testable automatically before anything that draws a
  pixel; the riskiest unknown first, as a spike; the dangerous thing small before full size;
  the recovery route before the thing that keeps it alive; the thing that can lock you out
  last, with a seatbelt.
- **The verification table is wired up.** Every task that can only be checked by a person
  says so in its own doc, and every row of the table belongs to some task.
- **Nothing out of scope is being built.** Cross the task list against what `DESIGN.md` says
  is deliberately not being built.
- **`FINDINGS.md` does not contradict the plan.** The planning session's own probes are in
  there.
- **The plan is within its budgets, and reads flat.** `DESIGN.md` carries each rule's reason
  in a sentence rather than an essay; no section is padded to look complete; `PROGRESS.md` and
  `FINDINGS.md` are inside the ceilings in `CLAUDE.md § Keeping them short is a duty`. This is
  the only session that reads the whole plan before anything is built on it, so it is the last
  cheap moment to size the corpus. Every page here is re-read by every session afterwards, and
  the register set now is the register every later session will append in.

### Pass 2 — Are the requirements complete

Read the plan as the person who will *use* the thing, not as the person who will build it.
You are looking for what nobody has decided yet:

- **Unhappy paths with no stated behaviour.** Offline, corrupt file, crash mid-write, two
  copies at once, permission refused, the thing simply not there, the user doing it wrong.
  Every one of these that the plan does not answer is a rule some session will invent.
- **Anything a user would see, hear or do that was never described.** First run with nothing
  to show, the empty state, the default, the wording, what happens when it is working and
  what happens when it is waiting.
- **Choices the plan made silently** where either answer is defensible. The plan picking one
  is not the same as the user choosing it.
- **Success criteria nobody can check.** "Good UX" is not one; the plan is allowed to say so.
- **"What must never happen"** — is there an actual task preventing it, or only an intention?

**Do not fill any of these in.** Every one is a decision, and it goes in the pile in Stage 3.

### Pass 3 — Do the machine claims still hold

The plan was measured on a machine, possibly on a different day. Re-measure:

- **The test command** named in `DESIGN.md § Environment` runs here. On a project with no
  code yet it may legitimately fail — check it fails the way an empty project fails, not the
  way a wrong command fails, and say which.
- **The passing run is actually cheap.** Where there is a suite to run, run it and look at what
  came back: a green run should be a summary line per suite, not a line per test, and it should
  carry no ANSI colour escapes. Verbose or coloured output means the quiet, colourless default
  `DESIGN.md` promised is not really baked into the command — usually a mechanical fix, the
  framework's dot-or-`-q` reporter plus `FORCE_COLOR=0` or `--no-color`, and a note of what was
  forcing colour (`FORCE_COLOR`, `CI`, `CLICOLOR_FORCE`). Confirm too that the command still
  fails loudly — failures in full, non-zero exit — and that any machine-readable CI path the
  plan names (JUnit XML, TAP) is left intact.
- **The versions** `DESIGN.md` records are the versions this machine reports.
- **Everything named as a dependency** exists, at that version, available here — and is
  allowed by the dependency policy the plan set.
- **The seatbelts are real.** The flag, the limit, the dry-run switch actually exists on the
  command it is attached to. A seatbelt that does not exist is worse than none, because
  somebody will trust it.

**Bounded probes only, and never the dangerous thing.** Anything needing a screen, a login,
another account, a reboot, a device or a paid call is handed to the user with its seatbelt,
in the block from `CLAUDE.md`, and you wait for the answer. Never run the unbounded version
to find out.

**A measurement that contradicts the plan is a finding.** It goes in `FINDINGS.md` — about
forty words, newest first — because it is a fact about the machine and that file is where
facts about the machine live. Decisions do not go there; those live in the commit message.

### Pass 4 — Is any of it already built?

`pir-plan` has a whole stage for this — *what already exists that does part of this* — and it
is still the thing plans get wrong most often, because a session that has spent an hour on the
requirements searches the code for the name it has just invented rather than for the behaviour.
**Do the search again, independently.** Do not read what the planning session concluded and
check its working; go and look for yourself, then compare.

What you are hunting is **a task that builds something the repo already has, in a slightly
different shape, under a different name.** It passes every other check in this skill — the documents agree, the requirements are met, the machine supports it —
and it is still wrong, because the right answer was to extend what is there. Nothing later in
the method catches it either: `pir-review` checks a task against its doc, and a faithful
implementation of a redundant task is a clean review.

**Work task by task, not file by file.** For each task, take what it says it will build — the
module, the function, the data shape, the endpoint, the file it names — and go looking:

- **Search by behaviour, not by name.** The existing thing is almost never called what the
  plan calls it; that is exactly why the planning session missed it. Search for what it *does*
  — the string it would format, the field it would read, the error it would raise, the call it
  would make, the constant it would need.
- **Check the files each task says it will create.** One that already exists is a rename, a
  rewrite or a collision, and the plan has to say which.
- **Hunt the near-miss, not the exact match.** Something covering most of it is the case that
  matters: the plan will build a second one beside it, and from then on every fix has to be
  made twice.
- **Look in the obvious neighbours.** Whatever this repo calls its utilities; the tests, where
  a test for behaviour the plan proposes to build is proof the behaviour exists; and the
  dependency list, where a library already installed may do the whole task.

Sort each hit, because they lead to different answers:

| What you found | Where it points |
|---|---|
| Already does the job | The task should be dropped |
| Does most of it, and extends cleanly | The task becomes an extension, usually much smaller |
| Similar but genuinely different | The task stands. Why it is not that other thing goes in your commit message, not into the task doc |
| Does the job badly | Replacing it is defensible and so is living with it. Not yours to decide |

**Every one of these is a decision, never a mechanical fix.** Dropping a task, shrinking it or
turning it into an extension changes what gets built. Bring it with the evidence: what exists,
where, how much of the task it already covers, and what the task would cost as an extension
instead.

**Recommend extending** unless you can say concretely why the existing thing cannot carry it.
A second implementation of something the repo already has is the most expensive kind of
"done", and it is invisible on the day it ships.

## Stage 3 — Sort what you found into two piles

**Mechanical** — one right answer, and fixing it changes nothing about what gets built:

> a dependency pointing at a task that does not exist or comes later · a task numbered twice
> · a task file with no row, or a row with no file · the same file or interface named two
> ways · a missing test list, a missing dependency line · a broken cross-reference · a
> version number the machine has just contradicted · a test command that prints a line per
> passing test or forces colour when it should be quiet · a row or cell over its word budget ·
> a section padded with "n/a" instead of deleted · a rule stated twice in two files

**Fix these yourself.** Do not ask. List them afterwards, one line each.

**Decisions** — anything that changes what gets built:

> everything from Pass 2 · everything from Pass 4 — a task that builds what the repo already
> has, or that should become an extension of it · two rules that contradict, where which one
> wins is a judgement · a task that should be split, added, dropped or reordered · a design
> rule the machine has just proved impossible · anything where either answer is defensible

**Ask. Never guess, and never invent a rule to avoid asking.**

**If you cannot tell which pile something belongs in, it is a decision.** That rule is doing
real work: the fixes that hurt are the ones that felt mechanical.

## Stage 4 — Put the whole list up, then decide one at a time

**First, the shape of it**, in plain English, no jargon: how many decisions there are, and one
line each naming them. The user needs to see the size of the problem before answering any part
of it — an answer given without knowing what else is coming is often the wrong one.

**Then one decision at a time**, in the format `CLAUDE.md` sets:

- what you are trying to do, in a sentence
- the options in plain words, with what each one costs
- **your recommendation**, because you know the machine and they do not
- what you will do if they say nothing

**Wait for each answer.** Do everything that does not depend on it while you wait — the
mechanical fixes, the rest of the passes. Do not batch the questions to save time, and do not
move on by assuming an answer.

## Stage 5 — Apply exactly what was decided

Edit `DESIGN.md`, `PLAN.md`, the task files and `PROGRESS.md` so the plan on disk says what
will actually be built. Splitting, adding, dropping and reordering tasks is all allowed here —
when it is what the user agreed to, and nothing has been built yet, so nothing breaks.

- **Every new or changed rule carries its reason**, exactly as at plan time.
- **After any renumbering, walk the dependency graph again.** A renumber that leaves a
  dangling dependency is worse than the gap it closed.
- **Change nothing that was not decided on.** A tidier plan the user did not ask for is scope
  creep, and it arrives without the fresh-eyes pass that everything else here gets.
- **Write no product code.** Not one file. The first task belongs to the next session.

## Stage 6 — Mark it reviewed, commit, stop

**The line in `PROGRESS.md` is what unlocks the build.** Replace the placeholder with the
verdict:

```
**Plan reviewed:** {date} — 6 fixed, 3 decided with the user
```
```
**Plan reviewed:** {date} — clean, nothing found
```

One line, not both. A clean review still writes it, still commits, and still says so — the
`PROGRESS.md` change is the commit.

**The commit message is the only account of this review, so write it long.** Every mechanical
fix by name, every decision with the reason the user gave for it, and anything you checked and
found sound. There is no review report file and no summary elsewhere; a session in three weeks
that wonders why a rule says what it says has `git log` and nothing else.

```
plan-review({slug}): 6 fixes, 3 decisions
```

Then report in plain English: what was wrong, what you fixed, what the user decided, and
anything you checked that is now known to hold. Say the next command is `/pir-work {slug}`,
put it on its own line, and **stop**.

**Do not implement T00.** The next session does that.
