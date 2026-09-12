# T18 — Live fixture: single (the happy path)

**Phase:** 6 · **Depends on:** T17 · **Weight:** light · **Runs:** you

## Goal

Run the `single` scenario for real and get an all-green fact report. The full happy path on one real
worker: spawn → hello → implement → fresh review → merge → promote → idle-gated close. This retires
**T13's live half** (by-name addressing and the idle-gated close, proven here on captured data
instead of by eye).

## Run

```
node src/shell/harness/run.mjs single
```

Hands-off — no mid-run action. See `TEST-HARNESS.md` for what you'll see, where the logs are, and how
to read the report.

## Facts it must show (all green)

- `hello-per-spawn` — exactly one hello per spawned session, addressed by the worker name.
- `by-name-addressing` — the worker addresses the coordinator by its convention name.
- `no-close-before-idle` — no finished worker is closed before an idle observation of it.
- `one-merge-to-main` — `main` gains exactly one commit, the promotion; no task branch merges direct.

## Done when

The fact report is `PASS` (all four ✓). Record the verdict and bundle path in `FINDINGS.md` with the
date; that is where T13's live half is retired. A failed fact is a finding — diagnose from the bundle,
fix, re-run (`TEST-HARNESS.md § When it fails`).
