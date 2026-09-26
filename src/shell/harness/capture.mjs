// The live-scenario harness's capture layer (DESIGN §4.1, T14; live-workers T16). It turns one live
// coordinator run into a self-contained, dated BUNDLE of evidence: the coordinator's flow log, a sampled
// worker timeline, every worker's conversation log, the run's final workers.json, and the scratch repo's
// `git log`. The assertion layer checks a bundle; the live runner produces one.
//
// It OBSERVES only. It never modifies the coordinator and never changes run behaviour: it reads files
// the coordinator already writes (the flow `log`, `workers.json`, `conversations/*.ndjson`) and copies
// them. Since live-workers every worker is a stream-json child of the coordinator (live-workers DESIGN
// §2.1), so there is no `claude agents` listing to sample and no ~/.claude transcript to copy: the
// coordinator's own records are the evidence.
//
// Why the timeline is still sampled live. workers.json lists only the coordinator's LIVE children and is
// rewritten on every spawn and exit (live-workers §2.12), so who was running at the same time, and whether
// a worker went idle before it was closed, survives only if the file is read while the run is going. Each
// tick joins workers.json with each worker's activity folded from its conversation log (core/stream.mjs
// workerActivity, the same fold the coordinator's platform.list() uses, §2.4). A recorded pid is only
// counted live when the process is alive with its recorded start time: after a SIGKILLed coordinator the
// file still names its workers, and a reaped one must not read as live.
//
// The conversation logs themselves are durable: the coordinator keeps them until the run is removed from
// the dashboard (§2.3), so seal copies them once, at the end, and needs no eager staging.
//
// Everything that touches a process or the clock is injected, so tick, seal and loadBundle are
// unit-tested against a temp control folder with no live worker (DESIGN §4.1, T14 acceptance).

import { mkdirSync, writeFileSync, appendFileSync, readFileSync, readdirSync, copyFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import { workerActivity } from '../../core/stream.mjs';
import { readWorkersFile } from '../reap.mjs';
import { isAlive as isAliveReal, startTimeOf as startTimeOfReal } from '../identity.mjs';

// --- Conversation logs (live-workers DESIGN §2.3) ------------------------------------------------

// parseLogName(file) → { task, role, n } for `{Txx}-{role}-{n}.ndjson`, else null.
export function parseLogName(file) {
  const m = /^(T\d+)-(implement|review)-(\d+)\.ndjson$/.exec(String(file ?? ''));
  return m ? { task: m[1], role: m[2], n: Number(m[3]) } : null;
}

// parseLog(text) → the log's entries, one per non-blank line. A line that does not parse (a crash
// mid-append) is kept as its raw string, as core/stream.mjs's reader expects (§2.3); it never throws.
export function parseLog(text) {
  return String(text ?? '')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return l;
      }
    });
}

// logSessionId(entries) → the session id the worker's own messages carry, or null before it has said
// anything. pir chose that id and it is the worker's `id` in workers.json (§2.1), so this is what ties a
// recorded worker to its log file.
export function logSessionId(entries) {
  for (const e of entries ?? []) {
    const sid = e?.dir === 'in' ? e.event?.session_id : null;
    if (typeof sid === 'string' && sid) return sid;
  }
  return null;
}

// statusOf(state) → 'busy' | 'idle', the two-valued status the timeline facts read. Mirrors platform.mjs:
// a worker waiting on the person, or whose turn ended, is not busy; `starting` has work in hand (§2.4).
export function statusOf(state) {
  return state === 'busy' || state === 'starting' ? 'busy' : 'idle';
}

// --- The bundle directory ------------------------------------------------------------------------

// bundleDirFor(parallelDir, now) → a dated bundle path under {parallelDir}/capture/{ISO}. The ISO
// stamp is made filesystem-safe (':' is legal on macOS but not everywhere; strip the punctuation).
export function bundleDirFor(parallelDir, now = new Date()) {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return join(parallelDir, 'capture', stamp);
}

const BUNDLE_FILES = {
  flow: 'flow.log',
  timeline: 'timeline.jsonl',
  workers: 'workers.json',
  run: 'run.json',
  manifest: 'manifest.json',
  gitLog: 'git-log.txt',
  coordinatorOut: 'coordinator.out',
  conversations: 'conversations',
};

function defaultRunGit(args, { cwd } = {}) {
  try {
    const stdout = execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { ok: true, stdout };
  } catch (e) {
    return { ok: false, stdout: e.stdout ?? '' };
  }
}

// createCapture(opts) → { dir, tick, start, stop, seal }. The in-process API the live runner drives:
// start sampling, stop-and-seal.
//
//   repo, slug     — the run's identity, written to run.json so the facts know which plan's branch to
//                    check without parsing it out of worker names (workers.json carries none).
//   dir            — the bundle directory to write (created if absent).
//   controlDir     — plans/{slug}/.parallel/control: the flow `log`, workers.json, conversations/.
//   repoDir        — the scratch repo root, for the `git log` at seal.
//   runGit         — (args, { cwd }) => { ok, stdout }, for the git log at seal.
//   readWorkers    — (controlDir) => the recorded workers; reap.mjs's reader by default.
//   isAlive, startTimeOf — (pid) probes, injected so a test uses fake pids (identity.mjs by default).
//   intervalMs     — poll cadence for start()/stop() (default ~2000, DESIGN §4.1).
//   now            — clock, injected (this is shell; the pure core stays clockless, DESIGN §3.1).
//   timers         — { setInterval, clearInterval }, injected so a test need not use real time.
export function createCapture({
  repo,
  slug,
  dir,
  controlDir,
  repoDir,
  runGit = defaultRunGit,
  readWorkers = readWorkersFile,
  isAlive = (pid) => isAliveReal(pid),
  startTimeOf = (pid) => startTimeOfReal(pid),
  intervalMs = 2000,
  now = () => new Date(),
  timers = { setInterval, clearInterval },
} = {}) {
  if (!dir) throw new Error('createCapture: no bundle dir');
  const timelinePath = join(dir, BUNDLE_FILES.timeline);
  const conversationsDir = controlDir ? join(controlDir, 'conversations') : null;
  mkdirSync(dir, { recursive: true });

  const timeline = [];
  const logOf = new Map(); // worker id → its log file name, once matched
  let handle = null;
  let sealed = false;

  const readEntries = (file) => {
    try {
      return parseLog(readFileSync(join(conversationsDir, file), 'utf8'));
    } catch {
      return [];
    }
  };

  // locateLog(worker) → { file, entries } | null. A worker's log is `{task}-{role}-{n}.ndjson`; the one
  // whose messages carry the worker's session id is its own. Before the worker has said anything no log
  // carries the id yet, so the newest file for that task and role with no session id stands in: the
  // platform names the log at spawn, one past the highest n (platform.mjs nextLogPath).
  function locateLog(w) {
    if (!conversationsDir) return null;
    const known = logOf.get(w.id);
    if (known) return { file: known, entries: readEntries(known) };
    let names = [];
    try {
      names = readdirSync(conversationsDir);
    } catch {
      return null;
    }
    const candidates = names
      .map((file) => ({ file, p: parseLogName(file) }))
      .filter(({ p }) => p && p.task === w.task && p.role === w.role)
      .sort((a, b) => b.p.n - a.p.n);
    let fallback = null;
    for (const { file } of candidates) {
      const entries = readEntries(file);
      const sid = logSessionId(entries);
      if (sid === w.id) {
        logOf.set(w.id, file);
        return { file, entries };
      }
      if (sid == null && !fallback) fallback = { file, entries };
    }
    return fallback;
  }

  // tick() → the entry it recorded: { ts, workers: [{ id, task, role, pid, startTime, status, state, log }] }.
  // One read of workers.json, keeping the workers whose process still runs, each with its activity from its
  // log. A read failure records an empty tick rather than throwing: capture must never break the run.
  function tick() {
    const ts = now().toISOString();
    const workers = [];
    let recorded = [];
    try {
      recorded = controlDir ? readWorkers(controlDir) : [];
    } catch {
      recorded = [];
    }
    for (const w of recorded) {
      try {
        if (!isAlive(w.pid)) continue;
        if (w.startTime != null && startTimeOf(w.pid) !== w.startTime) continue; // a reused pid
        const log = locateLog(w);
        const state = log ? workerActivity(log.entries).state : 'starting';
        workers.push({
          id: w.id,
          task: w.task,
          role: w.role,
          pid: w.pid,
          startTime: w.startTime ?? null,
          status: statusOf(state),
          state,
          log: log?.file ?? null,
        });
      } catch {
        /* one unreadable worker must not drop the tick */
      }
    }
    const entry = { ts, workers };
    timeline.push(entry);
    try {
      appendFileSync(timelinePath, `${JSON.stringify(entry)}\n`);
    } catch {
      /* capture must never break the run it observes */
    }
    return entry;
  }

  function start() {
    if (handle) return;
    tick(); // an immediate first sample, then on cadence
    handle = timers.setInterval(tick, intervalMs);
    if (handle && typeof handle.unref === 'function') handle.unref();
  }

  function copyIfPresent(src, dest) {
    if (!existsSync(src)) return false;
    try {
      copyFileSync(src, dest);
      return true;
    } catch {
      return false;
    }
  }

  // snapshotConversations() → the manifest: every `conversations/*.ndjson` of the run copied into the
  // bundle's conversations/, keyed by its file name. `role: 'worker'` is what tokens.mjs totals; the
  // worker's own role (implement/review), task, n and session id sit beside it.
  function snapshotConversations() {
    const manifest = {};
    if (!conversationsDir || !existsSync(conversationsDir)) return manifest;
    let names = [];
    try {
      names = readdirSync(conversationsDir).filter((n) => n.endsWith('.ndjson')).sort();
    } catch {
      return manifest;
    }
    mkdirSync(join(dir, BUNDLE_FILES.conversations), { recursive: true });
    for (const file of names) {
      const copiedTo = join(BUNDLE_FILES.conversations, file);
      const copied = copyIfPresent(join(conversationsDir, file), join(dir, copiedTo));
      const p = parseLogName(file);
      manifest[file] = {
        role: 'worker',
        task: p?.task ?? null,
        workerRole: p?.role ?? null,
        n: p?.n ?? null,
        sessionId: copied ? logSessionId(readEntries(file)) : null,
        copied,
        copiedTo: copied ? copiedTo : null,
      };
    }
    return manifest;
  }

  // seal() — the stop-and-seal half. Copies the flow log, the coordinator's stdout, workers.json and every
  // conversation log, writes run.json and the manifest, and captures the scratch repo's git log.
  // Idempotent: sealing twice is a no-op. Returns the loaded bundle.
  function seal() {
    if (sealed) return loadBundle(dir);
    sealed = true;

    if (controlDir) {
      // The flow log is copied in place (the coordinator wrote it; it is not re-derived, DESIGN §4.1). The
      // coordinator's stdout (run.mjs spawnCoordinator) holds its printed hand-off, the one record of
      // whether the end-of-run gate went green or red. workers.json is whatever the run left recorded.
      copyIfPresent(join(controlDir, 'log'), join(dir, BUNDLE_FILES.flow));
      copyIfPresent(join(controlDir, 'coordinator.out'), join(dir, BUNDLE_FILES.coordinatorOut));
      copyIfPresent(join(controlDir, 'workers.json'), join(dir, BUNDLE_FILES.workers));
    }

    writeFileSync(join(dir, BUNDLE_FILES.run), `${JSON.stringify({ repo: repo ?? null, plan: slug ?? null })}\n`);
    const manifest = snapshotConversations();
    writeFileSync(join(dir, BUNDLE_FILES.manifest), `${JSON.stringify(manifest, null, 2)}\n`);

    // git log of the scratch repo, so a merge is checkable after teardown (DESIGN §4.1).
    if (repoDir) {
      const g = runGit(['log', '--oneline', '--graph', '--all'], { cwd: repoDir });
      writeFileSync(join(dir, BUNDLE_FILES.gitLog), g.ok ? g.stdout : '');
    }

    return loadBundle(dir);
  }

  // stop() — end live sampling (if start()ed) and seal.
  function stop() {
    if (handle) {
      timers.clearInterval(handle);
      handle = null;
    }
    return seal();
  }

  return { dir, tick, start, stop, seal };
}

// --- Reading a sealed bundle back (DESIGN §4.1) --------------------------------------------------

// A flow-log line is `${ISO} ${type} ${rest}` (loop.mjs record + coordinate.mjs fileControl). Split
// the timestamp off the front; the first word of the remainder is the action type, the rest is its
// argument (a task id, a branch, or free text like "ceiling full: …").
function parseFlowLine(line) {
  const sp = line.indexOf(' ');
  if (sp === -1) return { ts: null, type: line, rest: '' };
  const ts = line.slice(0, sp);
  const body = line.slice(sp + 1);
  const sp2 = body.indexOf(' ');
  const type = sp2 === -1 ? body : body.slice(0, sp2);
  const rest = sp2 === -1 ? '' : body.slice(sp2 + 1);
  return { ts, type, rest };
}

function readTextOr(path, fallback = '') {
  try {
    return existsSync(path) ? readFileSync(path, 'utf8') : fallback;
  } catch {
    return fallback;
  }
}

function readJsonOr(path, fallback, valid) {
  try {
    const v = JSON.parse(readTextOr(path, ''));
    return valid(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

// loadBundle(dir) → a plain object the assertion layer reads: the parsed flow, the worker timeline, the
// final workers.json, the run identity, the conversation manifest, and the git log. Every field is
// present even when its file is absent (an empty array, object or string), so an assertion never has to
// guard for a missing file — a fact simply does not hold over empty evidence.
export function loadBundle(dir) {
  const flowText = readTextOr(join(dir, BUNDLE_FILES.flow));
  const flow = flowText.split('\n').filter((l) => l.trim() !== '').map(parseFlowLine);

  const timeline = readTextOr(join(dir, BUNDLE_FILES.timeline))
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const workers = readJsonOr(join(dir, BUNDLE_FILES.workers), [], Array.isArray);
  const run = readJsonOr(join(dir, BUNDLE_FILES.run), {}, isObj);
  const manifest = readJsonOr(join(dir, BUNDLE_FILES.manifest), {}, isObj);
  const gitLog = readTextOr(join(dir, BUNDLE_FILES.gitLog));

  // null, not '', when absent: a missing hand-off record must read differently from an empty one.
  const coordinatorOut = readTextOr(join(dir, BUNDLE_FILES.coordinatorOut), null);

  return { dir, name: basename(dir), flow, flowText, timeline, workers, run, manifest, gitLog, coordinatorOut };
}
