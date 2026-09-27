# T02 — coordinator-skill

**Phase:** 1 · **Depends on:** — · **Weight:** light

## Goal

Write the coordinator agent's base definition, the `pir-coordinator` skill: how it judges a worker's
question, what it may decide, what it must pass on, how it writes each decision file, and how it writes
its report sections. It is the first layer of the agent's rules; the project's
`.claude/pir-coordinator.md` is the second.

## Design sections this implements

DESIGN §2.2, §2.3, §2.4, §2.5, §2.6, §2.8, §2.9 step 3, §2.10 (`close`).

## Files

- `skills/pir-coordinator/SKILL.md` (new), frontmatter `name: pir-coordinator`, `user-invocable: false`,
  a description saying it is engaged by a parallel run's opening instruction, never typed.
- `install.sh`: add `pir-coordinator` to the explicit `SKILLS=(…)` list (line 29).
- `src/core/planning-skills.test.mjs` or a new `src/core/coordinator-skill.test.mjs`: assertions on the
  skill text, in the style the planning-skill tests already use.

## What the skill must say

- Read first: the project rules file if the opening instruction names one, then the plan's DESIGN.md,
  PLAN.md, PROGRESS.md, FINDINGS.md from the feature worktree; re-read them rather than trusting memory.
- For each brief: answer, or pass on. Pass on when the plan and rules do not settle it and a wrong guess
  would waste work, and always for a brief marked "this one is the person's".
- A pass carries a one-line reason and what it would pick, and in the same turn the agent says the
  pointer in its reply to the person: which worker and task, why it held back, what it would pick
  (DESIGN §2.5). This reply is the only place the person sees it, on the phone included.
- When pir sends the hand-off (the report and the merge command, or why none is offered), present them
  to the person in the reply (DESIGN §2.9 step 5).
- May approve a worker adding a task, and settle or override a design question; mark those `notable`.
- The project rules win over the base where they conflict; the person's instructions in the agent's own
  conversation win over both for the rest of the run.
- Every decision is one file, written with the Write tool to `<drop folder>/<epoch>-<rand>.json`,
  exactly the shapes of DESIGN §2.3 / T01. Never any other tool that writes.
- The report brief: write three markdown sections, plain English for the person, no jargon; the
  decisions section and the branch footer are added by pir.
- `close` only when the person says so in the agent's conversation, and only once the run is ready to
  merge; before that, tell the person the run is still building and stopping is the dashboard's.
- It never tells a worker to merge into main or push.

## Tests

- [ ] The skill's frontmatter parses; `user-invocable: false`.
- [ ] The skill names every decision kind of T01 with its fields.
- [ ] The skill names both reserved kinds and says to pass them on.
- [ ] The skill says to state the pointer in the reply on every pass, and to present the hand-off.

## Done when

- [ ] The skill exists with the content above; tests pass in `npm test`.
- [ ] `./install.sh` puts it at `~/.claude/skills/pir-coordinator/SKILL.md` (checked with `ls`).
