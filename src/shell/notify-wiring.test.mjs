// The phone alerts wired into the build run (reliable-notifications T07, DESIGN §2.1–§2.8, §3.3): the views
// the shell builds each pass, the action runner, one pass over the fake platform, the exit bound, the
// session environment, and a source check that main calls all of it on every path. No test here reaches
// the network: publish and clear are fakes recording their calls.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  notifyViews, runNotifyActions, newNotifyTrack, notifyPass, endAlertAction, withinMs, workerEnv,
  NOTIFY_EXIT_WAIT_MS, remoteWanted, startCoordinator, endAlertPass, finisherOneShot,
} from './coordinate.mjs';
import { newNotifyState, notifyExit } from '../core/notify.mjs';
import { createFakePlatform, FAKE_REMOTE_URL } from './fake/platform.mjs';
import { createFakeWorktree } from './fake/worktree.mjs';
import { writeNotifyConfig, notifyPaths } from './notify-config.mjs';

const TOPIC = 'pir-secrettopicabcdefghijklmn';
const CONFIG = { server: 'https://ntfy.sh', topic: TOPIC };
const ICON = 'https://example.test/icon.png';

// ---- notifyViews ----

const parked = (workerId, text) => ({ phase: 'awaiting-answer', workerId, role: 'implement', decision: { text } });
const idle = { state: 'idle', open: false, turns: 1, pending: [] };
const liveW = (over = {}) => ({ id: 'w1', task: 'T01', role: 'implement', live: true, activity: idle, remote: 'off', url: null, lastText: null, ...over });

test('views: a report park passed on, a reserved permission and a timed-out question set get their kind and prefix', () => {
  const workers = [
    liveW({ id: 'w1', task: 'T01' }),
    liveW({
      id: 'w2', task: 'T02', role: 'review', remote: 'on', url: `${FAKE_REMOTE_URL}w2`,
      activity: { state: 'permission', open: true, pending: [{ kind: 'permission', requestId: 'r1', toolName: 'Bash', input: { command: 'rm -rf build' } }] },
    }),
    liveW({
      id: 'w3', task: 'T03',
      activity: { state: 'questions', open: true, pending: [{ kind: 'questions', requestId: 'q1', questions: [{ question: 'Which database?' }, { question: 'Which port?' }] }] },
    }),
  ];
  const stateTasks = { T01: parked('w1', 'JSON or YAML?'), T02: { phase: 'reviewing', workerId: 'w2' }, T03: { phase: 'implementing', workerId: 'w3' } };
  const why = new Map([['w1', 'passed'], ['w2', 'reserved'], ['w3', 'timeout']]);
  const views = notifyViews({ plan: 'demo', workers, stateTasks, why });
  assert.deepEqual(views, [
    { id: 'w1', waiting: 'question', title: 'demo · T01 implement', message: 'Agent passed it on: asks: JSON or YAML?', remote: 'wanted', url: null },
    { id: 'w2', waiting: 'permission', title: 'demo · T02 review', message: 'Needs your yes: wants to run Bash rm -rf build', remote: 'wanted', url: `${FAKE_REMOTE_URL}w2` },
    { id: 'w3', waiting: 'questions', title: 'demo · T03 implement', message: "Agent didn't answer in time: asks: Which database? (+1 more)", remote: 'wanted', url: null },
  ]);
});

test('views: a worker the agent holds gets waiting null; a non-holder with nothing pending and an exited worker have no view', () => {
  const pending = [{ kind: 'permission', requestId: 'r1', toolName: 'Bash', input: { command: 'npm test' } }];
  const workers = [
    liveW({ id: 'w1', task: 'T01', activity: { state: 'permission', open: true, pending } }),
    liveW({ id: 'w2', task: 'T02' }), // the implementer still closing; its task is held by w3
    liveW({ id: 'w3', task: 'T02', role: 'review', activity: { state: 'busy', open: true, pending: [] } }),
    liveW({ id: 'w4', task: 'T04', live: false }),
  ];
  const stateTasks = { T01: { phase: 'implementing', workerId: 'w1' }, T02: parked('w3', 'x'), T04: parked('w4', 'y') };
  const views = notifyViews({ plan: 'demo', workers, stateTasks, heldByAgent: new Set(['w1:r1']) });
  assert.deepEqual(views.map((v) => [v.id, v.waiting]), [['w1', null]]);
  // The same predicate remoteWanted reads: neither names a worker the other does not.
  assert.deepEqual([...remoteWanted(workers, stateTasks, { heldByAgent: new Set(['w1:r1']) })], []);
});

test('views: a report-less question uses the worker\'s last text; none gives the fallback; a helper gets its helper title', () => {
  const workers = [
    liveW({ id: 'w1', task: 'T01', lastText: 'Should the port be 8080?' }),
    liveW({ id: 'w2', task: 'T02' }),
    liveW({ id: 'w3', task: 'main-sync', role: 'fix' }),
  ];
  const stateTasks = {
    T01: { phase: 'implementing', workerId: 'w1' },
    T02: { phase: 'implementing', workerId: 'w2' },
    'main-sync': parked('w3', 'Keep main\'s version?'),
  };
  const idleBg = { ...idle, background: [] }; // stoppedOnPerson needs the background list
  for (const w of workers) w.activity = idleBg;
  const views = notifyViews({ plan: 'demo', workers, stateTasks, why: new Map([['w3', 'off']]) });
  assert.deepEqual(views.map((v) => [v.title, v.message]), [
    ['demo · T01 implement', 'asks: Should the port be 8080?'],
    ['demo · T02 implement', 'is waiting for you'],
    ['demo · main-sync resolve-base-merge', 'asks: Keep main\'s version?'],
  ]);
});

test('views: remote is refused for a refused worker, off when REMOTE is off, else wanted', () => {
  const workers = [liveW({ id: 'w1', task: 'T01', remote: 'refused' }), liveW({ id: 'w2', task: 'T02' })];
  const stateTasks = { T01: parked('w1', 'a'), T02: parked('w2', 'b') };
  assert.deepEqual(notifyViews({ plan: 'p', workers, stateTasks }).map((v) => v.remote), ['refused', 'wanted']);
  assert.deepEqual(notifyViews({ plan: 'p', workers, stateTasks, remoteOn: false }).map((v) => v.remote), ['refused', 'off']);
});

// ---- runNotifyActions ----

function fakeSender({ publishResult = { ok: true, status: 200 }, clearResult = { ok: true, status: 200 } } = {}) {
  const s = { published: [], cleared: [], notes: [], logs: [], order: [] };
  s.publish = async (fields) => {
    s.published.push(fields);
    s.order.push(`publish ${fields.seq}`);
    return typeof publishResult === 'function' ? publishResult(fields) : publishResult;
  };
  s.clear = async (fields) => {
    s.cleared.push(fields);
    s.order.push(`clear ${fields.seq}`);
    return clearResult;
  };
  s.opts = (over = {}) => ({
    readConfig: () => CONFIG,
    icon: ICON,
    publish: s.publish,
    clear: s.clear,
    note: (id, kind, fields) => s.notes.push({ id, kind, fields }),
    log: (line) => s.logs.push(line),
    ...over,
  });
  return s;
}

const send = (over = {}) => ({ type: 'send', id: 'w1', seq: 'pir-w1-1', title: 'demo · T01 implement', message: 'asks: x', click: null, reminder: false, ...over });

test('runner: no config drops every action and notes nothing; a corrupt config is no config', async () => {
  for (const readConfig of [() => null, () => ({ corrupt: true })]) {
    const s = fakeSender();
    await runNotifyActions([send(), { type: 'clear', id: 'w1', seq: 'pir-w1-1' }], s.opts({ readConfig }));
    assert.deepEqual([s.published, s.cleared, s.notes, s.logs], [[], [], [], []]);
  }
});

test('runner: a send carries the icon and the config, notes `notified`; a reminder notes reminder true', async () => {
  const s = fakeSender();
  const track = newNotifyTrack();
  await runNotifyActions([send({ click: 'https://claude.ai/code/session_x' })], s.opts({ track }));
  await runNotifyActions([send({ message: 'Still waiting: asks: x', reminder: true })], s.opts({ track }));
  assert.equal(s.published.length, 2);
  for (const p of s.published) {
    assert.equal(p.icon, ICON);
    assert.equal(p.topic, TOPIC);
    assert.equal(p.server, 'https://ntfy.sh');
    assert.equal(p.seq, 'pir-w1-1');
  }
  assert.equal(s.published[0].click, 'https://claude.ai/code/session_x');
  assert.deepEqual(s.notes, [
    { id: 'w1', kind: 'notified', fields: { reminder: false } },
    { id: 'w1', kind: 'notified', fields: { reminder: true } },
  ]);
});

test('runner: a failed send notes `notify-failed` once per episode; a failed clear notes nothing', async () => {
  const s = fakeSender({ publishResult: { ok: false, status: 503, error: 'HTTP 503' }, clearResult: { ok: false, status: null, error: 'fetch failed' } });
  const track = newNotifyTrack();
  await runNotifyActions([send()], s.opts({ track }));
  await runNotifyActions([send({ reminder: true })], s.opts({ track }));
  await runNotifyActions([{ type: 'clear', id: 'w1', seq: 'pir-w1-1' }], s.opts({ track }));
  assert.deepEqual(s.notes, [{ id: 'w1', kind: 'notify-failed', fields: { status: 503, error: 'HTTP 503' } }]);
  // The next episode of the same worker is a new episode: its failure is noted again.
  await runNotifyActions([send({ seq: 'pir-w1-2' })], s.opts({ track }));
  assert.equal(s.notes.length, 2);
});

test('runner: a clear for an episode whose send is still in flight goes out after the send settles', async () => {
  const s = fakeSender();
  let release;
  const gate = new Promise((r) => (release = r));
  const track = newNotifyTrack();
  const opts = s.opts({ track, publish: async (f) => (s.order.push(`publish ${f.seq}`), await gate, { ok: true, status: 200 }) });
  const sending = runNotifyActions([send()], opts);
  const clearing = runNotifyActions([{ type: 'clear', id: 'w1', seq: 'pir-w1-1' }], opts);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(s.order, ['publish pir-w1-1'], 'the clear waits for the send');
  release();
  await Promise.all([sending, clearing]);
  assert.deepEqual(s.order, ['publish pir-w1-1', 'clear pir-w1-1']);
  assert.equal(track.inflight.size, 0, 'a settled send leaves nothing in flight');
});

test('runner: the flow-log lines name worker, seq and status and never the topic', async () => {
  const s = fakeSender({ publishResult: { ok: false, status: null, error: `fetch failed: https://ntfy.sh/${TOPIC}` } });
  await runNotifyActions([send(), { type: 'clear', id: 'w1', seq: 'pir-w1-1' }], s.opts());
  const ok = fakeSender();
  await runNotifyActions([send({ id: 'w2', seq: 'pir-w2-1' }), endAlertAction({ title: 't', message: 'm', tags: ['tada'] })], ok.opts());
  const lines = [...s.logs, ...ok.logs];
  assert.deepEqual(lines, [
    'notify send w1 pir-w1-1 failed fetch failed: https://ntfy.sh/…',
    'notify clear w1 pir-w1-1 ok 200',
    'notify send w2 pir-w2-1 ok 200',
    'notify send end - ok 200',
  ]);
  assert.ok(lines.every((l) => !l.includes(TOPIC)));
  assert.ok(s.notes.every((n) => !JSON.stringify(n).includes(TOPIC)), 'nor in the failure note');
});

test('runner: the end alert carries its own tags, no seq, and notes on the agent or nowhere', async () => {
  const s = fakeSender();
  await runNotifyActions([endAlertAction({ title: 'demo · ready to merge', message: 'm', tags: ['tada'], click: 'https://claude.ai/code/session_a' }, { noteTo: 'agent-1' })], s.opts());
  await runNotifyActions([endAlertAction({ title: 'demo · not ready', message: 'm', tags: ['warning'] })], s.opts());
  assert.deepEqual(s.published.map((p) => [p.tags, p.seq, p.click]), [[['tada'], null, 'https://claude.ai/code/session_a'], [['warning'], null, null]]);
  assert.deepEqual(s.notes, [{ id: 'agent-1', kind: 'notified', fields: { reminder: false } }]);
});

// ---- notifyPass over the fake platform ----

const SLUG = 'demo';
const REPO = 'demo-repo';
function progressDoc(nums) {
  const rows = nums.map((n) => `| ${n} | ${n}-thing | auto | — | ⬜ | |`).join('\n');
  return `# Progress\n\n**Plan reviewed:** 2026-09-08 — reviewed\n\n| # | Task | Runs | Depends on | State | Notes |\n|---|---|---|---|---|---|\n${rows}\n`;
}

// A hand-played agent, as coordinate.test.mjs's whyPerson tests use: the test queues its passes and settles.
function scriptedAgent() {
  const a = {
    up: true,
    briefs: [],
    toPass: [],
    toSettle: [],
    alive: () => a.up,
    brief(item) {
      if (!a.up) return false;
      a.briefs.push(item);
      return true;
    },
    drain() {
      const out = { passed: a.toPass.map((i) => ({ ...i, reason: 'yours' })), settled: [...a.toSettle] };
      a.toPass = [];
      a.toSettle = [];
      return out;
    },
    answeredElsewhere: () => true,
    timedOut() {},
    forget() {},
    close: async () => {},
    remoteUrl: () => 'https://claude.ai/code/session_agent',
    session: null,
  };
  return a;
}

// alertRun(t, behaviors, { remote }) → a one-task run and a pass that does what main does: the coordinator's
// pass, the REMOTE-gated Remote Control sync, then notifyPass with a clock the test moves.
function alertRun(t, behaviors, { remote = true, startAgent } = {}) {
  const worktree = createFakeWorktree({ progress: progressDoc(['T01']), slug: SLUG });
  t.after(() => worktree.cleanup());
  const platform = createFakePlatform({ behaviors: { T01: behaviors } });
  const agent = scriptedAgent();
  const clock = { t: 1_000_000 };
  const coordinator = startCoordinator({
    slug: SLUG, repo: REPO, platform, worktree, now: () => clock.t,
    startAgent: startAgent === undefined ? () => agent : startAgent,
  });
  const s = fakeSender();
  const track = newNotifyTrack();
  let notifyState = newNotifyState();
  const runs = [];
  const run = (actions) => runs.push(runNotifyActions(actions, s.opts({ track })));
  const pass = async () => {
    coordinator.pass();
    if (remote) {
      const wanted = remoteWanted(platform.workers(), coordinator.state.tasks, { heldByAgent: coordinator.heldByAgent() });
      for (const w of platform.workers()) if (w.live) platform.remoteControl(w.id, wanted.has(w.id));
    }
    notifyState = notifyPass({ plan: SLUG, platform, coordinator, notifyState, remote, now: clock.t, run });
    await Promise.all(runs);
  };
  const w = () => platform.spawns.find((x) => x.task === 'T01' && x.role === 'implement')?.id;
  return { coordinator, platform, agent, clock, s, pass, w, state: () => notifyState };
}

const NPM_TEST = { toolName: 'Bash', input: { command: 'npm test' } };

test('notifyPass: a question the agent answers yields nothing', async (t) => {
  const run = alertRun(t, { requests: [NPM_TEST] });
  await run.pass();
  await run.pass();
  run.agent.toSettle.push({ worker: run.w(), requestId: `${run.w()}-r1` });
  run.platform.answer(run.w(), `${run.w()}-r1`, { behavior: 'allow' }, { from: 'coordinator' });
  await run.pass();
  await run.pass();
  assert.deepEqual([run.s.published, run.s.cleared], [[], []]);
});

test('notifyPass: passed on → one send with the worker\'s link as click and the `passed` prefix; answered → one clear', async (t) => {
  const run = alertRun(t, { requests: [NPM_TEST] });
  await run.pass();
  assert.equal(run.s.published.length, 0, 'held by the agent');
  run.agent.toPass.push({ worker: run.w(), requestId: `${run.w()}-r1` });
  await run.pass();
  assert.equal(run.s.published.length, 1);
  const [p] = run.s.published;
  assert.equal(p.click, FAKE_REMOTE_URL + run.w());
  assert.equal(p.title, `${SLUG} · T01 implement`);
  assert.equal(p.message, 'Agent passed it on: wants to run Bash npm test');
  assert.equal(p.seq, `pir-${run.w()}-1`);
  await run.pass();
  assert.equal(run.s.published.length, 1, 'no repeat before the reminder');
  run.platform.answer(run.w(), `${run.w()}-r1`, { behavior: 'allow' }, { from: 'person' });
  await run.pass();
  assert.deepEqual(run.s.cleared.map((c) => c.seq), [`pir-${run.w()}-1`]);
  assert.deepEqual(run.s.notes.map((n) => [n.id, n.kind]), [[run.w(), 'notified']]);
});

test('notifyPass: with REMOTE off a person question is sent at once with no click', async (t) => {
  const run = alertRun(t, { requests: [NPM_TEST] }, { remote: false, startAgent: null });
  await run.pass();
  assert.equal(run.s.published.length, 1);
  assert.equal(run.s.published[0].click, null);
  assert.equal(run.s.published[0].message, 'wants to run Bash npm test', 'no agent: no prefix');
});

test('notifyPass: a stuck Remote Control holds the first alert 20 s, then sends it without a link', async (t) => {
  const run = alertRun(t, { requests: [NPM_TEST], remote: 'stuck' }, { startAgent: null });
  await run.pass();
  assert.equal(run.s.published.length, 0, 'waiting for the link');
  run.clock.t += 20_000;
  await run.pass();
  assert.equal(run.s.published.length, 1);
  assert.equal(run.s.published[0].click, null);
});

// ---- The exit ----

test('exit: the open sent episodes are cleared, and the wait is bounded at 2 s', async () => {
  const state = { episodes: { w1: { n: 1, sentAt: 5, seq: 'pir-w1-1' }, w2: { n: 1, sentAt: null, seq: 'pir-w2-1' } }, counts: {} };
  const s = fakeSender();
  await runNotifyActions(notifyExit(state), s.opts());
  assert.deepEqual(s.cleared.map((c) => c.seq), ['pir-w1-1'], 'only what the phone was sent');
  assert.equal(NOTIFY_EXIT_WAIT_MS, 2000);
  const t0 = Date.now();
  await withinMs(new Promise(() => {}), 30);
  assert.ok(Date.now() - t0 < 1000, 'a send that never settles does not hold the exit');
  assert.equal(await withinMs(Promise.reject(new Error('x')), 30), undefined, 'a rejection does not escape');
});

// The main loop builds the real platform and cannot be driven with the fake, so its wiring is checked in
// the source: notifyPass every pass, and the bounded exit sends on every exit path.
test('main: notifyPass runs every pass, and every exit path awaits the exit clears', () => {
  const src = readFileSync(fileURLToPath(new URL('./coordinate.mjs', import.meta.url)), 'utf8');
  const main = src.slice(src.indexOf('async function main(argv)'));
  const loop = main.slice(main.indexOf('for (;;) {'));
  assert.match(loop, /if \(REMOTE\) syncRemote\(coordinator\.state\.tasks\);\n\s*\/\/[^\n]*\n\s*try \{\n\s*notifyState = notifyPass\(/, 'after the REMOTE-gated sync, not gated by it');
  const paths = {
    signal: /process\.on\(sig, async \(\) => \{[\s\S]*?await notifyExitNow\(\);\n\s*process\.exit\(130\);/,
    halt: /HALTED by the kill switch[^\n]*\n\s*await notifyExitNow\(\);\n\s*return;/,
    finished: /renderFinished\([^\n]*\n[\s\S]*?await notifyExitNow\(done\);\n\s*return;/,
    noAgentComplete: /await notifyExitNow\(runNotify\(\[endAlertAction\(alert\)\]\)\);\n\s*return;/,
    runaway: /teardownOnce\('runaway'\);\n\s*await notifyExitNow\(\);\n\s*return;/,
    stall: /teardownOnce\('stalled'\);[^\n]*\n\s*await notifyExitNow\(\);\n\s*return;/,
    error: /teardownOnce\('error'\);\n\s*await notifyExitNow\(\);\n\s*throw e;/,
  };
  for (const [name, re] of Object.entries(paths)) assert.match(main, re, name);
  assert.match(main, /stopDetached\(\);\n\s*else teardownOnce/, 'the detached stop is inside the same awaiting handler');
  assert.match(main, /withinMs\([^\n]*NOTIFY_EXIT_WAIT_MS\)/);
  assert.match(main, /endAlertSent = endAlertPass\(/);
});

// The signal handler awaits the exit clears before process.exit, so the loop is still scheduled during that
// wait. A pass there would run after teardown closed every worker and could dispatch fresh ones into the
// freed slots, orphaned by the exit a moment later. The loop must run no pass once a signal is handled.
test('main: no pass runs after a signal, while the handler waits on the exit clears', () => {
  const src = readFileSync(fileURLToPath(new URL('./coordinate.mjs', import.meta.url)), 'utf8');
  const main = src.slice(src.indexOf('async function main(argv)'));
  const loop = main.slice(main.indexOf('for (;;) {'));
  const guard = loop.search(/if \(signalled\) await new Promise\(\(\) => \{\}\);/);
  assert.ok(guard !== -1, 'the loop parks once a signal is being handled');
  assert.ok(guard < loop.indexOf('coordinator.pass()'), 'before the pass, at the top of every iteration');
  assert.match(main, /if \(signalled\) process\.exit\(130\);\n\s*signalled = true;\n\s*if \(selfReport/, 'the flag is set before teardown');
});

// ---- The session environment (DESIGN §2.7) ----

test('workerEnv: null with no config or a corrupt one; the presence variable with one, and the marker exists after', (t) => {
  const home = mkdtempSync(join(tmpdir(), 'pir-t07-env-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const env = { PIR_HOME: home };
  assert.equal(workerEnv(env), null);
  const { config, presence } = notifyPaths(env);
  mkdirSync(join(config, '..'), { recursive: true });
  writeFileSync(config, '{not json');
  assert.equal(workerEnv(env), null);
  assert.equal(existsSync(presence), false, 'no marker without a config');
  writeNotifyConfig(CONFIG, env);
  assert.deepEqual(workerEnv(env), { CLAUDE_CLIENT_PRESENCE_FILE: presence });
  assert.equal(existsSync(presence), true);
});

test('main: build workers and the agent are started with the same workerEnv', () => {
  const src = readFileSync(fileURLToPath(new URL('./coordinate.mjs', import.meta.url)), 'utf8');
  const main = src.slice(src.indexOf('async function main(argv)'));
  assert.match(main, /createPlatform\(\{[^\n]*workerEnv: \(\) => workerEnv\(\) \}\)/);
  assert.match(main, /startCoordinatorAgent\(\{[\s\S]*?env: \(\) => workerEnv\(\),\n\s*\}\)/);
});

// ---- The finisher's alerts (finisher DESIGN §2.9, §2.12; T06) ----

// A stand-in coordinator for notifyPass: no workers, and a finisher whose view and parked requests the test
// sets, shaped as finisher-agent.mjs's Finisher.
function finisherRun({ phase = 'awaiting-go', pending = [], url = 'https://claude.ai/code/session_fin', refused = false } = {}) {
  const f = {
    id: 'fin-1',
    phase,
    pending,
    alive: () => true,
    remoteUrl: () => url,
    session: { pending: () => f.pending, remoteRefused: refused },
  };
  const coordinator = {
    state: { tasks: {} },
    heldByAgent: () => new Set(),
    whyPerson: () => new Map(),
    get finisher() {
      return f;
    },
    finisherView: () => ({ state: f.phase, phase: f.phase, summary: 'A step failed: install.sh exited 1', steps: ['git merge pir/demo', './install.sh'], rulesSource: 'project', asking: f.pending.length > 0 }),
  };
  const platform = { workers: () => [] };
  const s = fakeSender();
  const track = newNotifyTrack();
  let notifyState = newNotifyState();
  const runs = [];
  const run = (actions) => runs.push(runNotifyActions(actions, s.opts({ track })));
  const pass = async (now) => {
    notifyState = notifyPass({ plan: SLUG, platform, coordinator, notifyState, remote: true, now, run, stepOpts: { remindMs: 900_000 } });
    await Promise.all(runs);
  };
  return { f, s, pass };
}

const GO_Q = { kind: 'questions', requestId: 'q1', questions: [{ question: 'Go?', header: 'Go' }] };

test('finisher: ready → one alert with its link, noted on its conversation; a reminder at 15 min; cleared on finishing', async () => {
  const r = finisherRun({ pending: [GO_Q] });
  await r.pass(0);
  assert.deepEqual(r.s.published.map((p) => [p.title, p.message, p.click, p.seq]), [
    ['demo · ready for your go', '2 steps from project rules: git merge pir/demo', 'https://claude.ai/code/session_fin', 'pir-finisher-1'],
  ]);
  assert.deepEqual(r.s.notes, [{ id: 'fin-1', kind: 'notified', fields: { reminder: false } }]);
  await r.pass(900_000);
  assert.equal(r.s.published[1].message, 'Still waiting: 2 steps from project rules: git merge pir/demo');
  r.f.phase = 'finishing';
  r.f.pending = [];
  await r.pass(900_001);
  assert.deepEqual(r.s.cleared.map((c) => c.seq), ['pir-finisher-1']);
  assert.deepEqual(r.s.logs, ['notify send finisher pir-finisher-1 ok 200', 'notify reminder finisher pir-finisher-1 ok 200', 'notify clear finisher pir-finisher-1 ok 200']);
  assert.ok(r.s.logs.every((l) => !l.includes(TOPIC)));
});

test('finisher: stuck → `finisher stuck` with the summary; a reserved request in finishing → `Needs your yes`', async () => {
  const r = finisherRun({ phase: 'stuck', pending: [GO_Q] });
  await r.pass(0);
  assert.deepEqual(r.s.published.map((p) => [p.title, p.message]), [['demo · finisher stuck', 'A step failed: install.sh exited 1']]);
  r.f.phase = 'finishing';
  r.f.pending = [{ kind: 'permission', requestId: 'r1', toolName: 'Bash', input: { command: 'git push origin main' } }];
  await r.pass(10);
  assert.deepEqual(r.s.cleared.map((c) => c.seq), ['pir-finisher-1']);
  assert.deepEqual(r.s.published.slice(1).map((p) => [p.title, p.message, p.seq]), [['demo · finisher', 'Needs your yes: wants to run Bash git push origin main', 'pir-finisher-2']]);
});

test('finisher: `pir notify off` (no config) sends nothing, read per send', async () => {
  const s = fakeSender();
  await runNotifyActions([finisherOneShot({ title: 'demo · finished', message: 'm', tags: ['tada'] })], s.opts({ readConfig: () => null }));
  assert.deepEqual([s.published, s.logs, s.notes], [[], [], []]);
  const on = fakeSender();
  await runNotifyActions([finisherOneShot({ title: 'demo · finished', message: 'm', tags: ['tada'] }, { click: 'https://f' })], on.opts());
  assert.deepEqual(on.published.map((p) => [p.title, p.seq, p.tags, p.click]), [['demo · finished', null, ['tada'], 'https://f']]);
  assert.deepEqual(on.logs, ['notify send finisher - ok 200']);
});

test('endAlertPass with the finisher: no `ready to merge`; red still `not ready`; gave up and failed to start', () => {
  const r = (handoff, over = {}) => ({ handoff, tasks: [{}, {}], testsReason: null, ...over });
  const sent = [];
  const fin = [];
  const call = (rr, sentBefore = false) => endAlertPass({ r: rr, coordinator: null, slug: 'demo', sent: sentBefore, send: (a) => sent.push(a), takesOver: true, sendFinisher: (a) => fin.push(a) });
  assert.equal(call(r({ state: 'ready' })), false);
  assert.equal(call(r({ state: 'ready', finisher: 'on' })), false);
  assert.deepEqual([sent, fin], [[], []]);
  assert.equal(call(r({ state: 'red', finisher: 'fallback', fallback: 'red' }, { testsReason: { reason: 'T03 failed' } })), true);
  assert.deepEqual(sent.map((a) => [a.title, a.message]), [['demo · not ready', 'Tests red on pir/demo: T03 failed']]);
  assert.equal(call(r({ state: 'ready', finisher: 'fallback', fallback: 'gave-up' })), true);
  assert.deepEqual(fin.map((a) => [a.title, a.message]), [['demo · finisher gave up', 'Merge by hand: git merge pir/demo']]);
  assert.equal(call(r({ state: 'ready', finisher: 'fallback', fallback: 'gave-up' }), true), true, 'sent once');
  assert.equal(fin.length, 1);
  assert.equal(call(r({ state: 'ready', finisher: 'fallback', fallback: 'failed' })), true);
  assert.equal(sent.at(-1).title, 'demo · ready to merge');
  // Without the finisher, today's alert is unchanged.
  const plain = [];
  endAlertPass({ r: r({ state: 'ready' }), coordinator: null, slug: 'demo', send: (a) => plain.push(a) });
  assert.equal(plain[0].title, 'demo · ready to merge');
});

test('main: the end alert knows the finisher takes over, and the done alert is sent with the exit', () => {
  const src = readFileSync(fileURLToPath(new URL('./coordinate.mjs', import.meta.url)), 'utf8');
  const main = src.slice(src.indexOf('async function main(argv)'));
  assert.match(main, /takesOver: startFinisher !== null,/);
  assert.match(main, /r\.finished === 'finisher'\n\s*\? runNotify\(\[finisherOneShot\(finisherAlert\(\{ slug, phase: 'done', summary: lastFinisherSummary \}\), \{ click: lastFinisherUrl \}\)\]\)/);
});
