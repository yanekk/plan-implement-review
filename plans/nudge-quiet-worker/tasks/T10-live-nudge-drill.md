# T10 — live-nudge-drill

**Phase:** 3 · **Depends on:** T09 · **Weight:** medium

## Goal

See the whole feature work on real agents once: a real coordinator nudges a real worker out of a
needless wait-loop through its real inbox, the worker frees itself and finishes, and the person
judges from the worker's transcript that it reacted sensibly. This is the only place the socket round
trip, the transcript-based activity signal and the skill's instructions are exercised together.

## Design sections this implements

DESIGN §5.1 rows 1–2, §5.2, success criteria.

## Files

- `plans/nudge-quiet-worker/FINDINGS.md`: the dated result, machine and person halves separately.
- Nothing else. A defect found here is fixed in the task that owns the file, through the person.

## Environment (the worker owns this)

```
bring-up: the harness creates its own scratch repo; confirm `claude agents --json` works and no
          pir-*quiet-worker* session is already listed.
teardown: the harness tears workers down on every exit. Afterwards confirm no session whose name
          contains the scratch slug is listed and no coordinator process is left (`pgrep -f coordinate.mjs`).
```

## Outside actions

- live-nudge-drill — `ask`

## Automated checks (the worker runs these)

```
PARALLEL_NUDGE_MS=120000 node src/shell/harness/run.mjs quiet-worker
```

Record the fact report verbatim (pass/fail per fact) and the bundle path. If a fact fails, record which
and why from the bundle, and stop; do not re-run in a loop.

## Needs a person

```
The bundle's worker transcript for the quiet-worker task, from the first [pir:nudge line onward.
```

Expect: the worker notices the nudge, stops or abandons the needless wait, does not reply to the
nudge, does not ask the person anything, and finishes the task.
Tell me: did its reaction look sensible, meaning it stopped the right thing for the right reason
rather than guessing or thrashing? Anything in how it read the message that the wording should fix?

## Done when

- [ ] The fact report is recorded in FINDINGS with the date, every fact passing.
- [ ] The person's judgement is recorded in FINDINGS as a separate ✅ row with the date.
- [ ] Teardown is confirmed: no leftover session or coordinator process.
