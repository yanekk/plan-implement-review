# T04 — hand-rules

**Phase:** 1 · **Depends on:** T00, T02 · **Weight:** medium

## Goal

The pure rules for a command an agent hands the person: a pending `mcp__pir__hand_command` request reads
as its own asking kind, `command`, so the row says `asking you · run a command`, the phone alert says
what to run, and the coordinator agent can never answer it. The conversation's pin and keys are T07's,
which keeps this task off `conversation.mjs` while T06 edits it. All wired already through `waitingOn`, `kindPart` and `reservedFor`; this task
teaches them the new kind.

## Design sections this implements

DESIGN §2.6 (reservation), §2.7.

## Files

- `src/core/bang.mjs` — `HAND_TOOL = 'mcp__pir__hand_command'`, `HAND_FALLBACK`, `handDeclineMessage(text?)`.
- `src/core/stream.mjs` — `readRequest` reads a `HAND_TOOL` request as `{ kind:'command', command, reason, requestId, agentId? }`.
- `src/core/asking.mjs` — `waitingOn` → `'command'`; `itemsOf` marks it reserved.
- `src/core/coordinator-policy.mjs` — `reservedFor` reserves it (`'hand'`); the agent's decision check rejects an answer to it.
- `src/core/coordinator-brief.mjs` — the agent is told it is the person's and may only note it.
- `src/core/display.mjs` (`ASKING_LABEL`), `src/core/plandisplay.mjs` (`ASKING_TEXT`) — `asking you · run a command`.
- `src/core/notify.mjs` — `kindPart`: `asks you to run: {command} (open pir to run it)`, `Needs your yes: ` prefix.
- The tests beside each.

## Interface

```js
HAND_TOOL = 'mcp__pir__hand_command'
readRequest(entry) → { kind:'command', requestId, command, reason, agentId? }   // for HAND_TOOL
waitingOn(task, activity) → … | 'command'
reservedFor(item) → … | 'hand'
kindPart({ kind:'command', command }) → 'asks you to run: {command} (open pir to run it)'
```

If T00 found that the tool's name or request shape differs (for example a `PreToolUse`-hook route),
follow T00's FINDINGS row.

## Tests

- [ ] `readRequest` of a hand request → `kind:'command'`; a malformed input (no command) reads as a plain permission.
- [ ] `waitingOn` → `'command'`; held by nobody but the person (`waitingFor(...).holder === 'person'` even with the agent up).
- [ ] the coordinator decision check rejects an allow or deny of a hand request; the brief names it as reserved.
- [ ] `ASKING_LABEL`/`ASKING_TEXT` read `asking you · run a command`.
- [ ] `alertText` for a hand request: prefix, command, the `(open pir to run it)` tail, clipped to 150.

## Done when

- [ ] A logged hand request reads `asking you · run a command` in a build row and a planning row, and its alert text matches DESIGN §2.7.
- [ ] Nothing lets the coordinator agent answer it.
