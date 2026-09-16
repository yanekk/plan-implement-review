# T11 — `/pir-plan` + templates: the `Runs` marker, honest deps, width report

**Phase:** 4 · **Depends on:** T04 · **Weight:** medium · **Runs:** auto

## Goal

Teach the shared planning method to produce plans that parallelise honestly and to show the user
how parallel a plan is, so the coordinator has wide plans to work with rather than long chains.
Three changes to `/pir-plan` and its templates: mark each task `auto` or `you`; declare only real
dependencies (a false dependency serializes work for nothing); and report a plan's parallel width
at the plan checkpoint using `analyzeParallelism`. This changes the shared method, so the classic
flow sees the new column and report and simply ignores them.

## Design sections this implements

DESIGN §2.6 (the `Runs` marker), §2.7 (planning for parallelism: honest deps, the width report).

## Files

- `skills/pir-plan/SKILL.md` — Stage 6 gains: mark each task's `Runs`; declare only real
  dependencies, with the reason; and at the checkpoint report the width from `analyzeParallelism`.
- `skills/pir-plan/templates/PROGRESS.md` — add the `Runs` column and its legend line.
- `skills/pir-plan/templates/PLAN.md` — add `Runs` to the phase task tables and a width line.
- `skills/pir-plan/templates/TASK.md` — add `Runs` to the header line.
- `CLAUDE.md` — note the `Runs` marker and that the coordinator spawns a hands-on worker for a
  `you` task (the user runs the live steps, the worker records; §2.6); AND add a
  parallel-mode carve-out to § Where sessions run: the parallel-mode coordinator and its workers run
  on the feature and task branches in worktrees per DESIGN §2.9, so "main checkout, main branch,
  always; stop if in a worktree" binds the classic single-stream flow only. Without this a worker,
  which `pir-implement` tells to apply that rule in full, would halt on contact with its own worktree.

## Interface

```
The Runs marker in PROGRESS.md: a "Runs" column, values auto | you, default auto (DESIGN §2.6).
The width report, shown at the Stage 6 checkpoint in plain English, from analyzeParallelism (T04):
  "N tasks, longest chain M, up to W can run at once, K need you." — so the user sees whether the
  plan is wide enough for the coordinator to help, before a line is built.
Honest dependencies: the method states that a dependency is declared only when a task truly cannot
start until another is done, and that faking width by cutting a real dependency is out (DESIGN §2.7).
```

Nothing here changes what the classic single-stream flow does; it reads the same files and ignores
the marker and the report.

## Tests

- [ ] The updated PROGRESS and PLAN templates parse with `parseProgress` and expose the `Runs`
      column (a golden test on the template files).
- [ ] `analyzeParallelism` run over the updated PLAN template yields the width numbers the method
      will quote (guards the report against drifting from the metric).
- [ ] A template with no `Runs` column still parses, defaulting to `auto` (classic-plan back-compat).

## Done when

- [ ] `/pir-plan` marks each task `auto`/`you`, declares only real dependencies with the reason,
      and reports the plan's parallel width at the checkpoint.
- [ ] The three templates and `CLAUDE.md` carry the marker and the report, `CLAUDE.md § Where
      sessions run` carries the parallel-mode carve-out (§2.9), and the classic flow is unaffected.
- [ ] `npm test` is green.
