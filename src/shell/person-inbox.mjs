// The person's input, from the `pir` screen to a worker (plans/live-workers DESIGN §2.5–§2.8). The screen
// and the coordinator are separate processes, so the screen drops one JSON file per input into
// `control/inbox/` (dropPersonInput) and the coordinator forwards each one over the platform the moment
// it lands (startPersonInbox), outside the 5 s pass. The same module holds the per-worker "do not ask
// this worker again" grants, which the platform consults on every permission request (createGrants).
//
// Every outcome is written down so nothing the person sends disappears silently: a forwarded input is the
// worker's `dir:"out", from:"person"` log entry; one for a worker that is gone, or answering a request no
// longer pending, is an `undelivered` note in that worker's log; and every drop, delivered, undelivered or
// invalid, gets one line in the run log.

import { appendFileSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { validateDrop, grantFrom, decidePermission } from '../core/person-input.mjs';
import { allowResult, denyResult, answersResult, declineQuestionsResult } from '../core/stream.mjs';
import { AGENT_OUTPUT_CAP, LOG_OUTPUT_CAP, bangMessage, shellId } from '../core/bang.mjs';
import { plainText } from '../core/text.mjs';
import { writeJsonAtomic } from './atomic-write.mjs';
import { drainDropFolder, waitForDrop } from './drop-folder.mjs';
import { startShell as defaultStartShell, reapShells } from './person-shell.mjs';

// How long the forwarder's wait lasts when no watch event arrives. The coordinator also drains once per
// pass, so this only matters while a pass is not running; it matches the pass interval.
const BACKSTOP_MS = 5000;

export const inboxDirOf = (controlDir) => join(controlDir, 'inbox');
// Where a running `!` command's record lives, one file per session (bang-commands DESIGN §2.4, §3.2).
export const shellsDirOf = (controlDir) => join(controlDir, 'shells');

// A command's unfinished last line is held back so a split escape or `\r` overwrite is cleaned whole (T02's
// finding), but shown after this long without more output, so a prompt waiting on input is visible.
const PARTIAL_LINE_MS = 500;

// The text a session gets when a pir restart cut off the person's command in it (DESIGN §2.4).
export const cutOffMessage = (command) => `[pir] A command the person ran was cut off when pir restarted: $ ${command}`;

// ---- The screen's side. ----

// dropPersonInput(controlDir, input, { coordinatorAlive, now }) → { ok: true } | { ok: false, reason }.
// `coordinatorAlive` is the screen's verdict that the open run is `running` (the dashboard's classifyRun,
// DESIGN §2.5), a boolean or a function returning one. When it is not, nothing is written and the reason
// is `not-running`, so the view can say so and keep the typed text. An input that does not validate is
// refused with the validator's words and never written either. The file lands temp-then-rename, so the
// forwarder never reads half of it.
export function dropPersonInput(controlDir, input, { coordinatorAlive, now = Date.now } = {}) {
  const alive = typeof coordinatorAlive === 'function' ? coordinatorAlive() : coordinatorAlive === true;
  if (!alive) return { ok: false, reason: 'not-running' };
  const v = validateDrop(input);
  if (!v.ok) return { ok: false, reason: v.error };
  const name = `${now()}-${Math.random().toString(36).slice(2, 10)}.json`;
  try {
    writeJsonAtomic(join(inboxDirOf(controlDir), name), v.input);
  } catch (err) {
    return { ok: false, reason: `could not write the input: ${err?.message ?? err}` };
  }
  return { ok: true };
}

// ---- The grants (DESIGN §2.6). ----

// createGrants() → { add(workerId, grant), decide(workerId, request) }. One grant list per worker, in
// memory for the coordinator's life and never written to any settings file (user 2026-09-24). `grant` is
// core's grantFrom(request); a null grant (no `addRules` suggestion, or one Claude flagged
// suppressAlwaysAllowRule) adds nothing. decide → 'allow-by-grant' | 'ask', core's decidePermission.
export function createGrants() {
  const byWorker = new Map();
  return {
    add(workerId, grant) {
      if (!grant) return false;
      if (!byWorker.has(workerId)) byWorker.set(workerId, []);
      byWorker.get(workerId).push(grant);
      return true;
    },
    decide(workerId, request) {
      return decidePermission(byWorker.get(workerId) ?? [], request);
    },
  };
}

// ---- The person's `!` commands (bang-commands DESIGN §2.2–§2.4, §3.3). ----

// createShellTable() → the running commands of one host, outside any one forwarder: planning and single
// runs restart the forwarder when the rename moves the control folder, and a command started before the
// move must keep its `busy` check, its stop and its record (DESIGN §3.3). `running` is session id → run,
// `dir` is the shells folder as it is named now, `ctx` the newest forwarder's platform and run log, and
// `cutOff` session id → command for each reaped command whose session has not been told yet.
export function createShellTable() {
  return { running: new Map(), dir: null, ctx: null, cutOff: new Map() };
}

// appendToCommandLog(controlDir, id, entry, now) → true when written, 'closed' when the block has its end: appends `entry` to the conversation
// log holding the command's `start`, found by scanning conversations/. A reaped command's session belongs
// to the dead host, so this host's platform does not know it; the start entry is in exactly the right file
// whichever kind of session it was. The end's `ms` runs from that start.
function appendToCommandLog(controlDir, id, entry, now) {
  const dir = join(controlDir, 'conversations');
  let names = [];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith('.ndjson'));
  } catch {
    return false;
  }
  const needle = `"id":${JSON.stringify(id)}`;
  for (const name of names) {
    const path = join(dir, name);
    let text = '';
    try {
      text = readFileSync(path, 'utf8');
    } catch {
      continue;
    }
    if (!text.includes(needle)) continue;
    let startT = null;
    let closed = false;
    for (const line of text.split('\n')) {
      if (!line.includes(needle)) continue;
      try {
        const e = JSON.parse(line);
        if (e?.dir === 'shell' && e.kind === 'start' && e.id === id) startT = e.t;
        if (e?.dir === 'shell' && e.kind === 'end' && e.id === id) closed = true;
      } catch {
        // a torn line
      }
    }
    if (startT == null) continue;
    // Closed already: the host stopped it (session-closed) and exited before the command did. The block
    // keeps that end, and its session has nothing to be told.
    if (closed) return 'closed';
    const t = now();
    try {
      // A torn last line (the host died mid-append) must not swallow the end entry.
      const sep = text.length && !text.endsWith('\n') ? '\n' : '';
      appendFileSync(path, sep + JSON.stringify({ t, ...entry, ms: Number.isFinite(startT) ? Math.max(0, t - startT) : 0 }) + '\n');
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

// reapPersonShells({ controlDir, shells, now, reap, log }) → the reaped records. Called by every host at
// start, before its forwarder (DESIGN §2.4): a command a dead host left running is killed when its group
// is still the recorded one, its block closed in its session's log (`stopped: 'pir-restart'`, `sent:
// 'none'`) whether or not the session comes back, and its record deleted; the session, if it is live in
// this host later, is told by the forwarder (`cutOff`).
export function reapPersonShells({ controlDir, shells, now = Date.now, reap = reapShells, log = () => {} }) {
  let reaped = [];
  try {
    reaped = reap(shellsDirOf(controlDir)) ?? [];
  } catch (err) {
    log(`person input: shells reap failed: ${err?.message ?? err}`);
    return [];
  }
  for (const r of reaped) {
    const entry = { dir: 'shell', kind: 'end', id: r.id, code: null, signal: null, stopped: 'pir-restart', sent: 'none' };
    const closed = appendToCommandLog(controlDir, r.id, entry, now);
    if (r.to && closed !== 'closed') shells?.cutOff.set(r.to, r.command ?? '');
    log(`person input: reaped command ${r.id} of ${r.to}${r.killed ? ' (killed)' : ''}${closed === 'closed' ? ' (block already closed)' : closed ? '' : ' (no log found)'}`);
  }
  return reaped;
}

// ---- The coordinator's side. ----

// startPersonInbox({ controlDir, platform, grants, watch, log }) → { inboxDir, drain(), stop() }.
// Starts a forwarder that waits on inbox/ (drop-folder's waitForDrop, the same watcher the loop's own
// wait uses) and drains the moment a file lands; the coordinator also calls drain() once per pass as a
// backstop. drain() reads every *.json in name order, validates it, forwards it, logs the outcome and has
// already deleted it; it returns the outcomes, for the tests. `platform` is createPlatform's: send,
// interrupt, answer, pending, note, logPathOf. `log` is the run log's line writer. `onActivity()` is the
// coordinator loop's wake-up (fast-tests DESIGN §2.1): called after a forwarder drain that handled at least
// one valid input, so the pass that shows it runs now, not on the 5 s backstop. The loop's own drain()
// runs inside a pass and never calls it.
//
// The person's `!` (bang-commands DESIGN §2.2–§2.4): a `shell` drop runs through `startShell` in the
// session's folder (`platform.cwdOf`), its output logged into the session's conversation (`platform.log`),
// and at its end the agent is sent bangMessage `from: 'person'`. `shellsDir` is where the running
// command's record goes (null: no record); `shells` is the host's createShellTable, passed again when the
// forwarder is restarted on a moved control folder. stopAll(reason, to?) kills the running commands (of
// one session, or all) and closes their blocks with nothing sent; running(to) → the session's run or null.
export function startPersonInbox({
  controlDir,
  platform,
  grants = createGrants(),
  watch,
  log = () => {},
  onActivity = () => {},
  shellsDir = null,
  shells = createShellTable(),
  startShell = defaultStartShell,
  now = Date.now,
  env = process.env,
  partialLineMs = PARTIAL_LINE_MS,
}) {
  const inboxDir = inboxDirOf(controlDir);
  // The folder must exist for fs.watch to watch it; the screen's first drop would create it too late.
  mkdirSync(inboxDir, { recursive: true });
  const say = (line) => {
    try {
      log(`person input: ${line}`);
    } catch {
      /* the run log must never break forwarding */
    }
  };
  // The newest forwarder speaks for every command, a command started under an earlier one included.
  shells.dir = shellsDir;
  shells.ctx = { platform, say };

  // A session whose command a pir restart cut off is told once it is live in this host (DESIGN §2.4). A
  // build worker never comes back under its id, so its entry just stays.
  function tellCutOff() {
    for (const [to, command] of shells.cutOff) {
      try {
        if (platform.cwdOf?.(to) == null) continue;
        if (platform.send(to, cutOffMessage(command), { from: 'pir' })?.ok) shells.cutOff.delete(to);
      } catch {
        // tried again on the next drain
      }
    }
  }

  function drain() {
    tellCutOff();
    const outcomes = [];
    const values = drainDropFolder(inboxDir, {
      onBad: (name, err) => {
        say(`invalid drop ${name} deleted: ${err?.message ?? err}`);
        outcomes.push({ outcome: 'invalid', file: name, reason: String(err?.message ?? err) });
      },
    });
    for (const value of values) {
      const v = validateDrop(value);
      if (!v.ok) {
        say(`invalid drop deleted: ${v.error}`);
        outcomes.push({ outcome: 'invalid', reason: v.error });
        continue;
      }
      let result;
      try {
        result = forward(v.input);
      } catch (err) {
        // A platform failure on one input must not stop the rest, nor the watcher.
        result = { outcome: 'undelivered', reason: `forwarding failed: ${err?.message ?? err}` };
      }
      const { to, kind } = v.input;
      say(`${kind} for ${to}: ${result.outcome}${result.reason ? ` (${result.reason})` : ''}`);
      outcomes.push({ ...result, to, kind });
    }
    return outcomes;
  }

  function forward(input) {
    const { to, kind } = input;
    // An id this coordinator never spawned has no conversation log to note it in; the run log has it.
    if (platform.logPathOf(to) == null) return { outcome: 'undelivered', reason: 'no such worker in this run' };
    if (kind === 'message') {
      // The helper note rides along only when the view attached one (visible-helpers DESIGN §2.6).
      const opts = { from: 'person' };
      if (input.preface !== undefined) opts.preface = input.preface;
      if (input.helpersStopped !== undefined) opts.helpersStopped = input.helpersStopped;
      return delivered(platform.send(to, input.text, opts), 'the worker has exited');
    }
    if (kind === 'interrupt') return delivered(platform.interrupt(to, { from: 'person' }), 'the worker has exited');
    if (kind === 'shell') return runShell(input);
    if (kind === 'shell-stop') {
      const run = shells.running.get(to);
      if (!run) return { outcome: 'ignored', reason: 'no command running' };
      run.handle?.stop('person');
      return { outcome: 'delivered' };
    }

    const request = platform.pending(to).find((r) => r.requestId === input.requestId);
    // Answering what is not pending: the request was answered already (twice, or from two screens,
    // DESIGN §2.14), cancelled by an interrupt, or died with its worker.
    const wantKind = kind === 'permission' ? 'permission' : 'questions';
    if (!request || request.kind !== wantKind) {
      const reason = !request ? 'the request is no longer pending' : `the request is a ${request.kind}, not a ${wantKind}`;
      platform.note(to, 'undelivered', { what: 'reply', from: 'person', requestId: input.requestId, input: kind, reason });
      return { outcome: 'undelivered', reason };
    }

    let result;
    if (kind === 'permission') {
      result = input.decision === 'deny' ? denyResult(request, input.text) : allowResult(request);
    } else if (kind === 'answers') {
      result = answersResult(request, input.answers);
    } else {
      result = declineQuestionsResult(request, input.text);
    }
    const sent = delivered(platform.answer(to, input.requestId, result, { from: 'person' }), 'the request is no longer pending');
    if (sent.outcome === 'delivered' && kind === 'permission' && input.decision === 'allow-always') {
      grants.add(to, grantFrom(request));
      allowCoveredPending(to);
    }
    return sent;
  }

  // ---- `!`: run, stream, end. ----

  const refuse = (to, command, reason) => {
    platform.note(to, 'shell-refused', { command, reason });
    return { outcome: 'refused', reason };
  };

  function runShell({ to, command, requestId }) {
    // One at a time per session, checked here as well as in the view, so a stale screen cannot start two.
    if (shells.running.has(to)) return refuse(to, command, 'busy');
    const cwd = platform.cwdOf?.(to) ?? null;
    if (!cwd) return refuse(to, command, 'no-session');
    const id = shellId(now(), Math.random());
    const run = { id, to, command, requestId: requestId ?? null, ended: false, t0: now(), partial: '', partialTimer: null, logged: 0, clipped: false, tail: '', dropped: 0, handle: null };
    shells.running.set(to, run);
    logTo(run, { dir: 'shell', kind: 'start', id, command, cwd, ...(requestId ? { requestId } : {}) });
    try {
      run.handle = startShell({
        command,
        cwd,
        env,
        id,
        to,
        ...(requestId ? { requestId } : {}),
        recordPath: shells.dir ? join(shells.dir, `${to}.json`) : null,
        onOutput: (text) => onOutput(run, text),
        onEnd: (r) => onEnd(run, r),
      });
    } catch (err) {
      onEnd(run, { code: null, signal: null, stopped: null, ms: 0, error: String(err?.message ?? err) });
    }
    return { outcome: 'delivered' };
  }

  // Every entry goes through the newest forwarder's platform: the rename may have replaced this one.
  const logTo = (run, entry) => {
    try {
      shells.ctx.platform.log?.(run.to, entry);
    } catch {
      // a failed log write must not stop the command or its end
    }
  };

  // Plain text, then the log's 1 MB cap with one `clipped` marker; the agent's tail is kept separately and
  // bounded, so an endless `yes` costs memory for its last few tens of KB only.
  function emitClean(run, clean) {
    if (!clean) return;
    run.tail += clean;
    if (run.tail.length > 4 * AGENT_OUTPUT_CAP) {
      const chars = [...run.tail];
      if (chars.length > AGENT_OUTPUT_CAP) {
        run.dropped += chars.length - AGENT_OUTPUT_CAP;
        run.tail = chars.slice(-AGENT_OUTPUT_CAP).join('');
      }
    }
    if (run.clipped) return;
    const bytes = Buffer.byteLength(clean);
    if (run.logged + bytes <= LOG_OUTPUT_CAP) {
      run.logged += bytes;
      logTo(run, { dir: 'shell', kind: 'output', id: run.id, text: clean });
      return;
    }
    const head = utf8Prefix(clean, LOG_OUTPUT_CAP - run.logged);
    if (head) logTo(run, { dir: 'shell', kind: 'output', id: run.id, text: head });
    run.logged = LOG_OUTPUT_CAP;
    run.clipped = true;
    logTo(run, { dir: 'shell', kind: 'output', id: run.id, text: '', clipped: true });
  }

  const flushPartial = (run) => {
    if (run.partialTimer) clearTimeout(run.partialTimer);
    run.partialTimer = null;
    const p = run.partial;
    run.partial = '';
    emitClean(run, plainText(p));
  };

  // Cleaned per completed line: plainText on a chunk that splits an escape or a `\r` line gets it wrong.
  function onOutput(run, text) {
    if (run.ended) return;
    run.partial += text;
    const nl = run.partial.lastIndexOf('\n');
    if (nl >= 0) {
      const done = run.partial.slice(0, nl + 1);
      run.partial = run.partial.slice(nl + 1);
      emitClean(run, plainText(done));
    }
    if (run.partialTimer) clearTimeout(run.partialTimer);
    run.partialTimer = null;
    if (run.partial) {
      run.partialTimer = setTimeout(() => flushPartial(run), partialLineMs);
      run.partialTimer.unref?.();
    }
  }

  // The record is deleted where the folder is now: startShell's own path is the one it started under. Only
  // this command's: a later command of the same session may have written its own record there since.
  const dropRecord = (run) => {
    if (!shells.dir) return;
    const path = join(shells.dir, `${run.to}.json`);
    try {
      if (JSON.parse(readFileSync(path, 'utf8'))?.id !== run.id) return;
    } catch {
      // gone already, or torn: nothing of another command's to keep
    }
    rmSync(path, { force: true });
  };

  // `early` is stopAll's end, logged before the shell has gone: its record stays until the shell's own end
  // arrives, so a host that exits first (a command ignoring HUP and TERM, the SIGKILL 3 s away) leaves the
  // record for the next start's reap instead of an orphan nobody can find (DESIGN §2.4).
  function onEnd(run, { code = null, signal = null, stopped = null, ms, error } = {}, { early = false } = {}) {
    if (run.ended) {
      if (!early && run.recordKept) {
        run.recordKept = false;
        dropRecord(run);
      }
      return;
    }
    flushPartial(run);
    // The shell never started (the folder went away, no /bin/sh): say why, in the block and to the agent.
    if (error) emitClean(run, `pir could not start the command: ${error}\n`);
    run.ended = true;
    if (shells.running.get(run.to) === run) shells.running.delete(run.to);
    if (early) run.recordKept = true;
    else dropRecord(run);
    const elapsed = Number.isFinite(ms) ? ms : now() - run.t0;
    const { platform: p, say: sayNow } = shells.ctx;
    let sent = 'none';
    if (stopped !== 'session-closed') {
      const text = bangMessage({ command: run.command, output: run.tail, code, signal, stopped, ms: elapsed, alreadyCut: run.dropped });
      // Sent before the end entry is logged, so the entry records what the send did. The agent's reply
      // comes from another process, so it can never land between the two.
      let ok = false;
      try {
        ok = !!p.send(run.to, text, { from: 'person', shell: run.id })?.ok;
      } catch {
        ok = false;
      }
      sent = ok ? 'message' : 'undelivered';
    }
    logTo(run, { dir: 'shell', kind: 'end', id: run.id, code, signal, stopped, ms: elapsed, sent });
    sayNow(`shell ${run.id} for ${run.to} ended: ${stopped ? `stopped (${stopped})` : signal ? signal : `exit ${code}`}, sent ${sent}`);
  }

  // stopAll(reason, to?) — the session closed or the host is going (DESIGN §2.4): each running command
  // (of `to`, or every one) is signalled and its block closed now, with nothing sent, because the host may
  // be about to exit and the shell's own end would arrive too late to be logged.
  function stopAll(reason = 'session-closed', to = undefined) {
    for (const run of [...shells.running.values()]) {
      if (to !== undefined && run.to !== to) continue;
      try {
        run.handle?.stop(reason);
      } catch {
        // already gone
      }
      onEnd(run, { code: null, signal: null, stopped: reason, ms: now() - run.t0 }, { early: true });
    }
  }

  // A grant just added also covers any other request of that worker already waiting on the person: it is
  // allowed as a later one would be (DESIGN §2.6), by pir and logged `delivered-by-grant`.
  function allowCoveredPending(to) {
    for (const r of platform.pending(to)) {
      if (r.kind !== 'permission' || grants.decide(to, r) !== 'allow-by-grant') continue;
      if (platform.answer(to, r.requestId, allowResult(r), { from: 'pir' }).ok) {
        platform.note(to, 'delivered-by-grant', { requestId: r.requestId, toolName: r.toolName });
      }
    }
  }

  const delivered = (r, reason) => (r?.ok ? { outcome: 'delivered' } : { outcome: 'undelivered', reason });

  // The forwarder: wait for a drop, drain, repeat, until stop(). The wait is unref'd so it never holds the
  // coordinator's process open on its own.
  const abort = new AbortController();
  (async () => {
    drain();
    while (!abort.signal.aborted) {
      await waitForDrop(inboxDir, BACKSTOP_MS, { signal: abort.signal, unref: true, ...(watch ? { watch } : {}) });
      if (abort.signal.aborted) break;
      try {
        // An invalid drop was only deleted and logged: nothing the next pass would show.
        if (drain().some((o) => o.outcome !== 'invalid')) onActivity();
      } catch {
        /* drain already contains its own failures, and a throwing hook must never kill the forwarder */
      }
    }
  })();

  return {
    inboxDir,
    drain,
    stop() {
      abort.abort();
    },
    stopAll,
    running: (to) => shells.running.get(to) ?? null,
  };
}

// utf8Prefix(text, maxBytes) → the longest prefix of `text` whose UTF-8 length fits, never splitting a
// character.
function utf8Prefix(text, maxBytes) {
  if (maxBytes <= 0) return '';
  let bytes = 0;
  let i = 0;
  while (i < text.length) {
    const cp = text.codePointAt(i);
    const len = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    if (bytes + len > maxBytes) break;
    bytes += len;
    i += cp > 0xffff ? 2 : 1;
  }
  return text.slice(0, i);
}
