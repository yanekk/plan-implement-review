# T05 — hand-tool

**Phase:** 1 · **Depends on:** T00, T03, T04 · **Weight:** medium

## Goal

Give the agents that may hand the person a command the `hand_command` tool, and close the loop: when the
person's run of a handed command ends, answer the pending request with the output so the tool returns it
to the agent at once, and word a decline. After this task an agent's call reaches the person, and the
person's run (a `shell` drop with the `requestId`) reaches the agent as the tool's result.

## Design sections this implements

DESIGN §2.6, §3.1.

## Files

- `src/shell/worker-proc.mjs` and test — `workerOptions` gains `handTool`; with it, `mcpServers: { pir:
  createSdkMcpServer({ name:'pir', tools:[tool('hand_command', DESCRIPTION, { command, reason }, handler)] }) }`.
  The shape is zod (`import { z } from 'zod'`). The handler returns the person's result, carried as T00's
  FINDINGS row says (declared in the shape, or a per-request map), else `HAND_FALLBACK`; never a
  `pirResult` the model supplied itself. If T00 said so, a `PreToolUse` hook returning `ask` for
  `HAND_TOOL`.
- `package.json`, `package-lock.json` — `zod` 4.6.5 as a direct dependency (`npm i zod@4.6.5`, exact by
  `.npmrc`); `src/shell/deps.test.mjs` asserts `zod` imports from `src/shell/` with peers omitted, so the
  installed engine (`npm ci --omit=peer`) is shown to carry it.
- `src/shell/platform.mjs` (`spawn` for build workers and end-of-run helpers), `src/shell/held-session.mjs`
  (planner, plan reviewer, single builder and reviewer) — pass `handTool: true`. `coordinator-agent.mjs`
  and `finisher-agent.mjs` do not.
- The shell readers that switch on `'permission'` treat a pending `'command'` the same:
  `held-session.mjs` `REQUEST_KINDS` (`sessionAsking`, the planning and single rows), `platform.mjs`
  `NOT_BUSY` (a worker waiting on a hand request is parked, not busy), and `person-inbox.mjs`'s
  `wantKind` (a `permission` deny and a `shell` drop's `requestId` both answer a `command` request).
- `src/shell/person-inbox.mjs` and test — on the end of a run whose drop carried a `requestId` that is
  still pending: `platform.answer(to, requestId, { behavior:'allow', updatedInput: { ...input, pirResult } },
  { from:'person' })`, `sent:'answer'`; `lead` chosen by whether the command was edited. A `requestId` no
  longer pending falls back to the plain message. A `permission` deny of a hand request uses
  `handDeclineMessage(text)`.
- `src/shell/conversation-rig.mjs` — a `hand` scenario (the fake emits a `canUseTool` for `HAND_TOOL`,
  then replies to the tool result with a fixed line), used by this task's test and T07's screen tests.
- `src/shell/fake/claude-stream.mjs` — accept what T00 recorded the CLI is passed for an SDK MCP server.

The tool description tells the model: use it only for a command that only the person can run here (a
login, their account), never for anything its own permission rules allow, and never to get round a step
reserved for the person's yes; the person runs it in `pir` and its output is the result.

## Tests

- [ ] `workerOptions({handTool:true})` carries the `pir` server; without the flag it does not; the agent's
      and finisher's options never do.
- [ ] handler returns the person's result, and `HAND_FALLBACK` with none; a `pirResult` the model put in its own call is never returned.
- [ ] `deps.test.mjs`: `zod` imports; a fresh `npm ci` leaves `git status --porcelain` empty.
- [ ] a pending hand request: `sessionAsking` → `'command'`, the worker counts as not busy.
- [ ] forwarder: a run with a pending `requestId` answers allow with `pirResult` and sends no message; an
      edited command says so in the lead; a stale `requestId` sends the plain message; a deny is worded.
- [ ] rig `hand` scenario, real SDK, fake `claude` scripted to emit a `canUseTool` for `HAND_TOOL`: the request is
      logged and pending; a `shell` drop with its `requestId` produces the control response with
      `updatedInput.pirResult` in `rig.received`; a deny drop produces the worded deny.

## Outside actions

- `npm i zod@4.6.5` — `worker`

## Done when

- [ ] Workers, helpers, planners and single sessions are offered the tool; the agent and finisher are not.
- [ ] A handed command run by the person reaches the agent as the tool's result; a decline reaches it worded.
