# T00 — hand-tool-spike

**Phase:** 0 · **Depends on:** — · **Weight:** light

## Goal

The hand-a-command design (DESIGN §2.6) rests on one unmeasured claim: that an in-process SDK MCP tool,
given to a session started the way `worker-proc.mjs` starts workers (`permissionMode: 'auto'`), raises a
`canUseTool` request that waits for pir's answer, and that the answer's `updatedInput` reaches the tool's
handler. This spike measures it on this machine with one short real session, records the answer, and
deletes its code.

## Design sections this implements

DESIGN §2.6, §4, §5.2, §5.3.

## Files

- A throwaway script under `/tmp/pir-hand-spike/` (never committed).
- `plans/bang-commands/FINDINGS.md` — one row with the measured answers.
- `src/shell/fake/claude-stream.mjs` — read only: note in the FINDINGS row what the fake would need to
  tolerate when `workerOptions` carries `mcpServers` (an extra flag, `mcp_message` control requests).

## The questions, and what each answer means

1. Under `permissionMode: 'auto'`, does calling `mcp__pir__hand_command` reach `canUseTool`? Yes → T05
   relies on it. No → T05 adds a `PreToolUse` hook returning `ask` for that tool (the finisher's
   `ASK_EVERY_CALL` pattern); measure that the hook makes it reach `canUseTool`.
2. Does `{behavior:'allow', updatedInput:{…, pirResult}}` reach the handler's `args`, and does the
   handler's text come back to the model as the tool result? No → T05 keeps the result in a per-request
   map in `worker-proc.mjs` keyed by tool-use id instead of `updatedInput`.
3. Does a request left unanswered for 3 minutes still accept the answer (no MCP or permission timeout)?
   No → record the limit; T05 documents it and T10 states it.
4. Under `permissionMode: 'default'` (the agent's and finisher's), does the same hold? Recorded only, so
   a later plan does not re-measure.
5. What the CLI passes the fake when `mcpServers` holds an SDK server (flags, control requests), so T05
   knows what `fake/claude-stream.mjs` must accept.

## Tests

None committed; this is a measurement. The FINDINGS row is the deliverable.

## Done when

- [ ] FINDINGS.md has one dated row answering questions 1–5, and the spike folder is deleted.
- [ ] If an answer contradicts DESIGN §2.6, the session stops and asks the person before changing it.

## Outside actions

- One real Claude session for the spike — `worker`
