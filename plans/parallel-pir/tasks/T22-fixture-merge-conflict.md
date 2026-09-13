# T22 — Live fixture: merge-conflict

**Phase:** 6 · **Depends on:** T17 · **Weight:** medium · **Runs:** you

## Goal

Run the `merge-conflict` scenario for real and get an all-green fact report. Two tasks edit the same
line (both cut from base, ceiling 2), so the second merge conflicts; the coordinator must **surface and
park** it — no bad merge lands on the feature branch or `main`.

## Run

```
node src/shell/harness/run.mjs merge-conflict
```

Hands-off — no mid-run action. See `TEST-HARNESS.md`.

## Facts it must show (all green)

- `conflict-surfaced-and-parked` — a merge conflict was surfaced and parked; no bad merge landed.

## Reflection (after PASS, before ✅)

Run the reflection pass — `TEST-HARNESS.md § The reflection pass` (DESIGN §4.1): read the flow log,
git log, timeline, and this run's own transcripts (coordinator + workers, ignore `role:foreign`) for
how it flowed, where anyone got lost, and where time or tokens were wasted. **For this path,
scrutinise:** whether the coordinator detected the conflict and surfaced-and-parked it cleanly, or
retried/thrashed the failing merge; whether it left the task parked correctly rather than wrongly
closing it or spinning; and that no partial or bad state landed on the feature branch. Log the
findings; surface any hardening to the PM.

## Done when

The fact report is `PASS` **and** the reflection pass is logged. Record the verdict, bundle path, and
the reflection's findings in `FINDINGS.md` with the date. A failed fact is a finding — either a
framework bug or a fixture that did not force the conflict — diagnose from the bundle, fix, re-run
(`TEST-HARNESS.md § When it fails`).
