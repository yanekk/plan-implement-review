# T40 — The worker runs the automated checks; the person only judges

**Phase:** 11 · **Depends on:** T39 · **Weight:** medium · **Runs:** auto

## Goal

Stop asking the person to run an automated test. In the T37 capstone the second check-in had the person
install the browser driver and run the end-to-end test by hand (`npx playwright install` / `npm run e2e`).
That is a mechanical, repeatable check — exactly what a worker should run — and pushing it onto the person
is what produced the run's one integrity blemish (RETRO Q6/Q8): asked an ambiguous either/or, the person
answered "full pass", and the scribe recorded a specific manual click-through the person never reported.

The design already draws the right line — a `you` task is one whose "result is something only a person
can observe" (§2.6) — and an automated test is not that. This task makes the hands-on check run the
automated part *in the worker* and reserve the person for the judgement only, then records the two as
separate, literal confirmations.

## The change

Two rules, both in the hands-on worker contract and reflected in §2.6:

1. **The worker runs everything a machine can decide.** Building on T39 (the worker already has the stack
   up), the worker installs whatever the automated check needs and runs it itself — for the blog fixture,
   the browser driver and `npm run e2e` against the stack it brought up — and records the machine result
   it actually observed (pass/fail, the output). The person is not asked to run it.
2. **The person is asked only for judgement, and the scribe records exactly what they said.** The
   person-facing block asks the human-only question — "click through it: does it work and look right?
   yes/no" — and nothing a test already answered. The scribe writes **two separate confirmations** in the
   `✅` FINDINGS row: the automated result the worker observed, and the person's judgement in the person's
   own terms. It never merges them, and — the core fix — **it never resolves an ambiguous reply toward the
   bigger claim.** If the person's answer does not clearly cover the judgement asked, the worker re-asks
   and records only what is explicitly confirmed. A terse "full pass" to a two-option question is an
   ambiguity to resolve by asking, not by choosing the larger reading (CLAUDE.md: a genuine ambiguity is
   asked about, never silently resolved).

This narrows what the person does at a hands-on check to the irreducible core — the subjective look — and
makes the record say who established what: the machine, or the person.

## Files

- `plans/parallel-pir/DESIGN.md` — §2.6: the hands-on worker runs the automatable checks and records the
  machine result; the person supplies judgement only; the scribe records machine-result and person-
  judgement as separate confirmations and never inflates an ambiguous reply.
- `skills/pir-verify/SKILL.md` — the worker runs the automated check itself and records what it observed;
  the person-facing block is the judgement question only; the two-separate-confirmations rule and the
  never-resolve-ambiguity-upward rule, with the re-ask behaviour.
- The **blog-app fixture** T06/T07 task docs (harness fixtures; T16/T36) — T07's person no longer runs
  `playwright install` / `npm run e2e`; the worker does. The person's step is the click-through judgement.
  Keep T06 (the worker writes the e2e test) as is; it is T07's *running* of it that moves.
- Planner templates / goldens that encode the hands-on person-facing block and the scribe's recording,
  so a generated hands-on task carries the split-confirmation, no-inflation rule.

## Tests

Golden/template tests: a generated or fixture hands-on task's person-facing block asks only the judgement
question and contains no automated-test invocation; the worker contract requires recording the machine
result separately from the person's judgement. Where the recording logic is exercised by a golden, a
mutation that merges the two confirmations, or that upgrades an ambiguous reply, reddens it. `npm test`
stays install-free and green.

## Done when

- [ ] DESIGN §2.6 says the hands-on worker runs the automatable checks and the person judges only, and
      that the scribe records the two separately and never inflates an ambiguous reply.
- [ ] `pir-verify` makes the worker run the automated check itself, ask the person only the judgement
      question, record two separate confirmations, and re-ask rather than round an ambiguous reply up.
- [ ] The blog-app fixture's second check-in has the worker run the e2e and the person do only the
      click-through judgement; goldens/templates updated; `npm test` green.

## Live proof (a separate `you` follow-up, not this task)

That a real worker can install the browser driver and run the e2e against its own stack is a live-only
fact (same attended blog-app re-run as T39's live proof — one `you` task can prove both). This task builds
and golden-tests the contract; it does not assert the live behaviour. Flag it for the PM.

## Scope

Prose, fixture task docs, templates/goldens. No blog product code. Everything else goes in FINDINGS.md.
