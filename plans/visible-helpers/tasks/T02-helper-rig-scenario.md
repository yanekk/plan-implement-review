# T02 — helper-rig-scenario

**Phase:** 1 · **Depends on:** — · **Weight:** light

## Goal

Give the end-to-end tests of T03 and T05 and the T06 drill a pretend agent that spawns helpers, so the
real `pir` screen can be driven through them with no paid session. It extends the existing
conversation rig and fake `claude`; it adds no new tooling.

## Design sections this implements

DESIGN §2.1 (wire shapes to copy), §4.

## Files

- `src/shell/fake/claude-stream.mjs`: a permission step may carry `agentId`, written onto the
  `can_use_tool` request as `agent_id` (the wire field the SDK maps to `agentID`, DESIGN §2.1).
- `src/shell/fake/claude-stream.test.mjs`: the field reaches `canUseTool` as `opts.agentID`.
- `src/shell/conversation-rig.mjs`: scenario `helpers`.
- `src/shell/conversation-rig.test.mjs`: one pty test that the scenario drives.

## Interface

```
node src/shell/conversation-rig.mjs --scenario helpers [--into <scratch>] [--keep]
```

The `helpers` script, in order, every shape copied from `src/core/fixtures/helper-sample.ndjson` or,
until T01 lands it, `plans/visible-helpers/evidence/plan-0339-helper.ndjson`:

1. The opening message; a parent Agent tool_use starting helper A ("Survey the code", background).
   `background_tasks_changed` listing A, `task_started` (`local_agent`, `is_backgrounded: true`).
2. A second Agent tool_use starting helper B ("Check the tests", background), same events.
3. For A and B, alternating every `stepMs` (default 700 ms): `task_progress` with a new `description`
   and growing `usage.tool_uses` / `usage.duration_ms`, and a helper assistant frame (a tool_use with
   `parent_tool_use_id` set) plus its tool_result. At least one helper text frame.
4. Helper A makes a permission request (`agentId` = A's task id) and awaits the reply.
5. Helper B ends `completed` (`task_updated`, `task_notification`, a shrunken `background_tasks_changed`).
6. The parent ends its turn with a line of text and `result success`, while A keeps progressing.
7. On `{"await":"interrupt"}`: A ends `killed`/`stopped`, `background_tasks_changed []`, the parent's
   `result error_during_execution`.
8. Then `chat`: every later user message gets a reply, so T05 can see what text the model received
   (the fake's `PIR_FAKE_CLAUDE_RECEIVED` file).

## Tests

- [ ] Fake: a permission step with `agentId` arrives at the SDK's `canUseTool` with `opts.agentID`.
- [ ] Rig pty test: `--scenario helpers` starts, the run is listed `running`, opening T01's conversation
      shows the parent's opening message and the `⎿ Agent Survey the code` step line.

## Done when

- [ ] `node src/shell/conversation-rig.mjs --scenario helpers` runs the script above against the real
      screen, and the two tests pass in `npm test`.
- [ ] The `tour`, `long` and `coordinator` scenarios are unchanged (their tests still pass).
