# T03 — worker-add-task

**Phase:** B · **Depends on:** T02 · **Weight:** light

## Goal

Teach the worker sessions how to propose and add a task, now that the machine adopts one. A builder
that discovers a needed task must ask the person first, and only after approval write the task on its
own branch in the exact shape the coordinator adopts. The reviewer of the introducing task must
validate the addition. This is prose in the skills, and it is a deliberate, named carve-out to the
otherwise strict scope rule — described so a worker does the thing the T00–T02 machinery expects.

## Design sections this implements

DESIGN §2.1 (the lifecycle), §2.2 (add-only, deps on existing tasks, forced state), §2.4 (approval
in-session, reviewer validates).

## Files

- `skills/pir-worker/SKILL.md` — the propose-and-add carve-out (the account copy is refreshed by
  re-running `install.sh`; the repo copy is what the harness fixtures carry).
- `skills/pir-implement/SKILL.md` — how an implementing worker adds the task after approval; name
  this as the one sanctioned exception to "touch only your task."
- `skills/pir-review/SKILL.md` — the reviewer validates any task-addition in the diff.

## Interface

The worker contract to write (add-only, approval-first):

```
When a worker building T{x} believes a NEW task is needed:
  1. Escalate as a `decision` (existing path): drop the report, ask the person IN THIS SESSION,
     wait. Never add a task without a yes.
  2. On approval, on your own task branch, ADD ONLY (never edit an existing task):
     - PROGRESS.md: a new row, state ⬜, next free T-number, kebab slug, Depends on = existing
       tasks only (a dep on a task that does not exist will be rejected at merge).
     - PLAN.md: the matching row in the task table.
     - tasks/T{nn}-{slug}.md: a full task doc (goal, files, interface, tests, done-when) — slug
       matches the filename and the PROGRESS row.
     - FINDINGS.md: one dated line naming the task and why it was added.
  3. Finish T{x} normally. The coordinator adopts the new row when T{x} merges; you do not signal
     anything special.

The reviewer of T{x}, seeing a task-addition in the diff, checks:
  - every dependency of the new task names a task that already exists;
  - the new task doc has all five parts and its slug matches its filename and its PROGRESS row;
  - no existing task's row was edited (add-only).
  A malformed addition is a review finding to fix or escalate.
```

Non-obvious points to state in the prose:

- The coordinator forces an adopted row to `⬜` and rejects a dep on an unknown task and any edit of
  an existing task — so the worker gains nothing by pre-marking state or editing a neighbour, and a
  collision on the number is surfaced to the person, not auto-fixed (DESIGN §2.5).
- This is the only sanctioned break from the strict scope rule, and only in parallel mode, and only
  with the person's yes — analogous to the worktree carve-out already in the contract.

## Tests

Prose deliverable — no automated test. Its correctness is checkable by reading and by consistency
with the enforced machine rules (T00–T02):

- [ ] The add-only rule and the deps-on-existing-tasks rule in the prose match exactly what
      `adoptNewTaskRows` enforces (read both side by side).
- [ ] The reviewer's validation list matches the errors the coordinator would raise.
- [ ] Re-running `install.sh` refreshes the account skills without error (reversible: the repo copy
      is the source; a bad edit is reverted and re-installed).

## Done when

- [ ] The three skills carry the propose-and-add contract, internally consistent and consistent with
      DESIGN §2.1–2.4 and the T00–T02 code.
- [ ] The carve-out is named as the one sanctioned exception to strict scope, parallel-mode only,
      approval-required.
- [ ] `install.sh` re-run refreshes `~/.claude/skills` cleanly.
