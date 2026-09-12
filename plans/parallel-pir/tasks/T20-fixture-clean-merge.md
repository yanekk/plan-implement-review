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

## Done when

The fact report is `PASS`. Record the verdict and bundle path in `FINDINGS.md` with the date. A failed
fact is a finding — diagnose from the bundle, fix, re-run (`TEST-HARNESS.md § When it fails`).
