// Running a plan's declared command lines in a folder (DESIGN §2.4, §2.5).
//
// The end-of-run gate runs the setup and test lines synchronously in the feature worktree; worker setup
// runs the setup lines in the background in a task worktree, polled once per pass because runPass is
// synchronous and a blocking `npm ci` would freeze every other worker's merge and the display. Both go
// through here so they share one env scrub, one log format and one result shape.
//
// Result of a run of lines:
//   { ok: true, logPath }
//   { ok: false, line, status, signal, logPath, tail, reason }
// logPath is null when the log could not be opened; tail is the last TAIL_LINES lines of the log, ''
// when there is none.

import { spawn as nodeSpawn, execFileSync } from 'node:child_process';
import { openSync, fstatSync, readSync, closeSync, writeSync } from 'node:fs';

const TAIL_LINES = 20;

// scrubEnv(env) → a copy without PARALLEL_* and PIR_RUN. The run's own switches must not reach the
// project's suite: a project whose tests read PIR_RUN would otherwise behave as if it were the run.
export function scrubEnv(env) {
  return Object.fromEntries(Object.entries(env).filter(([k]) => !k.startsWith('PARALLEL_') && k !== 'PIR_RUN'));
}

// readLogTail(logPath, n, { fs }) → the last `n` lines of a log, or null if it cannot be read.
// A crashed run wrote why it died into run.log; showing the tail in the watch view saves the person
// opening the file (user 2026-09-22). Only the last 16 KiB is read so a long run's huge log never loads
// in full on every refresh; a partial first line from that cut is dropped so no half-line is shown.
// Moved here from pir-tui.mjs (which re-exports it) so the runner need not import the TUI.
export function readLogTail(logPath, n = 5, { fs = { openSync, fstatSync, readSync, closeSync } } = {}) {
  if (!logPath) return null;
  const MAX = 16 * 1024;
  let fd;
  try {
    fd = fs.openSync(logPath, 'r');
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, MAX);
    const buf = Buffer.alloc(len);
    if (len > 0) fs.readSync(fd, buf, 0, len, size - len);
    let text = buf.toString('utf8');
    if (len < size) text = text.slice(text.indexOf('\n') + 1); // drop the partial first line from the cut
    const lines = text.split('\n');
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    return lines.length ? lines.slice(-n) : null;
  } catch {
    return null; // no log, or unreadable — the caller simply shows none
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        // already closed / gone
      }
    }
  }
}

function openLog(logPath, flags) {
  try {
    return logPath ? openSync(logPath, flags) : null;
  } catch {
    return null; // an unwritable log must not turn a green run red
  }
}

function writeHeader(fd, line) {
  if (fd === null) return;
  try {
    writeSync(fd, `$ ${line}\n`);
  } catch {
    /* a log that stops accepting writes is not a failure of the line */
  }
}

function closeLog(fd) {
  if (fd === null) return;
  try {
    closeSync(fd);
  } catch {
    /* already closed */
  }
}

function failure(line, status, signal, cause, logPath) {
  const reason = status != null ? `\`${line}\` exited ${status}` : `\`${line}\` could not run (${cause ?? signal})`;
  const tail = (readLogTail(logPath, TAIL_LINES) ?? []).join('\n');
  return { ok: false, line, status: status ?? null, signal: signal ?? null, logPath, tail, reason };
}

// runLines(lines, { cwd, logPath, append, env }) → result. Synchronous. Each line via `/bin/sh -c`, in
// order, stopping at the first failure; each line is its own shell, so a `cd` does not carry over.
export function runLines(lines, { cwd, logPath = null, append = false, env = process.env } = {}) {
  const childEnv = scrubEnv(env);
  const fd = openLog(logPath, append ? 'a' : 'w');
  const usedLog = fd === null ? null : logPath;
  try {
    for (const line of lines) {
      writeHeader(fd, line);
      const out = fd === null ? 'ignore' : fd;
      try {
        execFileSync('/bin/sh', ['-c', line], { cwd, env: childEnv, stdio: ['ignore', out, out] });
      } catch (e) {
        return failure(line, e.status, e.signal, e.code, usedLog);
      }
    }
    return { ok: true, logPath: usedLog };
  } finally {
    closeLog(fd);
  }
}

// startLines(lines, { cwd, logPath, env, spawn }) → handle. The same semantics as runLines, in the
// background: the next line starts from the previous one's exit event. The log is rewritten per call
// (DESIGN §2.4: rewritten per attempt).
//   handle.poll() → null while running, else the result (stable once returned).
//   handle.kill() → kills the running line and its children and makes the result { ok: false,
//                   reason: 'killed' }.
// Each line is spawned detached, in its own process group, so kill() can signal the group: `npm ci`
// forks children that a signal to the shell alone would orphan.
export function startLines(lines, { cwd, logPath = null, env = process.env, spawn = nodeSpawn } = {}) {
  let result = null;
  if (lines.length === 0) {
    result = { ok: true, logPath: null };
    return { poll: () => result, kill() {} };
  }
  const childEnv = scrubEnv(env);
  const fd = openLog(logPath, 'w');
  const usedLog = fd === null ? null : logPath;
  let child = null;

  const finish = (r) => {
    if (result) return;
    result = r;
    child = null;
    closeLog(fd);
  };

  const startAt = (i) => {
    if (result) return;
    if (i >= lines.length) return finish({ ok: true, logPath: usedLog });
    const line = lines[i];
    writeHeader(fd, line);
    const out = fd === null ? 'ignore' : fd;
    let c;
    try {
      c = spawn('/bin/sh', ['-c', line], { cwd, env: childEnv, stdio: ['ignore', out, out], detached: true });
    } catch (e) {
      return finish(failure(line, null, null, e.code ?? e.message, usedLog));
    }
    child = c;
    let settled = false;
    c.on('error', (e) => {
      if (settled) return;
      settled = true;
      finish(failure(line, null, null, e.code ?? e.message, usedLog));
    });
    c.on('exit', (status, signal) => {
      if (settled) return;
      settled = true;
      if (status === 0) startAt(i + 1);
      else finish(failure(line, status, signal, null, usedLog));
    });
  };

  startAt(0);

  return {
    poll: () => result,
    kill() {
      if (result) return;
      const c = child;
      finish({ ok: false, reason: 'killed' });
      if (c?.pid) {
        try {
          process.kill(-c.pid, 'SIGKILL'); // the whole group: the shell and whatever it forked
        } catch {
          try {
            c.kill('SIGKILL');
          } catch {
            /* already gone */
          }
        }
      }
    },
  };
}
