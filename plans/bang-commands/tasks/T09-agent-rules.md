# T09 — agent-rules

**Phase:** 3 · **Depends on:** T05 · **Weight:** light

## Goal

Tell the agents that they can hand the person a command and when they may: only for a command only the
person can run here (a login, their account, their device), never for what their own permission rules
or a `worker` row let them run, never in place of the permission prompt of an `ask` row, and with a
reason the person can judge. Without this the tool exists and nobody uses it, or is used to push work
onto the person.

## Design sections this implements

DESIGN §2.6; requirement 12.

## Files

- `skills/pir-worker/SKILL.md` — in "The bar for handing something to the person", the `hand_command`
  tool as the way to hand the person a command in a run, replacing "give the exact command in the
  question" for that case; no report is dropped for it (the pending request already reads `asking you`,
  as for an `ask` permission).
- `skills/pir-implement/SKILL.md`, `skills/pir-review/SKILL.md` — one line each where they hand the
  person a command, pointing at `pir-worker`.
- `skills/pir-plan/SKILL.md` and `skills/pir-review-plan/SKILL.md` — in "Run by pir plan", **Asking.**:
  the planner may hand a command (for example a login check of Stage 3) with the tool.
- `skills/pir-single/SKILL.md` — the same in **Asking.**
- The skill-text tests that pin these files (`planning-skills.test.mjs`, `single-skill.test.mjs` and any
  other that fails) updated, not loosened.

## Tests

- [ ] each edited skill names `hand_command` and the three limits (only the person can, never round a
      permission or an `ask` row, with a reason); a test asserts it for `pir-worker` and `pir-single`.
- [ ] `pir-coordinator` and `pir-finisher` are unchanged.

## Done when

- [ ] The five skills say when and how to hand a command, and the coordinator's and finisher's do not.
- [ ] `npm test` passes the skill tests.
