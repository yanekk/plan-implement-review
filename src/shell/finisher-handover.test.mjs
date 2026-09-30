// finisher T05 — the run's end hands over to the finisher (finisher DESIGN §2.1, §2.8, §2.12), against the
// fake platform, the fake worktree and stub sessions. The finisher is the real finisher-agent.mjs over a stub
// session, so its status drain, go detection, state.json and resume are the shipped ones; the agent is the
// real coordinator-agent.mjs over stub sessions, as coordinate.test.mjs's end-sequence tests use it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startCoordinator, renderFinished, clearTransientFeeds, buildRunState } from './coordinate.mjs';
import { startCoordinatorAgent, withAgent, readJson } from './coordinator-agent.mjs';
import { startFinisher as startFinisherSession } from './finisher-agent.mjs';
import { createFakePlatform } from './fake/platform.mjs';
import { createFakeWorktree, git } from './fake/worktree.mjs';
import { readEntry, answersResult } from '../core/stream.mjs';

process.env.PARALLEL_DRY_RUN = '1';

const REPO = 'demo-repo';
const SLUG = 'demo';
const REPORT_REL = `plans/${SLUG}/REPORT.md`;
const SECTIONS = { delivered: 'The greeting works.', checkByHand: 'Run it once.', risks: 'None known.' };
const T0 = Date.parse('2026-09-29T10:00:00Z');

function progressDoc(rows) {
  const body = rows.map((r) => `| ${r.num} | ${r.num}-thing | auto | — | ⬜ | |`).join('\n');
  return `# Progress\n\n**Plan reviewed:** 2026-09-08 — reviewed\n\n| # | Task | Runs | Depends on | State | Notes |\n|---|---|---|---|---|---|\n${body}\n`;
}

// Stub sessions for the agent and the finisher: what startWorker returns, recording what was sent, with a
// log of entries the finisher's go detection reads, and requests a test parks with ask().
function stubSessions() {
  const sessions = [];
  const startWorker = (opts) => {
    const entries = [];
    const pend = new Map();
    const exitFns = [];
    const s = {
      id: opts.resume ?? opts.sessionId,
      opts,
      pid: null,
      dead: false,
      closed: false,
      told: [],
      remoteUrl: null,
      send(text, { from = 'pir' } = {}) {
        if (s.dead) return false;
        s.told.push({ text, from });
        entries.push({ dir: 'out', kind: 'message', from, text });
        return true;
      },
      ask(input) {
        const requestId = `req-${entries.length}`;
        const e = { dir: 'request', requestId, toolName: 'AskUserQuestion', input };
        entries.push(e);
        pend.set(requestId, e);
        return requestId;
      },
      answer(requestId, result, { from = 'person' } = {}) {
        if (!pend.has(requestId)) return false;
        pend.delete(requestId);
        entries.push({ dir: 'out', from, kind: 'reply', requestId, result });
        return true;
      },
      pending: () => [...pend.values()].map((e) => readEntry(e)[0]),
      note(kind, fields = {}) {
        entries.push({ dir: 'note', kind, ...fields });
      },
      interrupt: async () => {},
      remoteControl: async () => {},
      // The agent session subscribes to its events for the loop's wake-up (fast-tests T01); unused here.
      onEvent: () => {},
      onExit: (fn) => exitFns.push(fn),
      entries: () => entries.slice(),
      close: async () => {
        s.dead = true;
        s.closed = true;
      },
      exit() {
        s.dead = true;
        for (const fn of exitFns) fn({ code: 1 });
      },
    };
    sessions.push(s);
    return s;
  };
  return { sessions, startWorker, latest: () => sessions.at(-1) };
}

const GOQ = { questions: [{ question: 'Finish demo? 1 step from project rules', header: 'Go', options: [{ label: 'Go' }, { label: 'Not yet' }], multiSelect: false }] };
const READY = { kind: 'ready', rules: '/r/on-finish.md', summary: 'All clean.', steps: ['git merge pir/demo'] };

// finRun(t, opts) → a run with the agent and the finisher on, and helpers to play both.
function finRun(t, { worktree, controlDir, runTests, startFinisher, finisherStubs, control, agentStubs, base = 'main' } = {}) {
  const wt = worktree ?? createFakeWorktree({ progress: progressDoc([{ num: 'T01' }]), slug: SLUG, base });
  if (!worktree) t.after(() => wt.cleanup());
  const platform = createFakePlatform({});
  const cdir = controlDir ?? mkdtempSync(join(tmpdir(), 'pir-fin-t05-'));
  if (!controlDir) t.after(() => rmSync(cdir, { recursive: true, force: true }));
  const agents = agentStubs ?? stubSessions();
  const fins = finisherStubs ?? stubSessions();
  const clock = { t: T0 };
  const logs = [];
  const started = [];
  const coordinator = startCoordinator({
    slug: SLUG, repo: REPO, platform, worktree: wt, runTests, base, now: () => clock.t,
    control: control ?? { isHalted: () => false, log: (l) => logs.push(l) },
    startAgent: ({ featurePath, askRules }) => startCoordinatorAgent({
      controlDir: cdir, featurePath, repoRoot: featurePath, slug: SLUG, platform, askRules,
      startWorker: agents.startWorker, claudePath: '/nonexistent/claude', skillsDir: cdir, now: () => clock.t,
    }),
    startFinisher: startFinisher ?? (({ featurePath, askRules, reportPath, base: runBase }) => {
      started.push({ featurePath, askRules, reportPath, base: runBase });
      return startFinisherSession({
        controlDir: cdir, featurePath, repoRoot: wt.repo, slug: SLUG, base: runBase,
        rules: { path: join(featurePath, '.pir', 'rules', 'on-finish.md'), source: 'project' },
        reportPath: join(featurePath, reportPath), askRules, startWorker: fins.startWorker, claudePath: '/nonexistent/claude',
        remote: false, skillsDir: cdir, engineDir: cdir, pirHome: cdir, now: () => clock.t,
      });
    }),
    priorFinisher: () => readJson(join(cdir, 'finisher', 'state.json')),
  });
  t.after(() => coordinator.closeAll());
  let n = 0;
  const decide = (obj) => {
    const dir = join(cdir, 'coordinator', 'decisions');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${Date.now()}-${String(++n).padStart(3, '0')}.json`), JSON.stringify(obj));
  };
  const status = (obj) => {
    const dir = join(cdir, 'finisher', 'status');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${Date.now()}-${String(++n).padStart(3, '0')}.json`), JSON.stringify(obj));
  };
  const agentTold = () => agents.sessions.flatMap((s) => s.told.map((m) => m.text));
  const until = (pred, max = 20) => {
    for (let i = 0; i < max; i++) {
      const r = coordinator.pass();
      if (pred(r)) return r;
    }
    throw new Error(`not reached in ${max} passes; handoff ${JSON.stringify(coordinator.handoff)}`);
  };
  const reportCommits = () => git(wt.repo, ['log', '--format=%s', `pir/${SLUG}`, '--', REPORT_REL]).stdout.trim().split('\n').filter(Boolean);
  const moveMain = (path, content) => {
    writeFileSync(join(wt.repo, path), content);
    git(wt.repo, ['add', '-A']);
    git(wt.repo, ['commit', '-m', `${base}: ${path}`, '--no-edit']);
    return git(wt.repo, ['rev-parse', base]).stdout.trim();
  };
  const mergeByHand = () => git(wt.repo, ['merge', '--no-ff', '--no-edit', `pir/${SLUG}`]);
  // Built, reported and waiting in ready (the pass that settles it), with the agent still on.
  const toReady = () => {
    coordinator.pass();
    assert.equal(coordinator.drive().reason, 'complete');
    until(() => agentTold().some((m) => m.startsWith('Every task is done')));
    decide({ kind: 'report', sections: SECTIONS });
    return until((r) => r.handoff.state === 'ready');
  };
  // The finisher from preparing to awaiting-go, its go question parked.
  const toAwaitingGo = () => {
    status(READY);
    coordinator.pass();
    assert.equal(coordinator.finisher.phase(), 'awaiting-go');
    const requestId = fins.latest().ask(GOQ);
    coordinator.pass(); // the question is seen after the ready
    return requestId;
  };
  const go = (requestId, answer = 'Go') =>
    fins.latest().answer(requestId, answersResult({ input: GOQ }, { [GOQ.questions[0].question]: answer }), { from: 'person' });
  return {
    coordinator, platform, worktree: wt, controlDir: cdir, agents, fins, clock, logs, started, decide, status,
    agentTold, until, reportCommits, moveMain, mergeByHand, toReady, toAwaitingGo, go,
  };
}

// ---- The hand-over (DESIGN §2.1) ----

test('green end with the agent: ready, then the next pass closes the agent and starts the finisher', (t) => {
  const run = finRun(t);
  const ready = run.toReady();
  assert.equal(ready.handoff.state, 'ready');
  assert.equal(run.started.length, 0, 'not on the pass that settles ready');
  assert.equal(run.coordinator.agent.alive(), true);

  const r = run.coordinator.pass();
  assert.equal(run.started.length, 1, 'the finisher started');
  assert.deepEqual(run.started[0].reportPath, REPORT_REL);
  assert.equal(run.started[0].base, 'main', 'the run\'s base is handed to the finisher');
  assert.equal(run.coordinator.agent.alive(), false, 'the agent is closed');
  assert.equal(r.handoff.finisher, 'on');
  assert.equal(r.finished, null);
  assert.equal(run.coordinator.finisher.phase(), 'preparing');
  assert.equal(r.finisher.phase, 'preparing', 'the pass carries the finisher view');
  assert.equal(run.coordinator.agentView(), null, 'the agent row is gone');
  assert.ok(run.logs.includes('finisher started'));
  assert.match(run.fins.latest().told[0].text, /Invoke the pir-finisher skill/);

  const rs = buildRunState({ passTasks: r.tasks, handoff: r.handoff, coordinator: run.coordinator.agentView(), finisher: r.finisher });
  assert.equal(rs.coordinator, null);
  assert.equal(rs.finisher.phase, 'preparing');
  assert.equal(buildRunState({ passTasks: [] }).finisher, undefined, 'no finisher: the old shape');
});

test('with the finisher taking over, the agent\'s hand-off message carries the report and no git merge line', (t) => {
  const run = finRun(t);
  run.toReady();
  const handoff = run.agentTold().at(-1);
  assert.match(handoff, /The greeting works\./);
  assert.doesNotMatch(handoff, /git merge/);
  assert.match(handoff, /starts the finisher/);
});

test('red end: no finisher; the run waits red as today', (t) => {
  const run = finRun(t, { runTests: () => ({ ok: false, reason: 'boom' }) });
  run.coordinator.pass();
  run.coordinator.drive();
  // The fix worker is spawned and the fake reports it done; the tests stay red.
  run.until(() => run.agentTold().some((m) => m.startsWith('Every task is done')), 40);
  run.decide({ kind: 'report', sections: SECTIONS });
  const r = run.until((x) => x.handoff.state === 'red', 40);
  for (let i = 0; i < 3; i++) run.coordinator.pass();
  assert.equal(r.handoff.finisher, undefined);
  assert.equal(run.started.length, 0, 'no finisher on a red branch');
  assert.equal(run.coordinator.agent.alive(), true, 'the agent stays, as today');
  assert.doesNotMatch(run.agentTold().at(-1), /starts the finisher/);
});

test('--no-coordinator: no end sequence and no finisher, whatever startFinisher is', (t) => {
  const wt = createFakeWorktree({ progress: progressDoc([{ num: 'T01' }]), slug: SLUG });
  t.after(() => wt.cleanup());
  let called = 0;
  const coordinator = startCoordinator({ slug: SLUG, repo: REPO, platform: createFakePlatform({}), worktree: wt, startFinisher: () => ((called += 1), null) });
  assert.equal(coordinator.drive().reason, 'complete');
  for (let i = 0; i < 3; i++) assert.equal(coordinator.pass().handoff, null);
  assert.equal(called, 0);
  assert.equal(coordinator.finisher, null);
});

// ---- The end of the run (DESIGN §2.8) ----

test('done ends the run finished by the finisher, closes it, and the done summary is printed', (t) => {
  const run = finRun(t);
  run.toReady();
  run.coordinator.pass();
  const req = run.toAwaitingGo();
  assert.equal(run.go(req), true);
  run.coordinator.pass();
  assert.equal(run.coordinator.finisher.phase(), 'finishing');
  run.mergeByHand(); // the finisher's own merge: after a go it does not end the run
  assert.equal(run.coordinator.pass().finished, null);
  const fin = run.fins.latest();
  run.status({ kind: 'done', summary: 'Merged pir/demo and ran install.sh.\nAll good.' });
  const r = run.coordinator.pass();
  assert.equal(r.finished, 'finisher');
  assert.equal(fin.closed, true, 'the finisher is closed');
  assert.equal(r.finisher.summary, 'Merged pir/demo and ran install.sh.\nAll good.', 'the ending pass still carries the summary');
  const line = renderFinished({ by: 'finisher', slug: SLUG, reportPath: REPORT_REL, summary: r.finisher.summary });
  assert.match(line, /^✔ finished: Merged pir\/demo and ran install\.sh\. The report is plans\/demo\/REPORT\.md\.$/);
});

test('close ends the run finished as closed, with the merge line offered', (t) => {
  const run = finRun(t);
  run.toReady();
  run.coordinator.pass();
  run.status({ kind: 'close', reason: 'not today' });
  const r = run.coordinator.pass();
  assert.equal(r.finished, 'closed');
  assert.equal(run.fins.latest().closed, true);
  assert.match(renderFinished({ by: 'closed', slug: SLUG, ready: r.handoff.state === 'ready', reportPath: REPORT_REL }), /git merge pir\/demo/);
});

test('a hand merge in awaiting-go ends the run merged and closes the finisher', (t) => {
  const run = finRun(t);
  run.toReady();
  run.coordinator.pass();
  run.toAwaitingGo();
  run.mergeByHand();
  const r = run.coordinator.pass();
  assert.equal(r.finished, 'merged');
  assert.equal(run.fins.latest().closed, true);
});

test('a hand merge in finishing, or in stuck after a go, does not end the run', (t) => {
  const run = finRun(t);
  run.toReady();
  run.coordinator.pass();
  run.go(run.toAwaitingGo());
  run.coordinator.pass();
  assert.equal(run.coordinator.finisher.phase(), 'finishing');
  run.mergeByHand();
  for (let i = 0; i < 2; i++) assert.equal(run.coordinator.pass().finished, null, 'finishing');
  run.status({ kind: 'stuck', summary: 'install.sh failed', proposal: 'retry', steps: ['./install.sh'] });
  run.coordinator.pass();
  assert.equal(run.coordinator.finisher.phase(), 'stuck');
  for (let i = 0; i < 2; i++) assert.equal(run.coordinator.pass().finished, null, 'stuck after a go');
  assert.equal(run.fins.latest().closed, false);
});

test('the person\'s Go answered in pir\'s conversation view reaches the finisher through withAgent', (t) => {
  const run = finRun(t);
  run.toReady();
  run.coordinator.pass();
  const req = run.toAwaitingGo();
  const fin = run.coordinator.finisher;
  // The bin's routing: currentAgent is the finisher once it has replaced the agent.
  const routed = withAgent(run.platform, () => run.coordinator.finisher ?? run.coordinator.agent);
  assert.equal(routed.pending(fin.id).length, 1, 'the go question is the finisher\'s pending request');
  const res = routed.answer(fin.id, req, answersResult({ input: GOQ }, { [GOQ.questions[0].question]: 'Go' }));
  assert.equal(res.ok, true);
  routed.note(fin.id, 'notify-sent', { title: 'x' });
  assert.ok(run.fins.latest().entries().some((e) => e.kind === 'notify-sent'), 'the notifier\'s notes land on the finisher');
  run.coordinator.pass();
  assert.equal(fin.phase(), 'finishing');
  assert.equal(fin.goGiven(), true);
  assert.deepEqual(fin.ledger().filter((l) => l.kind === 'go').map((l) => l.by), ['person']);
});

// A run cut from another branch gets the same finisher, told that branch as its target (user, 2026-09-30).
test('a run whose base is dev: the finisher starts, is told dev as its target, and follows dev moving', (t) => {
  const run = finRun(t, { base: 'dev' });
  run.toReady();
  const r = run.coordinator.pass();
  assert.equal(r.handoff.finisher, 'on');
  assert.equal(run.started.length, 1);
  assert.equal(run.started[0].base, 'dev');
  const opening = run.fins.latest().told[0].text;
  assert.match(opening, /^Target branch: dev$/m);
  assert.doesNotMatch(opening, /\bmain\b(?! checkout)/i);

  run.toAwaitingGo();
  const devSha = run.moveMain('other.txt', 'from dev\n');
  const told = () => run.fins.latest().told.some((m) => m.text.startsWith(`dev moved to ${devSha.slice(0, 12)}`));
  run.until((x) => x.handoff.state === 'ready' && told());
  assert.equal(run.coordinator.finisher.phase(), 'preparing');
  assert.equal(run.coordinator.finisher.ledger().at(-1).base, 'dev');

  assert.ok(run.mergeByHand().ok);
  const end = run.until((x) => x.finished !== null);
  assert.equal(end.finished, 'merged', 'a hand merge into dev before any go still ends the run');
});

test('main moving in awaiting-go re-syncs as today, then sends the finisher back to preparing', (t) => {
  const run = finRun(t);
  run.toReady();
  run.coordinator.pass();
  const req = run.toAwaitingGo();
  const mainSha = run.moveMain('other.txt', 'from main\n');
  const told = () => run.fins.latest().told.some((m) => m.text.startsWith(`main moved to ${mainSha.slice(0, 12)}`));
  const r = run.until((x) => x.handoff.state === 'ready' && told());
  assert.equal(run.coordinator.finisher.phase(), 'preparing');
  assert.equal(run.fins.latest().told.filter((m) => m.text.startsWith('main moved to')).length, 1, 'told once, when settled');
  assert.equal(r.handoff.baseSha, mainSha);
  assert.deepEqual(run.reportCommits(), [`report(${SLUG}): re-synced with main`, `report(${SLUG}): delivery report`]);
  assert.ok(run.fins.latest().told.some((m) => m.text.startsWith(`main moved to ${mainSha.slice(0, 12)}`)));
  // A go given for the old steps opens nothing.
  run.go(req);
  run.coordinator.pass();
  assert.equal(run.coordinator.finisher.phase(), 'preparing');
});

test('main moving in awaiting-go and the re-sync turning red closes the finisher; the run waits red (user 2026-09-29)', (t) => {
  let red = false;
  const run = finRun(t, { runTests: () => (red ? { ok: false, reason: 'boom' } : { ok: true }) });
  run.toReady();
  run.coordinator.pass();
  run.toAwaitingGo();
  const fin = run.fins.latest();
  red = true;
  run.moveMain('other.txt', 'from main\n');
  const r = run.until((x) => x.handoff.state === 'red' && x.handoff.finisher === 'fallback', 40);
  assert.equal(r.handoff.fallback, 'red');
  assert.equal(fin.closed, true);
  assert.equal(run.coordinator.finisher, null);
  assert.ok(run.logs.some((l) => l.startsWith('finisher closed')));
  run.mergeByHand();
  assert.equal(run.coordinator.pass().finished, 'merged', 'today\'s red wait: a hand merge still ends it');
});

// ---- The unhappy paths (DESIGN §2.12) ----

test('the finisher fails to start → today\'s ready to merge, `finisher failed to start` in the log', (t) => {
  const run = finRun(t, { startFinisher: () => { throw new Error('no claude'); } });
  run.toReady();
  const r = run.coordinator.pass();
  assert.equal(r.handoff.finisher, 'fallback');
  assert.equal(r.handoff.fallback, 'failed');
  assert.ok(run.logs.includes('finisher failed to start: no claude'));
  assert.deepEqual(r.readyToMerge, { branch: `pir/${SLUG}` });
  assert.match(renderFinished({ by: 'finisher-gave-up', slug: SLUG }), /git merge pir\/demo/);
  run.mergeByHand();
  assert.equal(run.coordinator.pass().finished, 'merged');
});

test('the finisher gives up → ready-to-merge fallback; the person can still merge by hand to finish', (t) => {
  const run = finRun(t);
  run.toReady();
  run.coordinator.pass();
  for (let i = 0; i < 4; i++) run.fins.latest().exit();
  const r = run.coordinator.pass();
  assert.equal(r.handoff.finisher, 'fallback');
  assert.equal(r.handoff.fallback, 'gave-up');
  assert.ok(run.logs.includes('finisher gave up'));
  assert.equal(run.coordinator.finisher, null);
  assert.equal(r.finisher, null);
  assert.equal(run.coordinator.pass().finished, null, 'waits in ready');
  run.mergeByHand();
  assert.equal(run.coordinator.pass().finished, 'merged');
});

test('HALT closes the finisher', (t) => {
  let halted = false;
  const run = finRun(t, { control: { isHalted: () => halted, log: () => {} } });
  run.toReady();
  run.coordinator.pass();
  const fin = run.fins.latest();
  halted = true;
  const r = run.coordinator.pass();
  assert.equal(r.halted, true);
  assert.equal(fin.closed, true);
});

// ---- pir restarts (DESIGN §2.12) ----

// restart(first) → a second run over the same worktree and control folder, as a pir restart is.
function restart(t, first) {
  first.coordinator.closeAll();
  const second = finRun(t, { worktree: first.worktree, controlDir: first.controlDir, finisherStubs: first.fins });
  second.coordinator.pass();
  assert.equal(second.coordinator.drive().reason, 'complete');
  return second;
}

for (const phase of ['preparing', 'awaiting-go']) {
  test(`pir restart in ${phase}: the finisher is resumed (not the agent), in the same phase; the report is kept`, (t) => {
    const first = finRun(t);
    first.toReady();
    first.coordinator.pass();
    if (phase === 'awaiting-go') first.toAwaitingGo();
    const id = first.coordinator.finisher.id;
    const commits = first.reportCommits();

    const second = restart(t, first);
    second.until((r) => r.handoff.finisher === 'on');
    assert.equal(second.agents.sessions.length, 0, 'no agent started');
    assert.equal(second.coordinator.agentView(), null);
    assert.equal(second.fins.latest().opts.resume, id, 'resumed by its session id');
    assert.equal(second.coordinator.finisher.phase(), phase);
    assert.match(second.fins.latest().told[0].text, /pir restarted your session/);
    assert.deepEqual(second.reportCommits(), commits, 'the report is not rewritten');
    assert.ok(second.logs.includes('finisher resumed'));
  });
}

test('pir restart in finishing after the finisher merged: resumed in stuck, not ended as merged', (t) => {
  const first = finRun(t);
  first.toReady();
  first.coordinator.pass();
  first.go(first.toAwaitingGo());
  first.coordinator.pass();
  assert.equal(first.coordinator.finisher.phase(), 'finishing');
  first.mergeByHand();
  const commits = first.reportCommits();

  const second = restart(t, first);
  const r = second.until((x) => x.handoff.finisher === 'on');
  assert.equal(r.finished, null);
  assert.equal(second.coordinator.finisher.phase(), 'stuck');
  assert.equal(second.coordinator.finisher.goGiven(), true);
  assert.match(second.fins.latest().told[0].text, /Your phase is now stuck/);
  assert.deepEqual(second.reportCommits(), commits);
  assert.equal(second.coordinator.pass().finished, null, 'after a go only done or close end it');
  // stuck is look-only: a done needs a fresh go first.
  second.status({ kind: 'done', summary: 'Checked: merged and installed.' });
  assert.equal(second.coordinator.pass().finished, null, 'done refused in stuck');
  const req = second.fins.latest().ask(GOQ);
  second.coordinator.pass();
  second.go(req);
  second.coordinator.pass();
  assert.equal(second.coordinator.finisher.phase(), 'finishing');
  second.status({ kind: 'done', summary: 'Checked: merged and installed.' });
  assert.equal(second.coordinator.pass().finished, 'finisher');
});

test('pir restart in stuck after a go: resumed in stuck', (t) => {
  const first = finRun(t);
  first.toReady();
  first.coordinator.pass();
  first.go(first.toAwaitingGo());
  first.coordinator.pass();
  first.status({ kind: 'stuck', summary: 'install failed', proposal: 'retry', steps: ['./install.sh'] });
  first.coordinator.pass();
  assert.equal(first.coordinator.finisher.phase(), 'stuck');

  const second = restart(t, first);
  second.until((x) => x.handoff.finisher === 'on');
  assert.equal(second.coordinator.finisher.phase(), 'stuck');
  assert.equal(second.agents.sessions.length, 0);
});

test('pir restart after the finisher wrote done but before the run ended: finished at once', (t) => {
  const first = finRun(t);
  first.toReady();
  first.coordinator.pass();
  // Stored as the finisher leaves it after an accepted done, the run not yet ended.
  const statePath = join(first.controlDir, 'finisher', 'state.json');
  const st = JSON.parse(readFileSync(statePath, 'utf8'));
  writeFileSync(statePath, JSON.stringify({ ...st, phase: 'done', goGiven: true, summary: 'All done.' }));
  first.mergeByHand();

  const second = restart(t, first);
  const r = second.until((x) => x.finished !== null);
  assert.equal(r.finished, 'finisher');
});

// ---- Startup clearing (DESIGN §3.5) ----

test('clearTransientFeeds clears finisher/status/ and keeps state.json, session.json and the ledger', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'pir-fin-clear-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const fin = join(dir, 'finisher');
  mkdirSync(join(fin, 'status'), { recursive: true });
  writeFileSync(join(fin, 'status', '1-a.json'), '{}');
  for (const f of ['state.json', 'session.json', 'ledger.jsonl']) writeFileSync(join(fin, f), '{}');
  const { cleared } = clearTransientFeeds(dir);
  assert.ok(cleared.includes(join('finisher', 'status') + '/'));
  assert.equal(existsSync(join(fin, 'status', '1-a.json')), false);
  for (const f of ['state.json', 'session.json', 'ledger.jsonl']) assert.equal(existsSync(join(fin, f)), true, f);
});

test('renderFinished: the finisher\'s done line, and the give-up fallback with the merge line', () => {
  assert.equal(renderFinished({ by: 'finisher', slug: SLUG, summary: '\n  Merged and installed.\nmore' }), '✔ finished: Merged and installed.');
  assert.equal(renderFinished({ by: 'finisher', slug: SLUG }), '✔ finished: the finisher is done');
  const gave = renderFinished({ by: 'finisher-gave-up', slug: SLUG, reportPath: REPORT_REL });
  assert.match(gave, /could not go on/);
  assert.match(gave, /\n\n {2}git switch main && git merge pir\/demo\n$/);
  assert.match(renderFinished({ by: 'finisher-gave-up', slug: SLUG, base: 'dev' }), /\n\n {2}git switch dev && git merge pir\/demo\n$/);
});

test('main moving in awaiting-go: a Go on the old question answered while the re-sync runs does not count (review T05)', (t) => {
  const run = finRun(t);
  run.toReady();
  run.coordinator.pass();
  const req = run.toAwaitingGo();
  const mainSha = run.moveMain('other.txt', 'from main\n');
  run.coordinator.pass(); // main moved: the re-sync starts, and spans passes
  assert.equal(run.coordinator.handoff.state, 'preparing', 'the re-sync is under way');
  assert.equal(run.coordinator.finisher.phase(), 'preparing', 'look-only from the pass main moved');
  run.go(req);
  const fin = run.fins.latest();
  assert.equal(fin.opts.decide('Bash', { command: 'git merge pir/demo' }), 'deny', 'no step runs on a go for the old plan');
  // A fresh ready and a fresh go question while the branch is still being re-synced: still no go.
  run.status(READY);
  const req2 = fin.ask(GOQ);
  fin.opts.decide('Read', { file_path: join(run.worktree.repo, 'README.md') });
  run.go(req2);
  assert.equal(fin.opts.decide('Bash', { command: 'git merge pir/demo' }), 'deny', 'no go counts mid-re-sync');
  assert.notEqual(run.coordinator.finisher.phase(), 'finishing');
  // Settled: told once, back to preparing, and a go for the fresh ready counts again.
  run.until((x) => x.handoff.state === 'ready' && fin.told.some((m) => m.text.startsWith(`main moved to ${mainSha.slice(0, 12)}`)));
  assert.equal(run.coordinator.finisher.phase(), 'preparing');
  run.go(run.toAwaitingGo());
  run.coordinator.pass();
  assert.equal(run.coordinator.finisher.phase(), 'finishing');
});
