# T04 — single-helpers-skill

**Phase:** 1 · **Depends on:** — · **Weight:** light

## Goal

The two helper sessions a single run now holds at its end (resolve a clash, fix red tests) follow the
`pir-single` skill, as the builder and reviewer do. Add their section, so a helper knows its one job,
what it may touch, and how it reports (DESIGN §2.3).

## Design sections this implements

DESIGN §2.3.

## Files

- `skills/pir-single/SKILL.md`, `src/core/single-skill.test.mjs`

## Interface

A new section `## The helpers (resolve and fix)` in the skill, engaged when the opening instruction says
"as the resolve helper of pir/{name}" or "as the fix helper of pir/{name}" (T03's `helperInstruction`):

- Work only in the run's worktree on `pir/{name}`. Never merge into, rebase onto, push or switch to the
  base; never start or abort a merge yourself beyond finishing the one in progress (resolve).
- **resolve**: a merge of `{base}` into `pir/{name}` is in progress with the listed files conflicted.
  Resolve each keeping both the change's intent and the base's, `git add` them, `git commit --no-edit`,
  then report `[pir:v1 kind=resolved single={name}]`. If a conflict cannot be resolved without a decision,
  ask the person in the conversation and wait.
- **fix**: pir ran the tests after merging `{base}` in and they failed; the reason and log are given. Make
  them pass without undoing the change or the merged base, commit, report `[pir:v1 kind=fixed
  single={name}]`. If they cannot be fixed within the change's scope, say why in the report body and
  report `fixed` anyway; pir runs the tests and the run waits red if they still fail.
- Neither helper reports `dropped`. After reporting, change nothing until pir's word arrives.
- The report format and the one-Bash-command drop are the builder's, with the new kinds.

## Tests

- [ ] The skill names both roles, both report headers exactly, and the "never touch the base" rule.
- [ ] The skill says a helper never reports `dropped`.
- [ ] The opening phrases the skill keys on ("as the resolve helper of", "as the fix helper of") match T03's `helperInstruction` text (assert both strings appear in the skill; T05 cross-checks against the function).

## Done when

- [ ] The section exists with the rules above; the skill test covers it.
- [ ] `./install.sh` run and `diff -rq skills/pir-single ~/.claude/skills/pir-single` prints nothing.
- [ ] `npm test` green.

## Outside actions

- Refresh the installed engine and skills — `worker` (DESIGN §5.3)
