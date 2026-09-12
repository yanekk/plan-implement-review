// capture.mjs, proven without a live agent (DESIGN §4.1, T14 acceptance). The path-escape convention
// is asserted against the exact observed example; the timeline is assembled from a canned sequence of
// `agents --json` snapshots (a worker busy, then idle, then absent) and read back through loadBundle;
// transcripts are snapshotted from a temp projects/ tree (present and missing); ownership tagging is
// checked for a worker of this run, this run's coordinator, and a foreign agent. The one thing these
// cannot reach — a real agent producing the snapshots and transcripts — arrives in T17.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  escapeProjectPath,
  resolveTranscriptPath,
  parseAgentsForCapture,
  bundleDirFor,
  createCapture,
  loadBundle,
} from './capture.mjs';

const REPO = 'pir-t14';
const SLUG = 'scratch';
const COORD = `${REPO} · ${SLUG}`;
const W1 = `${REPO} · ${SLUG} · T01 · implement`;

// A temp workspace holding a bundle dir, a control dir (the flow log), a projects/ transcript store and
// a scratch repo dir. Never the real project — a throwaway temp dir, no agent spawned (the seatbelt).
function workspace() {
  const dir = mkdtempSync(join(tmpdir(), 'pir-t14-'));
  return {
    dir,
    bundle: join(dir, 'bundle'),
    control: join(dir, 'control'),
    projects: join(dir, 'projects'),
    repo: join(dir, 'repo'),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

// A canned `claude` runner: successive `agents --json` snapshots per tick, and a fixed `--all` result
// at seal. Records its calls so a test can assert argv (never `--cwd`, always `agents --json`).
function claudeSpy({ ticks = [], all = [] } = {}) {
  let i = 0;
  const calls = [];
  const fn = (args) => {
    calls.push(args);
    if (args.includes('--all')) return { ok: true, stdout: JSON.stringify(all) };
    const snap = ticks.length ? ticks[Math.min(i, ticks.length - 1)] : [];
    i += 1;
    return { ok: true, stdout: JSON.stringify(snap) };
  };
  fn.calls = calls;
  return fn;
}

function agent({ name, sessionId, cwd, status = 'busy', state = 'working', id = sessionId }) {
  return { id, sessionId, name, cwd, status, state, pid: 4242 };
}

// --- escape(cwd) (DESIGN §4.1, the exact observed convention) ------------------------------------

test('escapeProjectPath replaces every / and . with - (the observed convention)', () => {
  assert.equal(
    escapeProjectPath('/Users/j/src/pir-t10/.claude/worktrees/pir-scratch-T01'),
    '-Users-j-src-pir-t10--claude-worktrees-pir-scratch-T01',
  );
  // A leading / becomes a leading -, and /.claude collapses to --claude (the '/' and '.' abut).
  assert.equal(escapeProjectPath('/a/.b'), '-a--b');
  assert.equal(escapeProjectPath(''), '');
});

test('resolveTranscriptPath joins projectsDir, escaped cwd and sessionId.jsonl; null without both', () => {
  assert.equal(
    resolveTranscriptPath('/proj', '/Users/j/wt', 'sess-1'),
    join('/proj', '-Users-j-wt', 'sess-1.jsonl'),
  );
  assert.equal(resolveTranscriptPath('/proj', null, 'sess-1'), null);
  assert.equal(resolveTranscriptPath('/proj', '/Users/j/wt', null), null);
});

// --- parse for capture keeps sessionId (which platform.parseAgents drops) ------------------------

test('parseAgentsForCapture keeps sessionId and accepts raw text or an array', () => {
  const raw = JSON.stringify([{ id: 'a', sessionId: 's1', name: W1, cwd: '/wt', status: 'idle', state: 'done' }]);
  const [a] = parseAgentsForCapture(raw);
  assert.equal(a.sessionId, 's1');
  assert.equal(a.status, 'idle');
  const [b] = parseAgentsForCapture([{ id: 'b', sessionId: 's2', name: COORD, cwd: '/c' }]);
  assert.equal(b.sessionId, 's2');
  assert.deepEqual(parseAgentsForCapture('not-an-array-json' && '{}'), []);
});

// --- timeline assembly: busy → idle → absent (DESIGN §4.1) ---------------------------------------

test('the timeline shows a worker busy, then idle, then absent, and reads back via loadBundle', () => {
  const ws = workspace();
  try {
    const runClaude = claudeSpy({
      ticks: [
        [agent({ name: W1, sessionId: 's1', cwd: ws.repo, status: 'busy', state: 'working' })],
        [agent({ name: W1, sessionId: 's1', cwd: ws.repo, status: 'idle', state: 'working' })],
        [], // the worker has ended — gone from the live list
      ],
      all: [],
    });
    const cap = createCapture({
      repo: REPO,
      slug: SLUG,
      dir: ws.bundle,
      controlDir: ws.control,
      repoDir: ws.repo,
      runClaude,
      runGit: () => ({ ok: true, stdout: '' }),
      projectsDir: ws.projects,
    });
    cap.tick();
    cap.tick();
    cap.tick();
    cap.seal();

    const b = loadBundle(ws.bundle);
    assert.equal(b.timeline.length, 3);
    assert.equal(b.timeline[0].agents[0].status, 'busy');
    assert.equal(b.timeline[1].agents[0].status, 'idle');
    assert.equal(b.timeline[2].agents.length, 0, 'the worker has disappeared from the last tick');
    // The busy→idle transition is present, which is what proves an idle-gated close (DESIGN §2.3).
    const statuses = b.timeline.map((t) => t.agents[0]?.status ?? null);
    assert.deepEqual(statuses, ['busy', 'idle', null]);
    assert.ok(b.timeline.every((t) => typeof t.ts === 'string'));
  } finally {
    ws.cleanup();
  }
});

// --- ownership tagging by name (DESIGN §2.8, §4.1) -----------------------------------------------

test('tags this run’s worker and coordinator by name; a foreign agent is tagged not-ours', () => {
  const ws = workspace();
  try {
    const runClaude = claudeSpy({
      ticks: [
        [
          agent({ name: W1, sessionId: 's1', cwd: ws.repo }),
          agent({ name: COORD, sessionId: 's2', cwd: ws.repo }),
          agent({ name: 'someone-else · other · T99 · implement', sessionId: 's3', cwd: '/elsewhere' }),
        ],
      ],
    });
    const cap = createCapture({
      repo: REPO,
      slug: SLUG,
      dir: ws.bundle,
      controlDir: ws.control,
      runClaude,
      runGit: () => ({ ok: true, stdout: '' }),
      projectsDir: ws.projects,
    });
    const entry = cap.tick();
    const byName = Object.fromEntries(entry.agents.map((a) => [a.name, a]));

    assert.equal(byName[W1].isWorkerOf, true);
    assert.equal(byName[W1].isCoordinator, false);
    assert.equal(byName[COORD].isCoordinator, true);
    assert.equal(byName[COORD].isWorkerOf, false);
    assert.equal(byName['someone-else · other · T99 · implement'].isWorkerOf, false, 'foreign worker not ours');
    assert.equal(byName['someone-else · other · T99 · implement'].isCoordinator, false, 'foreign, not our coordinator');
    // Every agent is kept per tick, not just this run's (DESIGN §4.1).
    assert.equal(entry.agents.length, 3);
  } finally {
    ws.cleanup();
  }
});

// --- transcript snapshot: present copied, missing recorded copied:false, not a throw -------------

test('snapshots each session’s transcript; a present one is copied, a missing one is copied:false', () => {
  const ws = workspace();
  try {
    // A real transcript on disk for the worker's session, at the exact escaped path.
    const escaped = escapeProjectPath(ws.repo);
    mkdirSync(join(ws.projects, escaped), { recursive: true });
    const transcriptBody = '{"type":"assistant"}\n{"type":"user"}\n';
    writeFileSync(join(ws.projects, escaped, 's1.jsonl'), transcriptBody);

    const runClaude = claudeSpy({
      ticks: [
        [
          agent({ name: W1, sessionId: 's1', cwd: ws.repo }), // transcript present
          agent({ name: COORD, sessionId: 's2', cwd: ws.repo }), // no transcript file on disk
        ],
      ],
    });
    const cap = createCapture({
      repo: REPO,
      slug: SLUG,
      dir: ws.bundle,
      controlDir: ws.control,
      runClaude,
      runGit: () => ({ ok: true, stdout: '' }),
      projectsDir: ws.projects,
    });
    cap.tick();
    const bundle = cap.seal(); // must not throw on the missing transcript

    // The manifest maps name → its entry, and the worker's transcript was copied into the bundle.
    const worker = bundle.manifest[W1];
    assert.ok(worker, 'the worker is in the manifest, keyed by name');
    assert.equal(worker.copied, true);
    assert.equal(worker.role, 'worker');
    assert.equal(worker.sessionId, 's1');
    assert.equal(worker.transcriptPath, join(ws.projects, escaped, 's1.jsonl'));
    assert.equal(readFileSync(join(ws.bundle, worker.copiedTo), 'utf8'), transcriptBody);

    // The coordinator's transcript is missing → recorded, not thrown; role is coordinator.
    const coord = bundle.manifest[COORD];
    assert.equal(coord.copied, false);
    assert.equal(coord.role, 'coordinator');
    assert.equal(coord.copiedTo, null);
  } finally {
    ws.cleanup();
  }
});

// --- a worker name that recurs across sessions (implementer then its fresh reviewer, §2.8) -------

test('one worker name across two sessions keeps both transcripts — key and file disambiguated', () => {
  const ws = workspace();
  try {
    // Two sessions can carry the same worker name at different times — e.g. a crashed implementer
    // respawned as `implement` again (§2.8; role-suffixed names make the implement→review pair distinct,
    // but a same-role respawn still recurs). Both transcripts exist on disk under the same escaped cwd.
    const escaped = escapeProjectPath(ws.repo);
    mkdirSync(join(ws.projects, escaped), { recursive: true });
    writeFileSync(join(ws.projects, escaped, 's1.jsonl'), '{"impl":true}\n');
    writeFileSync(join(ws.projects, escaped, 's2.jsonl'), '{"review":true}\n');

    // Two ticks: the first session, then (after it ends) a second session under the same name.
    const runClaude = claudeSpy({
      ticks: [
        [agent({ name: W1, sessionId: 's1', cwd: ws.repo })],
        [agent({ name: W1, sessionId: 's2', cwd: ws.repo })],
      ],
    });
    const cap = createCapture({
      repo: REPO,
      slug: SLUG,
      dir: ws.bundle,
      controlDir: ws.control,
      runClaude,
      runGit: () => ({ ok: true, stdout: '' }),
      projectsDir: ws.projects,
    });
    cap.tick();
    cap.tick();
    const bundle = cap.seal();

    // Both sessions are in the manifest: the first keyed by name, the second disambiguated by session.
    const first = bundle.manifest[W1];
    const second = bundle.manifest[`${W1} (s2)`];
    assert.ok(first, 'the first session is keyed by the bare worker name');
    assert.ok(second, 'the second session under the same name is keyed name (sessionId), not lost');
    assert.equal(first.sessionId, 's1');
    assert.equal(second.sessionId, 's2');
    // Neither transcript file overwrote the other — distinct copiedTo paths, distinct contents.
    assert.notEqual(first.copiedTo, second.copiedTo);
    assert.equal(readFileSync(join(ws.bundle, first.copiedTo), 'utf8'), '{"impl":true}\n');
    assert.equal(readFileSync(join(ws.bundle, second.copiedTo), 'utf8'), '{"review":true}\n');
  } finally {
    ws.cleanup();
  }
});

// --- the whole sealed bundle reads back, all fields present (DESIGN §4.1 "Done when") ------------

test('loadBundle reads a sealed bundle back with every field present', () => {
  const ws = workspace();
  try {
    // A pre-existing flow log the coordinator would have written (loop.mjs record + fileControl format).
    mkdirSync(ws.control, { recursive: true });
    writeFileSync(
      join(ws.control, 'log'),
      '2026-09-10T00:00:00.000Z open-feature pir/scratch\n' +
        '2026-09-10T00:00:01.000Z spawn T01\n' +
        '2026-09-10T00:00:02.000Z ceiling full: 4/4 busy, waiting: T05\n',
    );
    const runClaude = claudeSpy({
      ticks: [[agent({ name: W1, sessionId: 's1', cwd: ws.repo, status: 'idle' })]],
      all: [agent({ name: W1, sessionId: 's1', cwd: ws.repo, status: null, state: 'stopped' })],
    });
    const cap = createCapture({
      repo: REPO,
      slug: SLUG,
      dir: ws.bundle,
      controlDir: ws.control,
      repoDir: ws.repo,
      runClaude,
      runGit: () => ({ ok: true, stdout: '* abc123 (HEAD -> main) promote\n' }),
      projectsDir: ws.projects,
    });
    cap.tick();
    cap.seal();

    const b = loadBundle(ws.bundle);
    // Flow parsed: timestamp split off, action type and its argument recovered.
    assert.equal(b.flow.length, 3);
    assert.equal(b.flow[0].type, 'open-feature');
    assert.equal(b.flow[0].rest, 'pir/scratch');
    assert.equal(b.flow[1].type, 'spawn');
    assert.equal(b.flow[1].rest, 'T01');
    assert.equal(b.flow[2].type, 'ceiling'); // free-text lines still split cleanly
    assert.ok(b.flowText.includes('open-feature'));

    assert.equal(b.timeline.length, 1);
    assert.equal(Array.isArray(b.final), true);
    assert.equal(b.final[0].state, 'stopped', 'the resting state from --all');
    assert.equal(typeof b.manifest, 'object');
    assert.ok(b.manifest[W1]);
    assert.ok(b.gitLog.includes('promote'));
    assert.equal(b.name, ws.bundle.split('/').pop());
  } finally {
    ws.cleanup();
  }
});

test('loadBundle over an empty bundle dir yields present-but-empty fields, never a throw', () => {
  const ws = workspace();
  try {
    mkdirSync(ws.bundle, { recursive: true });
    const b = loadBundle(ws.bundle);
    assert.deepEqual(b.flow, []);
    assert.equal(b.flowText, '');
    assert.deepEqual(b.timeline, []);
    assert.deepEqual(b.final, []);
    assert.deepEqual(b.manifest, {});
    assert.equal(b.gitLog, '');
  } finally {
    ws.cleanup();
  }
});

// --- bundleDirFor: a dated, filesystem-safe directory --------------------------------------------

test('bundleDirFor puts a filesystem-safe dated dir under {parallel}/capture', () => {
  const d = bundleDirFor('/plans/x/.parallel', new Date('2026-09-10T12:34:56.789Z'));
  assert.equal(d, join('/plans/x/.parallel', 'capture', '2026-09-10T12-34-56-789Z'));
  assert.ok(!d.split('/').pop().includes(':'), 'no colon in the dir name');
});

// --- seal is idempotent and start()/stop() drive tick without real time --------------------------

test('seal is idempotent and stop() seals after start()-driven sampling', () => {
  const ws = workspace();
  try {
    const runClaude = claudeSpy({ ticks: [[agent({ name: W1, sessionId: 's1', cwd: ws.repo })]] });
    // A fake timer: setInterval fires nothing on its own here; start() takes the immediate first sample.
    let cleared = false;
    const timers = {
      setInterval: () => ({ unref() {} }),
      clearInterval: () => {
        cleared = true;
      },
    };
    const cap = createCapture({
      repo: REPO,
      slug: SLUG,
      dir: ws.bundle,
      controlDir: ws.control,
      repoDir: ws.repo,
      runClaude,
      runGit: () => ({ ok: true, stdout: '' }),
      projectsDir: ws.projects,
      timers,
    });
    cap.start(); // one immediate tick
    const first = cap.stop(); // clears the interval and seals
    assert.equal(cleared, true);
    assert.equal(first.timeline.length, 1);
    const again = cap.seal(); // sealing twice is a no-op that re-reads the bundle
    assert.equal(again.timeline.length, 1);
  } finally {
    ws.cleanup();
  }
});
