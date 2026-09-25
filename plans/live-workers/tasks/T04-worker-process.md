# T04 — worker-process

**Phase:** 2 · **Depends on:** T01, T10 · **Weight:** medium

## Goal

Start and hold one worker through the Agent SDK: call `query()` with the DESIGN §2.1 options, own its
input queue, turn each `canUseTool` call into a pending request pir can answer later, append every SDK
message and every value pir sends to the conversation log, hold the pid, and report exit. Also the fake
`claude` every later shell test drives through the real SDK, so no test ever pays for a model.

## Design sections this implements

DESIGN §2.1, §2.2, §2.3, §2.12 (workers.json writer only), §4.

## Files

- `src/shell/worker-proc.mjs` (new), `src/shell/worker-proc.test.mjs` (new). The only module in `src/`
  that imports `@anthropic-ai/claude-agent-sdk` (installed by T10).
- `src/shell/terminate.mjs` (new) and its test: the SIGTERM-wait-SIGKILL escalation lifted from
  `control-run.mjs` `stopRun`, so `close` here and T06's reap and `stopRun` share one copy (user 2026-09-25,
  plan review); T06 moves `stopRun` onto it
- `src/shell/fake/claude-stream.mjs` (new): a node script standing in for the `claude` executable, driven by
  a JSON script file named in `PIR_FAKE_CLAUDE_SCRIPT`. It answers the SDK's `initialize` control request
  the way T01's `wire-sample.ndjson` shows, then runs its script

## Interface

```js
workerOptions({ cwd, sessionId, name, claudePath, canUseTool, spawnProcess }) → SDK Options   // exactly DESIGN §2.1
startWorker({ cwd, sessionId, name, logPath, claudePath, query = sdk.query,
              spawnProcess = childProcess.spawn, now = Date.now }) → Worker
// Worker:
//   id (= sessionId), pid, startedAt
//   send(text, { from: 'pir'|'person' }) → boolean   // pushes userMessage; logs {dir:'out', kind:'message'};
//                                                   // false and an `undelivered` note once the queue is closed
//   interrupt({ from }) → Promise<boolean>          // query.interrupt(); logs {dir:'out', kind:'interrupt'}
//   answer(requestId, result, { from }) → boolean   // resolves that canUseTool promise; logs {kind:'reply'};
//                                                   // false and `undelivered` if nothing is pending under that id
//   pending() → [request…]                          // canUseTool calls not yet answered
//   note(kind, fields)                              // logs {dir:'note'}
//   onEvent(fn)  // fn(entry) per logged entry, after it is written
//   onExit(fn)   // fn({ code, signal }) once; logs {dir:'note', kind:'exited'}
//   entries() → the in-memory log entries (for workerActivity)
//   close({ graceMs = 5000, killMs = 10000 }) → Promise<void>  // end the input queue, then terminate(pid)
terminate(pid, { graceMs, killMs, isAlive, kill, sleep }) → Promise<{ escalated }>   // shell/terminate.mjs
writeWorkersFile(controlDir, workers /* [{id, task, role, pid, startTime}] */)   // temp then rename
```

`canUseTool` logs a `request` entry (DESIGN §2.3: `requestId`, `decisionReason` as `reason`,
`description`, `suggestions`, from the SDK's call options) and returns a promise that `answer` resolves.
T07 decides grants before a request counts as pending; this module only holds and resolves.

The input queue is an async iterable pir owns. Closing it uses an internal sentinel that is never
yielded to the SDK as a message.

The fake script is a list of steps: `{emit: <line>}`, `{await: 'user'|'control_response'|'interrupt'}`,
`{sleep: ms}`, `{exit: code}`; on stdin EOF it exits 0 unless the script says otherwise.

## Tests

- [ ] `workerOptions` matches DESIGN §2.1 exactly; `spawnProcess` receives the argv T00 saw, with the fake as the command
- [ ] against the fake through the real SDK: every SDK message is logged `in` before `onEvent` fires, in order
- [ ] a scripted `can_use_tool` becomes a `request` entry and a pending request; `answer` sends the
      `PermissionResult` the fake expects (checked in the fake's received lines); a second `answer` is `undelivered`
- [ ] `interrupt` reaches the fake as the interrupt control request and the turn ends `error_during_execution`
- [ ] `send` logs `out` with `from`; after exit it returns false and logs only an `undelivered` note
- [ ] an SDK stream error (the fake exits mid-turn with garbage) is logged `sdk-error` and reported as exit
- [ ] `terminate` with injected isAlive/kill/sleep: exits after SIGTERM, escalates to SIGKILL, dead pid is a no-op
- [ ] `close` on a fake that ignores EOF escalates to SIGTERM then SIGKILL within the given times (short in tests)
- [ ] exit code and signal are reported once and logged
- [ ] `writeWorkersFile` never leaves a partial file (write to temp, rename)
- [ ] no test spawns the real `claude` (the command is always the fake)

## Done when

- [ ] `npm test` green with the tests above
- [ ] a worker run against the fake produces a log that T01's `workerActivity` folds to `idle`
- [ ] the fake is documented in its header well enough for T05–T08 to script new cases
