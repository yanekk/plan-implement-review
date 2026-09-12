# T19 — Live fixture: review-queue

**Phase:** 6 · **Depends on:** T17 · **Weight:** light · **Runs:** you

## Goal

Run the `review-queue` scenario for real and get an all-green fact report. A task reaches `🔍` and a
**fresh session** takes over the review while the rest of the work proceeds — the implement→review
handoff on real sessions.

## Run

```
node src/shell/harness/run.mjs review-queue
```

Hands-off — no mid-run action. See `TEST-HARNESS.md`.

## Facts it must show (all green)

- `hello-per-spawn` — one hello per spawned session, addressed by name.
- `no-close-before-idle` — no finished worker closed before an idle observation of it.
- `one-merge-to-main` — `main` gains exactly one commit, the promotion.

## Done when

The fact report is `PASS`. Record the verdict and bundle path in `FINDINGS.md` with the date. A failed
fact is a finding — diagnose from the bundle, fix, re-run (`TEST-HARNESS.md § When it fails`).
