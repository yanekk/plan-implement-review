// The coordinator agent held as a live session (pir-coordinator DESIGN §2.3, §2.5, §2.7, §2.8, §2.11,
// §3.4, §3.5). One object the run talks to: brief the agent, drain its decision files, check them with
// the rulebook (core/coordinator-policy.mjs), apply them through the same platform calls the person's
// answers use, refuse the bad ones with a message back, keep the ledger, keep its Remote Control on, and
// resume it after an exit or a pir restart.
//
// The agent only ever decides; this module applies. The agent is a session like any worker, started
// through worker-proc's `startWorker` (DESIGN §7: no second session holder), fenced by three things:
// a `tools` allowlist, `permissionMode: 'default'` so every tool outside the measured read-only
// exceptions reaches `canUseTool`, and the `decide` gate below, which answers every request itself and
// never parks one for the person.

import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, realpathSync, statSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readDecision, checkDecision, describeItem } from '../core/coordinator-policy.mjs';
import { briefFor, refusalFor, answeredElsewhereFor, closedWhy, openingFor, resumedFor, endBriefFor, timedOutFor, holdWords } from '../core/coordinator-brief.mjs';
import { readEntry, DEFAULT_REFUSAL } from '../core/stream.mjs';
import { writeJsonAtomic } from './atomic-write.mjs';

// DESIGN §3.4. The allowlist is what actually holds (T00); `disallowedTools` is the second fence.
export const AGENT_TOOLS = ['Read', 'Glob', 'Grep', 'Write', 'Skill'];
export const AGENT_DISALLOWED = ['Bash', 'Edit', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Task', 'Agent'];

// DESIGN §2.11: resumed after each of the first three exits within an hour; the fourth gives it up.
const RESTART_WINDOW_MS = 60 * 60 * 1000;
const MAX_RESTARTS = 3;

// canonical(p) → the real path of `p`, whether or not it exists yet: the nearest existing ancestor is
// resolved through realpath and the rest appended. A cwd under /tmp reaches the CLI as /private/tmp
// (FINDINGS 2026-09-27), and a Write's target does not exist yet, so both sides are compared this way.
function canonical(p) {
  let head = resolve(p);
  const rest = [];
  for (;;) {
    try {
      return join(realpathSync(head), ...rest);
    } catch {
      const up = dirname(head);
      if (up === head) return resolve(p);
      rest.unshift(basename(head));
      head = up;
    }
  }
}

const within = (p, root) => p === root || p.startsWith(root.endsWith(sep) ? root : root + sep);
const strictlyWithin = (p, root) => p !== root && within(p, root);

// A `..` after the first glob segment (`**/../../etc/*`) is outside what the prefix check sees, so a
// pattern holding one is refused outright (review T03).
const climbsAfterGlob = (pattern) => {
  const segs = pattern.split('/');
  const first = segs.findIndex((s) => /[*?[\]{}]/.test(s));
  return first !== -1 && segs.slice(first).includes('..');
};

// The static prefix of a glob pattern: its path segments up to the first one with a glob character.
function globPrefix(pattern) {
  const segs = pattern.split('/');
  const keep = [];
  for (const s of segs) {
    if (/[*?[\]{}]/.test(s)) break;
    keep.push(s);
  }
  return keep.join('/') || (pattern.startsWith('/') ? '/' : '.');
}

// gateFor({ cwd, readRoots, decisionsDir }) → decide(toolName, input) → 'allow' | 'deny' (DESIGN §3.4).
// Never null: nothing the agent asks for is parked for the person. Every path is resolved against the
// agent's cwd and canonicalised before comparing, so neither `..` nor a symlinked /tmp can escape.
export function gateFor({ cwd, readRoots, decisionsDir }) {
  const roots = readRoots.map(canonical);
  const drop = canonical(decisionsDir);
  const readable = (p) => {
    const c = canonical(isAbsolute(p) ? p : resolve(cwd, p));
    return roots.some((r) => within(c, r));
  };
  const str = (v) => typeof v === 'string' && v !== '';

  return function decide(toolName, input) {
    const i = input && typeof input === 'object' ? input : {};
    switch (toolName) {
      case 'Read':
        return str(i.file_path) && readable(i.file_path) ? 'allow' : 'deny';
      case 'Glob': {
        const base = str(i.path) ? i.path : cwd;
        if (!readable(base)) return 'deny';
        if (!str(i.pattern)) return 'allow';
        if (climbsAfterGlob(i.pattern)) return 'deny';
        const prefix = globPrefix(i.pattern);
        return readable(isAbsolute(prefix) ? prefix : resolve(base, prefix)) ? 'allow' : 'deny';
      }
      case 'Grep': {
        const base = str(i.path) ? i.path : cwd;
        if (!readable(base)) return 'deny';
        if (str(i.glob) && (isAbsolute(i.glob) || i.glob.split('/').includes('..'))) return 'deny';
        return 'allow';
      }
      case 'Skill':
        return i.skill === 'pir-coordinator' ? 'allow' : 'deny';
      case 'Write': {
        if (!str(i.file_path)) return 'deny';
        const target = canonical(isAbsolute(i.file_path) ? i.file_path : resolve(cwd, i.file_path));
        return strictlyWithin(target, drop) ? 'allow' : 'deny';
      }
      default:
        return 'deny';
    }
  };
}

const gateRefusal = (toolName) =>
  `The coordinator agent may not use ${toolName} with this input. It may Read, Glob and Grep inside the repository, ` +
  'its worktrees and the installed skills, invoke the pir-coordinator skill, and Write decision files into its drop folder. Nothing else.';

// The item a decision was applied to, taken out of this drain's view so a second decision for it in the
// same drain is refused as already answered (first answer wins, DESIGN §2.3).
const sameItem = (a, b) =>
  a.worker === b.worker && (b.requestId !== undefined ? a.requestId === b.requestId : a.kind === 'report');

// The conversation log's counter: the highest `coordinator-{n}.ndjson` already there.
function lastLogN(dir) {
  let n = 0;
  try {
    for (const f of readdirSync(dir)) {
      const m = /^coordinator-(\d+)\.ndjson$/.exec(f);
      if (m) n = Math.max(n, Number(m[1]));
    }
  } catch {
    // no conversations yet
  }
  return n;
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

// ---- Who closed an item, and with what (DESIGN §2.3, T15) ----
//
// An item the agent was briefed on can stop waiting without a decision of its own: the person answered in
// pir or on the phone, a standing grant allowed it, or the worker stopped. The agent is told which, and the
// answer when the worker's conversation log shows it, so it never has to guess who answered.

// readLogEntries(logPath) → the parsed entries of a conversation log; [] when it is missing or unreadable.
// A line that does not parse (a torn last line) is skipped.
export function readLogEntries(logPath) {
  if (typeof logPath !== 'string' || !existsSync(logPath)) return [];
  const out = [];
  try {
    for (const line of readFileSync(logPath, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line));
      } catch {
        // a torn line
      }
    }
  } catch {
    return [];
  }
  return out;
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const BY_SENDER = { person: 'person', coordinator: 'coordinator', pir: 'pir' };
// Remote Control input opening (stream.mjs REMOTE_OPEN_STATES): the person typed on claude.ai or the phone.
const REMOTE_OPEN = new Set(['queued', 'started']);

// What a reply's result said, in the plain form the agent is told.
function describeResult(item, result) {
  const r = isObj(result) ? result : {};
  if (item.kind === 'questions') {
    if (r.behavior === 'allow') {
      const given = isObj(r.updatedInput?.answers) ? r.updatedInput.answers : {};
      const pairs = Object.entries(given).map(([q, a]) => `${q} → ${a}`);
      return pairs.length ? pairs.join('; ') : 'answered, with no answers recorded';
    }
    return `replied in text instead: ${r.message ?? ''}`.trim();
  }
  if (r.behavior === 'allow') return 'allowed';
  return typeof r.message === 'string' && r.message.trim() && r.message !== DEFAULT_REFUSAL ? `denied (${r.message.trim()})` : 'denied';
}

// The answer a phone (Remote Control) answer left in the log: the tool's result, since the CLI logs no
// reply for it (worker-proc.mjs `answered-remotely`). A permission whose tool ran cleanly was allowed; a
// question set's result names the chosen answers. Anything else is not recorded: an error result may be
// a denial or a failed tool, and saying either would be a guess.
function remoteAnswer(list, from, item, toolUseId) {
  for (let i = from; i < list.length; i++) {
    for (const ev of readEntry(list[i])) {
      if (ev.kind !== 'tool-result' || (toolUseId && ev.toolUseId !== toolUseId)) continue;
      if (item.kind === 'questions') {
        const pairs = [...ev.text.matchAll(/"([^"]*)"="([^"]*)"/g)].map((m) => `${m[1]} → ${m[2]}`);
        return pairs.length ? pairs.join('; ') : null;
      }
      return ev.isError ? null : 'allowed';
    }
  }
  return null;
}

// closingAnswer(entries, item, { since }) → { by, answer?, how? }: how the item stopped waiting, read from
// the worker's conversation log. `by` is 'person' | 'phone' | 'grant' | 'pir' | 'coordinator' | 'stopped'
// | 'unknown'; `answer` is set only when the log shows it; `how` ('exited' | 'interrupted' | 'restarted')
// only for 'stopped'. A request is found by its requestId; a report park has none, so it is read from
// `since`, the log's length when the park was first seen.
export function closingAnswer(entries, item, { since = 0 } = {}) {
  const list = Array.isArray(entries) ? entries : [];
  const i0 = isObj(item) ? item : {};
  const noteOf = (e, kind) => isObj(e) && e.dir === 'note' && e.kind === kind;
  const stoppedBy = (e) => {
    if (noteOf(e, 'exited')) return 'exited';
    if (noteOf(e, 'resumed')) return 'restarted';
    return null;
  };

  if (i0.requestId !== undefined) {
    const id = i0.requestId;
    const at = list.findIndex((e) => isObj(e) && e.dir === 'request' && e.requestId === id);
    let toolUseId = null;
    for (let i = (at === -1 ? list.length : at) - 1; i >= 0 && toolUseId === null; i--) {
      for (const ev of readEntry(list[i])) if (ev.kind === 'tool-use' && ev.name === list[at]?.toolName) toolUseId = ev.toolUseId;
    }
    for (let i = at + 1; i < list.length; i++) {
      const e = list[i];
      if (!isObj(e)) continue;
      if (e.dir === 'out' && e.kind === 'reply' && e.requestId === id) {
        const grant = e.from === 'pir' && list.slice(i + 1).some((n) => noteOf(n, 'delivered-by-grant') && n.requestId === id);
        if (grant) return { by: 'grant', answer: 'allowed' };
        return { by: BY_SENDER[e.from] ?? 'unknown', answer: describeResult(i0, e.result) };
      }
      if (noteOf(e, 'delivered-by-grant') && e.requestId === id) return { by: 'grant', answer: 'allowed' };
      if (noteOf(e, 'answered-remotely') && e.requestId === id) {
        const answer = remoteAnswer(list, i + 1, i0, toolUseId);
        return answer ? { by: 'phone', answer } : { by: 'phone' };
      }
      if (e.dir === 'out' && e.kind === 'interrupt') return { by: 'stopped', how: 'interrupted' };
      const how = stoppedBy(e);
      if (how) return { by: 'stopped', how };
    }
    return { by: 'unknown' };
  }

  for (let i = Math.max(0, since | 0); i < list.length; i++) {
    const e = list[i];
    if (!isObj(e)) continue;
    if (e.dir === 'out' && e.kind === 'message' && (e.from === 'person' || e.from === 'coordinator')) {
      return { by: e.from, answer: `"${String(e.text ?? '').trim()}"` };
    }
    for (const ev of readEntry(e)) {
      if (ev.kind === 'system' && ev.subtype === 'command_lifecycle' && REMOTE_OPEN.has(ev.event?.state)) {
        // The typed text reaches the log only as a replayed user message, when the CLI replays it.
        for (let j = i + 1; j < list.length; j++) {
          const typed = readEntry(list[j]).find((x) => x.kind === 'text' && x.role === 'user' && !x.synthetic && x.text.trim());
          if (typed) return { by: 'phone', answer: `"${typed.text.trim()}"` };
          if (readEntry(list[j]).some((x) => x.kind === 'result')) break;
        }
        return { by: 'phone' };
      }
    }
    const how = stoppedBy(e);
    if (how) return { by: 'stopped', how };
  }
  return { by: 'unknown' };
}

// startCoordinatorAgent(...) → CoordinatorAgent. See tasks/T03-coordinator-session.md for the interface.
// `remote` is false when PARALLEL_REMOTE=0 switched Remote Control off for the run (DESIGN §2.8);
// `skillsDir` and `uuid` are injectable for tests. `env() → object | null` is platform.mjs's `workerEnv`
// contract (reliable-notifications DESIGN §2.7), read at each launch, a resume included: an object is merged
// over `process.env` as the session's environment; null leaves it inheriting.
export function startCoordinatorAgent({
  controlDir,
  featurePath,
  repoRoot,
  slug,
  projectRulesPath = null,
  platform,
  askRules = [],
  startWorker,
  claudePath,
  now = Date.now,
  remote = true,
  skillsDir = join(homedir(), '.claude', 'skills'),
  uuid = randomUUID,
  env = null,
}) {
  const coordDir = join(controlDir, 'coordinator');
  const decisionsDir = join(coordDir, 'decisions');
  const sessionPath = join(coordDir, 'session.json');
  const ledgerPath = join(coordDir, 'ledger.jsonl');
  const convDir = join(controlDir, 'conversations');
  mkdirSync(decisionsDir, { recursive: true });

  const decide = gateFor({
    cwd: featurePath,
    readRoots: [repoRoot, join(repoRoot, '.claude', 'worktrees'), featurePath, skillsDir],
    decisionsDir,
  });
  const name = `${basename(repoRoot)} / ${slug} / coordinator agent`;

  // A stored session is resumed: after a pir restart the agent keeps its conversation (DESIGN §2.11).
  const stored = readJson(sessionPath);
  const session = {
    sessionId: typeof stored?.sessionId === 'string' ? stored.sessionId : null,
    restarts: Array.isArray(stored?.restarts) ? stored.restarts.filter((x) => typeof x === 'string') : [],
  };
  const saveSession = () => writeJsonAtomic(sessionPath, session);

  let worker = null;
  let logPath = null; // the conversation log of the session now (or last) holding the agent
  let up = false;
  let givenUp = false;
  let closing = false;
  const briefed = new Map(); // item key → item, every item briefed this run
  // item key → why a decision for it is refused (closedWhy): the items it was told were closed without a
  // decision of its own (T15), so a late decision is refused with the same facts, not the generic "unknown
  // worker". Cleared for a key when that key is briefed again (a worker's next report park).
  const answered = new Map();
  const unparsed = new Set(); // decision files that failed to parse once (DESIGN §3.5)

  function launch() {
    const resume = session.sessionId !== null;
    if (!resume) {
      session.sessionId = uuid();
      saveSession();
    }
    const n = lastLogN(convDir);
    // A resumed session continues its own conversation file; a fresh one starts the next.
    logPath = join(convDir, `coordinator-${resume ? Math.max(n, 1) : n + 1}.ndjson`);
    const extra = env?.() ?? null;
    worker = startWorker({
      ...(extra ? { env: { ...process.env, ...extra } } : {}),
      cwd: featurePath,
      ...(resume ? { resume: session.sessionId } : { sessionId: session.sessionId }),
      name,
      logPath,
      claudePath,
      permissionMode: 'default',
      tools: AGENT_TOOLS,
      disallowedTools: AGENT_DISALLOWED,
      decide,
      denyMessage: gateRefusal,
    });
    up = true;
    const w = worker;
    w.onExit((info) => onExit(w, info));
    if (resume) w.send(resumedFor(), { from: 'pir' });
    else w.send(openingFor({ slug, projectRulesPath, dropDir: decisionsDir }), { from: 'pir' });
    if (remote) w.remoteControl(true).catch(() => {});
  }

  function onExit(w, info) {
    if (w !== worker) return;
    up = false;
    if (closing) return;
    const t = now();
    session.restarts = [...session.restarts, new Date(t).toISOString()].filter((iso) => t - Date.parse(iso) < RESTART_WINDOW_MS);
    saveSession();
    if (session.restarts.length > MAX_RESTARTS) {
      // Given up for the rest of the run: every waiting item goes to the person (DESIGN §2.11).
      givenUp = true;
      w.note('coordinator-given-up', { exits: session.restarts.length, code: info?.code ?? null });
      return;
    }
    w.note('coordinator-resuming', { exits: session.restarts.length, code: info?.code ?? null });
    try {
      launch();
    } catch (err) {
      // A resume that cannot even start leaves nothing to wait for: the person takes every item.
      givenUp = true;
      w.note('coordinator-given-up', { message: String(err?.message ?? err) });
    }
  }

  const alive = () => up && !givenUp && !closing;
  const keyOf = (item) => `${item.worker}:${item.requestId ?? 'report'}`;
  const tell = (text) => (alive() ? worker.send(text, { from: 'pir' }) : false);

  // A torn last line (DESIGN §3.5) has no newline; appending straight after it would fuse the new line
  // onto it and lose both on read, so a missing newline is written first (review T03).
  const endsTorn = () => {
    let fd;
    try {
      const { size } = statSync(ledgerPath);
      if (size === 0) return false;
      fd = openSync(ledgerPath, 'r');
      const b = Buffer.alloc(1);
      readSync(fd, b, 0, 1, size - 1);
      return b[0] !== 0x0a;
    } catch {
      return false;
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  };

  const appendLedger = (line) => {
    try {
      appendFileSync(ledgerPath, (endsTorn() ? '\n' : '') + JSON.stringify({ t: new Date(now()).toISOString(), ...line }) + '\n');
    } catch {
      // a ledger that cannot be written must not take the pass down; the answer was still applied
    }
  };

  // Apply one checked decision through the platform. → true when it reached the worker.
  function apply(a) {
    if (a.kind === 'permission' || a.kind === 'answers') {
      return platform.answer(a.worker, a.requestId, a.result, { from: 'coordinator' })?.ok === true;
    }
    if (a.kind === 'message') return platform.send(a.worker, a.text, { from: 'coordinator' })?.ok === true;
    return true;
  }

  // → { passed, settled, report?, close? }. `settled` holds every item this drain closed for the agent —
  // answered by it, or found already answered and the agent told so here — as { worker, requestId? }, so
  // the run never tells the agent a second time that the person answered it (T04). `late` is the keys of
  // the items the hold limit already handed to the person (T13): a decision for one is applied as any
  // other, first answer winning, and its ledger line carries `late: true`. `closedOf(item)` → how an item
  // found answered between the snapshot and the apply was closed (closingAnswer), for the message (T15).
  function drain(waiting = [], { ready = false, late = new Set(), closedOf = () => ({ by: 'unknown' }) } = {}) {
    const out = { passed: [], settled: [] };
    const ledgerFor = (a) => (late.has(keyOf(a)) ? { ...a.ledger, late: true } : a.ledger);
    let files = [];
    try {
      files = readdirSync(decisionsDir).filter((f) => f.endsWith('.json')).sort();
    } catch {
      return out;
    }
    let remaining = Array.isArray(waiting) ? waiting.slice() : [];
    const take = (a) => {
      remaining = remaining.filter((i) => !sameItem(i, a));
    };

    for (const file of files) {
      const path = join(decisionsDir, file);
      let raw;
      try {
        raw = readFileSync(path, 'utf8');
      } catch {
        continue; // vanished under us
      }
      let obj;
      try {
        obj = JSON.parse(raw);
      } catch {
        // The agent's Write has no rename, so the file may still be landing: left for one more pass.
        if (!unparsed.has(file)) {
          unparsed.add(file);
          continue;
        }
        unparsed.delete(file);
        drop(path);
        tell(refusalFor('it is not valid JSON', file));
        continue;
      }
      unparsed.delete(file);
      drop(path);

      const read = readDecision(obj);
      if (!read.ok) {
        tell(refusalFor(read.error, file));
        continue;
      }
      const checked = checkDecision(read.decision, remaining, { ready, answered });
      if (!checked.ok) {
        if (checked.passOn) {
          // A permission for a reserved item: the item goes to the person with the agent's text as its note.
          const d = read.decision;
          const passed = { worker: d.worker, reason: d.reason, suggestion: null };
          if (d.requestId !== undefined) passed.requestId = d.requestId;
          out.passed.push(passed);
          take(passed);
        }
        tell(refusalFor(checked.why, file));
        continue;
      }

      const a = checked.apply;
      if (a.kind === 'report') {
        out.report = a.sections;
        continue;
      }
      if (a.kind === 'close') {
        out.close = true;
        continue;
      }
      if (a.kind === 'pass') {
        // The pointer is the agent's own reply (DESIGN §2.5); pir writes no note for it.
        const passed = { worker: a.worker, reason: a.reason, suggestion: a.suggestion };
        if (a.requestId !== undefined) passed.requestId = a.requestId;
        out.passed.push(passed);
        take(a);
        appendLedger(ledgerFor(a));
        continue;
      }
      const item = remaining.find((i) => sameItem(i, a)) ?? a;
      take(a);
      out.settled.push(a.requestId !== undefined ? { worker: a.worker, requestId: a.requestId } : { worker: a.worker });
      if (apply(a)) {
        appendLedger(ledgerFor(a));
      } else if (a.kind === 'message') {
        tell(refusalFor(`worker ${a.worker} could not be reached; it has exited`, file));
      } else {
        // Not pending any more: someone answered it between the pass's snapshot and now.
        told(item, closedOf(item));
      }
    }
    return out;
  }

  // Tell the agent an item was closed without it, once per item, and remember the facts for the refusal.
  function told(item, closed) {
    const key = keyOf(item);
    if (answered.has(key)) return false;
    answered.set(key, closedWhy(closed));
    return tell(answeredElsewhereFor(item, closed));
  }

  function drop(path) {
    try {
      unlinkSync(path);
    } catch {
      // already gone
    }
  }

  function ledger() {
    if (!existsSync(ledgerPath)) return [];
    const lines = [];
    for (const l of readFileSync(ledgerPath, 'utf8').split('\n')) {
      if (!l.trim()) continue;
      try {
        lines.push(JSON.parse(l));
      } catch {
        // a torn last line (DESIGN §3.5)
      }
    }
    return lines;
  }

  // A run whose agent was already given up in the last hour stays given up across a pir restart.
  const t0 = now();
  if (session.restarts.filter((iso) => t0 - Date.parse(iso) < RESTART_WINDOW_MS).length > MAX_RESTARTS) {
    givenUp = true;
    // Its row still says so, and `c` / → still open the conversation it last had (T12).
    const n = lastLogN(convDir);
    if (n > 0) logPath = join(convDir, `coordinator-${n}.ndjson`);
  } else launch();

  return {
    get id() {
      return session.sessionId;
    },
    alive,
    // Given up for the rest of the run (DESIGN §2.11). Not alive and not given up is an agent restarting,
    // which the end of the run waits for.
    givenUp: () => givenUp,
    // The worker-proc Worker currently holding the session, for the screen and T04's routing; null once
    // given up before a launch.
    get session() {
      return worker;
    },
    // remoteUrl() → the agent's Remote Control link, for the end-of-run alert's tap (reliable-notifications
    // DESIGN §2.4); null while it is off, not yet known, or the agent has no session.
    remoteUrl() {
      return worker?.remoteUrl ?? null;
    },
    // The agent's conversation log, for the screen to open (pir-coordinator §2.8); null before a launch.
    get logPath() {
      return logPath;
    },
    // view() → { id, live, logPath, state } for the run state (buildRunState's `coordinator`), or null when
    // it never launched and is not given up. `state` is what its row in the live view reads (T12): `up`,
    // `restarting` (down, not given up; the end of the run waits for it) or `given-up`. An agent closed by
    // the run's own end reads `up`: that frame is the run's last, and nothing restarts it.
    view() {
      if (!logPath && !givenUp) return null;
      const state = givenUp ? 'given-up' : alive() || closing ? 'up' : 'restarting';
      return { id: session.sessionId, live: alive(), logPath, state };
    },
    brief(item) {
      if (!alive() || !item) return false;
      const key = keyOf(item);
      if (briefed.has(key)) return false;
      if (!tell(briefFor(item))) return false;
      briefed.set(key, item);
      answered.delete(key);
      return true;
    },
    // forget(item) → the item is no longer waiting, so the same key (a worker's next report park) is
    // briefed afresh when it waits again (T04).
    forget(item) {
      if (item) briefed.delete(keyOf(item));
    },
    // answeredElsewhere(item, closed) → the item stopped waiting without a decision of the agent's (DESIGN
    // §2.3, T15): the agent is told who closed it and the answer (`closed` from closingAnswer), once per
    // item. → true once told.
    answeredElsewhere(item, closed = { by: 'unknown' }) {
      return item ? told(item, closed) : false;
    },
    // timedOut(item, { holdMs, heldForMs }) → the agent held the item for the hold limit without a decision
    // and it is the person's now (DESIGN §2.11, T13): the agent is told, and the ledger gets one `timeout`
    // line, never notable, so the report's decisions section is unchanged. → true once the agent was told.
    timedOut(item, { holdMs, heldForMs } = {}) {
      if (!item) return false;
      const line = { kind: 'timeout', worker: item.worker, task: item.task, item: describeItem(item), answer: `handed to the person after ${holdWords(holdMs)} without a decision`, heldForMs, notable: false };
      if (item.requestId !== undefined) line.requestId = item.requestId;
      appendLedger(line);
      return tell(timedOutFor(item, holdMs));
    },
    drain,
    tell,
    ledger,
    // briefEnd(facts) → the end brief (DESIGN §2.9 step 2); true once it is in the agent's session.
    briefEnd(facts) {
      return tell(endBriefFor(facts));
    },
    // record(line) → append a line the command itself owns to the ledger: a task adopted into the plan
    // while the agent was on (DESIGN §2.7), so the report lists it after a pir restart too.
    record(line) {
      if (line && typeof line === 'object') appendLedger(line);
    },
    async close(opts) {
      closing = true;
      if (worker) await worker.close(opts);
    },
  };
}

// withAgent(platform, getAgent) → the platform the person inbox forwards through, with the coordinator
// agent's session added under its id (pir-coordinator DESIGN §2.8). The agent is not one of the platform's
// workers (it is started beside them), so without this a message the person types in the agent's
// conversation in `pir` would be refused as "no such worker in this run". Everything else is the
// platform's, unchanged. `getAgent()` is read per call: the agent starts after the inbox, and a resume
// swaps the session under the same id.
export function withAgent(platform, getAgent) {
  const sessionFor = (id) => {
    const a = getAgent?.();
    return a && id != null && a.id === id && a.session ? a : null;
  };
  return {
    ...platform,
    send(id, text, opts = {}) {
      const a = sessionFor(id);
      return a ? { ok: a.session.send(text, { from: opts.from ?? 'person' }) } : platform.send(id, text, opts);
    },
    interrupt(id, opts = {}) {
      const a = sessionFor(id);
      if (!a) return platform.interrupt(id, opts);
      a.session.interrupt({ from: opts.from ?? 'person' }).catch(() => {});
      return { ok: a.alive() };
    },
    answer(id, requestId, result, opts = {}) {
      const a = sessionFor(id);
      return a ? { ok: a.session.answer(requestId, result, { from: opts.from ?? 'person' }) } : platform.answer(id, requestId, result, opts);
    },
    pending(id) {
      const a = sessionFor(id);
      return a ? a.session.pending() : platform.pending(id);
    },
    note(id, kind, fields = {}) {
      const a = sessionFor(id);
      if (!a) return platform.note(id, kind, fields);
      a.session.note(kind, fields);
      return { ok: true };
    },
    logPathOf(id) {
      const a = sessionFor(id);
      return a ? a.logPath : platform.logPathOf(id);
    },
  };
}
