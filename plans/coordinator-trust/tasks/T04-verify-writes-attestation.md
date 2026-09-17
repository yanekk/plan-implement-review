# T04 — pir-verify writes the attestation

**Phase:** 2 · **Runs:** auto · **Depends on:** T02 · **Weight:** light

## Goal

Have the hands-on worker put the human-verification attestation into its `done` report, so the
completion signal T02 emits carries real evidence. `pir-verify` already gathers two separate
confirmations — the machine result it observed and the person's judgement — and writes them into
`FINDINGS.md` on the task branch; this task adds those same two confirmations to the `done`
report the worker drops for the engine, in the shape T02 parses (DESIGN §3.3). This is the worker
half of DESIGN §2.1/§2.2.

## Design sections this implements

DESIGN §2.1, §2.2, §3.3.

## Files

- `skills/pir-verify/SKILL.md` — the step where the worker composes and drops its `done` report.

## Interface

The `done` report stays a `[pir:v1 …]` message; the attestation rides in its text as two named
lines the engine parses (DESIGN §3.3):

```
machine: <what the automated check the worker ran decided, or "none" if the task has no machine half>
person:  <what the person judged, in the person's terms, never rounded up from an ambiguous reply>
```

The two lines mirror the two confirmations already written to `FINDINGS.md`, and stay separate for
the same reason they are separate there: a machine result is not a person's judgement. `machine:
none` is written explicitly for a pure look-at-it check, so an absent machine half is visible, not
forgotten. The exact delimiter/field names are finalised jointly with T02's parser — this doc
fixes that there are two named confirmations and that they are never merged.

## Tests

`pir-verify` is prose, not code, so it has no unit test. Its acceptance is that a worker following
it produces a `done` report T02's parser reads into the two confirmations. That is exercised live
in T07; here, the check is a read-through:

- [ ] The skill instructs the worker to include both `machine:` and `person:` lines in the `done`
      report, matching T02's parser.
- [ ] The skill says to write `machine: none` for a task with no machine half, not to omit it.
- [ ] The skill keeps the existing rule that an ambiguous reply is never rounded up to the bigger
      claim, and that the two confirmations stay separate.

## Done when

- `pir-verify`'s `done`-report step names the two confirmations in the shape T02 parses.
- Nothing else in `pir-verify` changed (scope is the report step only).
- The wording matches T02's parser — check the two against each other before marking done.
