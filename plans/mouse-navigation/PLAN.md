# Implementation plan

8 tasks in 2 phases. Each has a file in [tasks/](tasks/) with its goal, the files it touches, the
interfaces it defines, and what "done" means. Track state in [PROGRESS.md](PROGRESS.md). Read
[DESIGN.md](DESIGN.md) first.

## Shape of the build

- **No T00.** The one load-bearing unknown, whether the person's terminal delivers pointer moves to
  pi-tui so hover can work, was answered by the spike the user ran on 2026-09-28 (DESIGN §6).
- **Pure first.** T02 (row hits, `select` in the live view) and T03 (hover paint) are pure and proven
  before any mouse event reaches the screen.
- **Safe before useful.** T04 turns the mouse on together with the exit restore, so no later task can
  leave a terminal in mouse mode.

```
Phase 1  ▸  T01 T02 T03          rig, row hits, hover paint          no visible change
Phase 2  ▸  T04 T05 T06 T07 T08  mouse on, lists, conversation, docs, drill
```

**Palette.** T03 edits `src/shell/palette.mjs`, committed on `main` at plan review (`4af5c63`).

## Phase 1 — Headless

| # | Task | Depends on |
|---|---|---|
| [T01](tasks/T01-mouse-rig.md) | mouse-rig | — |
| [T02](tasks/T02-row-hits.md) | row-hits | — |
| [T03](tasks/T03-hover-style.md) | hover-style | — |

At the end: the rig can send and read mouse state, every row line knows what it is, and hover has a paint.

## Phase 2 — The mouse

| # | Task | Depends on |
|---|---|---|
| [T04](tasks/T04-mouse-on.md) | mouse-on | T01 |
| [T05](tasks/T05-list-clicks.md) | list-clicks | T02, T03, T04 |
| [T06](tasks/T06-conversation-wheel.md) | conversation-wheel | T04 |
| [T07](tasks/T07-mouse-docs.md) | mouse-docs | T05, T06 |
| [T08](tasks/T08-mouse-drill.md) | mouse-drill | T05, T06, T07 |

At the end: click, hover and wheel work across the dashboard, documented, drilled and installed.

## Main path, builder and wirer

| Step | Built by | Plugged in by |
|---|---|---|
| Mouse reporting on, hover under tmux, copy, exit restore | T04 | T04 (`createScreen`, used by `runTui` already) |
| A mouse event reaches pir | T04 (`guarded.handleMouse`, `listen`'s `onMouse`) | T05 (`runTui` fills `onMouse`), T06 (conversation view) |
| Which row is under the pointer | T02 (hits, `hitAt`) | T05 |
| Hover highlight | T03 (paint) | T05 (`hoverY` into `FrameView` and the list view) |
| Click opens | T02 (`select` in watch) | T05 (`dispatch` select + open) |
| Wheel on lists | — (reducer `up`/`down` exist) | T05 |
| Wheel in a conversation, box clicks | T06 | T06 (`withHeadLine` forwarding; T04 forwards to the mounted view) |
| Docs | T07 | T07 |

The rig needs no rig task beyond T01: `openScreen` and `startPlanRig` already drive `pir`.

## Critical path

```
T01 → T04 → T05 → T07 → T08
```

T05 carries the weight. The only leaf is T08, the drill.

## Parallel width

8 tasks, longest chain 5, up to 3 at once (T01, T02, T03; later T05 beside T06). Serial by nature,
because every screen task goes through T04.
