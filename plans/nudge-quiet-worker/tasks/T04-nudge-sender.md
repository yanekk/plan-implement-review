# T04 — nudge-sender

**Phase:** 1 · **Depends on:** T00 · **Weight:** medium

## Goal

Deliver one line of text into a worker's inbox socket from the coordinator process, using the wire
format and socket location T00 proved. Also correct the code's statement that no such channel exists,
and narrow the `no-down-channel` guard so it still forbids routing the person's answers while allowing
exactly the fixed nudge.

## Design sections this implements

DESIGN §2.1, §2.7 (send failures), §3.1 (the narrowed guard).

## Files

- `src/shell/platform.mjs`: add `nudge()` to `createPlatform`; rewrite the header paragraph that says
  a Node process cannot send a cross-session message (keep the point that nothing is routed from the
  person).
- `src/shell/platform.test.mjs`: tests below; update the comment on `createMessaging exposes inbox and
  no send` (the assertion stays).
- `src/shell/fake/platform.mjs`: `nudge()` records `{ workerId, text }` into a `nudged` array and
  returns a scriptable result.
- `src/shell/no-down-channel.test.mjs`: the narrowed guard.

## Interface

```js
// Injected: connect (node:net createConnection), socketDirs (default from T00's finding, e.g.
// ['/tmp/cc-socks', `/tmp/cc-socks-${uid}`]), timeoutMs (default 5000).
nudge({ pid }, text) → Promise<{ ok: true } | { ok: false, reason: string }>
// Finds <dir>/<pid>.sock (first that exists), connects, writes
//   JSON.stringify({ type:'user', message:{ role:'user', content:text } }) + '\n'
// ends the connection, resolves on close. Never throws: no pid, no socket, connect error, timeout
// → { ok:false, reason }. Adjust the line format and lookup to whatever T00 recorded.
```

If `runPass` is synchronous, T05 decides how to await it (a pass may fire the send and record its
result on the next pass). Say which in the code comment. Do not make the loop block for more than the
timeout.

Guard test additions: the relay tokens and `.send(` stay forbidden in `coordinate.mjs`, `loop.mjs`,
`platform.mjs`; every `platform.nudge(` call in `loop.mjs` must pass a `nudgeMessage(` result as its
text argument (a source scan). The test is written now and passes vacuously until T05 adds the call.

## Tests

- [ ] Against a real Unix socket server created in a temp dir: the server receives exactly one line,
      and it parses to the documented JSON with the given text.
- [ ] No socket file for the pid → `{ ok:false, reason }` naming the missing path.
- [ ] Server that accepts and never reads, or never closes → resolves `{ ok:false }` within `timeoutMs`.
- [ ] Missing pid → `{ ok:false }` without touching the filesystem.
- [ ] Text containing quotes, newlines and non-ASCII is carried intact through the JSON line.
- [ ] Guard: a fixture source string with `platform.nudge(w, 'free text')` fails the scan; one with
      `platform.nudge(w, nudgeMessage({…}))` passes.
- [ ] Fake `nudge()` records calls and can be scripted to fail.

## Done when

- [ ] `platform.nudge()` exists, never throws, and all listed tests pass in `npm test`.
- [ ] `no-down-channel.test.mjs` forbids the relay and `.send(` as before, plus free-text nudges.
- [ ] No comment in `platform.mjs` still claims a Node process cannot post to a session.
