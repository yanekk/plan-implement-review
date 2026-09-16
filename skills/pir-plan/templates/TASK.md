# T{NN} — {name}

**Phase:** {n} · **Runs:** auto / you · **Depends on:** {T…} · **Weight:** light / medium / heavy

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

## Environment (the worker owns this)

*(Delete if the check needs no environment stood up. Otherwise: the commands that bring the
execution environment up and seed it, and the commands that tear it down. These are the
**worker's**, not the person's — standing an environment up and down is mechanical, not a
judgement (DESIGN §2.6). The hands-on worker runs the bring-up before the hand-off and the
teardown before it marks the task done, and it confirms the environment is actually down.
**Guaranteed teardown is the seatbelt (§5.2)** that lets a worker bring a live environment up at
all; a worker that cannot confirm teardown escalates instead of marking done.)*

```
{bring-up + seed — the worker runs this before the hand-off}
{teardown — the worker runs this before marking done, and confirms it is down}
```

## Needs a person

*(Delete if nothing here needs a person. Otherwise: exactly what the person must **judge** —
what only a person can look at and decide — never the environment setup or teardown, which is the
worker's (above). State what to look at, what to expect, and what to report back.)*

**This block is carried two ways (DESIGN §2.6):**

- **A folded `auto` task** raises it the moment it needs it and waits for the answer — the check
  is a quick escalation the builder presents inline, not homework left at the end.
- **A `you` verify task in a build→verify split** *is* this block: it is a `you` task depending
  on the `auto` task that built the thing, and the hands-on worker (`pir-verify`) stands the
  environment up, puts this block in front of the user, who judges it and reports what they saw,
  and then the worker tears the environment down. Use the split when the check is first-class —
  heavy, or on real agents, real branches or a real device — rather than a quick yes/no.

```
{what the person looks at — the judgement, with its seatbelt if it carries one}
```

Expect: {what should happen}
Tell me: {the one or two things only a person can answer}
