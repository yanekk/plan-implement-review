# T07 — skills

**Phase:** 3 · **Runs:** auto · **Depends on:** T04 · **Weight:** medium

## Goal

Remove the skills whose job is gone, rewrite the surviving worker skills so they no longer assume the
coordinator is an agent, and teach the plan-authoring skill the slug-as-name convention. The
`pir-coordinate` skill was the agentic coordinator; `pir-verify` was the hands-on `you` worker;
`pir-parallelize-plan` existed to add the `Runs` column and tag `you` — all three are dead. The worker
skills that remain must drop every trace of the down-channel and the "the coordinator messages you"
model: a worker reports up by dropping a file, and the person answers it directly in its own session.
The `pir-worker` contract also carries the explicit bar for when a worker may stop and ask the person
to judge something, so "genuinely cannot verify it itself" is a written rule, not an adjective. And
the plan templates adopt the slug-as-name convention (DESIGN §2.9): a task's `PROGRESS.md` Task cell
is its kebab slug, matching its `tasks/T{nn}-{slug}.md` filename.

## Design sections this implements

DESIGN §2.2 (the person answers directly; the up-signal is a file drop), §2.5 (no `you` path; the
prepare-and-ask bar in the worker contract), and §2.9 (slug as the task name, method-wide).

## Files

- Delete `skills/pir-coordinate/`, `skills/pir-verify/`, `skills/pir-parallelize-plan/`.
- `skills/pir-implement/SKILL.md`, `skills/pir-review/SKILL.md`, `skills/pir-worker/SKILL.md` —
  remove SendMessage/outbox/"coordinator answers you down the other channel"/"the coordinator
  surfaces" language; a worker drops its report file and, when it needs the person, the person
  answers in this session. Add the prepare-and-ask bar to `pir-worker`.
- `skills/pir-plan/SKILL.md` and `skills/pir-plan/templates/{PROGRESS,PLAN,TASK}.md` — remove the
  `Runs` column, the fold-vs-split machinery, and the `you` count from the width-report guidance; add
  the rule that a task's Task cell is its kebab slug, matching the task-doc filename.
- `src/core/planner-templates.test.mjs` — update so it stays green against the edited templates
  (no `Runs` column; slug Task cells).
- `skills/pir-install/SKILL.md` and `install.sh` — drop the deleted skills from the installed set.
- `README.md` — remove references to the deleted skills and the agentic coordinator.

## Interface

No code interface. Grep-checkable contracts: the surviving worker skills contain no
SendMessage/outbox/surfaced/down-channel language; no skill or template references `pir-verify`,
`pir-coordinate`, `pir-parallelize-plan`, or a `Runs`/`you`/fold-split model; the templates show a
slug in the Task column.

## Tests

- [ ] `planner-templates.test.mjs` is green against the edited templates (no `Runs` column; slug Task
      cells).
- [ ] `npm test` is green.
- [ ] (Done-when greps below stand in for the un-unit-testable Markdown.)

## Done when

- [ ] `pir-coordinate`, `pir-verify`, `pir-parallelize-plan` are deleted from `skills/`, dropped from
      `install.sh`'s installed set and from `pir-install`, and gone from the README.
- [ ] `pir-implement`, `pir-review`, `pir-worker` carry no agentic-coordinator or down-channel
      assumption; `pir-worker` carries the prepare-and-ask bar; a worker reports up by file and is
      answered directly.
- [ ] The templates and `pir-plan` carry no `Runs`/`you`/fold-split machinery and state the
      slug-as-Task-cell convention; `npm test` green.
- [ ] Note in the commit that the account-level copies under `~/.claude/skills/` are refreshed by
      re-running the installer (or `pir-install`); this task edits the repo's `skills/` source.
