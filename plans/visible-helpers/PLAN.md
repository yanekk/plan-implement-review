# Implementation plan

7 tasks in 3 phases. Each has a file in [tasks/](tasks/) with its goal, the files it touches, the
interfaces it defines, and what "done" means.

Track state in [PROGRESS.md](PROGRESS.md). Read [DESIGN.md](DESIGN.md) first.

---

## Shape of the build

- **Headless first.** T01 and T04 are pure and proven on the plan-0339 log; the screen tasks wire them.
- **No probe task, no paid run.** The wire shapes are in `evidence/plan-0339-helper.ndjson` and the
  probe recorded in DESIGN §2.1. The screen is driven on the existing conversation rig with the fake
  `claude` (T02).
- **Prose last.** The docs (T07) follow the drill, so they describe what was seen.

```
Phase 1  ▸  T01  T02            helper fold; rig scenario                parallel
Phase 2  ▸  T03  T04  T05       helper lines; gate rules; gate wiring    T03 needs T01,T02; T04 needs T01; T05 needs T02,T03,T04
Phase 3  ▸  T06  T07            drill; docs                              T06 needs T03,T05; T07 needs T06
```

## Phase 1 — The reading and the rig

| # | Task | Depends on |
|---|---|---|
| [T01](tasks/T01-helper-fold.md) | helper-fold | — |
| [T02](tasks/T02-helper-rig-scenario.md) | helper-rig-scenario | — |

## Phase 2 — What the person sees

| # | Task | Depends on |
|---|---|---|
| [T03](tasks/T03-helper-lines.md) | helper-lines | T01, T02 |
| [T04](tasks/T04-interrupt-gate.md) | interrupt-gate | T01 |
| [T05](tasks/T05-interrupt-gate-view.md) | interrupt-gate-view | T02, T03, T04 |

T03 is its own wirer: `buildConversation` is already what the conversation view paints, so the helper
line reaches the screen with no new call site; `worker-proc.mjs`'s `canUseTool` is already the one place
requests are logged. T05 wires T04 into `conversation-view.mjs` (already mounted by `pir-tui.mjs`) and
the existing drop → `person-inbox.mjs` → `platform.send` → `worker.send` path, in all three hosts
(`platform.mjs`, `plan-run.mjs`, `coordinator-agent.mjs`). T05 follows T03 because both edit
`conversation.mjs` and `conversation-view.mjs`.

## Phase 3 — Check and document

| # | Task | Depends on |
|---|---|---|
| [T06](tasks/T06-helpers-drill.md) | helpers-drill | T03, T05 |
| [T07](tasks/T07-docs.md) | docs | T06 |

T06 reaches every build task: T03 → T01, T02; T05 → T02, T03, T04. T07 is the only leaf.

---

## Main path and who wires it

| Step | Built by | Wired by |
|---|---|---|
| The log's helper frames and events are read | T01 (`stream.mjs`, `helpers.mjs`) | T03 (`buildConversation`), T05 (`conversation-view.mjs`) |
| One line per helper; details on Tab | T03 | T03 (`buildConversation`, already painted) |
| A helper's request names it | T03 (`conversation.mjs`) | T03 (`worker-proc.mjs` logs `agentId`) |
| The status line names running helpers | T03 (`buildConversation`'s `helpers`) | T03 (`conversation-view.mjs`) |
| Esc warns | T04 (`interruptGate`, `gateWarning`) | T05 (`conversation-view.mjs`) |
| The next message carries the note | T04 (`stoppedByInterrupt`, `helpersNote`) | T05 (view, inbox, platforms, `worker-proc.mjs`) |
| Not `asking` while a helper runs | already `background` (stopped-worker-asking) | T01 (turn-opener fix and regression tests) |

## Critical path

```
T01 → T03 → T05 → T06 → T07
```

## Sizing

T01, T03 and T05 medium; T02, T04, T06 and T07 light.

## Parallel width

7 tasks, longest chain 5, up to 2 can run at once (T01 with T02, or T03 with T04).

## Open

- The helper line's time is as of the last progress event (DESIGN §2.2), because the core reads no clock.
  If the drill finds it reads stale, a shell-side ticking clock is a person's choice, not a fix.
