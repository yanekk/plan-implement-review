# T14 — worker-contract

**Phase:** 4 · **Depends on:** T05 · **Weight:** light

## Goal

Tell workers the truth about how they are reached. They still drop a report when they park on the person
or finish, but they ask the person in their own conversation, with AskUserQuestion when the answer is a
choice, and the person answers in `pir`, not by attaching in `claude agents`. Idle is now read from the
stream, so the "go idle in `claude agents`" wording goes.

## Design sections this implements

DESIGN §2.4, §2.7, §2.10.

## Files

- `skills/pir-worker/SKILL.md` (the asking section around "finds you in their `claude agents` view", the
  "Leave a clean, idle session" section, the merge-conflict lines where "the person attaches", the
  permission-prompt lines on needing input in `claude agents`, and the naming lines about the `claude agents` list)
- `skills/pir-implement/SKILL.md`, `skills/pir-review/SKILL.md` (their parallel-mode asking lines already say
  ask in this session and wait; they gain only the AskUserQuestion wording). No test asserts on skill text

## Tests

- [ ] no skill text mentions attaching or `claude agents` for a parallel worker
- [ ] the report-file instructions (kinds, the `node -e` writer) are unchanged
- [ ] a message from pir (the conflict fix) is described as something the worker acts on

## Done when

- [ ] `grep -rn "claude agents" skills/` finds nothing that tells a worker how the person reaches it
- [ ] the skills say: ask in this conversation, prefer AskUserQuestion for a choice, drop the report, wait
- [ ] classic-mode wording (a person at the keyboard) is untouched
