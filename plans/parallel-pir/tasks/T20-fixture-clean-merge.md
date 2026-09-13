# T20 — Live fixture: clean-merge

**Phase:** 6 · **Depends on:** T17 · **Weight:** light · **Runs:** you

## Goal

Run the `clean-merge` scenario for real and get an all-green fact report. Two tasks on different files
build in parallel and their branches serialize cleanly into the feature branch — the no-conflict merge
path, at the ceiling.

## Run

```
node src/shell/harness/run.mjs clean-merge
```

Hands-off — no mid-run action. See `TEST-HARNESS.md`.

## Facts it must show (all green)

- `one-merge-to-main` — `main` gains exactly one commit, the promotion; no task branch merges direct.
- `ceiling-held:2` — at most two workers live at once.
- `no-close-before-idle` — no finished worker closed before an idle observation of it.

## Reflection (after PASS, before ✅)

Run the reflection pass — `TEST-HARNESS.md § The reflection pass` (DESIGN §4.1): read the flow log,
git log, timeline, and this run's own transcripts (coordinator + workers, ignore `role:foreign`) for
how it flowed, where anyone got lost, and where time or tokens were wasted. **For this path, scrutinise:**
how the coordinator serialized the two task branches into the feature branch — clean ordering, or
hesitation about feature-branch state between the two merges; and the relay overhead with two workers
reporting close together (the cost T25 targets). Log the findings; surface any hardening to the PM.

## Done when

The fact report is `PASS` **and** the reflection pass is logged. Record the verdict, bundle path, and
the reflection's findings in `FINDINGS.md` with the date. A failed fact is a finding — diagnose from
the bundle, fix, re-run (`TEST-HARNESS.md § When it fails`).
