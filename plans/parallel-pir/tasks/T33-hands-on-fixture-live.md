# T33 — Live: drive the hands-on fixture and find its bottlenecks

**Phase:** 8 (coverage: hands-on verification) · **Depends on:** T31, T32 · **Weight:** light · **Runs:** you

## Why this exists

Prove the `you` / hands-on path end-to-end with the PM in the loop, and gather the feedback and
bottlenecks the fact harness cannot — the payoff the PM asked for. This is itself a `you` task, which
is fitting: the drill *is* a hand-verification the PM drives, so it also validates the build→verify
split (T31) on a real run using the fixture T32 builds.

## Needs a person

```
Needs you — I cannot see this from here:

  node src/shell/harness/run.mjs hands-on --into <scratch dir>
  (real paid agents, launched attended; low ceiling; wall-clock backstop ~20–30 min)

  When the run prints "go drive worker <name> for T02", open that worker session
  (second terminal: `claude agents --json` inside the scratch repo lists it), run
  the program it built as its "Needs a person" block instructs, and tell the worker
  what you saw (e.g. "prints `hello from the agent` — correct").

Expect: the fact report is green — verifyWorkerSpawned, youNeverReviewed, and
  oneMergeToMain — and the run promotes once after you drive the scribe worker to
  done; T02 is never sent for an agent review.
Tell me: did it pass, the bundle path, and — the real payoff — every place the
  hands-on flow was clunky: finding the worker, knowing what to run, the scribe's
  prompt, the wait, the coordinator's narration. Each bottleneck, so we can harden it.
```

## What "done" must behave like

- The attended `hands-on` run **PASSes**: `verifyWorkerSpawned`, `youNeverReviewed`, and
  `oneMergeToMain` green, one promotion, and T02 never reviewed by an agent (skipped straight to merge).
- A **reflection pass** captures the hands-on UX bottlenecks — where the PM had to hunt for the worker,
  any ambiguity in what to run, the scribe's prompt quality, the coordinator's narration, the timing —
  recorded in `FINDINGS.md` with the date, newest first. Each bottleneck worth fixing is surfaced to the
  PM as its own candidate hardening task, **not implemented here** (scope), the way each earlier live
  reflection produced its own follow-up task.
- The `you` task **skips review and folds back** like any `you` task (DESIGN §2.6): the scribe worker
  records the observation, marks `✅`, reports `done`; the coordinator merges and reconciles.

## Files

None in `src/` — a `you` task has no code deliverable. The scribe worker writes `FINDINGS.md` on its
task branch during the drill; the reflection adds the bottleneck findings.

## Tests

None automated — a `you` task's evidence is the recorded observation (DESIGN §2.6). The three declared
facts are checked by the live run's captured bundle; the bottlenecks are the person's report.

## Done when

- [ ] The attended `hands-on` run PASSes (three facts green, one promote) with the PM driving the scribe
      worker to done.
- [ ] The hands-on bottlenecks are recorded in `FINDINGS.md` with the date; any worth fixing are surfaced
      to the PM as candidate follow-up tasks.
- [ ] The `you` task folds back to `✅` (no review).

## Note on structure

A `you` task — the PM runs the live steps, the scribe records. Mirrors the Phase 6 live fixtures
(T18–T23) but for the hands-on path itself. Depends on T31 (the taught pattern) and T32 (the fixture),
so the drill validates both.
