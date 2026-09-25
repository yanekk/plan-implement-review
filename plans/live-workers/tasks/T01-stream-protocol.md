# T01 — stream-protocol

**Phase:** 1 · **Depends on:** T00 · **Weight:** medium

## Goal

The pure vocabulary of a worker's conversation: read the log entries the SDK-driven worker produces (SDK
messages, `canUseTool` requests, pir's messages and replies), build the few values pir hands the SDK,
and derive from a worker's history whether it is busy, idle, or waiting on a permission or a question
set. The wire protocol itself belongs to the SDK (DESIGN §2.1); nothing here builds or parses a
stream-json line. Every later task reads workers through this module, so it is tested exhaustively
against what Claude really sends.

## Design sections this implements

DESIGN §2.2, §2.3, §2.4, §2.6, §2.7.

## Files

- `src/core/stream.mjs` (new), `src/core/stream.test.mjs` (new)
- `src/core/fixtures/stream-sample.ndjson` (new): real conversation-log entries of every kind T00 listed
  (SDK messages as yielded, `request` entries from `canUseTool` calls, a reply, an interrupt), recorded by
  a short SDK probe in this task, home paths scrubbed
- `src/shell/fake/fixtures/wire-sample.ndjson` (new): the raw stdin/stdout lines of the same probe,
  teed through `spawnClaudeCodeProcess`, including the SDK's `initialize` exchange. T04's fake
  `claude` replays from it; recorded here so both fixtures come from one run

The probe runs from a scratch folder with its own SDK install (`perl -e 'alarm 120; exec @ARGV' node
<probe>`, haiku), not from the repo, so this task does not wait for T10. It stops after a fixed number
of turns (T00's note on the looping probe).

## Interface

```js
// Read one conversation-log entry. Never throws: a malformed entry is { kind: 'raw', raw }.
readEntry(entry) → WorkerEvent[]   // an assistant message with several blocks yields several events
// WorkerEvent kinds: 'init' {sessionId, slashCommands[], terminalSlashCommands[], tools[], permissionMode}
//   'text' {text} · 'tool-use' {toolUseId, name, input} · 'tool-result' {toolUseId, text, isError}
//   'permission' {requestId, toolName, input, description, reason, suggestions[], defaultToNo, suppressAlwaysAllowRule}
//   'questions' {requestId, questions:[{question, header, multiSelect, options:[{label, description}]}]}
//   'reply' {requestId, behavior} · 'sent' {from, text} · 'interrupt' {}
//   'result' {subtype, text, isError} · 'system' {subtype} · 'note' {kind, …} · 'raw' {raw}

// Values pir hands the SDK.
userMessage(text, sessionId) → SDKUserMessage          // pushed into the input queue
allowResult(request) → PermissionResult                // updatedInput = request.input
denyResult(request, message) → PermissionResult        // message defaults to 'The person refused.'
answersResult(request, answers /* {question: 'A, B'} */) → PermissionResult
declineQuestionsResult(request, text) → PermissionResult

// Fold a worker's entries (in order, including pir's own out entries) into its state.
workerActivity(entries) → { state: 'starting'|'busy'|'idle'|'permission'|'questions',
                            pending: [request…], turns, lastEventAt, slashCommands[] }
```

`entries` are conversation-log entries (DESIGN §2.3). `lastEventAt` comes from entry `t`, never a clock.

## Tests

- [ ] every kind in the fixture reads to the right event; an unknown message `type` becomes `system`, not an error
- [ ] a non-object entry, an entry missing `dir`, and a truncated last log line all become `raw`
- [ ] an `assistant` message carrying several content blocks (text + tool_use) yields each block, in order
- [ ] an AskUserQuestion `request` becomes `questions`, any other tool becomes `permission`
- [ ] each result builder's output matches the `PermissionResult` shapes in FINDINGS exactly (allow keeps
      `updatedInput` = input; deny carries `message`)
- [ ] `answersResult` keeps the request input and adds `answers`; multi-select labels joined `", "`
- [ ] activity: message out → busy; result → idle; request → permission/questions; its reply → back to busy
- [ ] two pending requests at once; a reply to an unknown request id leaves state unchanged
- [ ] interrupt while busy → next result (`error_during_execution`) → idle
- [ ] a system task notification after a result (background job) is handled as T00 found it
- [ ] no import of fs, child_process, clocks or packages (boundary test passes)

## Done when

- [ ] `npm test` green with the tests above, and both fixtures are committed
- [ ] every value pir hands the SDK (DESIGN §2.2, §2.6–§2.7) is built by a function here and nowhere else
- [ ] `workerActivity` over the committed sample ends in `idle` with the right turn count

## Outside actions

- Probe worker — `worker`
- Install packages from npm — `ask` (the probe's scratch folder only)
