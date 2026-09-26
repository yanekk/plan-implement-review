# T09 — live-nudge-drill

**Phase:** 3 · **Depends on:** T08 · **Weight:** medium

## Goal

See the whole feature work on real agents once: a real coordinator nudges a real worker out of a
needless wait-loop over its live line, the worker frees itself and finishes, and this task's worker
judges from the nudged worker's conversation that it reacted sensibly (user, plan review 2026-09-26). This is the only place the send, the
log-based activity signal and the skill's instructions are exercised together.

## Design sections this implements

DESIGN §5.1 row 1, §5.2, success criteria.

## Files

- `plans/nudge-quiet-worker/FINDINGS.md`: the dated result, machine and person halves separately.
- Nothing else. A defect found here is fixed in the task that owns the file, through the person.
  A wording change to the nudge text is the person's decision; propose it, do not make it.

## Environment (the worker owns this)

```
bring-up: the harness builds its scratch repo at the `--into` path, which must already be trusted by
          Claude Code (live-workers §5.2: `hasTrustDialogAccepted` in `~/.claude.json`).
          `/private/tmp/pir-quiet-worker` was not trusted on 2026-09-26 (FINDINGS). Confirm
          `claude --version` works and `npm ci` has run in this worktree.
teardown: the harness tears workers down on every exit and reaps from workers.json. Afterwards confirm
          no coordinator process is left (`pgrep -f coordinate.mjs`) and no pid in the scratch run's
          workers.json is still alive with its recorded start time.
```

## Outside actions

- live-nudge-drill — `worker` (moved down by the user at plan review 2026-09-26)

## Automated checks (the worker runs these)

```
node src/shell/harness/run.mjs quiet-worker --into /tmp/pir-quiet-worker
```

The scenario sets `PARALLEL_NUDGE_MS=120000` itself (T08). `--into` is required: run from this repo's
folder the harness refuses without it (`run.mjs` canonical-repo guard).

Record the fact report verbatim (pass/fail per fact) and the bundle path. If a fact fails, record which
and why from the bundle, and stop; do not re-run in a loop.

## Judged by the worker

Read the bundle's conversation log for the quiet-worker task from the first `[pir:nudge` message on.

Expect: the worker notices the nudge, stops or abandons the needless wait, does not reply to the
nudge, does not ask the person anything, and finishes the task.
Judge: did it stop the right thing for the right reason, rather than guessing or thrashing? Quote the
lines that show it. Note anything in how it read the message that the wording should fix, as a
proposal for the person.

## Needs a person

Only if the harness refuses the `--into` folder as untrusted: the person opens `claude` once in that
folder and accepts the trust prompt. Nothing else.

## Done when

- [ ] The fact report is recorded in FINDINGS with the date, every fact passing.
- [ ] The worker's judgement is recorded in FINDINGS as a separate 📌 row with the date, marked
      worker-judged (not ✅ verified by hand), with any wording proposal raised with the person.
- [ ] Teardown is confirmed: no leftover worker or coordinator process.
