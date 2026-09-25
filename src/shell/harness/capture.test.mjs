// capture.mjs, proven without a live agent (DESIGN §4.1, T14 acceptance; live-workers T16). The timeline
// is assembled from a temp control folder whose workers.json and conversation logs a test rewrites between
// ticks (a worker busy, then idle, then gone), with fake pid probes; seal bundles every conversation log
// and workers.json; loadBundle reads it all back. The one thing these cannot reach — a real coordinator
// writing those files — is the live run (T18).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseLogName,
  parseLog,
  logSessionId,
  statusOf,
  bundleDirFor,
  createCapture,
  loadBundle,
} from './capture.mjs';

const REPO = 'pir-t14';
const SLUG = 'scratch';

function workspace() {
  const dir = mkdtempSync(join(tmpdir(), 'pir-t16-cap-'));
  const control = join(dir, 'control');
  mkdirSync(join(control, 'conversations'), { recursive: true });
  return {
    dir,
    bundle: join(dir, 'bundle'),
    control,
    conversations: join(control, 'conversations'),
    repo: join(dir, 'repo'),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

// Conversation-log entries in the shape worker-proc writes (live-workers §2.3).
const sent = (t, text = 'pir-implement T01') => ({ t, dir: 'out', from: 'pir', kind: 'message', text });
const init = (t, sid) => ({ t, dir: 'in', event: { type: 'system', subtype: 'init', session_id: sid } });
const said = (t, sid, text = 'working') => ({
  t,
  dir: 'in',
  event: { type: 'assistant', session_id: sid, message: { role: 'assistant', content: [{ type: 'text', text }] } },
});
const result = (t, sid) => ({ t, dir: 'in', event: { type: 'result', subtype: 'success', session_id: sid, result: 'done' } });
const ask = (t) => ({ t, dir: 'request', requestId: 'r1', toolName: 'Bash', input: { command: 'rm -rf x' } });

function writeLog(ws, file, entries) {
  writeFileSync(join(ws.conversations, file), entries.map((e) => JSON.stringify(e) + '\n').join(''));
}
function writeWorkers(ws, workers) {
  writeFileSync(join(ws.control, 'workers.json'), JSON.stringify(workers));
}
const rec = (id, task, role, pid, startTime = 'Mon 1') => ({ id, task, role, pid, startTime });

// Fake pid probes: `alive` is the set of live pids, `starts` their start times.
function procs({ alive = [], starts = {} } = {}) {
  const live = new Set(alive);
  return {
    live,
    isAlive: (pid) => live.has(pid),
    startTimeOf: (pid) => starts[pid] ?? 'Mon 1',
  };
}

function capture(ws, p, extra = {}) {
  return createCapture({
    repo: REPO,
    slug: SLUG,
    dir: ws.bundle,
    controlDir: ws.control,
    repoDir: ws.repo,
    runGit: () => ({ ok: true, stdout: '* abc T01\n' }),
    isAlive: p.isAlive,
    startTimeOf: p.startTimeOf,
    ...extra,
  });
}

// --- the log helpers ------------------------------------------------------------------------------

test('parseLogName reads {Txx}-{role}-{n}.ndjson and rejects anything else', () => {
  assert.deepEqual(parseLogName('T05-review-2.ndjson'), { task: 'T05', role: 'review', n: 2 });
  assert.equal(parseLogName('T05-review-2.ndjson.tmp'), null);
  assert.equal(parseLogName('notes.txt'), null);
});

test('parseLog keeps an unparsable line raw; logSessionId reads the worker’s own session id', () => {
  const text = `${JSON.stringify(sent(1))}\n${JSON.stringify(init(2, 'sid-1'))}\n{"t":3,"dir":"in","ev`;
  const entries = parseLog(text);
  assert.equal(entries.length, 3);
  assert.equal(typeof entries[2], 'string', 'the torn last line is kept raw (§2.3)');
  assert.equal(logSessionId(entries), 'sid-1');
  assert.equal(logSessionId([sent(1)]), null, 'nothing said yet → no id');
});

test('statusOf: busy and starting are busy; idle, permission and questions are not (§2.4)', () => {
  assert.equal(statusOf('busy'), 'busy');
  assert.equal(statusOf('starting'), 'busy');
  for (const s of ['idle', 'permission', 'questions']) assert.equal(statusOf(s), 'idle');
});

// --- the timeline: workers.json plus each worker's activity from its log ---------------------------

test('the timeline shows a worker busy, then idle, then gone, and reads back via loadBundle', () => {
  const ws = workspace();
  try {
    const p = procs({ alive: [101] });
    writeWorkers(ws, [rec('sid-1', 'T01', 'implement', 101)]);
    writeLog(ws, 'T01-implement-1.ndjson', [sent(1), init(2, 'sid-1'), said(3, 'sid-1')]);
    let clock = 0;
    const cap = capture(ws, p, { now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, clock++)) });

    const t1 = cap.tick();
    assert.deepEqual(t1.workers, [
      { id: 'sid-1', task: 'T01', role: 'implement', pid: 101, startTime: 'Mon 1', status: 'busy', state: 'busy', log: 'T01-implement-1.ndjson' },
    ]);

    appendFileSync(join(ws.conversations, 'T01-implement-1.ndjson'), JSON.stringify(result(4, 'sid-1')) + '\n');
    assert.equal(cap.tick().workers[0].status, 'idle', 'its turn ended → idle');

    appendFileSync(join(ws.conversations, 'T01-implement-1.ndjson'), JSON.stringify(ask(5)) + '\n');
    const parked = cap.tick().workers[0];
    assert.equal(parked.state, 'permission', 'a pending request is the finer state');
    assert.equal(parked.status, 'idle', 'a worker waiting on the person is not busy');

    p.live.delete(101); // the child exited; workers.json may lag, the pid probe does not
    assert.deepEqual(cap.tick().workers, []);

    const b = cap.seal();
    assert.equal(b.timeline.length, 4);
    assert.deepEqual(b.timeline.map((t) => t.workers.map((w) => w.status)), [['busy'], ['idle'], ['idle'], []]);
  } finally {
    ws.cleanup();
  }
});

test('a recorded pid reused by another process (start time differs) is not counted live', () => {
  const ws = workspace();
  try {
    const p = procs({ alive: [101, 102], starts: { 101: 'Mon 1', 102: 'Tue 9' } });
    writeWorkers(ws, [rec('a', 'T01', 'implement', 101), rec('b', 'T02', 'implement', 102, 'Mon 2')]);
    const cap = capture(ws, p);
    assert.deepEqual(cap.tick().workers.map((w) => w.id), ['a']);
  } finally {
    ws.cleanup();
  }
});

test('a worker is matched to its own log by session id, not merely the newest file for its task', () => {
  const ws = workspace();
  try {
    const p = procs({ alive: [201] });
    // T02's first implementer finished (log 1); a restart spawned a second (log 2) that is live and busy.
    writeLog(ws, 'T02-implement-1.ndjson', [sent(1), init(2, 'old'), result(3, 'old')]);
    writeLog(ws, 'T02-implement-2.ndjson', [sent(4), init(5, 'new'), said(6, 'new')]);
    writeWorkers(ws, [rec('old', 'T02', 'implement', 201)]);
    const cap = capture(ws, p);
    const [w] = cap.tick().workers;
    assert.equal(w.log, 'T02-implement-1.ndjson');
    assert.equal(w.status, 'idle');
  } finally {
    ws.cleanup();
  }
});

test('a worker that has not spoken yet takes the newest unclaimed log for its task and role', () => {
  const ws = workspace();
  try {
    const p = procs({ alive: [301] });
    writeLog(ws, 'T03-review-1.ndjson', [sent(1), init(2, 'earlier'), result(3, 'earlier')]);
    writeLog(ws, 'T03-review-2.ndjson', [sent(4, 'pir-review T03')]);
    writeWorkers(ws, [rec('fresh', 'T03', 'review', 301)]);
    const [w] = capture(ws, p).tick().workers;
    assert.equal(w.log, 'T03-review-2.ndjson');
    assert.equal(w.status, 'busy', 'the opening instruction went in: a turn is open');
  } finally {
    ws.cleanup();
  }
});

test('a missing or torn workers.json records an empty tick, never a throw', () => {
  const ws = workspace();
  try {
    const cap = capture(ws, procs());
    assert.deepEqual(cap.tick().workers, []);
    writeFileSync(join(ws.control, 'workers.json'), '[{"id":');
    assert.deepEqual(cap.tick().workers, []);
  } finally {
    ws.cleanup();
  }
});

// --- seal: every conversation log and workers.json of the run --------------------------------------

test('seal bundles every conversations/*.ndjson and workers.json of the run, with a manifest and run.json', () => {
  const ws = workspace();
  try {
    writeLog(ws, 'T01-implement-1.ndjson', [sent(1), init(2, 'i1'), result(3, 'i1')]);
    writeLog(ws, 'T01-review-1.ndjson', [sent(4, 'pir-review T01'), init(5, 'r1'), result(6, 'r1')]);
    writeLog(ws, 'T02-implement-1.ndjson', [sent(7)]); // never spoke
    writeFileSync(join(ws.conversations, 'stray.txt'), 'not a log');
    writeWorkers(ws, [rec('r1', 'T01', 'review', 401)]);
    writeFileSync(join(ws.control, 'log'), '2026-01-01T00:00:00Z spawn T01\n');

    const b = capture(ws, procs()).seal();

    for (const f of ['T01-implement-1.ndjson', 'T01-review-1.ndjson', 'T02-implement-1.ndjson']) {
      assert.equal(
        readFileSync(join(ws.bundle, 'conversations', f), 'utf8'),
        readFileSync(join(ws.conversations, f), 'utf8'),
        `${f} copied byte for byte`,
      );
    }
    assert.ok(!existsSync(join(ws.bundle, 'conversations', 'stray.txt')), 'only conversation logs are bundled');
    assert.deepEqual(Object.keys(b.manifest), ['T01-implement-1.ndjson', 'T01-review-1.ndjson', 'T02-implement-1.ndjson']);
    assert.deepEqual(b.manifest['T01-review-1.ndjson'], {
      role: 'worker',
      task: 'T01',
      workerRole: 'review',
      n: 1,
      sessionId: 'r1',
      copied: true,
      copiedTo: join('conversations', 'T01-review-1.ndjson'),
    });
    assert.equal(b.manifest['T02-implement-1.ndjson'].sessionId, null);
    assert.deepEqual(b.workers, [rec('r1', 'T01', 'review', 401)]);
    assert.deepEqual(b.run, { repo: REPO, plan: SLUG });
    assert.equal(b.flow[0].type, 'spawn');
    assert.equal(b.gitLog, '* abc T01\n');
  } finally {
    ws.cleanup();
  }
});

test('seal copies the coordinator stdout into the bundle as coordinatorOut', () => {
  const ws = workspace();
  try {
    writeFileSync(join(ws.control, 'coordinator.out'), 'Yours to merge:\n\n  git merge pir/scratch\n');
    const b = capture(ws, procs()).seal();
    assert.match(b.coordinatorOut, /git merge pir\/scratch/);
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
    assert.deepEqual(b.timeline, []);
    assert.deepEqual(b.workers, []);
    assert.deepEqual(b.run, {});
    assert.deepEqual(b.manifest, {});
    assert.equal(b.gitLog, '');
    assert.equal(b.coordinatorOut, null, 'absent hand-off reads differently from an empty one');
  } finally {
    ws.cleanup();
  }
});

test('bundleDirFor puts a filesystem-safe dated dir under {parallel}/capture', () => {
  const d = bundleDirFor('/p/.parallel', new Date('2026-09-10T12:34:56.789Z'));
  assert.equal(d, '/p/.parallel/capture/2026-09-10T12-34-56-789Z');
});

test('seal is idempotent and stop() seals after start()-driven sampling', () => {
  const ws = workspace();
  try {
    let ticks = 0;
    const timers = {
      setInterval: (fn) => ({ fn }),
      clearInterval: () => {},
    };
    const cap = capture(ws, procs(), {
      timers,
      readWorkers: () => {
        ticks += 1;
        return [];
      },
    });
    cap.start();
    assert.equal(ticks, 1, 'start takes an immediate first sample');
    const a = cap.stop();
    const b = cap.seal();
    assert.equal(a.timeline.length, 1);
    assert.deepEqual(a.manifest, b.manifest);
  } finally {
    ws.cleanup();
  }
});

// --- no harness path calls `claude agents` any more (live-workers T16) ----------------------------

test('no harness module calls `claude agents` or reads ~/.claude transcripts', () => {
  const here = new URL('.', import.meta.url).pathname;
  for (const f of ['capture.mjs', 'run.mjs', 'assertions.mjs', 'fixtures.mjs', 'tokens.mjs', 'scenario.mjs']) {
    const src = readFileSync(join(here, f), 'utf8');
    assert.doesNotMatch(src, /agents --json|\['agents'|'claude', \[?args/, `${f} calls claude agents`);
    assert.doesNotMatch(src, /execFileSync\('claude'/, `${f} runs the claude CLI`);
    assert.doesNotMatch(src, /\.claude', 'projects'/, `${f} reads ~/.claude/projects`);
  }
});
