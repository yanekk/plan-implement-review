# T01 — stream-protocol

**Phase:** 1 · **Depends on:** T00 · **Weight:** medium

## Goal

The pure vocabulary of the line: read what a worker sends, build what pir sends, and derive from a
worker's event history whether it is busy, idle, or waiting on a permission or a question set. Every
later task speaks through this module, so it is tested exhaustively against lines Claude really emits.

## Design sections this implements

DESIGN §2.1, §2.2, §2.4, §2.6, §2.7, §2.8.

## Files

- `src/core/stream.mjs` (new), `src/core/stream.test.mjs` (new)
- `src/core/fixtures/stream-sample.ndjson` (new): real lines of every kind T00 listed, recorded by a
  short probe in this task (`perl -e 'alarm 120; exec @ARGV' claude -p …`, haiku), home paths scrubbed

## Interface

```js
// Parse one stdout line. Never throws: a bad line is { kind: 'raw', raw }.
parseWorkerLine(text) → WorkerEvent
// WorkerEvent kinds: 'init' {sessionId, slashCommands[], terminalSlashCommands[], tools[], permissionMode}
//   'text' {text} · 'tool-use' {toolUseId, name, input} · 'tool-result' {toolUseId, text, isError}
//   'permission' {requestId, toolName, input, description, reason, suggestions[]}
//   'questions' {requestId, questions:[{question, header, multiSelect, options:[{label, description}]}]}
//   'result' {subtype, text, isError} · 'control-ack' {requestId} · 'system' {subtype} · 'raw' {raw}

// Build one stdin line (a string without the newline).
userLine(text) → string
interruptLine(requestId) → string
permissionReply(request, { allow, message }) → string        // allow → updatedInput = request.input
answersReply(request, answers /* {question: 'A, B'} */) → string
declineQuestionsReply(request, text) → string                // deny with the typed text as message

// Fold a worker's event history (in order, including pir's own outgoing lines) into its state.
workerActivity(entries) → { state: 'starting'|'busy'|'idle'|'permission'|'questions',
                            pending: [request…], turns, lastEventAt, slashCommands[] }
```

`entries` are conversation-log entries (DESIGN §2.3). `lastEventAt` comes from entry `t`, never a clock.

## Tests

- [ ] every kind in the fixture parses to the right event; an unknown `type` becomes `system`, not an error
- [ ] a non-JSON line, an empty line, a truncated last line all become `raw`
- [ ] `assistant` messages carrying several content blocks (text + tool_use) yield each block, in order
- [ ] AskUserQuestion `can_use_tool` becomes `questions`, any other tool becomes `permission`
- [ ] each builder's output parses as JSON and matches the shapes in FINDINGS 2026-09-24 exactly
- [ ] `answersReply` keeps the request input and adds `answers`; multi-select labels joined `", "`
- [ ] activity: user line → busy; result → idle; request → permission/questions; its reply → back to busy
- [ ] two pending requests at once; a reply to an unknown request id leaves state unchanged
- [ ] interrupt while busy → next result (interrupted) → idle
- [ ] a system task notification after a result (background job) is handled as T00 found it
- [ ] no import of fs, child_process, clocks or packages (boundary test passes)

## Done when

- [ ] `npm test` green with the tests above, and the fixture is committed
- [ ] every line shape in DESIGN §2.6–§2.8 is built by a function here and nowhere else
- [ ] `workerActivity` over the committed sample ends in `idle` with the right turn count

## Outside actions

- Probe worker — `worker`
