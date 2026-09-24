# T04 — nudge-sender

**Phase:** 1 · **Depends on:** T00 · **Weight:** medium

## Goal

The whole nudge channel as T00 proved it (DESIGN §2.1): the coordinator writes a note file for one
worker, and the worker's own hooks show it the note. Also give every spawned worker those hooks, correct
the code's statement that nothing is ever sent to a worker, and narrow the `no-down-channel` guard so it
still forbids routing the person's answers while allowing exactly the fixed nudge. If T00 recorded that
the wake does not work, also build the stop-and-resume path for an idle worker.

## Design sections this implements

DESIGN §2.1, §2.7 (delivery failures), §3.1 (the narrowed guard).

## Files

- `src/shell/platform.mjs`: add `nudge()` and `nudgePending()` to `createPlatform`; `spawnArgv` gains
  `--settings <hook json>` naming `nudge-hook.mjs`; rewrite the header paragraph that says there is no
  down-channel (keep the point that nothing is routed from the person).
- `src/shell/nudge-hook.mjs` (new): the worker-side hook script, run by Claude Code inside the worker
  session. Two modes, from its argv: `tool` (PreToolUse/PostToolUse: if a note exists for this session,
  consume it and print it as `additionalContext`) and `wake` (the async watcher T00 proved: wait for a
  note, consume it, print it and exit so the session wakes; exit silently if the session's next turn
  starts first). No-op, exit 0, when there is no note.
- `src/shell/nudge-hook.test.mjs` (new), `src/shell/platform.test.mjs`: tests below; update the comment
  on `createMessaging exposes inbox and no send` (the assertion stays).
- `src/shell/fake/platform.mjs`: `nudge({ sessionId }, text)` records `{ sessionId, text }` into a
  `nudged` array and returns a scriptable result; `nudgePending()` scriptable.
- `src/shell/no-down-channel.test.mjs`: the narrowed guard.
- `install.sh` only if the engine copy it makes does not already include `src/shell/nudge-hook.mjs`
  (the spawned worker's `--settings` must point at the installed copy).
- Fallback only (T00 says the wake does not work): `platform.resumeWith({ id, sessionId, cwd }, text)`,
  built on `platform.revive` from `resume-dead-worker` T02 (stop, then `claude --bg --resume <sessionId>
  "<text>"`), with the nudge text in place of the revive continuation. Do not write a second stop-and-
  resume; if that task is not built yet, stop and raise it with the person.

## Interface

```js
// Note location from T00 (DESIGN §2.1: reachable from every worktree, never listed by git status),
// keyed by the worker's sessionId. Injected: fs, notesDir.
nudge({ sessionId }, text) → { ok: true } | { ok: false, reason: string }
// Writes the note temp-then-rename; replaces an unconsumed older note. Never throws. No sessionId →
// { ok:false } without touching the filesystem.
nudgePending({ sessionId }) → boolean   // the note is still there, i.e. no hook has shown it yet

// nudge-hook.mjs reads the session id from the hook input JSON on stdin (T00 records the field), looks
// up the note, deletes it, and writes the hook output JSON T00 recorded.
```

The spawn `--settings` JSON is built by one exported function so its exact shape is unit-tested.

Guard test additions: the relay tokens and `.send(` stay forbidden in `coordinate.mjs`, `loop.mjs`,
`platform.mjs`; every `platform.nudge(` and `platform.resumeWith(` call in `loop.mjs` must pass a
`nudgeMessage(` result as its text argument (a source scan). `node:net` and `cc-socks` are forbidden in
those files. The test is written now and passes vacuously until T05 adds the call.

## Tests

- [ ] `nudge` writes exactly the text for that sessionId, atomically; a second call replaces it.
- [ ] Missing sessionId → `{ ok:false }` without touching the filesystem; an unwritable dir →
      `{ ok:false, reason }`.
- [ ] `nudgePending` true after `nudge`, false after the hook consumed it.
- [ ] `nudge-hook.mjs tool` with a note: prints the recorded output shape containing the text and
      deletes the note; with no note: prints nothing, exit 0; with a note for another session: untouched.
- [ ] `nudge-hook.mjs wake` returns as soon as a note appears, and exits silently when told the turn
      started (driven with an injected clock/poll, no real waiting).
- [ ] Text containing quotes, newlines and non-ASCII is carried intact.
- [ ] `spawnArgv` includes the `--settings` JSON naming the installed hook path.
- [ ] Guard: a fixture source string with `platform.nudge(w, 'free text')` fails the scan; one with
      `platform.nudge(w, nudgeMessage({…}))` passes; `node:net` in `platform.mjs` fails.
- [ ] Fake `nudge()` records calls and can be scripted to fail.
- [ ] Fallback only: `resumeWith` calls `revive` with the nudge text and never spawns a copy.

## Done when

- [ ] `platform.nudge()` and `nudge-hook.mjs` exist, never throw, and all listed tests pass in `npm test`.
- [ ] `no-down-channel.test.mjs` forbids the relay and `.send(` as before, plus free-text nudges and
      socket posts.
- [ ] No comment in `platform.mjs` still claims nothing is ever sent to a worker.
- [ ] `./install.sh` has run and `~/.claude/pir-engine/src/shell/nudge-hook.mjs` exists.

## Outside actions

- refresh-install — `worker`
