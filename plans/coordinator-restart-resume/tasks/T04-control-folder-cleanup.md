# T04 — Clear transient control feeds; HALT and log policy

**Phase:** 1 · **Runs:** auto · **Depends on:** — · **Weight:** medium

## Goal

Stop a dead run's leftovers from contaminating a fresh one. On startup the coordinator clears the
transient control-folder feeds (`reports/`, `answers`, `outbox`, `surfaced`) so a stale answer,
down-message or surface from the crashed run does not route to a fresh worker, while preserving the
two durable records — the append-only `log` (the audit trail and the harness signal) and the `HALT`
flag (a deliberate user stop). A `HALT` still present at startup refuses the run with a clear
instruction rather than the current silent immediate self-halt.

## Design sections this implements

DESIGN §2.7 (control-folder cleanup on restart), §7 (the HALT decision).

## Files

- `src/shell/coordinate.mjs` — a `clearTransientFeeds` function (exported, testable), the HALT
  refusal at bin startup, and the `restart` log marker.
- `src/shell/coordinate.test.mjs` — its tests.

Do not touch `loop.mjs` (T03 owns the reconciliation) or the docs (T05).

## Interface

```
clearTransientFeeds(controlDir) → { cleared: string[] }
  Empties the transient feeds under controlDir and returns which it touched:
    reports/   — unlink every *.json (or remove and recreate the dir)
    answers    — truncate to ''
    outbox     — truncate to ''
    surfaced   — truncate to ''
  Never touches `log` or `HALT`. Best-effort per feed: a missing feed is fine (nothing to clear),
  and a clear must never throw the run down.

// at bin startup (main), after fileControl(root, slug), before the loop:
  if control.isHalted():
      print "HALT flag present at {control.flag} — remove it to restart." and exit non-zero.
      // never clear HALT here (DESIGN §2.7): auto-clearing defeats the kill switch.
  clearTransientFeeds(control.dir)
  control.log('restart')        // the audit-trail boundary marker; log is preserved, not cleared
```

Non-obvious points, each with its reason:

- **Clear on every startup, not only on a detected restart.** A genuine first start has these feeds
  empty, so an unconditional clear is safe and needs no restart detection (matches the reconciliation
  approach in DESIGN §2.1).
- **Truncate the append-only feeds rather than delete them**, so their paths still exist for the
  bridge to append to this run; `reports/` is a directory of one-file-per-report, so emptying its
  contents is the clear.
- **Never clear `HALT`.** It is the one flag whose whole value is surviving a restart until the person
  removes it; clearing it would let a HALTed run be restarted straight past the stop (DESIGN §2.7).
- **Refuse, do not silently self-halt.** Today a forgotten `HALT` makes the coordinator start, read
  the flag, and quietly do nothing; refusing at startup with the flag's path is the same safety with a
  clear next step for the person.
- **The clear runs in the bin (`main`), once, before `startCoordinator`/the loop.** The skill reads
  `surfaced` and writes `answers` during the run, so the clear must happen before either side writes
  anything this run.

## Tests

- [ ] `clearTransientFeeds` empties `reports/` (removes leftover `*.json`), and truncates `answers`,
      `outbox`, `surfaced`, returning which it cleared.
- [ ] it does not touch `log` (an existing log's contents survive) and does not touch `HALT`.
- [ ] it is a no-op that does not throw when a feed is missing (fresh control dir).
- [ ] a stale `answers` line present before the clear is gone after it (so it cannot route to a fresh
      worker).
- [ ] the HALT check: with `HALT` present, startup refuses (non-zero, message names the flag path) and
      `HALT` is left in place; with `HALT` absent, startup proceeds and `clearTransientFeeds` runs.
- [ ] the `restart` marker is appended to `log` on startup and prior log lines are preserved.

## Done when

- [ ] `clearTransientFeeds` clears the four transient feeds, preserves `log` and `HALT`, and never
      throws; it is exported and unit-tested.
- [ ] bin startup refuses a run whose `HALT` is present (naming the flag path) without clearing it, and
      otherwise clears the feeds and appends a `restart` log marker.
- [ ] `npm test` is green.
</content>
