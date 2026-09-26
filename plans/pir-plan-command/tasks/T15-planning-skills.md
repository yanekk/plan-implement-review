# T15 — planning-skills

**Phase:** 3 · **Depends on:** T01 · **Weight:** medium

## Goal

The planner and reviewer skills learn to run under `pir plan`: on a side branch in a worktree without
halting, checking a name is free before using it, saving the mock as a local file, committing
everything, and reporting back to `pir` instead of telling the person which session to open next. The
house rules gain the matching exception. Without this a real planner under `pir` stops on contact with
"work in the main checkout".

## Design sections this implements

DESIGN §2.3 (instructions), §2.4 (report format), §2.15.

## Files

- `skills/pir-plan/SKILL.md`: a "Run by pir plan" section
- `skills/pir-review-plan/SKILL.md`: a "Run by pir plan" section
- `CLAUDE.md`: § Where sessions run carve-out; the commands table gains `pir plan` and `pir start {slug}`
- `src/core/planner-templates.test.mjs` or a new `src/core/planning-skills.test.mjs`

## Interface

The report lines of DESIGN §2.4, exactly as `parsePlanReport` (T01) reads them, written by the skills
into the folder the opening instruction names. Each section starts with the trigger sentence the
opening instruction contains (`You are run by \`pir plan\``), so a hand-typed `/pir-plan` is
unaffected.

## Tests

- [ ] A test extracts every `[pir:v1 kind=… plan=…]` example from both skills and checks `parsePlanReport`
      accepts it, so the skills and the parser cannot drift.
- [ ] A test checks both skills name the carve-out and `CLAUDE.md § Where sessions run` names planning
      sessions run by `pir plan`.

## Done when

- [ ] Both sections cover every bullet of DESIGN §2.15; the classic path of each skill is unchanged
      (diff shows additions only, outside the new section and the one-line pointer to it).
- [ ] `npm test` green.
- [ ] Installed into a scratch HOME (`HOME=/tmp/pir-plan-command-home ./install.sh`) and the section
      grepped in the installed copy.

## Outside actions

- Scratch install — `worker`
