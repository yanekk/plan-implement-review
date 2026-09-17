# T08 — Coordinator delivery heartbeat

**Phase:** 2 · **Runs:** auto · **Depends on:** T02, T05, T06, T09 · **Weight:** medium

## Goal

Guarantee that a decision queued for a parked worker is delivered even if the coordinator's
event-driven flow-log watch has gone deaf or the coordinator had gone idle between turns. Today
delivery depends on the coordinator noticing the bin's `answer Txx` line with a watch it keeps
alive itself, and that watch fails silently (a buffering pipe, an expired watch, an idle session) —
the freeze that stranded the `my-ender/print-vision` run a second time. This task adds the floor
under §2.5's receipt loop: a harness-driven heartbeat that re-reads the outbox on a fixed cadence
and delivers whatever is still outstanding, plus the small state that keeps that delivery idempotent
and makes a stuck delivery a visible flow-log event. This is DESIGN §2.8 and §3.6.

## Design sections this implements

DESIGN §2.8 (delivery does not depend on the coordinator staying awake) and §3.6 (the delivery
cursor and the overdue signal).

## Files

- `src/shell/coordinate.mjs` — read the coordinator's delivery acknowledgements, compute which
  queued answers are overdue, and emit the `deliver-overdue Txx` flow-log line (once per line). The
  overdue computation is a small pure predicate and may sit in `src/core/` if that reads cleaner;
  the flow-log emission and file I/O are shell.
- `skills/pir-coordinate/SKILL.md` — arm the heartbeat wake alongside the event watch, using the
  self-wake mechanism T09 proved (a harness scheduled wake, NOT a poll that needs the session to
  keep taking turns — that is the approach that failed). On every wake, deliver every outbox line
  not yet acknowledged, recording each, and re-read the flow log too so a woken coordinator resumes
  its full read cycle, not delivery alone. Replaces the current manual "≈60s fallback re-read".
- `docs/control-folder.md`, `docs/human-flow.md` — the `delivered` feed as a transient control file,
  the `deliver-overdue` flow-log tag, and one line that the down-channel delivery is guaranteed by
  the heartbeat, not the coordinator's own watch. Deps on T06 so these land after its doc pass and
  do not conflict on the same files.

## Interface

```
// pure, testable — no clock read inside; `now` is a parameter (CLAUDE.md core rule)
overdueDeliveries({ outbox, delivered, now, graceMs }) -> [{ task, key }]
  // outbox:    [{ key, to, task, queuedAt }]  — the queued down-messages the bin wrote
  // delivered: Set<key>                        — keys the coordinator has acknowledged sending
  // returns each outbox line whose key is NOT in delivered and whose (now - queuedAt) >= graceMs.
  // returns [] when every queued line is acknowledged (a heartbeat with nothing to do sends nothing).

// the delivered feed — control folder, append-only, coordinator-owned, one key per line:
//   plans/{slug}/.parallel/control/delivered
// the flow-log tag, written by the bin once per overdue line:
//   deliver-overdue {task}
```

The coordinator's per-wake delivery is: read `outbox` and `delivered`; SendMessage every line whose
key is not in `delivered`; append each sent key to `delivered`. The key is stable per outbox line
(its index is enough within a run); the exact key format, the `delivered` filename and the grace
window are the implementing session's to finalise against the existing control-folder conventions.

Reconciliation with §2.5 (do not reopen the freeze). A key counts as delivered only when the send
is confirmed landed under §2.5's receipt loop, not merely when `SendMessage` returned — otherwise a
send that queued but never reached the worker before the coordinator idled would sit in `delivered`
and the heartbeat would never retry it, reopening the very freeze this task closes. Where T00 finds
no observable receipt, the heartbeat still re-sends any past-grace outbox line and a duplicate
decision is accepted as harmless (a parked worker acts on it once); a possible duplicate is the safe
side, a stranded worker is not. This is the one interface where T08 and T05 meet: build T08 against
T05's receipt loop, not beside it.

## Cross-plan note

The `delivered` feed is transient control state that a restart must reset with the outbox. The
`coordinator-restart-resume` plan clears the outbox on startup (its DESIGN §2.7, its T04); this new
feed must be added to that clearing list, or a fresh outbox read against a stale cursor would skip
the new run's first answers (DESIGN §3.6). Record this in `FINDINGS.md` when built and flag it to
whoever is running `coordinator-restart-resume`.

## Tests

Automated, over the pure predicate:

- [ ] `overdueDeliveries` returns `[]` when every outbox key is in `delivered`.
- [ ] A queued line not yet delivered is returned once `now - queuedAt >= graceMs`, and NOT before.
- [ ] Several undelivered lines are all returned; a delivered one is excluded.
- [ ] An empty `delivered` set returns every past-grace queued line.

Shell/observability:

- [ ] The bin emits `deliver-overdue {task}` once per overdue line, and does not re-emit the same
      line every pass.

Prose (read-through, proven live in T07):

- [ ] The skill arms a heartbeat wake — a fixed-cadence tick the harness drives, re-armed on expiry —
      in addition to the milestone event watch, and NOT as a `tail -f | filter` pipe.
- [ ] On each wake the coordinator delivers only outbox lines absent from `delivered` and records
      each, so a heartbeat with nothing new sends nothing and no decision is delivered twice.
- [ ] The wording states the heartbeat is the guaranteed floor and the event watch the fast path,
      and does not loosen the §2.5 receipt loop (confirm / retry / surface still applies per send).

## Done when

- `overdueDeliveries` is implemented and unit-tested; the bin writes `deliver-overdue` once per
  overdue line; both are green under `npm test`.
- The coordinator skill arms a heartbeat and delivers idempotently from the `delivered` feed on
  every wake, with the event watch kept as the fast path and the receipt loop intact.
- The `delivered` feed and `deliver-overdue` tag are documented, and the cross-plan clearing note is
  recorded for `coordinator-restart-resume`.
- Every changed rule cites its DESIGN section. The live proof that the heartbeat actually wakes an
  idle coordinator and delivers is T07, not this task.
