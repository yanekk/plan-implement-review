# T02 — Hands-on completion signal

**Phase:** 1 · **Runs:** auto · **Depends on:** — · **Weight:** medium

## Goal

Give a finished hand-driven task a positive completion signal the coordinator reads, so a
`you`/verify task's merge is no longer an unexplained silence the coordinator can misread as
fraud. When a verify worker's `done` report carries the human-verification attestation (DESIGN
§2.2, §3.3), the engine parses the two confirmations, and on the you-task's merge emits a
`verified Txx` flow-log line and writes the attestation text to the surfaced feed the coordinator
already reads. This is the engine half of DESIGN §2.1; the worker writes the attestation in T04
and the coordinator reads the signal in T05.

## Design sections this implements

DESIGN §2.1 (the signal), §2.2 (two separate confirmations, never merged), §3.3 (the attestation
shape), §3.4 (the data flow).

## Files

- `src/shell/loop.mjs` — where drained reports are folded into task phase (`m.kind === 'done'`);
  parse the verify report's attestation here.
- `src/shell/coordinate.mjs` — where flow-log lines and the surfaced feed are written; emit
  `verified Txx` and the feed entry on a you-task merge.
- Their `*.test.mjs` siblings.
- Optionally a small pure predicate in `src/core/` if "is this a valid attestation" reads cleaner
  there; the emission itself stays in shell (DESIGN §3.1).

## Interface

```
// A verify worker's done report text carries two named confirmations (DESIGN §3.3):
//   machine: <what an automated check decided, or "none">
//   person:  <what the person judged>
// parseAttestation(reportText) → { machine: string|null, person: string|null }
//   - both present  → the two strings, never concatenated
//   - absent/unparseable → { machine: null, person: null }, and the signal marks it absent

// On a you-task (role 'verify') reaching merge, in addition to the existing `merge Txx`:
//   flow log:      verified Txx
//   surfaced feed: { "task":"Txx", "kind":"verified",
//                    "text":"machine: …\nperson: …",   // or "attestation not recorded"
//                    "message":"<plain-English completion the coordinator reports>" }
```

The `verified Txx` line is a new flow-log tag, parallel to `merge Txx`; keep `merge Txx` too, so
existing watchers and the merge accounting are unchanged. The `kind:"verified"` feed entry is
informational — it is not a decision and must not park the run or wait on an `answer` (contrast a
`surface`, which does). A verify report with a `done` but no parseable attestation still completes
the task; the feed entry then says the attestation was absent (DESIGN §3.3), so a blank is visible,
never treated as present.

## Tests

- [ ] A verify `done` report with both `machine:` and `person:` lines parses to the two strings,
      kept separate.
- [ ] The two confirmations are never concatenated or rounded into one.
- [ ] `machine: none` parses as an explicit no-machine-check, distinct from an absent line.
- [ ] A verify `done` report with no attestation still marks the task done, and the feed entry
      reports the attestation as absent.
- [ ] On a you-task merge the flow log gains `verified Txx` in addition to `merge Txx`.
- [ ] The `verified` feed entry is informational: it does not park the task, does not create an
      outbox message, and does not wait on an `answer`.
- [ ] An `auto` task's merge does NOT emit `verified` (the signal is for `you`/verify tasks only).
- [ ] A malformed/half-written report is dropped, not guessed, exactly as a malformed report is
      today (no regression to the drain).

## Done when

- A verify task's completion emits `verified Txx` and a `verified`-kind feed entry carrying the
  two confirmations, or an explicit "absent" when none was recorded.
- The two confirmations are never merged, and an `auto` merge never emits the signal.
- `npm test` is green, including the new cases.
