# T01 — shell-runner

**Phase:** 1 · **Depends on:** — · **Weight:** medium

## Goal

The world-touching half of `!`: start one command in a folder with the person's shell, stream its merged
output back in chunks, stop it on request, and leave a record so a host that dies mid-command can kill the
orphan on its next start. It knows nothing of conversations or agents; T03 wires it.

## Design sections this implements

DESIGN §2.2, §2.4 (stop, record, reap), §3.2 (the shells record).

## Files

- `src/shell/person-shell.mjs` (new), `src/shell/person-shell.test.mjs` (new).
- Reuses `scrubEnv` from `src/shell/commands.mjs` and the pid+start-time check `single-run.mjs`
  `reapCommand` uses (extract a shared helper if it is not already one, without changing its behaviour).

## Interface

```js
// shellArgv(env) → [file, ...args]: ['/bin/zsh', '-i', '-c'] for zsh or bash $SHELL, else ['/bin/sh', '-c'].
export function shellArgv(env)

// Starts `command` in `cwd`. stdin /dev/null, stdout+stderr piped and merged, own process group.
// onOutput(text) is called coalesced: at most every `flushMs` (250) or `flushBytes` (8192).
// onEnd({ code, signal, stopped, ms }) once; `stopped` is 'person' when stop() caused it, else null.
// recordPath: written temp-then-rename with { id, to, pid, startTime, command, requestId? } on spawn,
// deleted on end.
export function startShell({ command, cwd, env, id, to, requestId, recordPath, onOutput, onEnd,
  spawn, now, flushMs, flushBytes, killAfterMs /* 3000 */ }) → { id, pid, stop(reason = 'person') }

// For each record in dir: kill a live group whose pid and start time match, delete the record,
// return what was reaped so the host can tell the session.
export function reapShells(dir, { isSameProcess, kill }) → [{ id, to, command, requestId? }]
```

`stop` sends SIGTERM to `-pid`, then SIGKILL after `killAfterMs` if it has not ended. Plain-texting and
caps are not here (`plainText` and T02's caps, applied by T03), so this module stays a pipe.

## Tests

- [ ] `printf 'a\nb'` in a temp dir: output arrives, `onEnd` gives `code 0`, `stopped null`.
- [ ] `exit 3` gives `code 3`; a command killed by an outside SIGKILL gives `signal 'SIGKILL'`.
- [ ] stderr and stdout both arrive, in order for a command that alternates them with pauses.
- [ ] `sleep 30` then `stop()`: ends within 1 s with `stopped 'person'`; a child that traps TERM is
      killed after `killAfterMs`; a backgrounded grandchild (`sleep 30 &`) dies with the group.
- [ ] coalescing: 10 000 small writes produce far fewer `onOutput` calls, none over `flushBytes`.
- [ ] `cwd` is honoured (`pwd`); `PARALLEL_X` and `PIR_RUN` are absent from the command's env.
- [ ] `shellArgv` for zsh, bash, fish, unset `SHELL`.
- [ ] the record exists while running and is gone after the end; `reapShells` kills a live matching
      group, skips a dead pid, skips a reused pid with another start time, deletes every record it read,
      and tolerates a corrupt record (deleted, not thrown).
- [ ] `onEnd` is called exactly once even when `stop()` is called twice or after the end.

## Done when

- [ ] `person-shell.mjs` exports the interface above and its tests pass in `npm test`.
- [ ] No orphan process survives the test file (asserted by checking each test's pid is gone).
