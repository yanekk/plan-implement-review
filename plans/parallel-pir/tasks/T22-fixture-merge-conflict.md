# T22 — Live fixture: merge-conflict

**Phase:** 6 · **Depends on:** T17 · **Weight:** medium · **Runs:** you

## Goal

Run the `merge-conflict` scenario for real and get an all-green fact report. Two tasks edit the same
line (both cut from base, ceiling 2), so the second merge conflicts at the coordinator's merge step.
Under Option 2 (DESIGN §2.5, T28) the coordinator must **keep that worker alive and parked**, surface
the conflict, deliver the decision, and let the worker **resolve on its own branch** — then the decided
side merges and reaches `main`. This is the re-run gated behind T28; it exposed the original conflict-path
bug (the worker was closed and its task respawned, shipping the wrong side; see FINDINGS 2026-09-13).

## Run

```
node src/shell/harness/run.mjs merge-conflict
```

**Interactive, not hands-off.** The runner feeds the fixture's scripted decision to the control
`answers` file automatically when the conflict surfaces (for whichever task lost the merge race), so the
run reaches a verdict without you typing; if attended, you may also answer through the coordinator. See
`TEST-HARNESS.md`.

## Facts it must show (all green)

- `merge-conflict-resolved` — the conflict was surfaced with no earlier merge of that task, the decision
  was delivered to the live worker (`answer`), the same worker resumed to a merge, exactly one implementer
  ran the task (no respawn), exactly one promotion reached `main`, and `main`'s final `greeting.txt` is
  the decided `hello there`, not the losing `hi world`.

## Reflection (after PASS, before ✅)

Run the reflection pass — `TEST-HARNESS.md § The reflection pass` (DESIGN §4.1): read the flow log,
git log, timeline, and this run's own transcripts (coordinator + workers, ignore `role:foreign`) for
how it flowed, where anyone got lost, and where time or tokens were wasted. **For this path,
scrutinise:** whether the coordinator kept the conflicting worker alive and parked (not closed or
respawned), delivered the decision to it, and let it resolve on its own branch; whether the worker's
resolution took the decided side; whether the coordinator claimed the outcome only from evidence (not
narrated intent); and that `main` ended with the decided content. Log the findings; surface any
hardening to the PM.

## Done when

The fact report is `PASS` **and** the reflection pass is logged. Record the verdict, bundle path, and
the reflection's findings in `FINDINGS.md` with the date. A failed fact is a finding — either a
framework bug or a fixture that did not force the conflict — diagnose from the bundle, fix, re-run
(`TEST-HARNESS.md § When it fails`).
