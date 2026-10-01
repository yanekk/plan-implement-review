# T03 — bang-forwarding

**Phase:** 1 · **Depends on:** T01, T02 · **Weight:** heavy

## Goal

Wire `!` end to end below the screen: the person-inbox forwarder takes a `shell` drop, runs it through
T01 in the session's folder, writes the output into that session's conversation log, and when it ends
sends the agent the T02 message; `shell-stop` stops it; each of the three hosts keeps a shells folder,
reaps it at start, and kills running commands when a session closes or the host exits. After this task a
drop written by hand into `inbox/` works in a build, a planning run and a single run.

## Design sections this implements

DESIGN §2.2, §2.3, §2.4, §2.5, §3.1–§3.3.

## Files

- `src/shell/person-inbox.mjs` and test — `forward` for `shell` and `shell-stop`; the per-session map of
  running commands; `stopAll(reason)`.
- `src/shell/worker-proc.mjs` and test — `logEntry(entry)` on the worker handle (the existing `log`,
  exposed; it stamps `t`).
- `src/shell/platform.mjs`, `src/shell/held-session.mjs`, `src/shell/coordinator-agent.mjs` (`withAgent`)
  and tests — `cwdOf(to)` and `log(to, entry)` on each platform.
- `src/shell/coordinate.mjs`, `src/shell/plan-run.mjs`, `src/shell/single-run.mjs` — pass
  `shellsDir: {controlDir}/shells` to `startPersonInbox`; call `reapShells` before it starts and send the
  restart message to a reaped session that is live again; call `stopAll('session-closed')` for a session
  on its close and for all on exit.
- `src/shell/conversation-rig.mjs` — a `bang` scenario (one idle worker that replies to each message it
  gets with a fixed line), for this task's integration test and T06's screen tests.

## Interface

```js
startPersonInbox({ controlDir, platform, grants, watch, log, onActivity,
  shellsDir, startShell = defaultStartShell, now }) → { drain, stop, stopAll(reason), running(to) }

// platform additions (all three hosts)
platform.cwdOf(to) → string | null      // null: no such live session → drop refused 'no-session'
platform.log(to, entry) → entry | null  // appends to that session's conversation log
```

Forwarding `shell`: refuse with a `shell-refused` note when `running(to)` (`busy`) or `cwdOf(to)` is null
(`no-session`); else log `start`, stream `output` entries (ANSI stripped, 1 MB cap then one `clipped`),
and on end log `end` then send `bangMessage(…)` with `{ from: 'person', shell: id }`, recording `sent`.
A drop carrying `requestId` is forwarded the same way here; T05 changes its end to answer the request.

## Tests

- [ ] forwarder unit (fake platform, fake `startShell`): start/output/end entries in order; message sent
      `from:'person'` with `shell`; `busy` refusal; `no-session` refusal; `shell-stop` stops the running
      one and is a no-op with none; output past 1 MB logs one `clipped` and the agent text is the tail.
- [ ] `stopAll('session-closed')` ends with `stopped:'session-closed'` and sends nothing.
- [ ] each platform's `cwdOf` returns the session's worktree and `log` lands in its ndjson file; a dead
      worker gives `null`.
- [ ] integration, rig `bang` scenario with the real SDK and fake `claude`: a hand-written `shell` drop
      of `printf hi` → the ndjson holds the entries and `rig.received` holds one user message whose text
      is the T02 message; a `shell-stop` on `sleep 30` ends it as stopped.
- [ ] host start with a leftover record for a live `sleep` group kills it and deletes the record (one
      test per host's start path, or one shared helper tested once and called by all three).
- [ ] a parked build worker (report park, asking turn ended) un-parks when the result message is sent.

## Done when

- [ ] A `shell` drop runs, streams and reaches the agent in a build, a planning run and a single run.
- [ ] Stop, busy, no-session, session-closed and restart reap all behave as DESIGN §2.2–§2.4 say.
- [ ] `npm test` is green apart from the known red of DESIGN §4.
