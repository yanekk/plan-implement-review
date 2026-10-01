// The world-touching half of a person's `!` command (plans/bang-commands DESIGN §2.2, §2.4, §3.2): start
// one command in a folder with the person's own shell, stream its merged output back in coalesced chunks,
// stop it on request, and leave a record on disk so a host that dies mid-command lets its successor kill
// the orphan. It knows nothing of conversations or agents, and it does not plain-text or cap the output:
// the forwarder (person-inbox.mjs) applies `plainText` and the caps, so this module stays a pipe.

import { spawn as nodeSpawn } from 'node:child_process';
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { writeJsonAtomic } from './atomic-write.mjs';
import { scrubEnv } from './commands.mjs';
import { isSameProcess as isSameProcessReal, startTimeOf as startTimeOfReal } from './identity.mjs';

const FLUSH_MS = 250;
const FLUSH_BYTES = 8192;
const KILL_AFTER_MS = 3000;
// After the shell exits, how long its pipes may stay open before the end is reported anyway. A command
// that backgrounds a child (`server &`) hands that child the pipe, and 'close' would wait for it for
// ever; the person's background child is theirs, so it is left running rather than killed.
const END_GRACE_MS = 500;

// shellArgv(env) → [file, ...args]. The person's shell with `-i`, so their rc file loads and their aliases
// and functions work as in their terminal (DESIGN §2.2, measured: `zsh -ic` loads the aliases, `zsh -lc`
// does not). Only zsh and bash are trusted with `-i -c`; any other shell (fish, an unset SHELL) gets
// plain `/bin/sh -c`, whose syntax every command line written for a terminal is most likely to fit.
export function shellArgv(env = {}) {
  const sh = typeof env.SHELL === 'string' ? env.SHELL.trim() : '';
  const name = basename(sh);
  if (sh.startsWith('/') && (name === 'zsh' || name === 'bash')) return [sh, '-i', '-c'];
  return ['/bin/sh', '-c'];
}

// cutUtf8(text, maxBytes) → index: the longest prefix of `text`, in code units, whose UTF-8 length is at
// most maxBytes, never splitting a surrogate pair. Always at least one character, so a flush progresses.
function cutUtf8(text, maxBytes) {
  let bytes = 0;
  let i = 0;
  while (i < text.length) {
    const cp = text.codePointAt(i);
    const len = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    if (bytes + len > maxBytes && i > 0) break;
    bytes += len;
    i += cp > 0xffff ? 2 : 1;
  }
  return i;
}

// startShell(opts) → { id, pid, stop(reason = 'person') }
//
//   command, cwd, env      what to run, where, and the host env (scrubbed of PARALLEL_* and PIR_RUN)
//   id, to, requestId      carried into the record, so a reaper can name the command and its session
//   recordPath             written temp-then-rename on spawn, deleted on end; null writes none
//   onOutput(text)         coalesced: at most every flushMs, or at once past flushBytes, no chunk over it
//   onEnd({ code, signal, stopped, ms, error? })   exactly once. `stopped` is stop()'s reason, else null;
//                          `error` is set only when the shell could not be started (bad cwd)
//   spawn, now, startTimeOf, flushMs, flushBytes, killAfterMs   injected for the tests
//
// stdin is /dev/null (DESIGN §2.2: plain only). The shell is spawned detached, in its own process group,
// so stop() reaches whatever it forked: SIGHUP and SIGTERM to the group, then SIGKILL after killAfterMs.
export function startShell({
  command,
  cwd,
  env = process.env,
  id,
  to,
  requestId,
  recordPath = null,
  onOutput = () => {},
  onEnd = () => {},
  spawn = nodeSpawn,
  now = Date.now,
  startTimeOf = startTimeOfReal,
  flushMs = FLUSH_MS,
  flushBytes = FLUSH_BYTES,
  killAfterMs = KILL_AFTER_MS,
  endGraceMs = END_GRACE_MS,
}) {
  const t0 = now();
  const [file, ...args] = shellArgv(env);
  let pending = '';
  let flushTimer = null;
  let killTimer = null;
  let graceTimer = null;
  let stopped = null;
  let exit = null; // { code, signal } once the shell has exited
  let ended = false;
  let open = 2; // stdout and stderr, until each closes

  const emit = (text) => {
    try {
      onOutput(text);
    } catch {
      // a throwing listener must not lose the rest of the output or the end
    }
  };

  const flush = () => {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = null;
    while (pending) {
      const i = cutUtf8(pending, flushBytes);
      emit(pending.slice(0, i));
      pending = pending.slice(i);
    }
  };

  const push = (text) => {
    if (ended || !text) return;
    pending += text;
    if (Buffer.byteLength(pending) >= flushBytes) {
      // Emit only the whole chunks; the remainder waits for the timer like any small write.
      while (Buffer.byteLength(pending) >= flushBytes) {
        const i = cutUtf8(pending, flushBytes);
        emit(pending.slice(0, i));
        pending = pending.slice(i);
      }
    }
    if (pending && !flushTimer) flushTimer = setTimeout(flush, flushMs);
  };

  const groupKill = (pid, sig) => {
    try {
      process.kill(-pid, sig);
      return true;
    } catch {
      try {
        process.kill(pid, sig);
        return true;
      } catch {
        return false; // already gone
      }
    }
  };

  const groupAlive = (pid) => {
    if (!pid) return false;
    try {
      process.kill(-pid, 0);
      return true;
    } catch (e) {
      return e?.code === 'EPERM';
    }
  };

  let child;
  const finish = (result) => {
    if (ended) return;
    flush();
    ended = true;
    if (graceTimer) clearTimeout(graceTimer);
    // A stopped group may still hold a TERM-ignoring member after its shell left; the kill timer stays
    // armed only while that group still exists, so a number freed and reused is never signalled.
    if (killTimer && !(stopped && groupAlive(child?.pid))) {
      clearTimeout(killTimer);
      killTimer = null;
    } else if (killTimer) {
      killTimer.unref(); // the late SIGKILL must not keep the host alive by itself
    }
    if (recordPath) rmSync(recordPath, { force: true });
    child?.stdout?.destroy();
    child?.stderr?.destroy();
    try {
      onEnd({ ...result, stopped, ms: now() - t0 });
    } catch {
      // the end is reported once, whatever the listener does with it
    }
  };

  const maybeEnd = () => {
    if (exit && open === 0) finish(exit);
  };

  try {
    child = spawn(file, [...args, command], {
      cwd,
      env: scrubEnv(env),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
  } catch (e) {
    queueMicrotask(() => finish({ code: null, signal: null, error: e?.code ?? e?.message ?? String(e) }));
    return { id, pid: null, stop() {} };
  }

  const pid = child.pid ?? null;
  if (pid && recordPath) {
    try {
      writeJsonAtomic(recordPath, { id, to, pid, startTime: startTimeOf(pid), command, ...(requestId ? { requestId } : {}) });
    } catch {
      // without a record a crash leaves an orphan, but the command itself still runs and ends normally
    }
  }

  // stdout and stderr each get their own decoder, so a character split across reads is never mangled,
  // and both feed one buffer in arrival order: the merge the person sees in a terminal.
  for (const stream of [child.stdout, child.stderr]) {
    const decoder = new StringDecoder('utf8');
    stream.on('data', (buf) => push(decoder.write(buf)));
    stream.on('close', () => {
      push(decoder.end());
      open -= 1;
      maybeEnd();
    });
    stream.on('error', () => {});
  }
  child.on('error', (e) => {
    if (!exit) finish({ code: null, signal: null, error: e?.code ?? e?.message ?? String(e) });
  });
  child.on('exit', (code, signal) => {
    exit = { code, signal };
    if (open > 0) graceTimer = setTimeout(() => finish(exit), endGraceMs);
    maybeEnd();
  });

  return {
    id,
    pid,
    stop(reason = 'person') {
      if (ended || stopped || !pid) return;
      stopped = reason;
      // HUP first, as a closed terminal would: an interactive zsh or bash ignores TERM (measured
      // 2026-10-01: zsh -i killed only the running `sleep` of `sleep 30; echo after` and then ran
      // `echo after`, and ignored TERM outright while its rc file loaded), but exits on HUP, and bash
      // passes HUP on to the `cmd &` jobs it put in groups of their own. TERM still follows for any
      // member of the group that ignores HUP.
      groupKill(pid, 'SIGHUP');
      groupKill(pid, 'SIGTERM');
      killTimer = setTimeout(() => {
        killTimer = null;
        groupKill(pid, 'SIGKILL');
      }, killAfterMs);
    },
  };
}

// reapShells(dir, { isSameProcess, kill }) → [{ id, to, command, requestId?, killed }]
//
// For every record in `dir` a dead host left behind: SIGKILL the group when its leader is still the
// process the record names (pid and launch time, as single-run.mjs `reapCommand`), then delete the
// record. Every readable record is returned, killed or not, because the host must close that command's
// block in its session's log either way (DESIGN §2.4); `killed` says whether a live group was found.
// A corrupt record is deleted and skipped, never thrown: the reap runs on startup and must not stop it.
export function reapShells(dir, { isSameProcess = isSameProcessReal, kill = process.kill } = {}) {
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    const path = join(dir, name);
    if (name.endsWith('.tmp')) {
      rmSync(path, { force: true }); // a write torn by the crash; never a record
      continue;
    }
    if (!name.endsWith('.json')) continue;
    let rec = null;
    try {
      rec = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      rec = null;
    }
    rmSync(path, { force: true });
    if (!rec || typeof rec !== 'object' || typeof rec.id !== 'string') continue;
    let killed = false;
    if (isSameProcess(rec.pid, rec.startTime)) {
      try {
        kill(-rec.pid, 'SIGKILL');
        killed = true;
      } catch {
        try {
          kill(rec.pid, 'SIGKILL');
          killed = true;
        } catch {
          // gone between the check and the signal
        }
      }
    }
    out.push({ id: rec.id, to: rec.to, command: rec.command, ...(rec.requestId ? { requestId: rec.requestId } : {}), killed });
  }
  return out;
}
