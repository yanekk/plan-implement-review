# T23 — Live fixture: parallel + kill-switch drill (absorbs T10)

**Phase:** 6 · **Depends on:** T17 · **Weight:** heavy · **Runs:** you

## Goal

Run the `parallel` scenario for real and get an all-green fact report. Multiple real workers run at once
within the ceiling; mid-run the kill switch is drilled — `HALT` stops every worker, nothing is promoted,
`main` is untouched. This is the **full multi-worker + kill-switch drill that was T10** (absorbed here,
2026-09-12); it is the largest scenario, run last.

## Run

Launch with an explicit scratch dir so you know the path for the HALT drill:

```
node src/shell/harness/run.mjs parallel --into <dir>
```

**Needs you mid-run.** Once a couple of workers are going, drill the kill switch:

```
touch <dir>/plans/parallel/.parallel/control/HALT
```

See `TEST-HARNESS.md § parallel`.

## Facts it must show (all green)

- `hello-per-spawn` — one hello per spawned session, addressed by name.
- `ceiling-held:2` — at most two workers live at once (the scenario's ceiling).
- `kill-switch-stopped-all` — after `HALT`, every worker was stopped, nothing was promoted, `main` is
  untouched.

## Done when

The fact report is `PASS`. **This is where T10 closes ✅.** Record the verdict and bundle path in
`FINDINGS.md` with the date. A failed fact is a finding — diagnose from the bundle, fix, re-run
(`TEST-HARNESS.md § When it fails`).
