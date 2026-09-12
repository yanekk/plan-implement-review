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

## Done when

The fact report is `PASS`. Record the verdict and bundle path in `FINDINGS.md` with the date. A failed
fact is a finding — either a framework bug or a fixture that did not force the conflict — diagnose from
the bundle, fix, re-run (`TEST-HARNESS.md § When it fails`).
