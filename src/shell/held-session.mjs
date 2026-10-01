// Holding one Claude session at a time (single-runs DESIGN §3.2, §7), for a program that runs its
// sessions in sequence: the planning program (plan-run.mjs: planner, then reviewer) and the single
// program (single-run.mjs: builder, then reviewer). Extracted from plan-run.mjs so the second program is
// built on the same code rather than a copy.
//
// The holder owns the plumbing and nothing else: spawning a session through the build's worker line
// (startWorker), reopening one by id, closing it, workers.json, Remote Control, the grants, the platform
// the person inbox forwards through, the waker the program's loop waits on, and finding a session's
// conversation log again after a restart. What a step is called, who its session is and what it is told
// are the caller's (`roleOf`, `nameOf`, `instructionOf`); the holder decides nothing about the run.

import { randomUUID } from 'node:crypto';
import { appendFileSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stoppedOnPerson } from '../core/asking.mjs';
import { allowResult, workerActivity } from '../core/stream.mjs';
import { createWaker } from './drop-folder.mjs';
import { startTimeOf as startTimeOfReal } from './identity.mjs';
import { createGrants } from './person-inbox.mjs';
import { startWorker as startWorkerReal, writeWorkersFile } from './worker-proc.mjs';

// A stop has 4 s before `pir` sends SIGKILL (pir-plan-command DESIGN §2.16), so the session gets 1 s to
// go on its own input closing and 3 s after its SIGTERM; the reap covers anything left.
export const STOP_CLOSE = { graceMs: 1000, killMs: 3000 };

// A pending request is the session asking the person (a permission prompt or a question set).
const REQUEST_KINDS = new Set(['permission', 'questions']);

// sessionAsking(state, live) → null | 'permission' | 'questions' | 'question' (stopped-worker-asking §2.3)
//   What a step's live session is asking the person, read the same way by the row and by its clock. A
//   pending request names its kind. A stopped session (stoppedOnPerson: idle, no background job) asks a
//   plain-text 'question' only while no report of the current step is accepted: a planner idle after its
//   accepted `planned` waits on pir's checks and close, not on the person. state.accepted is cleared at
//   every step change, so when set it is always the current step's.
export function sessionAsking(state, live) {
  const activity = live?.activity;
  if (REQUEST_KINDS.has(activity?.state)) return activity.state;
  return live && stoppedOnPerson(activity) && !state.accepted ? 'question' : null;
}

// trackStoppedAt(state, views, stoppedAt, now) — the step clock's stop: for each live session, stamp
// stoppedAt[step] on the first paint that reads it asking (either rule of sessionAsking), keep the stamp
// while it stays asking, and clear it once it is not. Mutates and returns stoppedAt.
export function trackStoppedAt(state, views, stoppedAt, now) {
  for (const v of views) {
    if (!v.live) continue;
    if (sessionAsking(state, v)) stoppedAt[v.step] ??= now();
    else delete stoppedAt[v.step];
  }
  return stoppedAt;
}

// A step's conversation logs are conversations/{step}-{n}.ndjson. The step name is the caller's, so it
// is escaped rather than trusted to hold no regex character.
const logNameRe = (step) => new RegExp(`^${String(step).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)\\.ndjson$`);

// nextSessionLogPath(controlDir, step) → conversations/{step}-{n}.ndjson, n one past the highest there
// (pir-plan-command DESIGN §2.3), counted from the folder so a second session of a step never overwrites
// the first one's conversation.
export function nextSessionLogPath(controlDir, step, { readdir = readdirSync } = {}) {
  const dir = join(controlDir, 'conversations');
  let names = [];
  try {
    names = readdir(dir);
  } catch {
    names = [];
  }
  const re = logNameRe(step);
  let max = 0;
  for (const n of names) {
    const m = re.exec(n);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return join(dir, `${step}-${max + 1}.ndjson`);
}

// findSessionLog(controlDir, step, sessionId) → the conversation log a session wrote, or null: the
// highest-n {step}-{n} log whose `init` carries that session id. A resumed session appends to it, so
// the person reads one conversation (pir-plan-command DESIGN §2.3, §2.14).
export function findSessionLog(controlDir, step, sessionId, { readdir = readdirSync, readFile = readFileSync } = {}) {
  const dir = join(controlDir, 'conversations');
  let names = [];
  try {
    names = readdir(dir);
  } catch {
    return null;
  }
  const re = logNameRe(step);
  const logs = names
    .map((name) => ({ name, n: Number(re.exec(name)?.[1] ?? NaN) }))
    .filter((l) => Number.isFinite(l.n))
    .sort((a, b) => b.n - a.n);
  const needle = `"session_id":${JSON.stringify(sessionId)}`;
  for (const l of logs) {
    let text = '';
    try {
      text = readFile(join(dir, l.name), 'utf8');
    } catch {
      continue;
    }
    if (text.includes(needle)) return { logPath: join(dir, l.name), n: l.n };
  }
  return null;
}

// stepWorkedMs(logs) → how long a finished step's sessions worked, in ms, from their conversation logs'
// `t` stamps, or null when no log has two stamps. A resumed session appends to the log it exited in
// after a `resumed` note, so each log is cut into segments at those notes and the time between a stop
// and its resume is not counted, as the task rows' clocks do not count time nobody was working (T14,
// user 2026-09-26: a finished step shows how long it took, as the prototype does). Pure: `logs` is one
// array of parsed entries per log.
export function stepWorkedMs(logs) {
  let total = 0;
  let any = false;
  for (const entries of logs) {
    let first = null;
    let last = null;
    const close = () => {
      if (first != null && last != null && last > first) {
        total += last - first;
        any = true;
      }
      first = last = null;
    };
    for (const e of entries) {
      if (e?.dir === 'note' && e.kind === 'resumed') close();
      if (!Number.isFinite(e?.t)) continue;
      first ??= e.t;
      last = e.t;
    }
    close();
  }
  return any ? total : null;
}

// readLogEntries(path) → a conversation log's entries, the lines that parse; a missing log reads as none.
export function readLogEntries(path, { readFile = readFileSync } = {}) {
  let text = '';
  try {
    text = readFile(path, 'utf8');
  } catch {
    return [];
  }
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // a torn last line of a killed session: skipped
    }
  }
  return out;
}

// createSessionHolder(opts) → the holder. opts:
//   controlDir()      the control folder, re-read on every use: it moves at the rename
//   cwd()             the sessions' working directory, the run's worktree under its current name
//   taskLabel         the workers.json `task` field ('plan', 'single')
//   roleOf(step)      the workers.json `role` and the word in the program's log ('planner', 'builder', …)
//   nameOf(step)      the session name
//   instructionOf(step)  the opening instruction of a fresh session; a resumed one is sent none
//   remote            Remote Control on for each session's whole life
//   env               null, or variables merged over process.env as the session's whole environment (the
//                     SDK's Options.env replaces rather than merges), or a function returning either,
//                     read at each spawn. The holder does not know what they are for.
//   claudePath, log, now, uuid, startWorker, startTimeOf
//   onSessionExit(id)  called when a session's process exits: the host kills the person's command still
//                     running in it (bang-commands DESIGN §2.4)
// It returns:
//   sessions          [{ id, step, n, logPath, worker, live, startTime }], in spawn order, earlier
//                     programs' first. The records are the holder's own: a caller reads them.
//   since             { [step]: ms } — when that step's latest session was started or reopened
//   load(stateSessions, steps)   list an earlier program's sessions (a resume), closed, with their logs
//   spawn(step, resumeSessionId = null) → rec
//   closeCurrent(opts) → Promise
//   current() → rec | null
//   activity(rec = current()) → 'none' | 'exited' | the worker's activity state
//   views() → [{ id, step, n, logPath, cwd, live, activity }], what sessionAsking and a snapshot read
//   workedMs(step) → stepWorkedMs over that step's logs
//   controlMoved(from, to)   re-point the log paths and rewrite workers.json after the folder moved
//   platform          send/interrupt/answer/pending/note/logPathOf/cwdOf/log, for startPersonInbox
//   waker, grants
export function createSessionHolder({
  controlDir,
  cwd,
  taskLabel,
  roleOf,
  nameOf,
  instructionOf,
  remote = true,
  claudePath,
  log = () => {},
  now = Date.now,
  uuid = randomUUID,
  startWorker = startWorkerReal,
  startTimeOf = startTimeOfReal,
  env: extraEnv = null,
  onSessionExit = () => {},
}) {
  const sessions = [];
  const since = {};
  let current = null;
  // Wakes on a drop in a watched folder, any entry in the live session's log, its exit, or a stop; the
  // shared waker (drop-folder.mjs) with no pass gap.
  const waker = createWaker();
  const grants = createGrants();
  const byId = (id) => sessions.find((s) => s.id === id) ?? null;
  const workerOf = (id) => byId(id)?.worker ?? null;

  const writeWorkers = () => {
    try {
      writeWorkersFile(
        controlDir(),
        sessions.filter((s) => s.live).map((s) => ({ id: s.id, task: taskLabel, role: roleOf(s.step), pid: s.worker.pid, startTime: s.startTime, cwd: cwd() })),
      );
    } catch (err) {
      log(`workers.json write failed: ${err?.message ?? err}`);
    }
  };

  const platform = {
    send: (id, text, opts) => ({ ok: !!workerOf(id)?.send(text, opts) }),
    interrupt: (id, opts) => {
      const w = workerOf(id);
      if (!w) return { ok: false };
      w.interrupt(opts).catch(() => {});
      return { ok: byId(id).live };
    },
    answer: (id, requestId, result, opts) => ({ ok: !!workerOf(id)?.answer(requestId, result, opts) }),
    pending: (id) => (byId(id)?.live ? byId(id).worker.pending() : []),
    note: (id, kind, fields) => {
      const w = workerOf(id);
      if (!w) return { ok: false };
      w.note(kind, fields);
      return { ok: true };
    },
    logPathOf: (id) => byId(id)?.logPath ?? null,
    // The run's one worktree, under its current name, while the session is live (bang-commands §2.2).
    cwdOf: (id) => (byId(id)?.live ? cwd() : null),
    // log(id, entry) → the entry as written to that session's conversation, or null. A live session logs
    // through its worker; a closed one is appended to by path, because the path is re-pointed when the
    // rename moves the control folder and a closed worker's own path is not (a command stopped at the
    // planner's close ends after the move).
    log: (id, entry) => {
      const s = byId(id);
      if (!s) return null;
      if (s.live && s.worker?.logEntry) return s.worker.logEntry(entry);
      if (!s.logPath) return null;
      const full = { t: now(), ...entry };
      try {
        appendFileSync(s.logPath, JSON.stringify(full) + '\n');
      } catch {
        return null;
      }
      return full;
    },
  };

  // A session from an earlier program is listed closed, with its log, so the screen can still open its
  // conversation; a resumed one is taken up again in the same record.
  const load = (stateSessions, steps) => {
    for (const step of steps) {
      for (const id of stateSessions?.[step] ?? []) {
        const found = findSessionLog(controlDir(), step, id);
        sessions.push({ id, step, n: found?.n ?? null, logPath: found?.logPath ?? null, worker: null, live: false, startTime: null });
      }
    }
  };

  // spawn(step, resumeSessionId?) → a fresh session with its opening instruction, or the step's last
  // session reopened (pir-plan-command DESIGN §2.14): same id, same worktree, the same log after a
  // `resumed` note, and no opening instruction; the caller sends it what a resumed session is told.
  const spawn = (step, resumeSessionId = null) => {
    const prior = resumeSessionId ? byId(resumeSessionId) : null;
    const id = resumeSessionId ?? uuid();
    let logPath = prior?.logPath ?? null;
    if (!logPath) logPath = nextSessionLogPath(controlDir(), step);
    const n = prior?.n ?? Number(/-(\d+)\.ndjson$/.exec(logPath)[1]);
    const extra = typeof extraEnv === 'function' ? extraEnv() : extraEnv;
    const worker = startWorker({
      cwd: cwd(),
      ...(resumeSessionId ? { resume: id } : { sessionId: id }),
      name: nameOf(step),
      logPath,
      claudePath,
      ...(extra ? { env: { ...process.env, ...extra } } : {}),
    });
    const rec = prior ?? { id, step, n, logPath, worker: null, live: false, startTime: null };
    Object.assign(rec, { n, logPath, worker, live: true });
    rec.startTime = worker.pid ? startTimeOf(worker.pid) : null;
    if (!prior) sessions.push(rec);
    current = rec;
    since[step] = now();
    worker.onEvent((entry) => {
      // The same grants as a build worker (pir-plan-command DESIGN §2.3): a request a "do not ask
      // again" covers is allowed by pir at once. A question set is never answered by a grant.
      if (entry.dir === 'request' && entry.toolName !== 'AskUserQuestion') {
        const request = { toolName: entry.toolName, input: entry.input };
        if (grants.decide(id, request) === 'allow-by-grant') {
          queueMicrotask(() => {
            if (worker.answer(entry.requestId, allowResult(request), { from: 'pir' })) {
              worker.note('delivered-by-grant', { requestId: entry.requestId, toolName: entry.toolName });
            }
          });
        }
      }
      waker.wake();
    });
    worker.onExit(() => {
      if (rec.worker === worker) rec.live = false;
      writeWorkers();
      try {
        if (rec.worker === worker) onSessionExit(id);
      } catch {
        /* the host's own failure must not break the exit path */
      }
      waker.wake();
    });
    writeWorkers();
    if (resumeSessionId) worker.note('resumed', { sessionId: id });
    else worker.send(instructionOf(step), { from: 'pir' });
    // On for the session's whole life, a resumed one included; close() switches it off first.
    if (remote) worker.remoteControl(true).catch(() => {});
    log(`${roleOf(step)} ${resumeSessionId ? 'resumed' : 'started'}: session ${id}, log ${logPath}`);
    return rec;
  };

  const closeCurrent = async (opts) => {
    const rec = current;
    current = null;
    if (!rec) return;
    await rec.worker.close(opts).catch(() => {});
    rec.live = false;
    writeWorkers();
    log(`${roleOf(rec.step)} closed: session ${rec.id}`);
  };

  const activity = (rec = current) => {
    if (!rec) return 'none';
    if (!rec.live) return 'exited';
    return workerActivity(rec.worker.entries()).state;
  };

  // Every session runs in the run's one worktree, named as it is now, so a session whose folder the
  // rename moved still names where its work is.
  const views = () =>
    sessions.map((s) => ({
      id: s.id, step: s.step, n: s.n, logPath: s.logPath, cwd: cwd(), live: s.live,
      activity: s.worker ? workerActivity(s.worker.entries()) : { state: 'exited' },
    }));

  const workedMs = (step) => {
    const paths = [...new Set(sessions.filter((s) => s.step === step && s.logPath).map((s) => s.logPath))];
    return stepWorkedMs(paths.map((p) => readLogEntries(p)));
  };

  // Called between sessions: a worker appends to its log by path, so a session live across the move
  // would lose its log.
  const controlMoved = (from, to) => {
    const oldPrefix = from + '/';
    for (const s of sessions) if (s.logPath?.startsWith(oldPrefix)) s.logPath = join(to, s.logPath.slice(oldPrefix.length));
    writeWorkers();
  };

  return { sessions, since, load, spawn, closeCurrent, current: () => current, activity, views, workedMs, controlMoved, platform, waker, grants };
}
