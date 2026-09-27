# Implementation plan

7 tasks in 3 phases. Each has a file in [tasks/](tasks/) with its goal, the files it touches, the
interfaces it defines, and what "done" means.

Track state in [PROGRESS.md](PROGRESS.md). Read [DESIGN.md](DESIGN.md) first.

## Shape of the build

- The pure episode machine and wording (T01) and the two shell pieces it drives (T02 sender and config,
  T04 worker link and environment) are independent and built first; nothing reaches the network in tests.
- The command (T03) and the coordinator wiring (T05) join them. By the end of phase 2 every rule is
  proven with fakes.
- The phone is last (T06), then the docs describe what the phone actually did (T07).

No spike: the only unmeasured claims (iOS tap target, iOS clear, QR subscribe, the presence variable
under a headless worker) do not change the architecture; T06 measures them.

```
Phase 1  ▸  T01 T02 T04     core machine, sender + config, worker link + env
Phase 2  ▸  T03 T05         pir notify, coordinator wiring
Phase 3  ▸  T06 T07         live on the iPhone, docs
```

## Phase 1 — The parts

| # | Task | Depends on |
|---|---|---|
| [T01](tasks/T01-alert-core.md) | alert-core | — |
| [T02](tasks/T02-ntfy-sender.md) | ntfy-sender | — |
| [T04](tasks/T04-worker-link-and-silence.md) | worker-link-and-silence | — |

At the end: alerts can be decided, worded and sent, and a worker exposes its link and accepts the env.

## Phase 2 — Wiring

| # | Task | Depends on |
|---|---|---|
| [T03](tasks/T03-notify-command.md) | notify-command | T02 |
| [T05](tasks/T05-coordinator-alerts.md) | coordinator-alerts | T01, T02, T04 |

At the end: `pir notify` sets a phone up, and a real `pir start` sends alerts.

Main path and its wirers: setup is built by T02 and wired into `pir.mjs` by T03; the trigger, wording
and timing are built by T01 and wired into `coordinate.mjs` by T05; the link and the silencing env are
built by T04 and wired by T05 (`workerEnv` into `createPlatform`, `url` into the views).

## Phase 3 — Seen for real

| # | Task | Depends on |
|---|---|---|
| [T06](tasks/T06-notify-live.md) | notify-live | T03, T05 |
| [T07](tasks/T07-docs.md) | docs | T06 |

## Critical path

```
T01 | T02 | T04 → T05 → T06 → T07
```

T03 is off it and slots in any time after T02. Leaves: T07 only.

## Parallel width

7 tasks · longest dependency chain 4 · up to 3 could run at once (T01, T02, T04).

## Rough sizing

| Weight | Tasks |
|---|---|
| **Heavy** | none |
| **Medium** | T01, T02, T05, T06 |
| **Light** | T03, T04, T07 |

T05 may overrun where `coordinate.mjs` conflicts with `stopped-worker-asking` if that lands first.
T06 waits on the person and draws plan usage for one real worker.

## Decisions still open

- If T06 finds the Claude app still pushes with `CLAUDE_CLIENT_PRESENCE_FILE` set, the user decides:
  accept doubles, or turn off "Push when actions required" in Claude Code's `/config` by hand. Does not
  block T01–T05.
- What the QR does on iOS (T06) may change only T07's wording and T03's printed steps.
