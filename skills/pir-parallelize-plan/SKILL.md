---
name: pir-parallelize-plan
description: Convert a reviewed plan written before parallel mode existed into one the parallel coordinator dispatches correctly — add the Runs column PROGRESS.md needs, tag every spike and hand-verification `you`, and resolve each task that is both code and a mandatory human check into a fold (one auto task that parks and asks) or a build→verify split (an auto builder plus a `you` task a person judges). Fixes what has one right answer, brings the fold-vs-split depth to the user as a decision, and touches only the plan files. Runs once, before the first /pir-coordinate, on a plan that is reviewed but not yet being built. Use when the user says "pir-parallelize-plan {slug}" or asks to make an existing plan runnable in parallel.
---

# parallelize-plan

**This session changes plan documents, not code.** Not the product, not scaffolding. The plan
under `plans/{slug}/` is the only thing in front of you, and by the end of it the plan says
the same thing it always did — it is only reshaped so the parallel coordinator can dispatch it.

It runs **once, before the first `/pir-coordinate {slug}`**, on a plan that was written for the
single-stream `/pir-work` flow and never carried the classification the coordinator reads. When
it is done, `/pir-coordinate {slug}` can run the plan many-wide.

The reason it exists: a plan written for single-stream `pir-work` assumes one interactive
session that both *builds* a task and, in that same session, *hands the user a hand-check and
waits*. Most tasks in such a plan are quietly two things at once — code the test command can
prove, plus a check only a person at a real device, screen or account can confirm. The parallel
coordinator has no such hybrid shape: it dispatches an `auto` task down one pipeline (a worker
builds it, then a **fresh** session reviews it) and a `you` task down another (a worker runs
`pir-verify`, a person judges, no review). A task that is both fits neither slot, and resolving
that mismatch per task across the whole plan is the entire job here.

**A plan written by the current `/pir-plan` is already parallel-ready** — it carries the `Runs`
column and its tasks were already folded or split at plan time. This skill is for the older
plans that predate that. If the plan you are pointed at already has a `Runs` value on every task
row, say so in your first line and confirm there is nothing to convert before touching anything.

---

## Before you start — three ways this session must refuse

**1. The plan must already be reviewed.** Read `plans/{slug}/PROGRESS.md`. If its
`**Plan reviewed:**` line still says "not yet", stop and say so: `/pir-review-plan {slug}` runs
first. This skill amends a reviewed plan; it is not a substitute for review, and it cannot make
a plan safe to build that has never been read back.

**2. Not once building has started.** If any task is in any state but ⬜ — 🟡 🔍 ✅ ⛔ — the plan
is in flight and this session stops. Say which task and why: reshaping the ground under finished
work is worse than the gap it closes, and amending a live plan is a decision of the user's,
through `/pir-plan`. Convert the plan *before* the first `/pir-coordinate` run, never during one.

*(If the only thing stopping you is a ⛔ task that was never actually started, say exactly that
and let the user decide. Do not decide it yourself.)*

**3. Nothing to convert.** No slug argument: list `plans/`. Exactly one plan — use it and say
which in your first line. Several — show them and **ask**. None — say so and point at `/pir-plan`.

---

## What binds this session

**The user decides *what*. You decide *how*.** The whole of `CLAUDE.md § Who you are talking to`
applies. This conversion changes the task list — a split adds a task — and the task list is the
user's. So the one genuine decision here, the fold-vs-split *depth*, goes to the user. Everything
with exactly one right answer you do yourself and report afterwards.

**What you just do, and tell them after:**

- Add the `Runs` column to `PROGRESS.md` and give every row a value.
- Tag every spike and every pure hand-verification drill `you` — they never had code, so there
  is no fold-or-split question.
- Tag every task that is code with a suite and no human check `auto`.
- Keep dependencies honest, and refuse to add a fake one to line up a shared device or person.

**What you must ask** is in *Stage 3*: the fold-vs-split depth, once, with a recommendation.

**Plain English to the user, technical in the files.** Say "a machine can finish and check this
one" and "only you at the device can say whether this worked" — never `auto`, `you`, "task
branch" or "verify pipeline" to them. The conversation is theirs; the documents are yours.

**Read the whole plan before you say anything.** The first thing the user hears is the whole
classification and the single depth question, not a running commentary — see *Stage 3*.

---

## The mechanism — the load-bearing facts

Get any of these wrong and the coordinator silently misdispatches.

- **Classification lives in a `Runs` column in `PROGRESS.md`, nowhere else.** The task table
  must have a column named `Runs` holding the literal token `auto` or `you`, matched by name.
  It is not frontmatter, not a marker line in the task file, not a naming convention, and not
  the words "you" or "spike" appearing in prose. A `**Runs:** you` line in a task-file header is
  good documentation but it is not the source of truth.
- **A missing `Runs` column means every task parses as `auto`.** This is the single most
  important thing you fix. Without the column, a legacy plan's spikes and hand-verifications get
  dispatched as autonomous build-then-review tasks — the wrong pipeline, no `pir-verify`, and a
  pointless review session on a task that has no code.
- **An unknown value defaults to `auto` and is reported as an error.** Treat any cell that is
  not exactly `auto` or `you` as a bug to fix — a typo must never silently spawn an autonomous
  worker on a person-only task.
- **`auto` → an implement worker then a separate review session. `you` → a verify worker, and
  it goes straight to merge, no review.** That is why a `you` task must never carry a code
  deliverable: code gets no review under `you`. If a would-be `you` task has code in it, the
  code belongs in an `auto` builder and only the judgement belongs in the `you` task.
- **Task ids stay numeric `T{nn}`.** Numbers are parsed from `PROGRESS.md`, from task filenames
  `T{nn}-*.md`, and from branch names. A letter suffix like `T09b` risks breaking that parsing.
  When a split creates a new task, give it the **next free numeric id** even though that puts a
  verify task's number after the builder it pairs with. Do not renumber existing tasks to keep
  pairs adjacent — the cascade through filenames, every `Depends on` and every `FINDINGS.md`
  reference is not worth it, and a forward-pointing dependency (T11 depends on T09) is legal and
  honest.
- **The coordinator bin lives in the PIR engine checkout, not this repo.** `pir-coordinate`
  resolves inside the `plan-implement-review` (or `pir-run`) checkout; the plan's own repo holds
  only `plans/` and product code. You do not need the bin to do the conversion, but the operator
  needs it wired up to *run* `/pir-coordinate`. Worth one line in your report.

---

## Stage 1 — Read the whole plan, and inventory every human check

Read, in full, before forming a view: `DESIGN.md`, `PLAN.md`, every file in `tasks/`,
`PROGRESS.md`, `FINDINGS.md`. Then read the environment: the test command, the verification
table (`DESIGN.md`'s "what the test command cannot reach"), and the seatbelts it names.

**Then list, per task, the one thing that decides its classification: is there a check only a
person can do?** Work from two sources and cross them:

- The verification table in `DESIGN.md` — each row is a thing only a person can establish.
- Each task file's "Needs a person" language, its hand-check block, its "Done when" lines that a
  test cannot decide — a screen someone has to look at, a device someone has to watch, a login,
  a second account, a real agent, a paid call.

Keep a scratch list. Every task lands in exactly one of the three buckets in Stage 2, and you
cannot sort what you did not write down.

## Stage 2 — Classify every task

- **No human check, code plus a suite → `auto`.** The clean case, and most tasks.
- **A spike, a pure judgement, a hand-verification drill with no code deliverable → `you`.**
  Outright, no fold-or-split question — it never had code.
- **Code *and* a mandatory human check → the fold-or-split judgement below.** This is the one
  bucket that carries a decision, and it is where the user's answer in Stage 3 applies.

**Fold or split, per task:**

- **Fold** when the check is a *quick escalation*: keep one `auto` task. The builder builds,
  then parks and asks the user through the normal question path — in parallel mode it reports to
  the coordinator, who surfaces it to the user — hands over the exact seatbelted command, and
  records the answer before the task is done. One task, one row.
- **Split** when the check is *first-class* — heavy, dangerous, on a real device, real agents or
  real branches, or worth planning as its own step. Plan a **pair**: an `auto` task that builds
  the thing, and a separate **`you` verify task that depends on the builder** and has a person
  judge it.

Two guardrails, both directions are mistakes:

- Do **not** fold a heavy or dangerous check back into the builder to save a row. It holds the
  builder's worker slot at human speed while the whole run waits, and worse, it can put a
  dangerous live action inside an autonomous worker.
- Do **not** split a light yes/no into its own task for the appearance of width.

**The physical-device nuance.** When the environment is a real device a worker must not touch —
a printer where a wrong command ruins a live job — the worker owns only the *safe mechanical
prep* (build the app, run the suite) and the **dangerous live steps stay in "Needs a person"**
for the human to run. This is how a plan's seatbelts — observe-before-send, staged-on-a-
throwaway, revert-first — survive parallelism: the one dangerous action is still exercised in
exactly one human-driven task, never by an autonomous worker.

## Stage 3 — Put the whole classification up, then ask the one decision

**First, the shape of it**, in plain English, no jargon. For every task, one line: a machine can
finish and check this one; only you at the device can settle this one; this one is code that a
machine builds but only you can confirm it worked. The user needs to see the whole picture
before answering the one question that follows.

**Then ask the fold-vs-split depth, once, with a recommendation.** It has defensible answers and
it changes how many times you are pulled to the device and how many tasks exist:

- **Minimal** — tag the types only; fold every check, add no new tasks. Simplest, but a heavy or
  dangerous check then holds a worker at human speed and can end up inside an autonomous worker.
  Discouraged.
- **Balanced (recommended)** — spikes and drills become the person's; split only the heavy or
  dangerous first-class checks into their own verify task; fold the light glances. This is what
  the planning method prescribes.
- **Maximal** — split every check into its own verify task. Cleanest separation, but the most
  round-trips to you and many tiny tasks. Discouraged for light yes/no checks.

Lay it out in the format `CLAUDE.md` sets — what you are doing in a sentence, the options with
what each costs, your recommendation, and what you will do if they say nothing (apply Balanced).
**Wait for the answer.** Do the mechanical work that does not depend on it — the `Runs` column,
tagging the clean `auto` tasks and the outright `you` tasks — while you wait.

## Stage 4 — Apply the conversion

**Add the `Runs` column to `PROGRESS.md`.** Insert it into the task table header
(`| # | Task | Runs | Depends on | State | Notes |`) and give every row a value — `auto` or
`you`, never blank, never anything else. Add the new verify-task rows the splits create.

**For each split:**

- Create a new task file with the **next free numeric id** (`tasks/T{nn}-*.md`), marked `you`,
  that **depends on the builder**. Give it the three-part structure the task template defines:
  an **`Environment (the worker owns this)`** section with the seatbelted bring-up, seed and
  teardown commands; an **`Automated checks (the worker runs these)`** section for anything a
  machine can decide; and a **`Needs a person`** block for what only a person can judge, in the
  `Needs you — … / Expect: / Tell me:` form. Standing the environment up and tearing it down is
  the worker's job; the person judges only the running thing. For a real device the worker must
  not touch, the dangerous live steps stay in `Needs a person`.
- **Narrow the builder to the code half.** Remove its live or dangerous steps and any "Done
  when" line only a person can check, and leave a one-line pointer to the verify task. The
  builder stays `auto`, is unit-tested against recorded or seeded input, and is reviewed as the
  code path — it never performs the live action.

**For each fold:** keep the one `auto` task and mark its "Needs a person" block as a *folded
check*, so a worker treats it as an escalation-then-record inline, not as a separate verify
task. The block stays; the note is what tells the worker how to run it.

**Add a `**Runs:**` marker to each task-file header** (`**Runs:** auto` / `you`). This is
documentation for a human reader — the `PROGRESS.md` column is the source of truth — but it
keeps the two in step and costs a line.

**Keep dependencies honest.** A split's dependency (verify → builder) is real; declare it. Never
add a fake dependency to serialise a shared device or a single person — that hides real
parallelism, and the run simply *parks* on each `you` task until the person drives it. Never cut
a real dependency to make the plan look wider.

## Stage 5 — Update PLAN.md and DESIGN.md

**PLAN.md:** add the `Runs` values to the phase tables and the new verify tasks, extend the
critical path through them, and add a short "how this runs in parallel" note — the two task
kinds, that dependencies drive dispatch rather than phase order, and that tasks sharing one
device or one person are not serialised by fake dependencies but simply park until the person is
free.

**DESIGN.md:** add a small subsection recording the *why* the next session needs — the
`auto`/`you` classification, the fold-vs-split placement of each verification-table check, and
the note that the seatbelts stay intact because each dangerous action lives in one human-driven
task. This is the reasoning; the long account is the commit message. Do **not** import section
numbers from the PIR engine's own design here — a target plan needs no parallel-mode sections,
only this record of what was decided for it.

## Stage 6 — Verify the plan against itself

Before you commit, check:

- Every `Runs` cell is exactly `auto` or `you` — no blanks, no typos, no third value.
- Every task-file `**Runs:**` marker agrees with its `PROGRESS.md` row.
- Every `Depends on` (in `PROGRESS.md` and in the task files) points at a task that exists;
  a split's forward-pointing dependency is fine.
- Every task id is numeric `T{nn}`; no letter suffix crept in on a split.
- Every new verify-task file exists and carries a "Needs a person" block; no `you` task carries
  a code deliverable.
- The three lists still agree — every task has a `PLAN.md` entry, a `tasks/` file and a
  `PROGRESS.md` row.

A quick grep of the `Runs` markers and the dependency columns catches most of these.

## Stage 7 — Commit only the plan, report, stop

**Commit only `plans/{slug}/`.** Leave any unrelated working-tree change alone. Write the commit
long — it is the only account of this conversion. Name each split and each fold, the
classification of every task, the depth the user chose, and the note that the seatbelts survive
because each dangerous action is confined to one human-driven task.

```
plan({slug}): convert for the parallel pir-coordinate flow
```

Then report in plain English: which tasks a machine now finishes and checks, which now need you
at the device, which were split into a build step plus a hand-check, and the depth you applied.
Say that the plan is now ready for parallel mode, and that running it needs the coordinator,
which lives in the PIR engine checkout, not this repo. Say the next command is
`/pir-coordinate {slug}`, put it on its own line, and **stop**.

---

## Traps — check for each of these explicitly

1. **Missing `Runs` column means everything is `auto`.** The number-one silent failure. Spikes
   get a review session and never reach `pir-verify`. Always add the column, and put a value on
   every row.
2. **Letter-suffixed task ids** (`T09b`) can break number and branch parsing. Use the next free
   numeric id for a split, and do not renumber existing tasks.
3. **Folding a heavy or dangerous check** wastes a worker slot at human speed and can put a
   dangerous live action inside an autonomous worker. Split those.
4. **Fake dependencies to line up a shared device or person.** Tempting and wrong. Leave the
   dependencies honest and let the run park on each `you` task.
5. **Letting a `you` worker drive the dangerous action** when the device must be human-driven.
   Keep the safe mechanical prep in `Environment`/`Automated checks` and the dangerous step in
   `Needs a person`.
6. **A `you` task with a code deliverable.** It was mis-split — the code belongs in its `auto`
   builder. `you` tasks produce no code and get no review.
7. **Chasing the PIR engine's design section numbers into the target plan.** The task template
   and skills mention `DESIGN §2.6`-style references that point at the engine's own meta-plan.
   The plan you are converting needs no parallel-mode design sections; record its classification
   rationale in its own words instead.

---

## Worked example — the `print-vision` conversion

11 tasks became 13. The starting plan built two features on a finished app, with three throwaway
spikes, and almost every task had a "Needs a person" half.

- Spikes **T00, T01, T03** → `you` outright.
- **T05** (a pure decision policy) → `auto`, no person needed — the clean case.
- **T02, T04, T06, T07, T08** (live-frame look, popover look, live scores, warning fires, banner
  action) → `auto` with the check **folded**: the builder parks, asks, records.
- **T09** (the one command that can pause the printer) → narrowed to `auto` code-only — built,
  unit-tested against the recorded frame, reviewed as the sole transmit path, and it never sends
  live. A new **T11** (`you`, depends on T09) proves the real pause on a *throwaway* print with
  the person — the staged-pause seatbelt as its own task.
- **T10** (the camera-split boot script) → narrowed to `auto` build-the-script-and-docs, which
  touches nothing on the device. A new **T12** (`you`, depends on T10) installs it *revert-first*
  and proves it, or confirms the fallback.

The user chose the **Balanced** depth. No fake dependencies were added for the five `you` tasks
that share the one printer — the run parks on each until the person is free. The result was one
`plan(print-vision): …` commit touching only the plan files.
