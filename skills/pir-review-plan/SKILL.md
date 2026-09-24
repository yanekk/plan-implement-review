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

**The one exception: a missing or malformed setup/test block.** If the plan is in flight — or
already reviewed and not built — and its `DESIGN.md` has no valid block (see *Pass 3*), do not
refuse and do not re-review. Run **the narrow pass** (below) and nothing else. With a valid
block, this refusal stands as written.

### The narrow pass

The engine and `pir-work` both treat a plan without a valid block as not reviewed, so a plan
reviewed or started before the block existed is stuck until one is written. This pass unsticks
it without re-reading ground under finished work:

1. **Measure** the setup and test lines on this machine, as `pir-plan` Stage 3 does: what the
   tests are, and what a fresh copy needs before they run (`none` if nothing). The prose of
   `DESIGN.md § Environment` is the starting point, not the answer.
2. **Write** the block as the very first lines of `DESIGN.md`, in the shape *Pass 3* gives.
   Touch nothing else in the file.
3. **Verify** it in a fresh copy, exactly as *Pass 3* says. A failure there — setup failing,
   setup leaving the copy unclean, a test line failing where the plan's code is built — means
   the lines are wrong: measure again. Do not commit an unverified block.
4. **Show the user the block and wait for their yes**, in plain words: what each line does and
   what the fresh copy showed. The block is what the engine will run unattended in every worker's
   folder, so it is theirs to approve.
5. **Commit** `DESIGN.md` alone, as `plan-review({slug}): setup/test block`, the message saying
   what was measured and what the verification showed.

No other file changes. The `Plan reviewed:` line in `PROGRESS.md` stays as it was — this pass
is not a review, and a plan that was never reviewed still needs the full one. Then report and
stop.

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
  earlier. No cycles. No task number used twice. That is only its shape; the next three checks
  are whether it is *right*, and a graph can pass the shape and still dispatch a task before the
  work it needs exists.
- **The leaves.** List every task nothing depends on. Only the final deliverable — the end-to-end
  check, the deploy, the last user-visible surface — should be one, unless `PLAN.md` says in a
  line why another is terminal. Any other leaf is a part whose output nothing consumes: a missing
  edge, or a missing task that should consume it. Never accept a leaf because it "never lengthens
  the critical path"; that is how the real-screen-time remote-grant review signed off the poller,
  the one part that drops the cover, as a leaf the deploy check did not wait for.
- **The end-to-end task's reach.** For each task that exercises the whole thing — an end-to-end
  check, a deploy-and-verify — walk its hands-on steps and list every task whose work they run
  through. Each must be among its dependencies, directly or through others. A doc that says
  "built by T01–T09" over dependencies that reach only some of them is this defect.
- **Every step of the main path is wired, traced in the code.** Independently of the plan's own
  account, find where the program starts in the repo, walk the main path from `DESIGN.md` through
  it, and at each hop name the task whose Files list constructs, registers or switches on that
  part. A hop no task owns — typically the entry point that builds the new component — means the
  feature ships every part and runs none of them. In remote-grant no task's Files list constructed
  the poller in `main.swift`, and a reviewer found it mid-build.
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
- **The person's share is only what needs a person.** This is the check nothing else in the
  method makes. Walk every task's "Needs a person" block against the rule in `pir-plan`: it is
  only for a person's *judgement* no tool could stand in for. Hunt two failures, and both are
  decisions, not mechanical fixes — they change what gets built and who does it:
  - **A person step a worker could do.** "A program has to be run," "a file has to be checked,"
    "an environment has to be set up" — none is person-only; a worker runs programs, reads
    files and stands environments up. If the only thing the person adds is pressing enter, it
    belongs in the worker-owned sections, and leaving it with the person seats the user at a
    keyboard for work the machine should own.
  - **A task that secretly leans on the user.** Read its "Done when" and its steps for any point
    where the worker would have to hand the user a thing to run, configure or set up that the
    task never gave the worker the means to automate. Either the task carries the tool that
    closes it, or the genuinely person-only remainder goes in its "Needs a person" block with
    the mechanical setup in a worker-owned section.
- **Every outside action has a row and the right bin** (`DESIGN.md §5.3`). Walk every task for
  anything it does to the live world — a deploy, a paid call, a DNS record, a message sent — and
  check each has a §5.3 row, is listed in the task's "Outside actions", and sits in the right
  bin. Hunt both directions, and both are decisions:
  - **Too little autonomy.** A `person` row that is not a login, a device or a judgement: the
    worker could run it after the user's yes, so it belongs in `ask` or `worker`. A task that
    hands the user a command to paste is this defect. The real-screen-time remote-grant plan put
    every `sam deploy` in the user's hands on an unchecked premise, and this pass signed it off.
  - **Too much autonomy.** A `worker` row that crosses a hard line (cannot be undone, may cost
    more than its task expects, seen or received by others, changes the infrastructure) with no
    dated exception from the user.
  - **A row a worker cannot carry out**: no wrapped command, no login check, no way back.
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

- **The setup/test block is valid.** `DESIGN.md` opens with it — the first line of the file is
  `---`, and it ends at the next line that is exactly `---`:

  ```
  ---
  setup:
    - cd server && npm ci
  test:
    - make test
  ---
  ```

  `setup` and `test` are both required; `setup: none` is the empty setup; `test` needs at least
  one line and `test: none` is invalid; each item is `  - ` and one shell line, run from the repo
  root in its own `/bin/sh -c`. Check it with the engine's own parser, so you accept exactly what
  the engine will:

  ```
  node --input-type=module -e 'import {parseTestBlock} from "'"$HOME"'/.claude/pir-engine/src/core/testblock.mjs"; import {readFileSync} from "node:fs"; console.log(JSON.stringify(parseTestBlock(readFileSync(process.argv[1],"utf8"))))' plans/{slug}/DESIGN.md
  ```

  **A missing or malformed block is yours to write, not a decision.** Once measured it has one
  right answer: measure the lines as `pir-plan` Stage 3 does, write the block as the file's
  first lines, verify it as below, and list it afterwards with the other mechanical fixes. The
  engine refuses to start a plan without one, and `pir-work` stops on it.
- **The block runs in a fresh copy.** Your checkout already has everything installed, which is
  exactly how a missing install stays hidden, so run it where nothing is:

  ```
  V="${TMPDIR%/}/pir-verify-{slug}"      # the session's temp directory
  git worktree add --detach "$V" HEAD
  ( cd "$V" \
      && sh -c '<setup line 1>' && sh -c '<setup line 2>' \
      && test -z "$(git status --porcelain)" \
      && sh -c '<test line 1>' && sh -c '<test line 2>' )
  git worktree remove --force "$V"      # always, pass or fail
  ```

  Each line runs in its own `sh -c` from the copy's root, so a `cd` does not carry over — the
  way the engine runs them. With `setup: none`, skip straight to the clean check and the tests.
  **Remove the worktree whatever happened**, in the same command or the next one; a stale one
  blocks the next verification. It is local and needs no approval (`git worktree prune` clears
  a leftover).

  - **Setup must succeed and leave the copy clean.** Any output from `git status --porcelain`
    after setup counts as a setup failure: setup runs unattended in every parallel worktree, so
    a rewritten lock file or an install folder missing from `.gitignore` would land in task
    commits. `npm ci`, not `npm install`, is the usual fix.
  - **The test lines pass.** On a project with no code yet they may legitimately fail — check
    they fail the way an empty project fails, not the way a wrong command fails, and say which.
    Setup has no such allowance.

  A wrong line with one right replacement you have just measured is a mechanical fix; a choice
  between two defensible setups is a decision.
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
- **The credentials are what the plan says.** List the profiles, accounts and tokens configured
  here (names only, never secrets) and run each §5.3 login check, which is read-only. A plan
  that says a credential is absent when it is present has sent a worker's job to the user; one
  that says it is present when it is not has a task that stalls on first contact. Either is a
  finding, and the bins built on it are a decision. A login check that fails only because the
  session has expired is not a contradiction: say so and move on.

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
> a section padded with "n/a" instead of deleted · a rule stated twice in two files · a
> setup/test block missing or malformed, once measured and verified in a fresh copy (*Pass 3*) · a missing
> dependency edge between two tasks that both exist, where one plainly uses the other's work (the
> end-to-end task not reaching a part it exercises, a leaf whose one consumer is obvious)

**Fix these yourself.** Do not ask. List them afterwards, one line each. A missing edge changes the
order work runs in, not what gets built, so it is yours; if closing it would need a task that does
not exist yet, or a leaf has no obvious consumer, it is a decision.

**Decisions** — anything that changes what gets built:

> everything from Pass 2 · everything from Pass 4 — a task that builds what the repo already
> has, or that should become an extension of it · two rules that contradict, where which one
> wins is a judgement · a task that should be split, added, dropped or reordered — including a
> step of the main path no task wires in · a person step a worker could do, or a task that
> hides a handover a worker could automate · an outside action with no row, in the wrong bin,
> or crossing a hard line from the `worker` bin · a design rule the machine has just proved
> impossible · anything where either answer is defensible

**The §5.3 table as a whole is always a decision, even when every row looks right.** It is the
user's grant of what workers may do to the live world, and the plan proposed it without them.
Show it in plain words — what workers will do alone, what they will do after a yes, what stays
in the user's hands — and ask whether any `ask` action should move down to `worker`. That is the
only place an exception is made: the row records it with the date and the user's reason.

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
- **Turn the agreed §5.3 table into permission rules** in the project's `.claude/settings.json`
  (committed, so every worker's worktree has it): each `worker` command and every login check
  under `permissions.allow`, each `ask` command under `permissions.ask`, as exact
  `Bash(<command>)` rules. Merge into what is there, never replace it, and never widen a rule
  to a wildcard the table did not name. An `ask` rule makes the machine stop for the user's
  approval even in auto mode, and a narrow `allow` rule is what keeps the auto-mode classifier
  from blocking a live action the user already granted; the written bins alone do neither.

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
