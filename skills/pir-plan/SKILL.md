---
name: pir-plan
description: Turn an idea into a buildable plan — brainstorm the requirements, probe the tech, settle the architecture, split the work into tasks a session can each implement and a later session can review, and write it all to plans/{slug}/. Use when the user says "pir-plan" or "plan", describes something new to build, or asks to plan a feature. Produces DESIGN.md, PLAN.md, PROGRESS.md, FINDINGS.md and one file per task — and writes no product code.
---

# plan

**This session writes documents, not code.** The one exception is a throwaway spike, and
only to settle a question the plan would otherwise have to guess at — see *Stage 3*. When
the plan is written, you stop. `/pir-review-plan {slug}` checks it in the next session, and
`/pir-work {slug}` then builds it, one task at a time.

The output is a folder:

```
plans/{slug}/
├── DESIGN.md        why everything is the way it is — including the environment
│                    and the verification contract
├── PLAN.md          the phases, the task table, the dependency graph, the critical path
├── PROGRESS.md      task states and the queue — the handoff between sessions
├── FINDINGS.md      what the build teaches, filled in from here on
└── tasks/
    ├── T00-*.md     one file per task: goal, files, interface, done-when, tests
    └── …
```

Templates for all five are in `templates/` beside this file. They are starting points, not
forms to fill: delete a section that does not apply to this project rather than writing
"n/a" into it.

---

## What binds a planning session

**The user decides *what*. You decide *how*.** The whole of `CLAUDE.md § Who you are talking
to` applies here more than anywhere, because a planning session is where the temptation to
invent a requirement is strongest. Every unspecified behaviour is a question, not a gap for
you to close quietly. **Ask, and wait.**

**Ask one decision at a time.** A list of eight questions gets four answers. Ask the one
that unblocks the most, take the answer, ask the next. Batch only questions that are
genuinely the same decision.

**Plain English to the user, technical in the files.** The conversation is theirs; the
documents are yours.

**Write down the *why*, every time.** A design rule without its reason gets overturned by
the first session that finds it inconvenient. DESIGN.md is read by every session that
touches the thing it governs, and its whole value is that it carries the reasoning across.

**Do not start building.** Not even the "obviously needed" scaffolding. The first task in
the plan is somebody else's session, and a plan whose author already built half of it has
lost the fresh-eyes pass on that half.

---

## Stage 1 — The slug, and what already exists

1. **Agree the slug** with the user in one line: short, kebab-case, names the thing —
   `screen-time`, `invoice-import`, `auth-rewrite`. Propose one, let them correct it.
2. **If `plans/{slug}/` already exists, stop and ask.** Re-planning over a plan with work
   already done against it is a decision about history and it is the user's. Offer: a new
   slug for a new plan, or an explicit amendment to the existing one.
3. **Look at what is already there** — the repo, its README, its build files, its dependency
   list, its tests, any existing code. A plan that ignores the codebase it lands in is a plan
   rewritten in week two. This is the orientation pass; the real search happens in *Stage 4*,
   once you know what is being asked for.
4. Say in one line what you understood the goal to be, and let the user correct it before
   you spend anything on it.

## Stage 2 — Brainstorm, and gather the requirements

This is a conversation, not a questionnaire. Keep a scratch list of every answer as it
arrives — you will need the reasons, not just the decisions, when you write DESIGN.md.

Cover, in roughly this order, stopping to ask whenever the answer is not already clear:

- **What is this for, and who is it for?** In one paragraph. If you cannot write that
  paragraph, nothing downstream of it is safe.
- **What does success look like?** Concretely enough to be checkable. "The child stops
  arguing about screen time" is a success criterion; "good UX" is not.
- **The main path, step by step.** What actually happens, in the order it happens.
- **The unhappy paths.** What happens when it is offline, when the file is corrupt, when the
  user does the wrong thing, when two copies run at once, when it crashes halfway. **This is
  where most of the real requirements are**, and it is the part users have not thought about
  until asked. Ask about them one at a time.
- **The boundaries.** What is deliberately *not* being built. Write these down with their
  reasons — a declined feature that keeps getting re-proposed costs more than one that was
  refused in writing.
- **What must never happen.** The failure this thing exists to prevent, and any failure it
  must not be able to cause. This is what the seatbelts in Stage 3 are for.
- **What the user will run themselves.** Anything needing a screen, a login, another
  account, a device, a paid service or a real person. It becomes the verification table.

**Checkpoint.** Play the requirements back in plain English — a short numbered list, no
jargon — and get an explicit yes before Stage 3. Say what you are still unsure about rather
than smoothing over it.

## Stage 3 — Get the tech right, by measuring rather than reading

**Do not take documentation's word for anything the plan will sit on.** Check it on this
machine, in this version, today. A plan built on a remembered API is a plan discovered to be
wrong in the middle of task eleven.

Establish and write down:

- **What is actually installed.** Language and toolchain versions, from the machine, not from
  memory. What is deliberately *absent* matters as much — a missing IDE or SDK rules out
  whole workflows, and a later session will otherwise propose one every time.
- **The test command.** One command that produces this project's automated evidence. Name
  it in DESIGN.md and mean it: from here on it is the *only* evidence a session may produce
  on its own. If the obvious command does not work here, find the one that does and record
  why — the next session will otherwise rediscover it.

  **Require it to be quiet when it passes, and make quiet the default.** Its dominant caller
  is a session that reads all of its output, and a passing run that prints a line per assertion
  is thousands of lines of the word `ok` re-read by every review for the life of the project;
  the exit code already carries the result. Settle three things in DESIGN.md now, baked into
  the command itself so a plain run is already cheap and there is nothing to remember:

  - **Quiet.** The framework's own quiet reporter rather than a bespoke wrapper — a dot
    reporter, a `-q`, whatever this stack ships — one summary line per suite on green, and say
    in DESIGN.md how a person turns the detail back on to debug.
  - **No colour.** ANSI escapes tokenize badly, and `FORCE_COLOR`, `CI` and `CLICOLOR_FORCE`
    force colour even when output is piped, overriding `NO_COLOR`. Check whether it is forced
    here (`env | grep -i color`, the shell profile, the CI config) and turn it off inside the
    command itself (`FORCE_COLOR=0`, `--no-color`, `--color=never`), never by trusting the
    caller's environment; record what was forcing it, since this is the change that has cost
    this method the most.
  - **Loud on failure.** Failures print in full — message, file and line, the diff, the stack
    the framework gives — the exit code stays 0 on pass and non-zero on failure, and any
    machine-readable CI path such as JUnit XML or TAP is left intact.
- **The dependency policy.** What may be added, and what may not. Decide it now, with the
  user, rather than one library at a time under pressure.
- **What the test command cannot reach.** The verification table: each row is a thing only a
  person can establish, and why. Screens, cameras, logins, second accounts, reboots, real
  devices, paid APIs, anything with a human in the loop.
- **The seatbelts.** For anything that could take the machine, the screen, the account or
  real money: the bound that makes it safe to run — a time limit, a dry-run flag, a spending
  cap, a scratch account, a fake data directory. **If a dangerous capability has no seatbelt,
  designing one is part of the plan**, and it belongs in an early task rather than being
  improvised the first time someone needs it.

**When an assumption is load-bearing enough that being wrong about it changes the
architecture, it becomes T00: a spike.** Throwaway code, one session, whose only job is to
answer the question on this machine — and which is deleted afterwards. Say in the task doc
which design decisions it gates and what each possible answer would mean. Finding out in an
afternoon that the approach is wrong is the cheapest thing in this whole method.

You may write and run spike code yourself during this stage if a question is small, safe and
blocking — a version probe, a four-line API check. Anything larger, or anything that needs a
seatbelt, is T00 and belongs to a later session.

## Stage 4 — What already exists that does part of this

**The commonest defect in a plan is a task that rebuilds something the repo already has**, in
a slightly different shape and under a different name. It costs nothing at plan time and
everything afterwards: two implementations of one behaviour, every fix made twice, and neither
one the obvious place to look. And nothing downstream catches it — `pir-review` checks a task
against its doc, and a faithful implementation of a redundant task is a clean review.

**This stage comes before the architecture on purpose.** An architecture settled first will
produce tasks that have nowhere to extend into, and by then the cheap moment has gone.

If the repo is genuinely empty, this stage is one sentence saying so. Say it rather than
skipping it — the next session should know the ground was checked.

### Go and look

**Work from the requirements, one at a time.** For each thing the plan will have to do, search
for something already doing it:

- **Search by behaviour, not by the name you would give it.** The thing that already does the
  job is never called what you would call it — that is exactly why it gets missed. Search for
  what it *does*: the text it would produce, the field it would read, the error it would
  raise, the call it would make, the file it would touch.
- **The near-miss is the case that matters.** An exact match is rare and easy to spot.
  Something covering most of the job — one condition different, one case missing — is what
  gets rebuilt instead of extended.
- **Read the tests.** A test asserting behaviour you were about to plan is proof that
  behaviour already exists.
- **Read the dependency list.** Something already installed may do the whole job.

### Then place each hit

| What you found | What it means for the plan |
|---|---|
| Already does the job | Do not plan it at all. Say what covers it instead |
| Does most of it, and extends cleanly | Plan the extension, not the rebuild — usually a much smaller task |
| Similar but genuinely different | Plan the new thing |
| Does the job badly | Extending it, reshaping it and replacing it are all defensible — see below |

**Bias to extending.** A second implementation of something the repo already has is the most
expensive kind of progress, and it is invisible on the day it lands. Only plan the new thing
when you can say concretely why the existing one cannot carry this.

### The obvious ones are yours; the close calls are the user's

An obvious extension, or something obviously unrelated, you decide and move on. **A genuine
close call goes to the user** — the existing thing nearly fits, or fits but is poor, or
extending it would bend it out of shape. Those are choices about what the product becomes, and
they belong to the person who owns what gets built.

Ask in the format `CLAUDE.md` sets — one at a time, and wait:

- what already exists, in plain words, and how much of the job it covers
- the routes: extend it, reshape it, or build alongside it — and what each costs
- **your recommendation**
- what you will do if they say nothing

### Then report, before you design

Before Stage 5, tell the user in plain English what the survey found: what already exists that
covers part of this, what you propose to extend, and what genuinely has to be new. They do not
need to approve it line by line — but designing on top of a survey they have not seen is how
a plan ends up rebuilding their own project.

**What gets written down.** Every decision made here — extend this, replace that, build the
new one anyway — goes in `DESIGN.md § Decisions and rationale` with its reason, like every
other decision. **Nothing goes in the task files.** A task says what it builds; it does not
carry a justification for its own existence, and a task doc that argues with itself is a task
doc nobody finishes reading.

## Stage 5 — The architecture, and where the testability boundary runs

One structural decision pays for itself in every task that follows: **separate the part that
decides from the part that touches the world.** The deciding part takes inputs as parameters
— including the current time — and returns decisions. It reads no clock, opens no window,
makes no request. The world-touching part is as thin as you can make it.

The reason is testability. Everything on the pure side can be tested exhaustively, in
milliseconds, in the ordinary test run. Everything on the other side can only be checked by
a person, and a person is slow and occasionally unavailable. **Every rule that leaks across
that boundary becomes a rule that can only be verified by hand.**

Name the boundary in DESIGN.md, say which module is on which side, and — if the language
allows it — **give it a test**: a check that scans the pure side for forbidden imports. The
rule then survives the session that finds it inconvenient. Say explicitly in DESIGN.md that
if that test fails the fix is to move the code, never to relax the test.

Also settle here, and record with reasons: the module list, the data flow, where state is
stored and in what format, what happens to it on a crash mid-write, and any concurrency the
design implies.

## Stage 6 — Split it into tasks

**A task is one session's work**, and it is not done until it is reviewable by somebody who
was not there. Every task needs all five of:

1. **A goal** — one paragraph, why it exists and what it is for.
2. **The files it touches**, and the interfaces it defines, written out. Not prose about
   them: the actual signatures, shapes or endpoints. A task implemented from its title is a
   task reimplemented.
3. **A "Done when"** somebody else can check without asking the author.
4. **A test list** — the cases the implementing session must cover, including the edge cases
   the goal implies. This is what stops a green suite that tests nothing.
5. **Its dependencies**, by task number, and only on tasks before it.

Sizing: **if you cannot write its "Done when" in three lines, it is two tasks.** If it has
no test list, it is either not a task or the testability boundary is in the wrong place.

### The ordering principles

- **Everything testable automatically is built and tested before anything that draws a
  pixel.** By the end of the headless phase the rules are all implemented and proven, and
  the UI phase then wires a surface to logic already known to be correct.
- **The riskiest unknown goes first**, as a spike, before anything is built on top of it.
- **Build the dangerous thing small before you build it full size.** A window in a 600×400
  box before a window over the whole screen; a migration on ten rows before ten million.
  Most of the bugs are findable at the small size, and the small size cannot take the
  machine.
- **Do not install the thing that keeps it alive before the thing that lets it recover.**
  Whatever this project's version of that is — a watchdog before an autostart, a rollback
  before a deploy — the recovery route is built first.
- **The thing that can lock you out is built last, with a seatbelt, and verified with the
  user.**

Then group the tasks into phases, draw the dependency graph, mark the critical path, and give
a rough sense of where the weight is — heavy / medium / light, not hours.

**Checkpoint.** Show the user the phase table and the one-line-per-task list, in plain
English, and get an explicit yes. This is the last cheap moment to move something.

## Stage 7 — Write the files

From `templates/`, into `plans/{slug}/`:

**The templates are maximums, not forms.** Delete a section that does not apply rather than
writing "n/a" into it, and never pad one to look complete. Everything written here is re-read
by every session for the life of the plan, so this is the moment the corpus is sized: a
paragraph written now is paid for on every run afterwards.

**Flat prose, and every rule's reason in a sentence.** No bold-per-clause, no em-dash asides,
no aphorisms. This matters more than it sounds: the register you write these files in is the
register every later session appends to them in, and a plan that starts out written in
epigrams gets epigrams back for ever. See `CLAUDE.md § How to write in these files`.

- **DESIGN.md** — purpose, success criteria, the behaviour specification with its reasons,
  the architecture and the boundary, the environment, the verification table and seatbelts,
  the decisions-and-rationale section, and what is explicitly out of scope. **Every rule
  carries its reason, in a sentence**; that is the whole point of the file. A rule with three
  paragraphs under it does not get read, which costs exactly what a rule with no reason costs.
- **PLAN.md** — phases, task table with dependencies, critical path, sizing, and any
  decision still open.
- **PROGRESS.md** — every task ⬜, an empty review queue, the `Next work will:` line
  pointing at the first task, and the `Plan reviewed:` line left at **not yet**. That line is
  what `pir-work` reads to decide whether the plan may be built; this session never fills it
  in, because this session wrote the plan.
- **FINDINGS.md** — header, legend, and any finding this planning session already produced.
  A probe from Stage 3 that contradicted the documentation is a finding: write it down now,
  while you still have it.
- **`tasks/T00-…md`** onwards — one per task, from the task template.

Then check the plan against itself before you show it: every dependency points at a task
that exists and comes earlier; every "Done when" is checkable; every task that can only be
verified by a person says so in its own doc; nothing in PLAN.md contradicts DESIGN.md.

**That check is a courtesy, not the review.** `/pir-review-plan` does it properly in the next
session, and it will find things you cannot — you have been holding this plan in your head for
an hour and you will read your own reasoning and agree with it. Do not try to pre-empt it, and
do not soften what you hand over: an honest list of what you are unsure about is worth more to
that session than a plan polished into looking finished.

Commit it — `plan({slug}): <what it is>`.

## Stage 8 — Hand it over and stop

Report in plain English: what is going to be built, in what order, where the risk is, what
is deliberately not being built, and anything still open. Then say the next command is
`/pir-review-plan {slug}` — **not** `/pir-work` — put it on its own line, and **stop**.

A fresh session reads the plan for gaps, contradictions and claims the machine does not
support, settles them with the user, and marks the plan reviewed. `pir-work` refuses to build
until it has: a defect in a plan is copied into every task built from it, and nothing later in
the method catches it.

**Do not implement T00.** The next session does that, and it is the first of the alternating
pairs the whole method rests on.
