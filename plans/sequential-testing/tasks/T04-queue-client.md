# T04 — queue-client

**Phase:** 2 · **Depends on:** T01 · **Weight:** heavy

## Goal

The shell half of the machine-wide queue: the folder under `~/.pir/test-queue/`, the exclusive slot, the
kill request, the bump write, and `startQueuedLines`, which enqueues a suite run and, polled, takes the
slot on its turn, runs the lines through `startLines`, enforces the limit, honours a kill request, and
releases the slot. Every caller (the build's gate, its end gate, single runs) and the dashboard use this
one client, so "one suite at a time on the machine" is enforced in one place.

## Design sections this implements

DESIGN §2.6, §2.7, §2.12, §3.4, §3.5 (queue folder).

## Files

- `src/shell/test-queue.mjs` (new), `src/shell/test-queue.test.mjs` (new)
- `src/shell/commands.mjs` only if `startLines` needs a hook for the command pid (it already takes an injected `spawn`)

## Interface

```js
queueDir({ env = process.env } = {}) → `${env.PIR_HOME ?? env.HOME}/.pir/test-queue`
createTestQueue({
  dir = queueDir(),
  owner,                  // { pid, startTime } of this process; null for a read-only client (the dashboard)
  isSameProcess,          // identity.mjs, injected
  now = Date.now,
  fs, spawn, log,
}) → {
  startQueuedLines(lines, { cwd, logPath, env, meta: { repo, run, kind, task, role, try, label }, limitMs, onSettled }) → job,
  readQueue() → { entries, slot },   // unreadable files read as null entries; changes nothing
  bump(id) → boolean,                // writes T01's bumpOrder into the entry, temp-then-rename
  requestKill(id) → boolean,         // writes kill/{id} when id holds the slot
  cancelAll() → void,                // kill this owner's running command, remove its entries and slot; synchronous (teardown runs from signal handlers)
  watchPath → dir,                   // for the caller's waker
}
job = {
  id,
  poll() → null | result,   // result: startLines' shape, or { ok: false, timedOut: true, limitMs, reason, logPath, tail }
                            //                         or { ok: false, killedByPerson: true, reason, logPath, tail }
  status() → { state: 'queued', position } | { state: 'running', since },
  cancel() → void,          // kill if running, remove the entry
}
```

Every `poll()` (any job of any owner) runs T01's `decideSlot`: removes stale entries, reaps a stale slot's
command after `isSameProcess` (never signalling a mismatched pid), and, when `next` is its own entry,
creates `slot.json` with an exclusive create, starts the lines, then rewrites the slot with the command's
pid and start time. `startLines` spawns each line in its own process group, so the slot's `command` is
rewritten at every line's start; otherwise a reap after a crash during the test line would signal the
finished setup line's group and leave the suite running. A failed exclusive create means another owner won; the job stays queued. Settling
removes `slot.json`, the entry and any kill request, then calls `onSettled`.

## Tests

- [ ] one job alone: queued → running → ok; slot and entry gone afterwards; log written
- [ ] two jobs in one process: the second runs only after the first settles, in enqueue order
- [ ] two owners in two real child processes against one scratch `PIR_HOME`, each running a line that records its start and end times: the intervals never overlap
- [ ] bump makes a later entry run before an earlier one; bump of the running entry returns false
- [ ] limit: a `sleep 5` line with limitMs 300 ends timedOut, its process group killed, slot freed
- [ ] requestKill on the running job → killedByPerson; on a waiting job → false
- [ ] a two-line job: the slot's command names the second line's process while it runs
- [ ] a slot whose owner is dead (fake isSameProcess) is reaped and the next entry runs; a mismatched command identity is not signalled but the slot is freed
- [ ] an entry whose owner is dead is removed and skipped; an unreadable entry file is removed
- [ ] cancel of a queued job removes its entry; cancel of a running job kills it and frees the slot
- [ ] cancelAll removes only this owner's entries and slot
- [ ] read-only client: readQueue, bump, requestKill work; startQueuedLines throws
- [ ] every test uses a scratch `PIR_HOME`; none touches the real `~/.pir`

## Done when

- [ ] The listed tests are green in `npm test`, the two-process test included.
- [ ] No write in `test-queue.mjs` replaces a file except temp-then-rename or the exclusive create.
- [ ] A dead holder never blocks the next entry for longer than one poll.
