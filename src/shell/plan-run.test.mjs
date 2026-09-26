// pir-plan-command T06 — the planning program's planner half, run against the fake Claude (T05) in
// scratch repos. No real `claude` is ever started: every session is the shim.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn as spawnChild } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initialPlanState, plannerInstruction } from '../core/planflow.mjs';
import { parseRecord } from '../core/runrecord.mjs';
import { writeClaudeShim } from './fake/claude-shim.mjs';
import { initEvent, assistantText, resultEvent } from './fake/claude-stream.mjs';
import { plannerScript, noPlanScript, PLANNER_MATCH } from './fake/sessions.mjs';
import { recordPath, writeRecord } from './index-store.mjs';
import { dropPersonInput } from './person-inbox.mjs';
import { readSnapshot } from './snapshot-store.mjs';
import { git, openPlanBranch } from './worktree.mjs';
import { nextPlanLogPath, parseArgs, planRunState, plannerChecks, rootOf, runPlanning } from './plan-run.mjs';

const PROGRAM = fileURLToPath(new URL('./plan-run.mjs', import.meta.url));
const SESSIONS = fileURLToPath(new URL('./fake/sessions.mjs', import.meta.url));
const ID = 'plan-ab12';
const BRIEF = 'A small thing to plan\n\nwith a second paragraph';

const q = (s) => `'${String(s).replaceAll("'", `'\\''`)}'`;
const GIT = "git -c user.name='pir fake' -c user.email=fake@pir.invalid";
const sessionsCmd = (...args) => [process.execPath, SESSIONS, ...args].map(q).join(' ');

async function waitFor(fn, what, ms = 15000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

// A scratch repo with main, the plan branch opened as startPlanRun (T08) will open it, the control folder
// with brief.md and state.json, the index entry, and the fake `claude` behind a shim.
function setup(t, scripts, { indexEntry = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'pir-plan-run-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const root = join(dir, 'repo');
  git(dir, ['init', '-q', '-b', 'main', 'repo']);
  for (const [k, v] of [['user.email', 't06@test.local'], ['user.name', 'T06'], ['commit.gpgsign', 'false']]) git(root, ['config', k, v]);
  writeFileSync(join(root, 'README.md'), 'scratch\n');
  writeFileSync(join(root, '.gitignore'), 'plans/*/.parallel/\n.claude/\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init']);
  const { path: worktree } = openPlanBranch(ID, { root });
  const controlDir = join(root, 'plans', ID, '.parallel', 'plan');
  mkdirSync(controlDir, { recursive: true });
  writeFileSync(join(controlDir, 'brief.md'), BRIEF);
  writeFileSync(join(controlDir, 'state.json'), JSON.stringify(initialPlanState({ id: ID })));
  const home = join(dir, 'home');
  const repo = 'repo';
  if (indexEntry) {
    writeRecord(
      { kind: 'plan', label: 'A small thing to plan', slug: ID, repo, repoPath: root, controlDir, pid: process.pid, startTime: 'Sat Sep 26 10:00:00 2026', branch: `pir/${ID}` },
      { dir: join(home, '.pir', 'runs') },
    );
  }
  const fakeDir = join(dir, 'fake');
  mkdirSync(fakeDir);
  const scriptsFile = join(fakeDir, 'scripts.json');
  writeFileSync(scriptsFile, JSON.stringify(scripts));
  const received = join(fakeDir, 'received.ndjson');
  const shim = writeClaudeShim(join(dir, 'bin'), { scriptsFile, received });
  return { dir, root, worktree, controlDir, home, repo, shim, received, bin: join(dir, 'bin') };
}

// runPlanning in this process, with a stop lever and the program's log kept.
function start(s, { env = {}, deps = {} } = {}) {
  const stop = new AbortController();
  const lines = [];
  const snaps = [];
  let code;
  const done = runPlanning({
    controlDir: s.controlDir,
    deps: {
      env: { PIR_HOME: s.home, ...env },
      claudePath: s.shim,
      signal: stop.signal,
      log: (l) => lines.push(l),
      pollMs: 500,
      writeSnapshot: (dir, snap) => {
        snaps.push(snap);
        writeFileSync(join(dir, 'status.json'), JSON.stringify({ version: 1, ...snap }));
      },
      ...deps,
    },
  }).then((c) => (code = c));
  return { stop, lines, snaps, done, get code() { return code; } };
}

const readLog = (path) => (existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const planLog = (s, n = 1) => readLog(join(s.controlDir, 'conversations', `plan-${n}.ndjson`));
const stateOf = (s) => JSON.parse(readFileSync(join(s.controlDir, 'state.json'), 'utf8'));
const workersOf = (s) => JSON.parse(readFileSync(join(s.controlDir, 'workers.json'), 'utf8'));
const indexOf = (s, key = ID) => parseRecord(readFileSync(recordPath(s.repo, key, { dir: join(s.home, '.pir', 'runs') }), 'utf8'));
const notes = (log, kind) => log.filter((e) => e.dir === 'note' && e.kind === kind);

// A planner that writes the fake plan (optionally without some files), commits, drops `planned`, and
// then takes one more turn per message it is sent.
function quickPlanner(slug, { drop = [] } = {}) {
  const rm = drop.map((f) => ` && rm ${q(`plans/${slug}/${f}`)}`).join('');
  return [
    { await: 'user' },
    { emit: initEvent() },
    { sh: `${sessionsCmd('write-plan', slug)}${rm} && ${GIT} add -A ${q(`plans/${slug}`)} && ${GIT} commit -q -m plan` },
    { sh: sessionsCmd('report', '{{reportsDir}}', 'plan', `[pir:v1 kind=planned plan=${slug}]\nThe plan is committed.`) },
    { emit: assistantText('Reported.') },
    { emit: resultEvent('success', 'Reported.') },
    { chat: { workMs: 10 } },
  ];
}

// ---- The planner step end to end. ----

test('planner: exact instruction, question pending, inbox answer forwarded, planned → closed, state at rename, no final status', async (t) => {
  const slug = 'small-thing';
  const s = setup(t, [{ match: PLANNER_MATCH, script: plannerScript({ slug, question: 'Big or small?' }) }]);
  const run = start(s, { env: { PIR_RUN: '1' } });
  t.after(() => run.stop.abort());

  // The planner receives the exact instruction, and its question reaches the log as a pending request.
  const request = await waitFor(() => planLog(s).find((e) => e.dir === 'request'), 'the planner question');
  const log = planLog(s);
  const opening = log.find((e) => e.dir === 'out');
  assert.equal(opening.from, 'pir');
  assert.equal(opening.text, plannerInstruction({ reportsDir: join(s.controlDir, 'reports'), brief: BRIEF }));
  assert.equal(request.toolName, 'AskUserQuestion');
  const sessionId = workersOf(s)[0].id;
  assert.equal(workersOf(s).length, 1, 'workers.json holds the live planner');
  assert.equal(workersOf(s)[0].role, 'planner');
  await waitFor(() => run.snaps.some((x) => x.runState.steps[0].asking === 'questions'), 'a snapshot showing the question');

  // An inbox drop answering it is forwarded and the planner continues.
  const dropped = dropPersonInput(s.controlDir, { to: sessionId, kind: 'answers', requestId: request.requestId, answers: { 'Big or small?': 'Small' } }, { coordinatorAlive: true });
  assert.deepEqual(dropped, { ok: true });

  assert.equal(await run.done, 0);
  const after = planLog(s);
  assert.ok(after.some((e) => e.dir === 'out' && e.kind === 'reply' && e.from === 'person'), 'the answer reached the planner');
  assert.ok(git(s.worktree, ['cat-file', '-e', `HEAD:plans/${slug}/PROGRESS.md`]).ok, 'the planner carried on and committed');

  // planned with a valid plan: the planner was closed after idle; state.json at step rename.
  const st = stateOf(s);
  assert.equal(st.step, 'rename');
  assert.equal(st.slug, slug);
  assert.deepEqual(st.sessions.plan, [sessionId]);
  assert.deepEqual(st.renamed, { branch: false, worktree: false, control: false, index: false });
  assert.equal(st.live, false);
  const result = after.findIndex((e) => e.dir === 'in' && e.event.type === 'result' && e.event.subtype === 'success');
  const exited = after.findIndex((e) => e.dir === 'note' && e.kind === 'exited');
  assert.ok(result >= 0 && exited > result, 'closed only after its turn ended');
  assert.deepEqual(workersOf(s), [], 'workers.json emptied');
  assert.equal(git(s.root, ['rev-parse', '--verify', '--quiet', `refs/heads/pir/${ID}`]).ok, true, 'no rename yet (T07)');

  // No final status yet: the snapshot is live and the index untouched.
  const snap = readSnapshot(s.controlDir);
  assert.equal(snap.finalState, null);
  assert.equal(snap.runState.step, 'rename');
  assert.equal(snap.runState.steps[0].phase, 'done');
  assert.equal(indexOf(s).finalState, null);

  // Remote Control: on once right after the spawn, never off while busy, idle or asking, off at the close.
  const rc = notes(after, 'remote-control');
  assert.deepEqual(rc.map((n) => n.on), [true, false]);
  assert.ok(after.indexOf(rc[1]) > result, 'off only at the close');
  // On the wire: the one switch-on went out at the spawn, before the question was answered,
  // and the switch-off after the planner's last turn.
  const wire = readFileSync(s.received, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((x) => x.line).map((x) => JSON.parse(x.line));
  const rcWire = wire.filter((m) => m.type === 'control_request' && m.request?.subtype === 'remote_control');
  assert.deepEqual(rcWire.map((m) => m.request.enabled), [true, false]);
  const at = (m) => wire.indexOf(m);
  // The SDK may put the switch-on ahead of the opening message on the wire: both are sent at the spawn.
  const answer = wire.findIndex((m) => m.type === 'control_response');
  assert.ok(at(rcWire[0]) < answer, 'on from the spawn, before the answer');
  assert.ok(at(rcWire[1]) > answer, 'still on after the answer, off only at the close');
  assert.equal(notes(after, 'remote-control-failed').length, 0);

  // Under PIR_RUN a snapshot is written on each transition: planning, asking, planning again, done.
  const phases = run.snaps.map((x) => x.runState.steps[0].phase);
  for (const p of ['planning', 'asking', 'done']) assert.ok(phases.includes(p), `a snapshot at ${p}: ${phases}`);
  assert.ok(phases.lastIndexOf('planning') > phases.indexOf('asking'), 'back to planning after the answer');
  assert.ok(run.snaps.every((x) => x.finalState === null));
});

test('planner: planned with DESIGN.md missing → the planner hears which file, the step continues; no snapshot without PIR_RUN', async (t) => {
  const slug = 'no-design';
  const s = setup(t, [{ match: PLANNER_MATCH, script: quickPlanner(slug, { drop: ['DESIGN.md'] }) }]);
  const run = start(s);
  const msg = await waitFor(() => planLog(s).find((e) => e.dir === 'out' && e.from === 'pir' && /did not accept/.test(e.text ?? '')), 'the failure message');
  assert.match(msg.text, new RegExp(`plans/${slug}/DESIGN\\.md is not committed`));
  // The step continues: the planner takes the message as a turn, and the program is still running.
  await waitFor(() => planLog(s).filter((e) => e.dir === 'in' && e.event.type === 'result').length >= 2, 'the planner turn on the message');
  assert.equal(run.code, undefined);
  assert.equal(stateOf(s).step, 'plan');
  assert.equal(stateOf(s).accepted, null);
  // Without PIR_RUN nothing is written for the dashboard.
  assert.equal(run.snaps.length, 0);
  assert.equal(existsSync(join(s.controlDir, 'status.json')), false);

  run.stop.abort();
  assert.equal(await run.done, 0);
  assert.equal(indexOf(s).finalState, null, 'no index write without PIR_RUN');
});

test('planner: planned with a taken slug → the message says the name is taken and to choose another', async (t) => {
  const slug = 'taken-name';
  const s = setup(t, [{ match: PLANNER_MATCH, script: quickPlanner(slug) }]);
  git(s.root, ['branch', `pir/${slug}`, 'main']);
  const run = start(s);
  t.after(() => run.stop.abort());
  const msg = await waitFor(() => planLog(s).find((e) => e.dir === 'out' && /did not accept/.test(e.text ?? '')), 'the failure message');
  assert.match(msg.text, new RegExp(`"${slug}" is taken: a branch pir/${slug} already exists`));
  assert.match(msg.text, /Choose another name with the person/);
  assert.equal(stateOf(s).step, 'plan');
  run.stop.abort();
  assert.equal(await run.done, 0);
});

test('planner: no-plan → finished with outcome no-plan in state, snapshot and index; Remote Control never switched under PARALLEL_REMOTE=0', async (t) => {
  const s = setup(t, [{ match: PLANNER_MATCH, script: noPlanScript() }]);
  const run = start(s, { env: { PIR_RUN: '1', PARALLEL_REMOTE: '0' } });
  assert.equal(await run.done, 0);
  const st = stateOf(s);
  assert.equal(st.step, 'done');
  assert.equal(st.outcome, 'no-plan');
  const snap = readSnapshot(s.controlDir);
  assert.equal(snap.finalState, 'finished');
  assert.equal(snap.runState.outcome, 'no-plan');
  assert.equal(snap.runState.steps[0].phase, 'failed');
  assert.equal(indexOf(s).finalState, 'finished');
  assert.deepEqual(workersOf(s), []);
  assert.equal(notes(planLog(s), 'remote-control').length, 0);
  const sent = readFileSync(s.received, 'utf8');
  assert.doesNotMatch(sent, /remote_control/, 'no remote_control request reached the session');
});

test('planner: the session exits with no report → exit 1 with no final status (crashed)', async (t) => {
  const s = setup(t, [{ match: PLANNER_MATCH, script: [{ await: 'user' }, { emit: initEvent() }, { exit: 1 }] }]);
  const run = start(s, { env: { PIR_RUN: '1' } });
  assert.equal(await run.done, 1);
  assert.equal(readSnapshot(s.controlDir).finalState, null);
  assert.equal(indexOf(s).finalState, null);
  assert.equal(stateOf(s).step, 'plan');
  assert.deepEqual(workersOf(s), []);
});

test('the program under SIGTERM: session closed, stopped in snapshot and index, exit 0', async (t) => {
  const slug = 'stopped-thing';
  const s = setup(t, [{ match: PLANNER_MATCH, script: plannerScript({ slug }) }]);
  const child = spawnChild(process.execPath, [PROGRAM, '--control', s.controlDir], {
    env: { ...process.env, PATH: `${s.bin}:${process.env.PATH}`, PIR_HOME: s.home, PIR_RUN: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  const exited = new Promise((r) => child.on('exit', (code) => r(code)));
  t.after(() => child.kill('SIGKILL'));

  await waitFor(() => planLog(s).find((e) => e.dir === 'request'), `the planner question (${out})`);
  const { pid } = workersOf(s)[0];
  child.kill('SIGTERM');
  assert.equal(await exited, 0, out);
  assert.ok(notes(planLog(s), 'exited').length === 1, 'the session was closed');
  assert.throws(() => process.kill(pid, 0), 'the fake claude is gone');
  assert.deepEqual(workersOf(s), []);
  assert.equal(readSnapshot(s.controlDir).finalState, 'stopped');
  assert.equal(indexOf(s).finalState, 'stopped');
  assert.match(out, /stopped/);
});

test('T07 is not here yet: --resume and a state past plan are refused with exit 2', async (t) => {
  const s = setup(t, []);
  const lines = [];
  assert.equal(await runPlanning({ controlDir: s.controlDir, resume: true, deps: { log: (l) => lines.push(l), claudePath: s.shim, env: { PIR_HOME: s.home } } }), 2);
  writeFileSync(join(s.controlDir, 'state.json'), JSON.stringify({ ...initialPlanState({ id: ID }), step: 'rename', slug: 'x' }));
  assert.equal(await runPlanning({ controlDir: s.controlDir, deps: { log: (l) => lines.push(l), claudePath: s.shim, env: { PIR_HOME: s.home } } }), 2);
  assert.match(lines.join('\n'), /T07/);
});

// ---- The pure helpers. ----

test('plannerChecks: each §2.5 failure has its reason, and a clean valid plan passes', (t) => {
  const tree = new Set(['plans/ok-plan/PROGRESS.md', 'plans/ok-plan/PLAN.md', 'plans/ok-plan/DESIGN.md']);
  let dirty = '';
  const git = (_cwd, args) => {
    if (args[0] === 'ls-tree') return { ok: true, stdout: args.slice(4).filter((f) => tree.has(f)).join('\n') };
    if (args[0] === 'status') return { ok: true, stdout: dirty };
    throw new Error(`unexpected git ${args}`);
  };
  let taken = null;
  const base = { worktree: '/w', root: '/r', repo: 'r', indexDir: '/i', git, slugTaken: () => taken };
  assert.deepEqual(plannerChecks({ ...base, slug: 'ok-plan' }), { ok: true, reason: null });
  assert.match(plannerChecks({ ...base, slug: 'Bad_Name' }).reason, /kebab-case/);
  assert.match(plannerChecks({ ...base, slug: 'plan-00ff' }).reason, /plan-xxxx/);
  assert.match(plannerChecks({ ...base, slug: 'other' }).reason, /PROGRESS\.md, plans\/other\/PLAN\.md, plans\/other\/DESIGN\.md are not committed/);
  for (const [why, text] of [['branch', /branch pir\/ok-plan/], ['main-plan', /already on main/], ['index', /pir run named ok-plan/]]) {
    taken = why;
    assert.match(plannerChecks({ ...base, slug: 'ok-plan' }).reason, text);
  }
  taken = null;
  dirty = '?? stray.txt';
  assert.match(plannerChecks({ ...base, slug: 'ok-plan' }).reason, /uncommitted changes/);
});

test('planRunState: phases per step, the asking kind, the open session and its clock', () => {
  const st = (over) => ({ ...initialPlanState({ id: ID }), ...over });
  const sess = (step, live, state) => ({ id: `${step}-${live}`, step, n: 1, logPath: `/c/${step}-1.ndjson`, live, activity: { state } });
  let rs = planRunState(st({}), { label: 'A thing', sessions: [sess('plan', true, 'busy')], since: { plan: 5 } });
  assert.equal(rs.kind, 'plan');
  assert.equal(rs.label, 'A thing');
  assert.deepEqual(rs.steps.map((x) => [x.id, x.phase]), [['plan', 'planning'], ['review', 'pending'], ['build', 'pending']]);
  assert.equal(rs.steps[0].since, 5);
  assert.deepEqual(rs.steps[0].worker, { id: 'plan-true', live: true, logPath: '/c/plan-1.ndjson' });
  assert.deepEqual(rs.steps[0].workers, [{ id: 'plan-true', role: 'planner', n: 1, logPath: '/c/plan-1.ndjson' }]);

  rs = planRunState(st({}), { sessions: [sess('plan', true, 'permission')], since: { plan: 5 }, stoppedAt: { plan: 9 } });
  assert.equal(rs.steps[0].phase, 'asking');
  assert.equal(rs.steps[0].asking, 'permission');
  assert.equal(rs.steps[0].stoppedAt, 9);

  rs = planRunState(st({ step: 'review', slug: 's' }), { sessions: [sess('plan', false, 'idle'), sess('review', true, 'questions')] });
  assert.deepEqual(rs.steps.map((x) => x.phase), ['done', 'asking', 'pending']);
  assert.equal(rs.slug, 's');
  assert.equal(planRunState(st({ step: 'done', outcome: 'no-plan' })).steps[0].phase, 'failed');
  assert.deepEqual(planRunState(st({ step: 'done', outcome: 'not-reviewed' })).steps.map((x) => x.phase), ['done', 'failed', 'pending']);
  assert.deepEqual(planRunState(st({ step: 'done', outcome: 'reviewed' })).steps.map((x) => x.phase), ['done', 'done', 'pending']);
  assert.equal(planRunState(st({ step: 'rename' })).steps[1].phase, 'pending');
});

test('nextPlanLogPath counts per step from the folder; rootOf; parseArgs', () => {
  const readdir = () => ['plan-1.ndjson', 'plan-3.ndjson', 'review-1.ndjson', 'T01-implement-9.ndjson'];
  assert.equal(nextPlanLogPath('/c', 'plan', { readdir }), '/c/conversations/plan-4.ndjson');
  assert.equal(nextPlanLogPath('/c', 'review', { readdir }), '/c/conversations/review-2.ndjson');
  assert.equal(nextPlanLogPath('/c', 'plan', { readdir: () => { throw new Error('none'); } }), '/c/conversations/plan-1.ndjson');
  assert.equal(rootOf('/r/repo/plans/plan-ab12/.parallel/plan'), '/r/repo');
  assert.deepEqual(parseArgs(['--control', '/x', '--resume']), { controlDir: '/x', resume: true });
  assert.match(parseArgs([]).error, /--control/);
  assert.match(parseArgs(['--control', '/x', '--bogus']).error, /--bogus/);
});
