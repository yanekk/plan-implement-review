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

## Needs a person

*(Delete if nothing here needs a person. Otherwise: exactly what cannot be established by the
test command, the command that would establish it — with its seatbelt — what to expect, and what
to report back.)*

**This block is carried two ways (DESIGN §2.6):**

- **A folded `auto` task** raises it the moment it needs it and waits for the answer — the check
  is a quick escalation the builder presents inline, not homework left at the end.
- **A `you` verify task in a build→verify split** *is* this block: it is a `you` task depending
  on the `auto` task that built the thing, and the hands-on worker (`pir-verify`) puts this block
  in front of the user, who runs it and reports what they saw. Use the split when the check is
  first-class — heavy, or on real agents, real branches or a real device — rather than a quick
  yes/no.

```
{the exact command, with its seatbelt}
```

Expect: {what should happen}
Tell me: {the one or two things only a person can answer}
