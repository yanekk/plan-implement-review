# T31 — Teach the planner the build→verify split

**Phase:** 8 (coverage: hands-on verification) · **Depends on:** T30 · **Weight:** medium · **Runs:** auto

## Why this exists

The method today has one way to hand-verify an `auto` task's deliverable: the builder **folds** the
check into its own task and escalates it through the question path (§2.5, §2.6) — the worker builds,
then parks asking the user to verify, holding its slot at human speed. The standalone `you` task is
reserved (DESIGN §2.6) only for work with **no code deliverable** — a spike, or a pure
hand-verification drill against real agents.

So the shape the PM wants — an `auto` task builds a program, and a **separate** `you` task has a
person run it — is not a pattern the planner is taught to produce. It would fold the check into the
builder instead. The PM decided (2026-09-14) to add the split as a first-class planning pattern: in
parallel mode, when a deliverable's real verification can only be established by a person (running the
program, watching a real device or real agents) and the tests cannot reach it, plan it as a paired
`you` verification task depending on the `auto` builder — not folded in.

This is the "teach the pattern" half; T32/T33 prove it runs live.

## What "done" must behave like

- **DESIGN §2.6 gains the split as a first-class option beside the fold.** The rule states *when* to
  split vs fold: **split** when the check is a first-class, separately-planned human step whose result
  is an observation — especially on real agents, real branches, or a real device — so the build is
  reviewed and merged on its own and the human step is its own planned unit; **fold** (the existing
  §2.5 question path) when the check is a quick escalation the builder can present inline. Both coexist;
  the fold path is not removed.
- **The `you` definition in §2.6 is widened.** Today it reads "a person's actions with no deliverable a
  worker could produce," which excludes "run the program the builder just made." Widen it to: a `you`
  task's completion is a person's actions whose result is an **observation**, whether or not a sibling
  `auto` task produced the thing being verified.
- **`pir-plan` teaches the planner to emit the pair.** The task-splitting stage instructs: when a
  deliverable needs a person to verify it and the tests cannot, produce an `auto` build task and a
  dependent `you` verify task, with an **honest dependency** (the verify task depends on the builder),
  and give the `you` task a **"Needs a person" block** — the exact seatbelted command, what to expect,
  and what only a person can answer — so the hands-on worker (`pir-verify`) has something to present.
- **Templates carry the example.** The planner's task template shows the auto builder + paired you
  verify task, the dependency, and the "Needs a person" block. The PROGRESS/PLAN templates already
  carry the `Runs` marker (T11); no metric change — `analyzeParallelism` already counts `you` tasks.
- The planner's width report still reads correctly with paired `you` verify tasks in the `K need you`
  count.

## Files (confirm at build time)

- `plans/parallel-pir/DESIGN.md` — §2.6 (add the split pattern, the fold-vs-split rule, widen the `you`
  definition); §2.7 if the planning-for-parallelism prose needs the pattern named.
- `skills/pir-plan/SKILL.md` — the task-splitting stage (item 6, ≈298–301) and the sizing/ordering prose
  (≈303–320): teach the build→verify split, when to use it, the honest dependency, and the required
  "Needs a person" block on the `you` task.
- `skills/pir-plan/templates/` — a task-doc template/example showing the auto builder + paired you verify
  task with its "Needs a person" block.
- `src/core/planner-templates.test.mjs` (or wherever the golden planner tests live) — extend the goldens.

## Tests

- [ ] Golden planner test: a plan whose deliverable needs a person to run it yields an `auto` build task
      **and** a dependent `you` verify task carrying a "Needs a person" block — not one folded `auto`
      task. (Mutation: folding it into a single `auto` task fails the golden.)
- [ ] The paired `you` verify task's PROGRESS row shows `Runs: you` and a real dependency on the builder;
      `analyzeParallelism` counts it in the `you` total.
- [ ] `npm test` green; the boundary scan green (planner/skill/templates are prose, no core clock/net).

## Done when

- [ ] DESIGN §2.6 states the split pattern and the fold-vs-split rule; the `you` definition is widened to
      cover verifying a sibling's deliverable.
- [ ] `pir-plan` teaches the planner to emit the auto-build + you-verify pair with an honest dependency
      and a "Needs a person" block; templates carry the example.
- [ ] The golden planner tests lock the pattern; `npm test` and the boundary scan green.

## Note on structure

An `auto` task: prose + templates + golden tests, fresh-reviewed. No live confirmation of its own — the
pattern it teaches is proven live by T32 (the fixture) and T33 (the attended run). Sibling of T32 off
T30; the two can run at once.
