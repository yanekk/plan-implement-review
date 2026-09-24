# T08 — planner-writes-block

**Phase:** 3 · **Depends on:** T01 · **Weight:** medium

## Goal

The planner writes the block and the build sessions read their test command from it. Without this the
engine refuses every new plan.

## Design sections this implements

DESIGN §2.1, §2.7.

## Files

- `skills/pir-plan/templates/DESIGN.md` — starts with the block; §5 "The test command" says the block
  is the command and drops the "A parallel run executes this block" paragraph about the fence
- `skills/pir-plan/SKILL.md` — Stage 3 "The test command" measures setup as well (what a fresh clone
  needs before its tests can run, `none` if nothing) and writes both into the block; Stage 7 lists it
- `skills/pir-implement/SKILL.md`, `skills/pir-review/SKILL.md` — "the test command" is the block's
  `test` lines; if they cannot start for something missing, run the `setup` lines
- `skills/pir-worker/SKILL.md` — a paragraph on the setup-failure note: read it, get the worktree ready,
  carry on; do not ask the person unless the fix is outside the worktree
- `src/core/planner-templates.test.mjs`

## Interface

The template's first lines:

```
---
# setup: none, or a list of "  - <command>" lines a fresh clone needs before its tests can run
setup: none
test:
  - {the test command}
---
```

## Tests

- [ ] `planner-templates.test.mjs`: the DESIGN template parses with `parseTestBlock` to `ok: true`.
- [ ] No skill still says the test command is "the fenced block" or "named in § Environment" alone
      (a grep in the review is enough; no test needed for prose).

## Done when

- [ ] The template begins with a block `parseTestBlock` accepts, tested.
- [ ] pir-plan, pir-implement, pir-review and pir-worker describe the block as in DESIGN §2.7.
