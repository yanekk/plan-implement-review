# Implementation plan

9 tasks in 3 phases. Each has a file in [tasks/](tasks/) with its goal, the files it touches, the
interfaces it defines, and what "done" means.

Track state in [PROGRESS.md](PROGRESS.md). Read [DESIGN.md](DESIGN.md) first.

Redesigned 2026-09-28 for the coordinator agent: alerts fire when a question is the person's, not when a
worker waits, plus one end-of-run alert and an icon. The first version's T03, T05, T06, T07 are now T06,
T07, T08, T09; T03 (icon) and T05 (why-yours) are new.

## Shape of the build

- Five independent parts first: the pure episode machine and wording (T01), the sender and config (T02),
  the icon (T03), the session link and silencing env (T04), and the reason record in the routing (T05).
  Nothing reaches the network in tests.
- The command (T06) and the coordinator wiring (T07) join them. By the end of phase 2 every rule is
  proven with fakes.
- The phone is last (T08), then the docs describe what the phone actually did (T09).

No spike: the unmeasured claims (iOS tap target, iOS clear, iOS icon, QR subscribe, the presence variable
under a headless session) do not change the architecture; T08 measures them.

```
Phase 1  ▸  T01 T02 T03 T04 T05   core machine, sender + config, icon, session link + env, why-yours
Phase 2  ▸  T06 T07               pir notify, coordinator wiring
Phase 3  ▸  T08 T09               live on the iPhone, docs
```

## Phase 1 — The parts

| # | Task | Depends on |
|---|---|---|
| [T01](tasks/T01-alert-core.md) | alert-core | — |
| [T02](tasks/T02-ntfy-sender.md) | ntfy-sender | — |
| [T03](tasks/T03-notify-icon.md) | notify-icon | — |
| [T04](tasks/T04-worker-link-and-silence.md) | worker-link-and-silence | — |
| [T05](tasks/T05-why-yours.md) | why-yours | — |

At the end: alerts can be decided, worded and sent, the icon exists, sessions expose their link and
accept the env, and the routing knows why each question is the person's.

## Phase 2 — Wiring

| # | Task | Depends on |
|---|---|---|
| [T06](tasks/T06-notify-command.md) | notify-command | T02 |
| [T07](tasks/T07-coordinator-alerts.md) | coordinator-alerts | T01, T02, T04, T05 |

At the end: `pir notify` sets a phone up, and a real `pir start` sends alerts.

Main path and its wirers: setup is built by T02 and wired into `pir.mjs` by T06; the trigger, reason,
wording and timing are built by T01 and T05 and wired into `coordinate.mjs` by T07; the links and the
silencing env are built by T04 and wired by T07 (`workerEnv` into `createPlatform`, `env` into
`startCoordinatorAgent`, `url` into the views); the icon URL is built by T02 and sent by T06 and T07; the
icon file (T03) is consumed by T08, which pushes it online and sees it on the phone.

## Phase 3 — Seen for real

| # | Task | Depends on |
|---|---|---|
| [T08](tasks/T08-notify-live.md) | notify-live | T03, T06, T07 |
| [T09](tasks/T09-docs.md) | docs | T08 |

## Critical path

```
T01 | T02 | T04 | T05 → T07 → T08 → T09
```

T03 and T06 are off it. Leaves: T09 only.

## Parallel width

9 tasks · longest dependency chain 4 · up to 5 could run at once (T01–T05).

## Rough sizing

| Weight | Tasks |
|---|---|
| **Heavy** | none |
| **Medium** | T01, T02, T07, T08 |
| **Light** | T03, T04, T05, T06, T09 |

T05 and T07 both edit `coordinate.mjs` (T05 inside `startCoordinator`, T07 in `main`); T07 depends on T05,
so they never run at once. T08 waits on the person and draws plan usage for two real workers and the agent.

## Decisions still open

- If T08 finds the Claude app still pushes with `CLAUDE_CLIENT_PRESENCE_FILE` set, the user decides:
  accept doubles, or turn off "Push when actions required" in Claude Code's `/config` by hand. Does not
  block T01–T07.
- If the icon does not show on the iPhone, or the user wants a different look, the user decides: redo the
  drawing (a T03 follow-up) or drop the icon.
- What the QR does on iOS (T08) may change only T09's wording and T06's printed steps.
- Where the icon lives for good (user 2026-09-28, plan re-review): for now the default URL is the pushed
  feature branch's copy (DESIGN §2.5), so that branch stays on GitHub. Moving it is one constant in
  `notify-config.mjs`. Does not block any task.
