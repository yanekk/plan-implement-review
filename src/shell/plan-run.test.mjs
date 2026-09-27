// pir-plan-command T06, T07 — the planning program (planner, rename, reviewer, resume), run against the
// fake Claude (T05) in scratch repos. No real `claude` is ever started: every session is the shim.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn as spawnChild } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initialPlanState, plannerInstruction, resumeInstruction, reviewerInstruction } from '../core/planflow.mjs';
import { parseRecord } from '../core/runrecord.mjs';
import { writeClaudeShim } from './fake/claude-shim.mjs';
import { initEvent, assistantText, resultEvent } from './fake/claude-stream.mjs';
import { plannerScript, noPlanScript, reviewerScript, PLANNER_MATCH, REVIEWER_MATCH } from './fake/sessions.mjs';
import { recordPath, writeRecord } from './index-store.mjs';
import { dropPersonInput } from './person-inbox.mjs';
import { readSnapshot } from './snapshot-store.mjs';
import { git, openPlanBranch } from './worktree.mjs';
import { findControlDir, findSessionLog, nextPlanLogPath, parseArgs, planRunState, plannerChecks, reviewerChecks, rootOf, runPlanning, sessionAsking, stepWorkedMs, trackStoppedAt } from './plan-run.mjs';

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
function start(s, { env = {}, deps = {}, resume = false, controlDir = s.controlDir } = {}) {
  const stop = new AbortController();
  const lines = [];
  const snaps = [];
  let code;
  const done = runPlanning({
    controlDir,
    resume,
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
const controlAfter = (s, slug) => join(s.root, 'plans', slug, '.parallel', 'plan');
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

test('planner: exact instruction, question pending, inbox answer forwarded, planned → closed after idle, then renamed and reviewed', async (t) => {
  const slug = 'small-thing';
  const s = setup(t, [{ match: PLANNER_MATCH, script: plannerScript({ slug, question: 'Big or small?' }) }, { match: REVIEWER_MATCH, script: reviewerScript({ slug }) }]);
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
  // The run went on through the rename and the reviewer: the planner's log is now under the slug.
  const moved = controlAfter(s, slug);
  const after = readLog(join(moved, 'conversations', 'plan-1.ndjson'));
  assert.ok(after.some((e) => e.dir === 'out' && e.kind === 'reply' && e.from === 'person'), 'the answer reached the planner');
  assert.ok(git(s.root, ['cat-file', '-e', `pir/${slug}:plans/${slug}/PROGRESS.md`]).ok, 'the planner carried on and committed');

  // planned with a valid plan: the planner was closed after idle, and only then renamed and reviewed.
  const st = JSON.parse(readFileSync(join(moved, 'state.json'), 'utf8'));
  assert.equal(st.slug, slug);
  assert.deepEqual(st.sessions.plan, [sessionId]);
  const result = after.findIndex((e) => e.dir === 'in' && e.event.type === 'result' && e.event.subtype === 'success');
  const exited = after.findIndex((e) => e.dir === 'note' && e.kind === 'exited');
  assert.ok(result >= 0 && exited > result, 'closed only after its turn ended');
  assert.equal(exited, after.length - 1, 'nothing reached the planner after its close');

  // Remote Control: on once right after the spawn, never off while busy, idle or asking, off at the close.
  const rc = notes(after, 'remote-control');
  assert.deepEqual(rc.map((n) => n.on), [true, false]);
  assert.ok(after.indexOf(rc[1]) > result, 'off only at the close');
  // On the wire: the one switch-on went out at the spawn, before the question was answered,
  // and the switch-off after the planner's last turn. The planner's lines are the first session's.
  const wireAll = readFileSync(s.received, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const secondStart = wireAll.findIndex((x, i) => i > 0 && x.argv);
  const wire = wireAll.slice(0, secondStart).filter((x) => x.line).map((x) => JSON.parse(x.line));
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
  assert.ok(run.snaps.some((x) => x.runState.step === 'review' && x.runState.steps[1].phase === 'reviewing'), 'a snapshot while reviewing');
  assert.equal(run.snaps.at(-1).finalState, 'finished');
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

test('planner: an accepted planned, then an uncommitted edit before idle → re-checked at idle, not closed', async (t) => {
  const slug = 'edited-after';
  const script = quickPlanner(slug);
  // After the report is read and accepted (the session still busy), the planner leaves a stray file.
  script.splice(4, 0, { sleep: 1500 }, { sh: 'touch stray.txt' });
  const s = setup(t, [{ match: PLANNER_MATCH, script }]);
  const run = start(s);
  t.after(() => run.stop.abort());
  await waitFor(() => run.lines.some((l) => /checks for planned edited-after: ok/.test(l)), 'the report accepted while busy');
  const msg = await waitFor(() => planLog(s).find((e) => e.dir === 'out' && /did not accept/.test(e.text ?? '')), 'the failure at idle');
  assert.match(msg.text, /uncommitted changes/);
  assert.equal(stateOf(s).step, 'plan');
  assert.equal(stateOf(s).accepted, null);
  assert.equal(run.code, undefined, 'the planner was not closed');
  run.stop.abort();
  assert.equal(await run.done, 0);
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

// pir SIGKILLs a stopped program 4 s after its SIGTERM (DESIGN §2.16), and closing a session that will not
// go takes up to that long (the Remote Control switch-off, then the grace and the SIGTERM wait). `stopped`
// must be on record before the close, or a stubborn session turns a stop into a crash on the dashboard.
test('the program under SIGTERM with a session that will not go: `stopped` is recorded before the close ends', async (t) => {
  const s = setup(t, [{ match: PLANNER_MATCH, script: [{ onSigterm: 'ignore' }, { onEof: 'ignore' }, { await: 'user' }, { emit: initEvent() }, { sleep: 600000 }] }]);
  const child = spawnChild(process.execPath, [PROGRAM, '--control', s.controlDir], {
    env: { ...process.env, PATH: `${s.bin}:${process.env.PATH}`, PIR_HOME: s.home, PIR_RUN: '1' },
    stdio: 'ignore',
  });
  const exited = new Promise((r) => child.on('exit', (code) => r(code)));
  t.after(() => child.kill('SIGKILL'));
  await waitFor(() => existsSync(join(s.controlDir, 'workers.json')) && workersOf(s).length === 1, 'the live planner');
  await waitFor(() => planLog(s).some((e) => e.dir === 'in' && e.event.type === 'system'), 'the planner init');
  const { pid } = workersOf(s)[0];
  child.kill('SIGTERM');
  await waitFor(() => indexOf(s).finalState === 'stopped', '`stopped` in the index', 1000);
  assert.equal(readSnapshot(s.controlDir).finalState, 'stopped');
  assert.doesNotThrow(() => process.kill(pid, 0), 'recorded while the session is still being closed');
  assert.equal(await exited, 0);
  assert.throws(() => process.kill(pid, 0), 'the stubborn session was killed');
  assert.equal(indexOf(s).finalState, 'stopped');
  assert.equal(readSnapshot(s.controlDir).runState.steps[0].worker.live, false, 'the last snapshot shows the session closed');
  assert.deepEqual(workersOf(s), []);
});

// ---- T07: the rename, the reviewer, and resume. ----

// gate(file) → a `sh` step that waits (at most 10 s) for `file` to exist. A session parked on it is
// closed or killed mid-step, so the step is not recorded as done and a resumed fake re-runs it; the test
// creates the file before the resume, so the re-run passes at once. Bounded, so an orphaned wait ends.
const gate = (file) => ({ sh: `i=0; while [ ! -f ${q(file)} ] && [ $i -lt 100 ]; do sleep 0.1; i=$((i+1)); done` });
const reviewLog = (dir, n = 1) => readLog(join(dir, 'conversations', `review-${n}.ndjson`));
const pirTexts = (log) => log.filter((e) => e.dir === 'out' && e.from === 'pir' && e.kind === 'message').map((e) => e.text);
const argvs = (s) => readFileSync(s.received, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((x) => x.argv).map((x) => x.argv);

// A reviewer that runs `steps` in the worktree after its opening, then reports `kind`.
function reviewer(slug, { steps = [], kind = 'reviewed', after = [] } = {}) {
  return [
    { await: 'user' },
    { emit: initEvent() },
    ...steps,
    { sh: sessionsCmd('report', '{{reportsDir}}', 'plan', `[pir:v1 kind=${kind} plan=${slug}]\n${kind}`) },
    { emit: assistantText(`Reported ${kind}.`) },
    { emit: resultEvent('success', `Reported ${kind}.`) },
    ...after,
  ];
}
const markReviewed = (slug) => ({ sh: `${sessionsCmd('review-plan', slug)} && ${GIT} commit -q -am ${q(`plan-review(${slug}): clean`)}` });

// The plan branch as a planner leaves it: the fake plan committed, state.json at step `rename`.
function planned(s, slug, { sessions = ['planner-session'] } = {}) {
  execFileSync(process.execPath, [SESSIONS, 'write-plan', slug], { cwd: s.worktree });
  git(s.worktree, ['add', '-A']);
  git(s.worktree, ['commit', '-q', '-m', `plan(${slug})`]);
  writeFileSync(join(s.controlDir, 'state.json'), JSON.stringify({ ...initialPlanState({ id: ID }), step: 'rename', slug, sessions: { plan: sessions, review: [] } }));
}

test('the whole run: planner → planned → rename → reviewer with the exact instruction in pir-{slug} → reviewed → finished', async (t) => {
  const slug = 'whole-run';
  const s = setup(t, [{ match: PLANNER_MATCH, script: quickPlanner(slug) }, { match: REVIEWER_MATCH, script: reviewerScript({ slug }) }]);
  const mainBefore = git(s.root, ['rev-parse', 'main']).stdout.trim();
  const began = Date.now();
  const run = start(s, { env: { PIR_RUN: '1' } });
  assert.equal(await run.done, 0, run.lines.join('\n'));
  assert.ok(Date.now() - began < 30000, 'brief → reviewed plan in under 30 s');

  // The rename: branch, worktree, control folder, index entry.
  const moved = controlAfter(s, slug);
  const newWorktree = join(s.root, '.claude', 'worktrees', `pir-${slug}`);
  assert.equal(git(s.root, ['rev-parse', '--verify', '--quiet', `refs/heads/pir/${ID}`]).ok, false);
  assert.equal(existsSync(s.worktree), false, 'the old worktree moved');
  assert.equal(git(newWorktree, ['branch', '--show-current']).stdout.trim(), `pir/${slug}`);
  assert.ok(existsSync(join(moved, 'state.json')));
  assert.equal(existsSync(join(s.root, 'plans', ID)), false, 'plans/{runId}/ is gone');
  const rec = indexOf(s, slug);
  assert.equal(rec.kind, 'plan');
  assert.equal(rec.label, null);
  assert.equal(rec.controlDir, moved);
  assert.equal(rec.branch, `pir/${slug}`);
  assert.equal(rec.finalState, 'finished');
  assert.equal(existsSync(recordPath(s.repo, ID, { dir: join(s.home, '.pir', 'runs') })), false);

  // The reviewer: fresh, with the exact instruction naming the moved reports folder; it did its work in
  // the renamed worktree, so the reviewed plan is on pir/{slug}. main is untouched.
  const log = reviewLog(moved);
  assert.deepEqual(pirTexts(log), [reviewerInstruction({ reportsDir: join(moved, 'reports'), slug })]);
  const progress = git(s.root, ['show', `pir/${slug}:plans/${slug}/PROGRESS.md`]).stdout;
  assert.match(progress, /\*\*Plan reviewed:\*\* yes/);
  assert.equal(git(s.root, ['log', '-1', '--format=%s', `pir/${slug}`]).stdout.trim(), `plan-review(${slug}): clean`);
  assert.equal(git(s.root, ['rev-parse', 'main']).stdout.trim(), mainBefore, 'main unchanged');
  assert.equal(argvs(s).length, 2, 'two sessions: planner and reviewer');
  assert.ok(argvs(s)[1].some((a) => a.startsWith('--session-id')), 'the reviewer is a fresh session');
  assert.ok(argvs(s)[1].includes(`${s.repo} / ${slug} / plan / reviewer`), 'the reviewer is named by the slug');

  const st = JSON.parse(readFileSync(join(moved, 'state.json'), 'utf8'));
  assert.equal(st.step, 'done');
  assert.equal(st.outcome, 'reviewed');
  assert.deepEqual(st.renamed, { branch: true, worktree: true, control: true, index: true });
  assert.equal(st.sessions.plan.length, 1);
  assert.equal(st.sessions.review.length, 1);
  const snap = readSnapshot(moved);
  assert.equal(snap.finalState, 'finished');
  assert.equal(snap.proc.slug, slug);
  assert.equal(snap.proc.branch, `pir/${slug}`);
  assert.deepEqual(snap.runState.steps.map((x) => x.phase), ['done', 'done', 'pending']);
  assert.equal(snap.runState.steps[0].worker.logPath, join(moved, 'conversations', 'plan-1.ndjson'), 'held paths re-pointed');
  assert.deepEqual(JSON.parse(readFileSync(join(moved, 'workers.json'), 'utf8')), []);

  // Remote Control: on right after the reviewer spawned, off only at its close.
  const rc = notes(log, 'remote-control');
  assert.deepEqual(rc.map((n) => n.on), [true, false]);
  const lastResult = log.findLastIndex((e) => e.dir === 'in' && e.event.type === 'result');
  assert.ok(log.indexOf(rc[1]) > lastResult, 'off only at the close');
});

test('reviewer: `reviewed` while PROGRESS.md is not marked → the reviewer hears it, the run goes on', async (t) => {
  const slug = 'not-marked';
  const s = setup(t, [{ match: REVIEWER_MATCH, script: reviewer(slug, { after: [{ chat: { workMs: 10 } }] }) }]);
  planned(s, slug);
  const run = start(s, { resume: true });
  t.after(() => run.stop.abort());
  const moved = controlAfter(s, slug);
  const msg = await waitFor(() => reviewLog(moved).find((e) => e.dir === 'out' && /did not accept/.test(e.text ?? '')), 'the failure message');
  assert.match(msg.text, /does not read reviewed/);
  assert.equal(run.code, undefined);
  assert.equal(JSON.parse(readFileSync(join(moved, 'state.json'), 'utf8')).step, 'review');
  run.stop.abort();
  assert.equal(await run.done, 0);
});

test('reviewer: `reviewed` with a dirty worktree → the reviewer hears it; pir commits nothing', async (t) => {
  const slug = 'dirty-review';
  const s = setup(t, [{ match: REVIEWER_MATCH, script: reviewer(slug, { steps: [markReviewed(slug), { sh: 'touch stray.txt' }], after: [{ chat: { workMs: 10 } }] }) }]);
  planned(s, slug);
  const run = start(s, { resume: true });
  t.after(() => run.stop.abort());
  const moved = controlAfter(s, slug);
  const msg = await waitFor(() => reviewLog(moved).find((e) => e.dir === 'out' && /did not accept/.test(e.text ?? '')), 'the failure message');
  assert.match(msg.text, /uncommitted changes/);
  run.stop.abort();
  assert.equal(await run.done, 0);
  const wt = join(s.root, '.claude', 'worktrees', `pir-${slug}`);
  assert.equal(git(wt, ['log', '-1', '--format=%s']).stdout.trim(), `plan-review(${slug}): clean`, 'nothing committed by pir');
  assert.match(git(wt, ['status', '--porcelain']).stdout, /stray\.txt/);
});

test('reviewer: `not-reviewed` → finished not-reviewed; --resume reopens the reviewer session, which then finishes reviewed', async (t) => {
  const slug = 'second-look';
  const s = setup(t, []);
  const open = join(s.dir, 'resume-gate');
  writeFileSync(join(s.dir, 'fake', 'scripts.json'), JSON.stringify([
    { match: REVIEWER_MATCH, script: reviewer(slug, { kind: 'not-reviewed', after: [gate(open), markReviewed(slug), { sh: sessionsCmd('report', '{{reportsDir}}', 'plan', `[pir:v1 kind=reviewed plan=${slug}]\nreviewed`) }, { emit: assistantText('Now reviewed.') }, { emit: resultEvent('success', 'Now reviewed.') }] }) },
  ]));
  planned(s, slug);
  const first = start(s, { resume: true, env: { PIR_RUN: '1', PARALLEL_REMOTE: '0' } });
  assert.equal(await first.done, 0, first.lines.join('\n'));
  const moved = controlAfter(s, slug);
  let st = JSON.parse(readFileSync(join(moved, 'state.json'), 'utf8'));
  assert.equal(st.step, 'done');
  assert.equal(st.outcome, 'not-reviewed');
  assert.equal(indexOf(s, slug).finalState, 'finished');
  assert.equal(readSnapshot(moved).runState.steps[1].phase, 'failed');
  const reviewerId = st.sessions.review[0];
  assert.equal(notes(reviewLog(moved), 'remote-control').length, 0, 'no Remote Control under PARALLEL_REMOTE=0');

  writeFileSync(open, '');
  const second = start(s, { resume: true, controlDir: moved });
  assert.equal(await second.done, 0, second.lines.join('\n'));
  st = JSON.parse(readFileSync(join(moved, 'state.json'), 'utf8'));
  assert.equal(st.outcome, 'reviewed');
  assert.deepEqual(st.sessions.review, [reviewerId], 'the same session, not a new one');
  const av = argvs(s);
  assert.ok(av.at(-1).includes(`--resume=${reviewerId}`) || av.at(-1).includes(reviewerId), av.at(-1).join(' '));
  const log = reviewLog(moved);
  assert.equal(existsSync(join(moved, 'conversations', 'review-2.ndjson')), false, 'appended to review-1');
  assert.deepEqual(pirTexts(log), [reviewerInstruction({ reportsDir: join(moved, 'reports'), slug }), resumeInstruction()]);
  const resumedAt = log.findIndex((e) => e.dir === 'note' && e.kind === 'resumed');
  assert.ok(resumedAt > 0);
  const rc = notes(log.slice(resumedAt), 'remote-control');
  assert.deepEqual(rc.map((n) => n.on), [true, false], 'Remote Control on once the resumed session starts, off at its close');
});

test('crash after the branch rename only, then --resume: the rename completes and the reviewer starts', async (t) => {
  const slug = 'half-renamed';
  const s = setup(t, [{ match: REVIEWER_MATCH, script: reviewerScript({ slug }) }]);
  planned(s, slug);
  git(s.root, ['branch', '-m', `pir/${ID}`, `pir/${slug}`]);
  const run = start(s, { resume: true, env: { PIR_RUN: '1' } });
  assert.equal(await run.done, 0, run.lines.join('\n'));
  const moved = controlAfter(s, slug);
  assert.ok(existsSync(join(s.root, '.claude', 'worktrees', `pir-${slug}`)));
  assert.equal(existsSync(join(s.root, 'plans', ID)), false);
  assert.equal(indexOf(s, slug).finalState, 'finished');
  const st = JSON.parse(readFileSync(join(moved, 'state.json'), 'utf8'));
  assert.equal(st.outcome, 'reviewed');
  assert.deepEqual(st.sessions.plan, ['planner-session'], 'the planner was not resumed');
  assert.deepEqual(pirTexts(reviewLog(moved)), [reviewerInstruction({ reportsDir: join(moved, 'reports'), slug })], 'a fresh reviewer');
});

test('crash after the control folder moved, before the index rename: --resume on the old folder finds the moved one', async (t) => {
  const slug = 'moved-control';
  const s = setup(t, [{ match: REVIEWER_MATCH, script: reviewerScript({ slug }) }]);
  planned(s, slug);
  git(s.root, ['branch', '-m', `pir/${ID}`, `pir/${slug}`]);
  git(s.root, ['worktree', 'move', s.worktree, join(s.root, '.claude', 'worktrees', `pir-${slug}`)]);
  const moved = controlAfter(s, slug);
  mkdirSync(join(s.root, 'plans', slug, '.parallel'), { recursive: true });
  renameSync(s.controlDir, moved);
  // The index entry still names the old folder, which is what pir's resume passes.
  const run = start(s, { resume: true, env: { PIR_RUN: '1' } });
  assert.equal(await run.done, 0, run.lines.join('\n'));
  const rec = indexOf(s, slug);
  assert.equal(rec.controlDir, moved);
  assert.equal(rec.finalState, 'finished');
  assert.equal(existsSync(recordPath(s.repo, ID, { dir: join(s.home, '.pir', 'runs') })), false);
});

test('crash inside the index rename (both entries written), then --resume: the old entry goes, the new one stays', async (t) => {
  const slug = 'both-entries';
  const s = setup(t, [{ match: REVIEWER_MATCH, script: reviewerScript({ slug }) }]);
  planned(s, slug);
  git(s.root, ['branch', '-m', `pir/${ID}`, `pir/${slug}`]);
  git(s.root, ['worktree', 'move', s.worktree, join(s.root, '.claude', 'worktrees', `pir-${slug}`)]);
  const moved = controlAfter(s, slug);
  mkdirSync(join(s.root, 'plans', slug, '.parallel'), { recursive: true });
  renameSync(s.controlDir, moved);
  const dir = join(s.home, '.pir', 'runs');
  writeRecord({ ...indexOf(s), slug, label: null, controlDir: moved, branch: `pir/${slug}` }, { dir });
  const run = start(s, { resume: true, controlDir: moved, env: { PIR_RUN: '1' } });
  assert.equal(await run.done, 0, run.lines.join('\n'));
  assert.equal(existsSync(recordPath(s.repo, ID, { dir })), false);
  assert.equal(indexOf(s, slug).finalState, 'finished');
});

test('SIGKILL mid-planner, then --resume: same session id, exactly the resume message, same log, the run goes on to reviewed', async (t) => {
  const slug = 'killed-planner';
  const s = setup(t, []);
  const open = join(s.dir, 'resume-gate');
  const planner = [
    { await: 'user' },
    { emit: initEvent() },
    { emit: assistantText('Thinking about it.') },
    { emit: resultEvent('success', 'Thinking about it.') },
    gate(open),
    { sh: `${sessionsCmd('write-plan', slug)} && ${GIT} add -A ${q(`plans/${slug}`)} && ${GIT} commit -q -m plan` },
    { sh: sessionsCmd('report', '{{reportsDir}}', 'plan', `[pir:v1 kind=planned plan=${slug}]\nThe plan is committed.`) },
    { emit: assistantText('Reported.') },
    { emit: resultEvent('success', 'Reported.') },
  ];
  writeFileSync(join(s.dir, 'fake', 'scripts.json'), JSON.stringify([{ match: PLANNER_MATCH, script: planner }, { match: REVIEWER_MATCH, script: reviewerScript({ slug }) }]));
  const child = spawnChild(process.execPath, [PROGRAM, '--control', s.controlDir], {
    env: { ...process.env, PATH: `${s.bin}:${process.env.PATH}`, PIR_HOME: s.home, PIR_RUN: '1' },
    stdio: 'ignore',
  });
  const exited = new Promise((r) => child.on('exit', (code, sig) => r(sig)));
  t.after(() => child.kill('SIGKILL'));
  await waitFor(() => planLog(s).some((e) => e.dir === 'in' && e.event.type === 'result'), 'the planner thinking');
  await waitFor(() => stateOf(s).sessions.plan.length === 1, 'the session id in state.json');
  const plannerId = stateOf(s).sessions.plan[0];
  child.kill('SIGKILL');
  assert.equal(await exited, 'SIGKILL');
  writeFileSync(open, '');

  const run = start(s, { resume: true, env: { PIR_RUN: '1' } });
  assert.equal(await run.done, 0, run.lines.join('\n'));
  const moved = controlAfter(s, slug);
  const st = JSON.parse(readFileSync(join(moved, 'state.json'), 'utf8'));
  assert.equal(st.outcome, 'reviewed');
  assert.deepEqual(st.sessions.plan, [plannerId], 'resumed under the same id');
  assert.ok(argvs(s)[1].includes(`--resume=${plannerId}`) || argvs(s)[1].includes(plannerId), argvs(s)[1].join(' '));
  assert.equal(existsSync(join(moved, 'conversations', 'plan-2.ndjson')), false, 'no second planner log');
  const log = readLog(join(moved, 'conversations', 'plan-1.ndjson'));
  assert.deepEqual(pirTexts(log), [plannerInstruction({ reportsDir: join(s.controlDir, 'reports'), brief: BRIEF }), resumeInstruction()], 'the opening once, then only the resume message');
  const resumedAt = log.findIndex((e) => e.dir === 'note' && e.kind === 'resumed');
  const resumeMsg = log.findIndex((e) => e.dir === 'out' && e.text === resumeInstruction());
  assert.ok(resumedAt > 0 && resumeMsg > resumedAt, 'the `resumed` note, then the message');
  const firstInAfter = log.findIndex((e, i) => i > resumedAt && e.dir === 'in');
  assert.ok(firstInAfter > resumeMsg, 'the resumed session took no turn before the message');
  assert.ok(notes(log.slice(resumedAt), 'remote-control').some((n) => n.on), 'Remote Control on for the resumed planner');
  assert.deepEqual(reviewLog(moved).length > 0, true);
});

test('--resume on a finished reviewed run exits 0 doing nothing', async (t) => {
  const slug = 'already-done';
  const s = setup(t, []);
  planned(s, slug);
  git(s.root, ['branch', '-m', `pir/${ID}`, `pir/${slug}`]);
  const done = { ...stateOf(s), step: 'done', outcome: 'reviewed', sessions: { plan: ['p'], review: ['r'] }, renamed: { branch: true, worktree: true, control: true, index: true } };
  writeFileSync(join(s.controlDir, 'state.json'), JSON.stringify(done));
  const run = start(s, { resume: true });
  assert.equal(await run.done, 0);
  assert.deepEqual(stateOf(s), done, 'state untouched');
  assert.equal(existsSync(s.received), false, 'no session started');
  assert.equal(git(s.root, ['rev-parse', '--verify', '--quiet', `refs/heads/pir/${slug}`]).ok, true);
  assert.ok(existsSync(s.worktree), 'nothing renamed');
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

test('reviewerChecks: each §2.7 failure has its reason, and a clean reviewed plan passes', () => {
  const files = {
    'PROGRESS.md': '# Progress\n\n**Plan reviewed:** 2026-09-26 — clean\n',
    'DESIGN.md': '---\nsetup: none\ntest:\n  - npm test\n---\n# D\n',
  };
  let dirty = '';
  const git = (_cwd, args) => {
    if (args[0] === 'show') {
      const f = args[1].split('/').at(-1);
      return f in files ? { ok: true, stdout: files[f] } : { ok: false, stdout: '' };
    }
    if (args[0] === 'status') return { ok: true, stdout: dirty };
    throw new Error(`unexpected git ${args}`);
  };
  const check = () => reviewerChecks({ slug: 'p', worktree: '/w', git });
  assert.deepEqual(check(), { ok: true, reason: null });
  dirty = ' M x';
  assert.match(check().reason, /uncommitted changes/);
  dirty = '';
  files['DESIGN.md'] = '# no block\n';
  assert.match(check().reason, /setup\/test block .* does not parse \(no front-matter block\)/, 'the parser\'s own reason is passed on');
  files['PROGRESS.md'] = '**Plan reviewed:** not yet\n';
  assert.match(check().reason, /does not read reviewed/);
  delete files['PROGRESS.md'];
  assert.match(check().reason, /PROGRESS\.md is not committed/);
});

test('findSessionLog picks the highest-n log of the step whose init names the session; findControlDir follows a moved folder', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pir-plan-run-find-'));
  try {
    const conv = join(dir, 'repo', 'plans', 'the-slug', '.parallel', 'plan', 'conversations');
    mkdirSync(conv, { recursive: true });
    const init = (id) => JSON.stringify({ dir: 'in', event: { type: 'system', subtype: 'init', session_id: id } }) + '\n';
    writeFileSync(join(conv, 'plan-1.ndjson'), init('a'));
    writeFileSync(join(conv, 'plan-2.ndjson'), init('b'));
    writeFileSync(join(conv, 'review-3.ndjson'), init('a'));
    const control = dirname(conv);
    assert.deepEqual(findSessionLog(control, 'plan', 'a'), { logPath: join(conv, 'plan-1.ndjson'), n: 1 });
    assert.deepEqual(findSessionLog(control, 'review', 'a'), { logPath: join(conv, 'review-3.ndjson'), n: 3 });
    assert.equal(findSessionLog(control, 'plan', 'zz'), null);
    writeFileSync(join(control, 'state.json'), JSON.stringify({ id: 'plan-ab12' }));
    const old = join(dir, 'repo', 'plans', 'plan-ab12', '.parallel', 'plan');
    assert.equal(findControlDir(old), control);
    assert.equal(findControlDir(control), control);
    assert.equal(findControlDir(join(dir, 'repo', 'plans', 'plan-ffff', '.parallel', 'plan')), join(dir, 'repo', 'plans', 'plan-ffff', '.parallel', 'plan'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('planRunState: phases per step, the asking kind, the open session and its clock', () => {
  const st = (over) => ({ ...initialPlanState({ id: ID }), ...over });
  const sess = (step, live, state) => ({ id: `${step}-${live}`, step, n: 1, logPath: `/c/${step}-1.ndjson`, live, activity: { state } });
  let rs = planRunState(st({}), { label: 'A thing', sessions: [sess('plan', true, 'busy')], since: { plan: 5 } });
  assert.equal(rs.kind, 'plan');
  assert.equal(rs.label, 'A thing');
  assert.deepEqual(rs.steps.map((x) => [x.id, x.phase]), [['plan', 'planning'], ['review', 'pending'], ['build', 'pending']]);
  assert.equal(rs.steps[0].since, 5);
  assert.deepEqual(rs.steps[0].worker, { id: 'plan-true', live: true, logPath: '/c/plan-1.ndjson', cwd: null });
  assert.deepEqual(rs.steps[0].workers, [{ id: 'plan-true', role: 'planner', n: 1, logPath: '/c/plan-1.ndjson', cwd: null }]);

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

// stopped-worker-asking T03 (DESIGN §2.3): a planning session that has stopped asks the person, through the
// shared stoppedOnPerson, unless its step's report is already accepted.
test('planRunState: a stopped planner or reviewer reads asking a question, until its report is accepted', () => {
  const st = (over) => ({ ...initialPlanState({ id: ID }), ...over });
  const sess = (step, activity, live = true) => ({ id: `${step}-1`, step, n: 1, live, activity });
  const stopped = { state: 'idle', background: [] };

  let rs = planRunState(st({}), { sessions: [sess('plan', stopped)], since: { plan: 5 }, stoppedAt: { plan: 9 } });
  assert.equal(rs.steps[0].phase, 'asking');
  assert.equal(rs.steps[0].asking, 'question');
  assert.equal(rs.steps[0].stoppedAt, 9, 'the step clock stops');

  rs = planRunState(st({}), { sessions: [sess('plan', { state: 'idle', background: ['b1'] })], stoppedAt: { plan: 9 } });
  assert.equal(rs.steps[0].phase, 'planning', 'idle on its own background job');
  assert.equal(rs.steps[0].asking, null);
  assert.equal(rs.steps[0].stoppedAt, null);

  rs = planRunState(st({ accepted: { kind: 'planned', plan: 'screen-time' } }), { sessions: [sess('plan', stopped)] });
  assert.equal(rs.steps[0].phase, 'planning', 'an accepted planned waits on pir, not the person');

  rs = planRunState(st({ step: 'review', slug: 's' }), { sessions: [sess('plan', { state: 'exited' }, false), sess('review', stopped)] });
  assert.deepEqual(rs.steps.map((x) => x.phase), ['done', 'asking', 'pending']);
  assert.equal(rs.steps[1].asking, 'question');
  rs = planRunState(st({ step: 'review', slug: 's' }), { sessions: [sess('review', { state: 'busy', background: [] })] });
  assert.equal(rs.steps[1].phase, 'reviewing');
  rs = planRunState(st({ step: 'review', slug: 's', accepted: { kind: 'reviewed', plan: 's' } }), { sessions: [sess('review', stopped)] });
  assert.equal(rs.steps[1].phase, 'reviewing', 'an accepted reviewed waits on pir');

  // A pending request still names its kind, accepted report or not.
  for (const kind of ['permission', 'questions']) {
    rs = planRunState(st({ accepted: { kind: 'planned', plan: 'x' } }), { sessions: [sess('plan', { state: kind, background: [] })] });
    assert.equal(rs.steps[0].asking, kind);
  }
  // An activity with no `background` listing is not stopped (today's reading).
  rs = planRunState(st({}), { sessions: [sess('plan', { state: 'idle' })] });
  assert.equal(rs.steps[0].phase, 'planning');
  assert.equal(sessionAsking(st({}), null), null, 'no live session asks nothing');
});

test('trackStoppedAt: stamped when the stopped reading starts, kept while it holds, cleared when the next turn opens', () => {
  const state = initialPlanState({ id: ID });
  const view = (activity, live = true) => [{ step: 'plan', live, activity }];
  let t = 100;
  const now = () => t;
  const at = {};
  trackStoppedAt(state, view({ state: 'busy', background: [] }), at, now);
  assert.deepEqual(at, {});
  trackStoppedAt(state, view({ state: 'idle', background: [] }), at, now);
  assert.deepEqual(at, { plan: 100 });
  t = 200;
  trackStoppedAt(state, view({ state: 'idle', background: [] }), at, now);
  assert.deepEqual(at, { plan: 100 }, 'the first stamp holds');
  trackStoppedAt(state, view({ state: 'busy', background: [] }), at, now);
  assert.deepEqual(at, {}, 'cleared when the next turn opens');
  trackStoppedAt(state, view({ state: 'permission' }), at, now);
  assert.deepEqual(at, { plan: 200 }, 'a pending request stamps as before');
  trackStoppedAt(state, view({ state: 'exited' }, false), at, now);
  assert.deepEqual(at, { plan: 200 }, 'a session no longer live leaves the stamp alone');
  trackStoppedAt({ ...state, accepted: { kind: 'planned', plan: 'x' } }, view({ state: 'idle', background: [] }), at, now);
  assert.deepEqual(at, {}, 'idle after an accepted report is not asking');
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

// T14: a finished step's time is read from its logs, and the gap between a stop and its resume (after the
// `resumed` note) is not counted.
test('stepWorkedMs sums each log segment between resumes, and is null with nothing stamped', () => {
  const note = (t, kind) => ({ t, dir: 'note', kind });
  const log = [{ t: 1000, dir: 'out' }, { t: 5000, dir: 'in' }, note(6000, 'exited'), note(90_000, 'resumed'), { t: 91_000, dir: 'out' }, note(94_000, 'exited')];
  assert.equal(stepWorkedMs([log]), 5000 + 4000);
  assert.equal(stepWorkedMs([log, [{ t: 0 }, { t: 500 }]]), 9500, 'every log of the step counts');
  assert.equal(stepWorkedMs([[]]), null);
  assert.equal(stepWorkedMs([[{ t: 7 }]]), null);
  assert.equal(stepWorkedMs([]), null);
});
