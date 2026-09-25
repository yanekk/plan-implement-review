# T04 — worker-process

**Phase:** 2 · **Depends on:** T01 · **Weight:** medium

## Goal

Start and hold one stream-json worker: spawn it, split its stdout into lines, append every line and
every line pir writes to the conversation log, write to its stdin, and report its exit. Also the fake
`claude` every later shell test drives, so no test ever pays for a model.

## Design sections this implements

DESIGN §2.1, §2.2, §2.3, §2.12 (workers.json writer only), §4.

## Files

- `src/shell/worker-proc.mjs` (new), `src/shell/worker-proc.test.mjs` (new)
- `src/shell/terminate.mjs` (new) and its test: the SIGTERM-wait-SIGKILL escalation lifted from
  `control-run.mjs` `stopRun`, so `close` here and T06's reap and `stopRun` share one copy (user 2026-09-25,
  plan review); T06 moves `stopRun` onto it
- `src/shell/fake/claude-stream.mjs` (new): a node script, argv like `claude`, driven by a JSON script
  file named in `PIR_FAKE_CLAUDE_SCRIPT`

## Interface

```js
workerArgv({ sessionId, name }) → string[]           // exactly DESIGN §2.1, without the binary
startWorker({ cwd, sessionId, name, logPath, command = 'claude', spawn, now = Date.now }) → Worker
// Worker:
//   id (= sessionId), pid, startedAt
//   write(line, { from: 'pir'|'person' }) → boolean  // logs {dir:'out'}; false if stdin is closed
//   note(kind, fields)                              // logs {dir:'note'}
//   onEvent(fn)  // fn(parsedEvent, entry) per stdout line, after it is logged
//   onExit(fn)   // fn({ code, signal }) once; logs {dir:'note', kind:'exited'}
//   entries() → the in-memory log entries (for workerActivity)
//   close({ graceMs = 5000, killMs = 10000 }) → Promise<void>  // end stdin, SIGTERM, SIGKILL
terminate(pid, { graceMs, killMs, isAlive, kill, sleep }) → Promise<{ escalated }>   // shell/terminate.mjs
writeWorkersFile(controlDir, workers /* [{id, task, role, pid, startTime}] */)   // temp then rename
```

The fake script is a list of steps: `{emit: <line>}`, `{await: 'user'|'control_response'|'interrupt'}`,
`{sleep: ms}`, `{exit: code}`; on stdin EOF it exits 0 unless the script says otherwise.

## Tests

- [ ] argv matches DESIGN §2.1 exactly
- [ ] against the fake: every stdout line is logged `in` before `onEvent` fires, in order
- [ ] a line split across two chunks is joined; two lines in one chunk are split; a last line without a
      newline is logged at exit
- [ ] `write` logs `out` with `from`; after exit it returns false and logs nothing but an `undelivered` note
- [ ] `terminate` with injected isAlive/kill/sleep: exits after SIGTERM, escalates to SIGKILL, dead pid is a no-op
- [ ] `close` on a fake that ignores EOF escalates to SIGTERM then SIGKILL within the given times (short in tests)
- [ ] exit code and signal are reported once and logged
- [ ] `writeWorkersFile` never leaves a partial file (write to temp, rename)
- [ ] no test spawns the real `claude` (the command is always the fake)

## Done when

- [ ] `npm test` green with the tests above
- [ ] a worker run against the fake produces a log that T01's `workerActivity` folds to `idle`
- [ ] the fake is documented in its header well enough for T05–T08 to script new cases
