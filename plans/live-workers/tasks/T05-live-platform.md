# T05 — live-platform

**Phase:** 2 · **Depends on:** T04 · **Weight:** heavy

## Goal

Switch the coordinator from `claude --bg` sessions to live children. `createPlatform` keeps its shape
for the loop, spawn/list/close/remove/inbox, backed by T04 workers, and gains the line down: send,
interrupt, answer. The loop's liveness and busy checks move from `claude agents` to the children. After
this task a run drives stream-json workers and nothing in the coordinator lists `claude agents`.

## Design sections this implements

DESIGN §2.1, §2.2, §2.4 (isBusy), §1 Stance (the withdrawn rule).

## Files

- `src/shell/platform.mjs`, `src/shell/platform.test.mjs`
- `src/shell/loop.mjs`, `src/shell/loop.test.mjs` (liveness, isBusy, the name-match workaround)
- `src/shell/coordinate.mjs` (construct the platform with the control dir; `teardownRun` closes children)
- `src/shell/fake/platform.mjs` and its test (gain `send`, `interrupt`, `answer`, activity)
- `src/shell/no-down-channel.test.mjs` (narrowed, see below)

## Interface

```js
createPlatform({ root, controlDir, transport, startWorker = realStartWorker, uuid }) → {
  spawn({ cwd, name, phase }) → id          // id is a uuid pir chose; opening instruction sent as first line
  list() → [{ id, pid, name, cwd, status: 'busy'|'idle', state, live: true, task, role, activity }]
  close(id) → Promise<{ ok }>
  remove(id) → { ok: true }                 // no-op: there is no session record to clear
  inbox()                                   // unchanged, reports/ drop dir
  send(id, text, { from }) → { ok }         // user line
  interrupt(id) → { ok }
  answer(id, requestId, reply) → { ok }     // reply built by core/stream.mjs
  logPathOf(id) → string
}
```

The platform keeps `control/workers.json` current with T04's `writeWorkersFile` on every spawn and exit
(DESIGN §2.12); T06 only reads it.

`status` is `busy` unless `workerActivity` says `idle`; a worker waiting on a permission or a question
set is not busy (it is parked on the person, as a question report parks it today).

The no-down-channel test is narrowed, not deleted: it keeps forbidding the removed relay machinery
(`createAgentBridge`, `outbox`, the answers/surfaced feeds, `send-failed`) and drops the bare `.send(`
pattern, with a header line citing DESIGN §1 Stance and this task. The file is renamed only if its name
now misleads; say which in the commit.

## Tests

- [ ] spawn starts a fake worker in the task cwd with the §2.1 argv and the opening instruction as the first user line
- [ ] list reflects exits immediately; a worker that exited is gone from list and the loop treats it as dead as before
- [ ] isBusy flips on the fake's `result`; force-idle still triggers on an idle worker past the timeout
- [ ] send/interrupt/answer on a dead id return `{ok:false}` and log `undelivered`
- [ ] the loop no longer needs the name-match workaround for ids; whatever of it remains is justified in a comment
- [ ] coordinate/loop suites pass unchanged in meaning against the updated fake platform
- [ ] no call to `claude agents`, `claude stop` or `claude rm` remains in platform.mjs's live path
- [ ] the narrowed no-down-channel test still fails if `outbox` or `createAgentBridge` reappears

## Done when

- [ ] `npm test` green; `grep -n "'--bg'" src/shell` finds nothing
- [ ] a coordinator test drives two fake workers from spawn to done through the real platform
- [ ] the teardown path closes every child (asserted with the fake)
- [ ] `workers.json` lists exactly the live children after each spawn and exit
