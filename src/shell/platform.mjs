// The platform the coordinator loop injects (plans/live-workers DESIGN §2.1, §2.2, §3.2): the worker
// report inbox and the live workers themselves. Since live-workers T05 every worker is a stream-json
// child of this process, started and held by worker-proc.mjs through the Agent SDK; the `claude --bg`
// sessions, `claude agents --json` listing, `claude stop` and `claude rm` are gone from this file. A
// worker is live while its process has not exited, and its id is the session uuid pir chose, so the
// listed id and the spawned id are one and the same.
//
// The line down is back (DESIGN §1 Stance, user 2026-09-24): the rule "the coordinator routes nothing
// to a worker" is withdrawn. send / interrupt / answer go straight into a worker's input queue or its
// pending `canUseTool` promise, and every one is recorded in its conversation log. Nothing passes
// through a model, which is what the old relay's rule guarded against.
//
// The UP-channel is unchanged: a worker drops a one-line report into the control folder's `reports/`
// drop-dir, and the injected transport drains it. This module owns the report format; the transport
// owns the file-moving (the reports drain in the bin, a fake in the tests).
//
// The payload field is `text`, not the `body` the T07 interface sketch named. loop.mjs and the fake
// platform both carry it as `text` (`m.text`), so inbox() returns `text` to be the drop-in the loop
// already consumes. The four logical fields — from, kind, task, text — are all present.

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseAgentName } from '../core/naming.mjs';
import { allowResult, workerActivity } from '../core/stream.mjs';
import { startTimeOf as startTimeOfReal } from './identity.mjs';
import { startWorker as realStartWorker, writeWorkersFile } from './worker-proc.mjs';

// --- The wire format --------------------------------------------------------------------------
//
// A worker's report is a single free-text field, so a structured { kind, task, text } is packed into
// one string with a header line and unpacked on receipt. The sender's identity (`from`) is supplied
// by the transport (the drop-dir filename / stamp), not the header, because it must not be forgeable
// from inside the body. The header version tag lets the format change later without a silent
// mis-parse. A report with no recognisable header is not dropped: it is read as a plain message (kind
// `message`) whose task is inferred from the sender's name, so a human note still arrives structured.
// encodeMessage is the canonical spec of what a worker writes into a report; inbox() is the reader.

const HEADER = /^\[pir:v1 kind=(\S+) task=(\S+)\]$/;

// The message kinds the coordinator loop's state machine acts on (loop.mjs applyMessages): a worker
// signals `implemented` / `done` to advance a task, or `question` / `decision` / `conflict` to park it
// and surface it to the user (DESIGN §2.5). `pir-worker` is taught to send exactly these as the
// [pir:v1 …] header; PROSE_KIND below is the safety net for a worker that forgets the header.
const KINDS = ['question', 'decision', 'implemented', 'done', 'conflict'];

// The header is the contract (pir-worker emits it), but a real `claude` worker is a language model and
// may still send natural language — the T10 drill's worker wrote "T01 question (kind: question) — …"
// instead of the header, and parseMessage read it as a plain `message` the loop then ignored (T12
// Problem 3). So when there is no valid header, look for an EXPLICIT kind marker (`kind: question`,
// `kind=question`) anywhere in the text. Only an explicit `kind` token counts — a bare word like
// "done" in prose must not be mistaken for a state signal — so a plain human note still parses as
// `message`, never guessed into a wrong kind.
const PROSE_KIND = new RegExp(`\\bkind\\s*[:=]\\s*["']?(${KINDS.join('|')})\\b`, 'i');

// encodeMessage({ kind, task, text }) → the wire string. task is a full id ("T05") or absent; a
// missing task is written "-" and recovered from the sender's name at parse time.
export function encodeMessage({ kind, task, text = '' } = {}) {
  return `[pir:v1 kind=${kind} task=${task ?? '-'}]\n${text}`;
}

// parseMessage({ from, text }) → { from, kind, task, text }. The inverse of encodeMessage, with
// `from` (the transport's stamp) filled straight through and the task falling back to the sender's
// parsed name when the header carried none. A body that does not match the header is a plain
// message, never guessed into a wrong kind.
export function parseMessage({ from = null, text = '' } = {}) {
  const nl = text.indexOf('\n');
  const head = nl === -1 ? text : text.slice(0, nl);
  const body = nl === -1 ? '' : text.slice(nl + 1);
  const m = head.match(HEADER);
  if (m) {
    const task = m[2] === '-' ? parseAgentName(from).task : m[2];
    return { from, kind: m[1], task, text: body };
  }
  // No header: the safety net (T12 Problem 3). An explicit `kind:` / `kind=` marker in the prose is
  // honoured; the task falls back to any T-id in the text, then to the sender's parsed name. The
  // whole text is kept as the body since there was no header line to strip.
  const prose = text.match(PROSE_KIND);
  if (prose) {
    const idInText = text.match(/\bT\d+\b/);
    const task = idInText ? idInText[0] : parseAgentName(from).task;
    return { from, kind: prose[1].toLowerCase(), task, text };
  }
  return { from, kind: 'message', task: parseAgentName(from).task, text };
}

// --- The inbox surface the loop calls ---------------------------------------------------------
//
// createMessaging({ transport }) → { inbox }, the up-channel half of the platform object the loop
// injects (DESIGN §2.2, §3.4). It binds the wire format to a transport that only reads:
//   transport.drain() → [{ from, text }]     // the worker reports received since the last drain
// so the file-moving stays outside this module (the reports drop-dir drain in the bin, a fake in the
// dry run) while the format and addressing stay in it. The line down to a worker is createPlatform's
// send, not this module's: a report file is read-only traffic.
export function createMessaging({ transport } = {}) {
  return {
    // inbox() → the received reports, each parsed from the wire. Drop-in for the loop's
    // platform.inbox() (DESIGN §3.4): same { from, kind, task, text } shape as the fake.
    inbox() {
      const raw = transport?.drain?.() ?? [];
      return raw.map(parseMessage);
    },
  };
}

// --- The live workers: spawn / list / close / send / interrupt / answer (live-workers T05) -------

// Which stock skill the coordinator's opening instruction names, per the phase the loop hands spawn.
// The loop passes 'implement' | 'review' (loop.mjs); the worker runs exactly that under the
// pir-worker contract (skills/pir-worker). These two phases are the whole set now (§2.5); any other
// phase is rejected by openingInstruction below rather than mapped.
const SKILL_FOR = { implement: 'pir-implement', review: 'pir-review' };

// openingInstruction(phase, task, note = null) → the first-turn prompt a freshly spawned worker reads. It engages
// the pir-worker contract (so the fresh session knows it was given its task, never runs pir-work and
// never self-selects one, §2.1) and names the single phase+task it must carry out. It deliberately
// does not tell the worker how the run is orchestrated — the worker's world is its one task and the
// person it asks when stuck (§2.2); "coordinator" is a word the worker never needs. spawn pushes it as
// the worker's first user message, not an argument (live-workers DESIGN §2.1). A `note` (the
// setup-failure note, DESIGN §2.4) is appended after one blank line; without one the string is
// unchanged, so a worker whose setup succeeded reads exactly what it always did.
export function openingInstruction(phase, task, note = null) {
  const skill = SKILL_FOR[phase];
  if (!skill) throw new Error(`openingInstruction: unknown phase "${phase}"`);
  if (!task) throw new Error('openingInstruction: no task (the name did not parse to a task id)');
  const base =
    'You are a worker session in a parallel PIR run. You have been given one task and one phase to ' +
    'carry out — you did not choose it, so do not run pir-work and do not pick your own task. Invoke ' +
    'the pir-worker skill and follow its contract, then carry out exactly this instruction and nothing ' +
    `else: ${skill} ${task}`;
  return note ? `${base}\n\n${note}` : base;
}


// resolveClaudePath() → the absolute path of the installed `claude`, resolved once at coordinator start
// (DESIGN §2.1): workers run the Claude the person runs, never the SDK's bundled binary, which is not
// installed (`omit=optional`). Throws when there is none, so a run fails before its first spawn.
export function resolveClaudePath({ exec = execFileSync } = {}) {
  let out = '';
  try {
    out = exec('/bin/sh', ['-c', 'command -v claude'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    out = '';
  }
  const path = String(out).trim();
  if (!path) throw new Error('no `claude` on PATH: workers run the installed Claude Code (DESIGN §2.1)');
  return path;
}

// nextLogPath(controlDir, task, role, { readdir }) → conversations/{Txx}-{role}-{n}.ndjson (DESIGN §2.3),
// n one past the highest existing file for that task and role. Counting from the folder, not from memory,
// is what makes a restarted run continue the count instead of overwriting the last run's conversation.
export function nextLogPath(controlDir, task, role, { readdir = readdirSync } = {}) {
  const dir = join(controlDir, 'conversations');
  const re = new RegExp(`^${task}-${role}-(\\d+)\\.ndjson$`);
  let names = [];
  try {
    names = readdir(dir);
  } catch {
    names = [];
  }
  let max = 0;
  for (const n of names) {
    const m = re.exec(n);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return join(dir, `${task}-${role}-${max + 1}.ndjson`);
}

// logCounter(logPath) → the `n` of a conversations/{Txx}-{role}-{n}.ndjson path, or null.
function logCounter(logPath) {
  const m = /-(\d+)\.ndjson$/.exec(logPath ?? '');
  return m ? Number(m[1]) : null;
}

// A worker waiting on the person — a permission request or a question set — is parked, not busy
// (DESIGN §2.4), exactly as a question report parks it; so is one whose last turn has ended. `starting`
// (nothing said yet, the opening instruction not yet taken) counts as busy: it has work in hand.
const NOT_BUSY = new Set(['idle', 'permission', 'questions']);

// createPlatform({ root, controlDir, transport, startWorker, uuid, claudePath, startTimeOf, grants }) → the
// platform object the loop injects. Every worker is a child of this process, so the platform holds them
// all and list() is its own memory, current the moment a child exits: no listing lags behind, no id
// differs between spawn and list. `startWorker` is worker-proc's, injected so the tests run it against
// the fake `claude`; `startTimeOf` stamps workers.json so a reused pid is never mistaken for a worker
// (DESIGN §2.12). `grants` is person-inbox's createGrants (T07): every permission request a worker makes
// is checked against that worker's grants first, and one they cover is allowed by pir at once and logged
// `delivered-by-grant`, so it never shows as pending. `root` is kept for callers that pass it; nothing
// here needs the repo any more.
export function createPlatform({
  controlDir = null,
  transport,
  startWorker = realStartWorker,
  uuid = randomUUID,
  claudePath = null,
  startTimeOf = startTimeOfReal,
  grants = null,
} = {}) {
  const messaging = createMessaging({ transport });
  const live = new Map(); // id → record, while the child has not exited
  const gone = new Map(); // id → record, after exit: its log still takes the `undelivered` notes
  const order = []; // every record, in spawn order: the screen opens a task's finished workers too
  let claude = claudePath;

  // control/workers.json lists exactly the live children, rewritten on every spawn and exit (DESIGN
  // §2.12) so a coordinator killed outright leaves the pids its successor must reap (T06).
  const writeWorkers = () => {
    if (!controlDir) return;
    try {
      writeWorkersFile(controlDir, [...live.values()]);
    } catch {
      // A failed write must not throw out of an exit listener or a pass; the next spawn or exit rewrites it.
    }
  };

  const recordOf = (id) => live.get(id) ?? gone.get(id) ?? null;

  // A `request` entry is logged before worker-proc parks the request on its promise, both inside the one
  // synchronous canUseTool call, so the answer waits a microtask for the request to be pending. Nothing
  // else runs in between, so no list() can see it pending. A question set is never answered by a grant.
  const answerByGrant = (id, worker, entry) => {
    if (entry.dir !== 'request' || entry.toolName === 'AskUserQuestion') return;
    const request = { toolName: entry.toolName, input: entry.input };
    if (grants.decide(id, request) !== 'allow-by-grant') return;
    queueMicrotask(() => {
      if (worker.answer(entry.requestId, allowResult(request), { from: 'pir' })) {
        worker.note('delivered-by-grant', { requestId: entry.requestId, toolName: entry.toolName });
      }
    });
  };

  return {
    // spawn({ cwd, name, phase, note }) → id. The id is a uuid pir chose and passes as the session id,
    // so it is the worker's id everywhere (DESIGN §2.1). The opening instruction is the first user message.
    spawn({ cwd, name, phase, note = null }) {
      if (!controlDir) throw new Error('spawn: the platform was built without a control folder');
      const { task } = parseAgentName(name);
      const text = openingInstruction(phase, task, note);
      claude ??= resolveClaudePath();
      const id = uuid();
      const logPath = nextLogPath(controlDir, task, phase);
      const worker = startWorker({ cwd, sessionId: id, name, logPath, claudePath: claude });
      const rec = { id, worker, name, cwd, task, role: phase, logPath, pid: worker.pid, startTime: null };
      rec.startTime = rec.pid ? startTimeOf(rec.pid) : null;
      live.set(id, rec);
      order.push(rec);
      if (grants) worker.onEvent((entry) => answerByGrant(id, worker, entry));
      worker.onExit(() => {
        live.delete(id);
        gone.set(id, rec);
        writeWorkers();
      });
      writeWorkers();
      worker.send(text, { from: 'pir' });
      return id;
    },

    // list() → every live child with its activity folded from its own log (DESIGN §2.4). A worker that
    // exited is gone at once, which the loop reads as dead, as it read a vanished session before.
    list() {
      return [...live.values()].map((rec) => {
        const activity = workerActivity(rec.worker.entries());
        return {
          id: rec.id,
          pid: rec.pid,
          name: rec.name,
          cwd: rec.cwd,
          status: NOT_BUSY.has(activity.state) ? 'idle' : 'busy',
          state: activity.state,
          live: true,
          task: rec.task,
          role: rec.role,
          activity,
        };
      });
    },

    // close(id, { immediate }) → { ok }. Fire-and-forget, because the loop's pass is synchronous (DESIGN
    // §2.12): end the input queue, then SIGTERM at 5 s and SIGKILL at 10 s on the pid (worker-proc). The
    // child stays in list() until it has actually exited, which is why the loop still remembers the ids
    // it closed. `immediate` is teardownRun's: it runs from a signal handler just before process.exit,
    // so the SIGTERM is sent now, synchronously; the escalation left behind never runs, and a survivor
    // is reaped from workers.json (T06). Closing an exited or unknown id is a no-op.
    close(id, { immediate = false } = {}) {
      const rec = live.get(id);
      if (!rec) return { ok: true };
      rec.worker.close(immediate ? { graceMs: 0 } : undefined).catch(() => {});
      if (immediate && rec.pid) {
        try {
          process.kill(rec.pid, 'SIGTERM');
        } catch {
          // already gone
        }
      }
      return { ok: true };
    },

    // remove(id) → { ok: true }. A no-op: a child leaves no session record behind to clear (the
    // `claude rm` of the --bg days). Kept so the loop's finish paths need no platform check.
    remove() {
      return { ok: true };
    },

    inbox: messaging.inbox,

    // send(id, text, { from }) → { ok }. A user message into the worker's input queue, taken into the
    // open turn if one is running (DESIGN §2.2). A dead worker logs it `undelivered`; an unknown id has
    // no log to write to.
    send(id, text, { from = 'pir' } = {}) {
      const rec = recordOf(id);
      if (!rec) return { ok: false };
      return { ok: rec.worker.send(text, { from }) };
    },

    // interrupt(id, { from }) → { ok }. The SDK's interrupt() (DESIGN §2.8); its acknowledgement arrives
    // later, so ok means it was sent. A failure after sending is logged `undelivered` by the worker.
    interrupt(id, { from = 'person' } = {}) {
      const rec = recordOf(id);
      if (!rec) return { ok: false };
      // On an exited worker this only logs `undelivered` (worker-proc checks before it sends).
      rec.worker.interrupt({ from }).catch(() => {});
      return { ok: live.has(id) };
    },

    // answer(id, requestId, result, { from }) → { ok }. Resolves that worker's pending `canUseTool` with a
    // PermissionResult built by core/stream.mjs; a request no longer pending is logged `undelivered`.
    answer(id, requestId, result, { from = 'person' } = {}) {
      const rec = recordOf(id);
      if (!rec) return { ok: false };
      return { ok: rec.worker.answer(requestId, result, { from }) };
    },

    // workers() → every worker this platform spawned, live or exited, in spawn order, each with its
    // activity folded from its log: { id, task, role, n, logPath, live, activity }. Read-only, unlike the
    // loop's list(), so the run state can call it for the screen without touching the pass (live-workers
    // T09). `n` is the log's counter (DESIGN §2.3), so it continues a restarted run's count.
    workers() {
      return [...order].map((rec) => ({
        id: rec.id,
        task: rec.task,
        role: rec.role,
        n: logCounter(rec.logPath),
        logPath: rec.logPath,
        live: live.has(rec.id),
        activity: workerActivity(rec.worker.entries()),
      }));
    },

    // pending(id) → the worker's unanswered requests, as core/stream.mjs reads them (`kind` permission or
    // questions, `requestId`, `toolName`, `input`, `suggestions`, …). An exited or unknown worker has none.
    pending(id) {
      return live.get(id)?.worker.pending() ?? [];
    },

    // note(id, kind, fields) → { ok }. A `note` entry in the worker's log, live or exited (the person
    // inbox's `undelivered`, T07); an unknown id has no log.
    note(id, kind, fields = {}) {
      const rec = recordOf(id);
      if (!rec) return { ok: false };
      rec.worker.note(kind, fields);
      return { ok: true };
    },

    // logPathOf(id) → the worker's conversation log, live or exited; null for an id never spawned here.
    logPathOf(id) {
      return recordOf(id)?.logPath ?? null;
    },
  };
}
