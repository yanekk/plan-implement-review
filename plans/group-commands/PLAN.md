# Implementation plan

3 tasks in 2 phases. Each has a file in [tasks/](tasks/) with its goal, the files it touches, the
interfaces it defines, and what "done" means.

Track state in [PROGRESS.md](PROGRESS.md). Read [DESIGN.md](DESIGN.md) first.

## Shape of the build

The rules are built and proven headless first (T01): every grouping, label and fold decision is in pure
core and tested in milliseconds. The view then only wires clicks, hover and scrolling to lines already
known to be right (T02), with its end-to-end tests in the existing pty rig. A drill closes the surface
phase and carries the behaviour into `/docs` and the README (T03). No spike: nothing here rests on an
unmeasured assumption, since pi-tui's clicks and hover were proven by mouse-navigation.

```
Phase 1  ▸  T01        grouping in core, headless
Phase 2  ▸  T02 → T03  click, hover, scroll; drill and docs
```

## Phase 1 — The rules

| # | Task | Depends on |
|---|---|---|
| [T01](tasks/T01-group-steps-core.md) | group-steps-core | — |

At the end of it `buildConversation` draws groups, labels, running steps and open groups, and tags group
lines with a `hit`; the view still passes no `open`, so every group is folded and nothing is clickable yet.

## Phase 2 — The surface

| # | Task | Depends on |
|---|---|---|
| [T02](tasks/T02-group-steps-view.md) | group-steps-view | T01 |
| [T03](tasks/T03-group-steps-drill.md) | group-steps-drill | T01, T02 |

The Task cell is the task's kebab slug, matching its `tasks/T{nn}-{slug}.md` filename. T02 reuses the
existing `conversation-rig` for its end-to-end tests, so no rig task precedes it.

Main path, builder and wirer: grouping and labels are built in T01 and reached by the view's existing
`buildConversation` call, so they show as soon as T01 lands; the open set, click, hover and placement are
built and wired in T02 (`conversation-view.mjs` is where the view is constructed for every caller in
`pir-tui.mjs`, which needs no change); the docs are T03's.

## Critical path

```
T01 → T02 → T03
```

Leaves: T03 only, the final deliverable.

## Parallel width

3 tasks · longest dependency chain 3 · up to 1 could run at once. The plan is serial by nature: each task
builds on the one before, so a parallel run drains it no faster than one task at a time.

## Rough sizing

| Weight | Tasks |
|---|---|
| **Heavy** | |
| **Medium** | T01, T02 |
| **Light** | T03 |

T01 will overrun if the break rule (§2.1) is threaded through pass 2 case by case; flushing the pending
group whenever a case is about to push a line is the simpler shape. T02's risk is the click-to-line
arithmetic and the §2.5 placement; both have unit tests before the pty test.

## Decisions still open

None that blocks. The drill (T03) may surface look-and-feel choices with two defensible answers; those go
to the person.
