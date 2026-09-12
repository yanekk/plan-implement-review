// The live-scenario harness's capture layer (DESIGN §4.1, T14). It turns one live coordinator run
// into a self-contained, dated BUNDLE of evidence: the coordinator's flow log, a sampled agent-status
// timeline, a snapshot of every session's transcript, and the scratch repo's `git log`. The assertion
// layer (T15) checks a bundle; the live runner (T17) produces one.
//
// It OBSERVES only. It never modifies the reviewed coordinator (coordinate.mjs / loop.mjs /
// platform.mjs) and never changes run behaviour — it reads the flow log the coordinator already
// writes, samples `claude agents --json` on the side, and copies files that already exist on disk.
//
// Why capture parses `agents --json` itself instead of platform.parseAgents. The transcript filename
// is the session's `sessionId` (DESIGN §4.1), and platform.parseAgents deliberately drops sessionId —
// it is not part of any coordinator decision. Rather than widen the reviewed parser, capture keeps its
// own read that retains the fields evidence needs (id, sessionId, name, cwd, status, state). This is
// also why the layer can be read-only against the coordinator: it shares nothing mutable with it.
//
// Why the timeline must be sampled live (the one source not otherwise recorded, DESIGN §4.1). `status`
// (idle/busy) and `pid` exist in `agents --json` ONLY while a session is live; once it ends, `--all`
// still lists it but with just its final `state`, no `status`. So the busy→idle transition that proves
// the idle-gated close (DESIGN §2.3) survives only if snapshots are taken while the workers live. The
// flow log and the transcripts are durable — the flow log is appended by the coordinator, and the
// transcripts live under ~/.claude and survive a worker's kill and its worktree's removal (FINDINGS
// 2026-09-10) — so only the timeline is polled.
//
// Everything is injected exactly as platform.mjs injects runClaude and its git runner, so escaping,
// path resolution, timeline assembly, tagging and loadBundle are all unit-tested against canned
// `agents --json` output and a temp projects/ tree with no live agent (DESIGN §4.1, T14 acceptance).

import {
  mkdirSync,
  writeFileSync,
  appendFileSync,
  readFileSync,
  copyFileSync,
  existsSync,
} from 'node:fs';
import { join, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { coordinatorName, isWorkerOf, parseAgentName } from '../../core/naming.mjs';

// --- The transcript path convention (DESIGN §4.1, confirmed on this machine 2026-09-10) -----------
//
// A session's transcript lives at:
//   ~/.claude/projects/<escape(cwd)>/<sessionId>.jsonl
// where escape() replaces EVERY '/' and '.' in the absolute cwd with '-'. So a leading '/' becomes a
// leading '-', and a '/.claude' segment becomes '--claude' (the '/' → '-' and the '.' → '-' abut).
// Exported so the T17 live runner can reuse it without importing the whole capture surface.
export function escapeProjectPath(cwd) {
  return String(cwd ?? '').replace(/[/.]/g, '-');
}

// The default projects store, overridable for tests (a temp projects/ tree with no live agent).
export function defaultProjectsDir() {
  return join(homedir(), '.claude', 'projects');
}

// resolveTranscriptPath(projectsDir, cwd, sessionId) → the absolute .jsonl path, or null if either
// the cwd or the sessionId is missing (a session listed with neither cannot be resolved).
export function resolveTranscriptPath(projectsDir, cwd, sessionId) {
  if (!cwd || !sessionId) return null;
  return join(projectsDir, escapeProjectPath(cwd), `${sessionId}.jsonl`);
}

// --- Reading `claude agents --json` for evidence (capture's own parse; see the header) ------------
//
// Keeps the fields the bundle needs and drops nothing evidence-relevant. Accepts raw JSON text or an
// already-parsed array (as platform.parseAgents does), so a test can hand it either. A record with no
// name still passes through — a foreign or unnamed session is kept, tagged not-ours (DESIGN §4.1: keep
// every agent each tick).
export function parseAgentsForCapture(json) {
  const arr = typeof json === 'string' ? JSON.parse(json) : json;
  if (!Array.isArray(arr)) return [];
  return arr.map((a) => ({
    id: a.id ?? null,
    sessionId: a.sessionId ?? null,
    name: a.name ?? null,
    cwd: a.cwd ?? null,
    status: a.status ?? null,
    state: a.state ?? null,
    pid: a.pid ?? null,
  }));
}

// tagAgent(agent, { repo, plan, coordName }) → the agent with two ownership tags added (DESIGN §4.1:
// tag which are this run's workers/coordinator by name). isWorkerOf is true for a worker of THIS run
// (name parses to {repo}·{plan}·T{nn}); isCoordinator is true for this run's coordinator session
// ({repo}·{plan}, no task). A foreign agent gets both false — tagged not-ours. Ownership is read from
// the name alone, the same way the coordinator identifies its workers (DESIGN §2.8), so it cannot
// drift from separate bookkeeping.
function tagAgent(agent, { repo, plan, coordName }) {
  const worker = isWorkerOf(agent.name, { repo, plan });
  const coordinator = !worker && agent.name === coordName;
  return { ...agent, isWorkerOf: worker, isCoordinator: coordinator };
}

// The filename label for a session's transcript copy (DESIGN §4.1 "<worker-name-or-role>.jsonl"):
// a worker by its task id and role (T05-implement.jsonl, T05-review.jsonl), the coordinator by role
// (coordinator.jsonl), anything else by a filesystem-safe version of its name or, failing that, its
// sessionId. The role keeps the implementer's and reviewer's transcripts of one task from colliding.
function transcriptLabel(agent) {
  if (agent.isCoordinator) return 'coordinator';
  const parsed = parseAgentName(agent.name);
  if (agent.isWorkerOf && parsed.task) return parsed.role ? `${parsed.task}-${parsed.role}` : parsed.task;
  const raw = agent.name || agent.sessionId || 'unknown';
  return String(raw).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
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
  timeline: 'agents-timeline.jsonl',
  final: 'agents-final.json',
  manifest: 'manifest.json',
  gitLog: 'git-log.txt',
  transcripts: 'transcripts',
};

// --- The default injected runners (mirroring platform.mjs) ---------------------------------------

function defaultRunClaude(args) {
  try {
    const stdout = execFileSync('claude', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { ok: true, stdout };
  } catch (e) {
    return { ok: false, stdout: e.stdout ?? '' };
  }
}

function defaultRunGit(args, { cwd } = {}) {
  try {
    const stdout = execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { ok: true, stdout };
  } catch (e) {
    return { ok: false, stdout: e.stdout ?? '' };
  }
}

// createCapture(opts) → { dir, tick, start, stop, seal }. The in-process API the T17 runner drives:
// start sampling, stop-and-seal. Everything it touches is injected so the whole layer is provable with
// no live agent (DESIGN §4.1).
//
//   repo, slug     — identify this run's coordinator and workers by name (DESIGN §2.8).
//   dir            — the bundle directory to write (created if absent). The runner computes it, e.g.
//                    with bundleDirFor; a test passes a temp dir.
//   controlDir     — where the coordinator's flow `log` lives (plans/{slug}/.parallel/control).
//   repoDir        — the scratch repo root, for the `git log` at seal.
//   runClaude      — (args) => { ok, stdout }, for `agents --json` (tick) and `--all` (seal).
//   runGit         — (args, { cwd }) => { ok, stdout }, for the git log at seal.
//   projectsDir    — the transcript store root (~/.claude/projects by default).
//   intervalMs     — poll cadence for start()/stop() (default ~2000, DESIGN §4.1).
//   now            — clock, injected (this is shell; the pure core stays clockless, DESIGN §3.1).
//   timers         — { setInterval, clearInterval }, injected so a test need not use real time.
export function createCapture({
  repo,
  slug,
  dir,
  controlDir,
  repoDir,
  runClaude = defaultRunClaude,
  runGit = defaultRunGit,
  projectsDir = defaultProjectsDir(),
  intervalMs = 2000,
  now = () => new Date(),
  timers = { setInterval, clearInterval },
} = {}) {
  if (!dir) throw new Error('createCapture: no bundle dir');
  const coordName = coordinatorName({ repo, plan: slug });
  const timelinePath = join(dir, BUNDLE_FILES.timeline);
  mkdirSync(dir, { recursive: true });

  // The timeline is held in memory as well as appended to disk: seal() gathers the sessions to snapshot
  // from it without re-reading, and a caller can inspect it live.
  const timeline = [];
  let handle = null;
  let sealed = false;

  // tick() → the snapshot it recorded. One sample of `agents --json`: parse, tag every agent by name,
  // append { ts, agents } to the timeline (memory and disk). A failed `agents --json` records an empty
  // tick rather than throwing, so one hiccup does not abort a run's capture.
  function tick() {
    const ts = now().toISOString();
    const r = runClaude(['agents', '--json']);
    let agents = [];
    if (r.ok) {
      try {
        agents = parseAgentsForCapture(r.stdout).map((a) => tagAgent(a, { repo, plan: slug, coordName }));
      } catch {
        agents = [];
      }
    }
    const entry = { ts, agents };
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

  // The unique sessions seen across the whole run, keyed by sessionId (the transcript's true key). A
  // session with no sessionId cannot be resolved to a transcript, so it is skipped here; its rows still
  // stand in the timeline. The last-seen tag/name wins, which is correct — a session's name is stable.
  function sessionsSeen() {
    const bySession = new Map();
    for (const { agents } of timeline) {
      for (const a of agents ?? []) {
        if (a.sessionId) bySession.set(a.sessionId, a);
      }
    }
    return [...bySession.values()];
  }

  // snapshotTranscripts() → the manifest. For every session seen, resolve its transcript and copy it
  // into transcripts/<label>.jsonl. A missing transcript is recorded copied:false, never a throw
  // (DESIGN §4.1 acceptance). The manifest is keyed by agent name; if one name recurs across the run
  // with a different session — an implementer and its fresh reviewer share a worker name but never run
  // at once (DESIGN §2.8) — the later key is disambiguated with the sessionId so neither is lost.
  function snapshotTranscripts() {
    const transcriptsDir = join(dir, BUNDLE_FILES.transcripts);
    mkdirSync(transcriptsDir, { recursive: true });
    const manifest = {};
    const usedLabels = new Set();
    for (const a of sessionsSeen()) {
      const role = a.isCoordinator ? 'coordinator' : a.isWorkerOf ? 'worker' : 'foreign';
      const src = resolveTranscriptPath(projectsDir, a.cwd, a.sessionId);
      // A filename must not collide when two sessions share a label (same task across the run).
      let label = transcriptLabel(a);
      if (usedLabels.has(label)) label = `${label}-${a.sessionId}`;
      usedLabels.add(label);
      const bundleFile = join(BUNDLE_FILES.transcripts, `${label}.jsonl`);
      let copied = false;
      if (src && existsSync(src)) {
        try {
          copyFileSync(src, join(dir, bundleFile));
          copied = true;
        } catch {
          copied = false;
        }
      }
      const entry = {
        sessionId: a.sessionId,
        cwd: a.cwd,
        transcriptPath: src,
        role,
        copied,
        copiedTo: copied ? bundleFile : null,
      };
      // Key by name; disambiguate a recurring name (implementer vs its later reviewer) by sessionId.
      let key = a.name || a.sessionId || 'unknown';
      if (Object.prototype.hasOwnProperty.call(manifest, key)) key = `${key} (${a.sessionId})`;
      manifest[key] = entry;
    }
    return manifest;
  }

  // seal() — the stop-and-seal half. Copies the flow log, takes one `agents --json --all` for the
  // resting states, snapshots every session's transcript, captures the scratch repo's git log, and
  // writes the manifest. Idempotent: sealing twice is a no-op. Returns the loaded bundle.
  function seal() {
    if (sealed) return loadBundle(dir);
    sealed = true;

    // Flow log: copy it in place (the coordinator wrote it; it is not re-derived, DESIGN §4.1).
    if (controlDir) {
      const flowSrc = join(controlDir, 'log');
      if (existsSync(flowSrc)) {
        try {
          copyFileSync(flowSrc, join(dir, BUNDLE_FILES.flow));
        } catch {
          /* absent or unreadable flow log is recorded as an empty flow by loadBundle */
        }
      }
    }

    // Resting states: `--all` still lists ended sessions (with only their final `state`, DESIGN §4.1).
    const all = runClaude(['agents', '--json', '--all']);
    try {
      const parsed = all.ok ? parseAgentsForCapture(all.stdout).map((a) => tagAgent(a, { repo, plan: slug, coordName })) : [];
      writeFileSync(join(dir, BUNDLE_FILES.final), `${JSON.stringify(parsed, null, 2)}\n`);
    } catch {
      writeFileSync(join(dir, BUNDLE_FILES.final), '[]\n');
    }

    const manifest = snapshotTranscripts();
    writeFileSync(join(dir, BUNDLE_FILES.manifest), `${JSON.stringify(manifest, null, 2)}\n`);

    // git log of the scratch repo, so a merge/promotion is checkable after teardown (DESIGN §4.1).
    if (repoDir) {
      const g = runGit(['log', '--oneline', '--graph', '--all'], { cwd: repoDir });
      writeFileSync(join(dir, BUNDLE_FILES.gitLog), g.ok ? g.stdout : '');
    }

    return loadBundle(dir);
  }

  // stop() — end live sampling (if start()ed) and seal. The single call the live runner makes at the
  // end of a scenario.
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

// loadBundle(dir) → a plain object the assertion layer (T15) reads: the parsed flow, the agent-status
// timeline, the resting-state final snapshot, the transcript manifest, and the git log. Every field is
// present even when its file is absent (an empty array or string), so an assertion never has to guard
// for a missing file — a fact simply does not hold over empty evidence.
export function loadBundle(dir) {
  const flowText = readTextOr(join(dir, BUNDLE_FILES.flow));
  const flow = flowText.split('\n').filter((l) => l.trim() !== '').map(parseFlowLine);

  const timelineText = readTextOr(join(dir, BUNDLE_FILES.timeline));
  const timeline = timelineText
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

  let final = [];
  try {
    const t = readTextOr(join(dir, BUNDLE_FILES.final), '[]');
    final = JSON.parse(t);
    if (!Array.isArray(final)) final = [];
  } catch {
    final = [];
  }

  let manifest = {};
  try {
    const t = readTextOr(join(dir, BUNDLE_FILES.manifest), '{}');
    manifest = JSON.parse(t) ?? {};
  } catch {
    manifest = {};
  }

  const gitLog = readTextOr(join(dir, BUNDLE_FILES.gitLog));

  return { dir, name: basename(dir), flow, flowText, timeline, final, manifest, gitLog };
}
