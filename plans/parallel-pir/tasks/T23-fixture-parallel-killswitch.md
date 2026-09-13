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

## Reflection (after PASS, before ✅)

Run the reflection pass — `TEST-HARNESS.md § The reflection pass` (DESIGN §4.1): read the flow log,
git log, timeline, and this run's own transcripts (coordinator + workers, ignore `role:foreign`) for
how it flowed, where anyone got lost, and where time or tokens were wasted. **For this path,
scrutinise:** how the relay and coordinator scaled with several concurrent workers — this is the worst
case for the relay overhead T25 targets, so measure it here; the ceiling behaviour under load; and the
kill-switch — how fast every worker was SIGTERMed after `HALT`, and whether any worker lingered, ran
away, or was miscounted (the runaway-breaker history). Confirm the shutdown was orderly, not just that
nothing promoted. Log the findings; surface any hardening to the PM.

## Done when

The fact report is `PASS` **and** the reflection pass is logged. **This is where T10 closes ✅.** Record
the verdict, bundle path, and the reflection's findings in `FINDINGS.md` with the date. A failed fact
is a finding — diagnose from the bundle, fix, re-run (`TEST-HARNESS.md § When it fails`).
