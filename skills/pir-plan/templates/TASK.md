# T{NN} — {name}

**Phase:** {n} · **Depends on:** {T…} · **Weight:** light / medium / heavy

> *(If this task doc is later superseded by a decision, say so here in a blockquote with the
> date, rather than editing the body silently — the implementing session needs to see both
> what was planned and what changed.)*

> **Flat prose throughout, and only the sections this task needs.** This doc is read in full
> by the session that builds it and again by the session that reviews it. Delete a heading
> that does not apply rather than padding it.

## Goal

One paragraph: what this is for and why it exists. Enough that somebody who has not read the
whole design knows what they are building and what it is in service of. One paragraph means
one — the reasoning behind the task belongs in `DESIGN.md`, and a task doc that argues for
its own existence is one nobody finishes reading.

## Design sections this implements

Point at `DESIGN.md` §{n} rather than restating the rules. Restated rules drift.

## Files

Which files this creates or touches. Being specific here is what keeps two tasks from
colliding.

## Interface

The actual signatures, shapes, schemas or endpoints this task defines — not prose about them.
**A task implemented from its title is a task reimplemented.**

```
{the interface}
```

Anything non-obvious about it gets a line saying *why*.

## Tests

The cases the implementing session must cover, one per line, including the edge cases the
goal implies — the boundary, the empty input, the corrupt file, the second copy, the clock
going backwards. **This list is what stops a green suite that tests nothing.**

- [ ]
- [ ]

## Done when

Three lines somebody else can check without asking the author. If you cannot write it in
three, this is two tasks.

- [ ]
- [ ]

## End to end (the worker drives this)

*(Delete if this task builds or changes nothing a person sees or moves through. Otherwise, per
`pir-e2e`: the suite these tests join — the project's existing end-to-end tooling, or the plan's rig
task — the sizes, and the interactions to drive through the real input path (a real browser, a real
pseudo-terminal) against the free backend, each with what it must show. These tests are part of
"Done when" and of the test command. A surface is never handed to the person to look at.)*

- suite: {existing suite or rig task} · sizes: {e.g. 80×24, 120×40 / 390×844, 1280×800}
- [ ] {interaction} → {what the screen shows}

## Environment (the worker owns this)

*(Delete if the check needs no environment stood up. Otherwise: the commands that bring the
execution environment up and seed it, and the commands that tear it down. These are the
**worker's**, not the person's — standing an environment up and down is mechanical, not a
judgement. The worker runs the bring-up before it asks the person and the teardown before it marks
the task done, and it confirms the environment is actually down. **Guaranteed teardown is the
seatbelt** that lets a worker bring a live environment up at all; a worker that cannot confirm
teardown escalates instead of marking done.)*

```
{bring-up + seed — the worker runs this before it asks the person}
{teardown — the worker runs this before marking done, and confirms it is down}
```

## Outside actions

*(Delete if this task touches nothing outside the repo. Otherwise: the rows of `DESIGN.md §5.3` this
task runs, by action name, with their bin. Do not restate the command or the reason; §5.3 is the one
place they live. An action this task needs that has no row is a missing row, and the worker treats it
as `ask` until the person has placed it.)*

- {action} — `worker` / `ask` / `person`

## Automated checks (the worker runs these)

*(Delete if there is nothing a machine can decide here. Otherwise: the commands the **worker**
runs itself against the environment it brought up — install a driver, run an end-to-end test —
and records the machine result of. A machine-decidable check is not a judgement, so it is the
worker's to run and record, never the person's. The worker records the pass/fail it observed and
never rounds an ambiguous result up to the person's later judgement of it.)*

```
{the automated check(s) — the worker runs these and records the pass/fail + output it observed}
```

## Needs a person

*(Delete if nothing here needs a person. Otherwise: exactly what only a person can do or decide —
a physical device, a login only they hold, a second account, a camera, a real person's reaction, a
paid live run in its §5.3 bin — never the environment setup or teardown, never an automated test,
and never how a screen looks or feels, which are the worker's (above, and `pir-e2e`). State what to look at, what to expect, and what to
report back. The worker records the machine result and the person's judgement separately and never
inflates an ambiguous reply toward the bigger claim.)*

The worker builds and prepares up to the point where the only missing thing is the person,
then raises this block through the normal question path — the moment it needs it, waiting for the
answer, not homework left at the end (DESIGN §2.5). It is a running thing and a list of what to look
at, with the seatbelted command, not "can you check this."

```
{what the person does or decides, with its seatbelt if it carries one}
```

Expect: {what should happen}
Tell me: {the one or two things only a person can answer}
