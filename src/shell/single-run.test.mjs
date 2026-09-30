// single-runs T04 — the single program (setup, builder, tests, red rounds, baseline, rename, reviewer,
// stop and resume), run against the fake Claude in scratch repos with real git and real `sh` test lines.
// No real `claude` is ever started: every session is the shim.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn as spawnChild } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resumeInstruction } from '../core/planflow.mjs';
import { parseRecord } from '../core/runrecord.mjs';
import { builderInstruction, initialSingleState, leftoverMessage, reviewerInstruction } from '../core/singleflow.mjs';
import { writeClaudeShim } from './fake/claude-shim.mjs';
import { initEvent, assistantText, resultEvent } from './fake/claude-stream.mjs';
import { startTimeOf } from './identity.mjs';
import { recordPath, writeRecord } from './index-store.mjs';
import { readSnapshot } from './snapshot-store.mjs';
import { git, openBaseline, openPlanBranch } from './worktree.mjs';
import {
  commandFileOf,
  findControlDir,
  formatSingleSetupNote,
  nextTestsLogPath,
  parseArgs,
  reapCommand,
  rootOf,
  runSingle,
  singleChecks,
  singleRunState,
} from './single-run.mjs';

const PROGRAM = fileURLToPath(new URL('./single-run.mjs', import.meta.url));
const ID = 'single-ab12';
const PROMPT = 'Fix the typo in the README\n\nand nothing else';
const BUILDER_MATCH = 'run it as the builder';
const REVIEWER_MATCH = 'run it as the reviewer';

const q = (s) => `'${String(s).replaceAll("'", `'\\''`)}'`;
const GIT = "git -c user.name='pir fake' -c user.email=fake@pir.invalid";

async function waitFor(fn, what, ms = 20000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

// ---- Fake session scripts. ----
//
// A session drops its report where its opening names the reports folder. The fake's own
// `{{reportsDir}}` reads to the end of the line, and the single instructions go on after the path
// (`. Starting point: …`), so the folder is cut out of FAKE_OPENING here.
const REPORT_JS =
  "const fs=require('fs'),p=require('path');" +
  'const d=/Reports folder: (.+?)\\. Starting point/.exec(process.env.FAKE_OPENING)[1];' +
  'fs.mkdirSync(d,{recursive:true});' +
  "const f=p.join(d,Date.now()+'-single-'+Math.random().toString(36).slice(2)+'.json');" +
  "fs.writeFileSync(f+'.tmp',JSON.stringify({from:'pir fake claude',text:process.argv[1]}));" +
  "fs.renameSync(f+'.tmp',f)";
const report = (kind, name, body = kind) => ({ sh: `${q(process.execPath)} -e ${q(REPORT_JS)} ${q(`[pir:v1 kind=${kind} single=${name}]\n${body}`)}` });
const opening = () => [{ await: 'user' }, { emit: initEvent() }];
const say = (text) => [{ emit: assistantText(text) }, { emit: resultEvent('success', text) }];
// One more turn, taken when the next message arrives.
const turn = (...steps) => [{ await: 'user' }, { emit: initEvent() }, ...steps];
const commit = (file, message = `add ${file}`) => ({ sh: `echo x >> ${q(file)} && ${GIT} add -A && ${GIT} commit -q -m ${q(message)}` });
// A `sh` step that waits (at most 10 s) until `cond` holds.
const until = (cond) => ({ sh: `i=0; until ${cond} || [ $i -ge 100 ]; do sleep 0.1; i=$((i+1)); done` });

// Exits 0 once the state file records a green test run.
const TESTED_GREEN_JS = "process.exit(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).tested?.ok===true?0:1)";

const builder = (name, { file = 'change.txt', after = [] } = {}) => [...opening(), commit(file), report('built', name), ...say('Reported built.'), ...after];
const reviewer = (name, { steps = [], after = [] } = {}) => [...opening(), ...steps, report('reviewed', name), ...say('Reported reviewed.'), ...after];

// A scratch repo with main, the run's branch opened as startSingleRun (T05) will open it, the control
// folder with prompt.md and state.json, the index entry, and the fake `claude` behind a shim. `scripts`
// may be a function of the paths, for a script that waits on a file in the control folder.
function setup(t, scripts, { commands = { setup: [], test: ['true'] }, indexEntry = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'pir-single-run-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const root = join(dir, 'repo');
  git(dir, ['init', '-q', '-b', 'main', 'repo']);
  for (const [k, v] of [['user.email', 't04@test.local'], ['user.name', 'T04'], ['commit.gpgsign', 'false']]) git(root, ['config', k, v]);
  writeFileSync(join(root, 'README.md'), 'scratch\n');
  writeFileSync(join(root, '.gitignore'), 'plans/*/.parallel/\n.claude/\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init']);
  const baseSha = git(root, ['rev-parse', 'HEAD']).stdout.trim();
  const { path: worktree } = openPlanBranch(ID, { root, base: 'main' });
  const controlDir = join(root, 'plans', ID, '.parallel', 'single');
  mkdirSync(controlDir, { recursive: true });
  writeFileSync(join(controlDir, 'prompt.md'), PROMPT);
  const home = join(dir, 'home');
  const repo = 'repo';
  const s = { dir, root, worktree, controlDir, home, repo, baseSha, bin: join(dir, 'bin'), received: join(dir, 'fake', 'received.ndjson') };
  const cmds = typeof commands === 'function' ? commands(s) : commands;
  writeFileSync(join(controlDir, 'state.json'), JSON.stringify(initialSingleState({ id: ID, base: 'main', baseSha, commands: cmds })));
  if (indexEntry) {
    writeRecord(
      { kind: 'single', label: 'Fix the typo in the READ', slug: ID, repo, repoPath: root, controlDir, pid: process.pid, startTime: 'Wed Sep 30 10:00:00 2026', branch: `pir/${ID}`, baseBranch: 'main' },
      { dir: join(home, '.pir', 'runs') },
    );
  }
  mkdirSync(join(dir, 'fake'));
  const scriptsFile = join(dir, 'fake', 'scripts.json');
  writeFileSync(scriptsFile, JSON.stringify(typeof scripts === 'function' ? scripts(s) : scripts));
  s.shim = writeClaudeShim(s.bin, { scriptsFile, received: s.received });
  return s;
}

// runSingle in this process, with a stop lever, the program's log and its snapshots kept.
function start(s, { env = {}, deps = {}, resume = false, controlDir = s.controlDir } = {}) {
  const stop = new AbortController();
  const lines = [];
  const snaps = [];
  let code;
  const done = runSingle({
    controlDir,
    resume,
    deps: {
      env: { PIR_HOME: s.home, PARALLEL_REMOTE: '0', ...env },
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
const convLog = (dir, step, n = 1) => readLog(join(dir, 'conversations', `${step}-${n}.ndjson`));
const pirTexts = (log) => log.filter((e) => e.dir === 'out' && e.from === 'pir' && e.kind === 'message').map((e) => e.text);
const stateIn = (dir) => JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'));
const workersIn = (dir) => JSON.parse(readFileSync(join(dir, 'workers.json'), 'utf8'));
const indexOf = (s, key = ID) => parseRecord(readFileSync(recordPath(s.repo, key, { dir: join(s.home, '.pir', 'runs') }), 'utf8'));
const controlAfter = (s, name) => join(s.root, 'plans', name, '.parallel', 'single');
const testLogs = (dir) => readdirSync(dir).filter((n) => /^tests-\d+\.log$/.test(n)).sort();
const argvs = (s) => readFileSync(s.received, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((x) => x.argv).map((x) => x.argv);
const basePath = (s) => join(s.root, '.claude', 'worktrees', `pir-${ID}-base`);
const worktreeCount = (s) => git(s.root, ['worktree', 'list', '--porcelain']).stdout.split('\n').filter((l) => l.startsWith('worktree ')).length;
const gone = (pid) => {
  try {
    process.kill(pid, 0);
    return false;
  } catch {
    return true;
  }
};

// ---- The whole run. ----

test('happy path: setup, builder, checks, tests green, rename, a fresh reviewer, tests green, ready; testing is never asking', async (t) => {
  const name = 'fix-typo';
  const s = setup(
    t,
    [
      { match: BUILDER_MATCH, script: builder(name) },
      { match: REVIEWER_MATCH, script: reviewer(name, { steps: [commit('review.txt', 'review: a fix')] }) },
    ],
    { commands: { setup: ['echo setup-ran'], test: ['sleep 0.4', 'test -f change.txt'] } },
  );
  const mainBefore = git(s.root, ['rev-parse', 'main']).stdout.trim();
  const run = start(s, { env: { PIR_RUN: '1' } });
  assert.equal(await run.done, 0, run.lines.join('\n'));

  // The rename: branch, worktree, control folder, index entry, all under the builder's name.
  const moved = controlAfter(s, name);
  const worktree = join(s.root, '.claude', 'worktrees', `pir-${name}`);
  assert.equal(git(s.root, ['rev-parse', '--verify', '--quiet', `refs/heads/pir/${ID}`]).ok, false);
  assert.equal(existsSync(s.worktree), false, 'the old worktree moved');
  assert.equal(git(worktree, ['branch', '--show-current']).stdout.trim(), `pir/${name}`);
  assert.equal(existsSync(join(s.root, 'plans', ID)), false, 'plans/{id}/ is gone');
  const rec = indexOf(s, name);
  assert.deepEqual([rec.kind, rec.label, rec.controlDir, rec.branch, rec.finalState], ['single', null, moved, `pir/${name}`, 'finished']);
  assert.equal(existsSync(recordPath(s.repo, ID, { dir: join(s.home, '.pir', 'runs') })), false);

  // Setup ran first, in the worktree; each test run is setup then test lines in one log.
  assert.match(readFileSync(join(moved, 'setup.log'), 'utf8'), /^\$ echo setup-ran\nsetup-ran\n$/);
  assert.deepEqual(testLogs(moved), ['tests-1.log', 'tests-2.log'], 'one run per step: the reviewer committed a fix');
  assert.match(readFileSync(join(moved, 'tests-1.log'), 'utf8'), /^\$ echo setup-ran\nsetup-ran\n\$ sleep 0\.4\n\$ test -f change\.txt\n$/);

  // The two sessions, each with its exact opening; the reviewer is fresh and named by the new name.
  const reportsBefore = join(s.controlDir, 'reports');
  assert.deepEqual(pirTexts(convLog(moved, 'build')), [builderInstruction({ reportsDir: reportsBefore, base: 'main', baseSha: s.baseSha, prompt: PROMPT })]);
  assert.deepEqual(pirTexts(convLog(moved, 'review')), [reviewerInstruction({ reportsDir: join(moved, 'reports'), name, base: 'main', baseSha: s.baseSha, prompt: PROMPT })]);
  const av = argvs(s);
  assert.equal(av.length, 2, 'two sessions: builder and reviewer');
  assert.ok(av[0].includes(`${s.repo} / ${ID} / single / builder`), av[0].join(' '));
  assert.ok(av[1].includes(`${s.repo} / ${name} / single / reviewer`), av[1].join(' '));
  assert.ok(av[1].some((a) => a.startsWith('--session-id')), 'the reviewer is a fresh session');
  const buildLog = convLog(moved, 'build');
  const lastResult = buildLog.findLastIndex((e) => e.dir === 'in' && e.event.type === 'result');
  assert.ok(buildLog.findIndex((e) => e.dir === 'note' && e.kind === 'exited') > lastResult, 'the builder was closed only after its turn ended');

  // The end: ready, on the renamed branch, the base untouched, nothing left running.
  const st = stateIn(moved);
  assert.deepEqual([st.step, st.outcome, st.name, st.running], ['review', 'ready', name, null]);
  assert.deepEqual(st.renamed, { branch: true, worktree: true, control: true, index: true });
  assert.deepEqual([st.sessions.build.length, st.sessions.review.length], [1, 1]);
  assert.deepEqual(st.rounds, { build: 0, review: 0 });
  assert.equal(git(s.root, ['log', '-1', '--format=%s', `pir/${name}`]).stdout.trim(), 'review: a fix');
  assert.equal(git(s.root, ['rev-parse', 'main']).stdout.trim(), mainBefore, 'main unchanged');
  assert.deepEqual(workersIn(moved), []);
  assert.equal(existsSync(commandFileOf(moved)), false);
  assert.equal(worktreeCount(s), 2, 'the main checkout and the run, no baseline');

  // The snapshots (§3.5, §2.9): while pir's tests run the step reads testing, and no step ever asked.
  const snap = readSnapshot(moved);
  assert.equal(snap.finalState, 'finished');
  assert.deepEqual([snap.proc.slug, snap.proc.branch], [name, `pir/${name}`]);
  assert.deepEqual([snap.runState.kind, snap.runState.name, snap.runState.outcome, snap.runState.base, snap.runState.label], ['single', name, 'ready', 'main', null]);
  assert.deepEqual(snap.runState.steps.map((x) => [x.id, x.phase]), [['build', 'done'], ['review', 'done'], ['merge', 'ready']]);
  assert.equal(snap.runState.steps[0].worker.logPath, join(moved, 'conversations', 'build-1.ndjson'), 'held paths re-pointed');
  const phases = (i) => run.snaps.map((x) => x.runState.steps[i].phase);
  for (const p of ['building', 'testing', 'done']) assert.ok(phases(0).includes(p), `a build snapshot at ${p}: ${phases(0)}`);
  for (const p of ['pending', 'reviewing', 'testing', 'done']) assert.ok(phases(1).includes(p), `a review snapshot at ${p}: ${phases(1)}`);
  assert.ok(!phases(0).includes('asking') && !phases(1).includes('asking'), 'a session waiting on pir is not asking the person');
  const testing = run.snaps.find((x) => x.runState.steps[0].phase === 'testing');
  assert.equal(testing.runState.phase, 'testing');
  assert.equal(testing.runState.label, 'Fix the typo in the READ', 'the label names the run until it has a name');
  assert.ok(Number.isFinite(testing.runState.steps[0].testingSince));
  assert.ok(run.snaps.some((x) => x.runState.steps[0].phase === 'testing' && x.runState.steps[0].worker.live), 'the builder stays open while pir tests');
});

test('red once, then green: round 1 reaches the builder with the baseline line; a reviewer that commits nothing needs no second run', async (t) => {
  const name = 'red-once';
  const fix = { sh: `${GIT} rm -q broken && ${GIT} commit -q -m 'remove the marker'` };
  const s = setup(
    t,
    [
      { match: BUILDER_MATCH, script: builder(name, { file: 'broken', after: [...turn(fix, report('built', name), ...say('Fixed and reported.'))] }) },
      { match: REVIEWER_MATCH, script: reviewer(name) },
    ],
    { commands: { setup: [], test: ['test ! -f broken'] } },
  );
  const run = start(s);
  assert.equal(await run.done, 0, run.lines.join('\n'));
  const moved = controlAfter(s, name);
  const st = stateIn(moved);
  assert.equal(st.outcome, 'ready');
  assert.deepEqual(st.rounds, { build: 1, review: 0 });
  assert.deepEqual(st.baseline, { ok: true, half: null, reason: null, logPath: join(s.controlDir, 'baseline.log') });

  const red = git(s.root, ['rev-parse', `pir/${name}~1`]).stdout.trim();
  const [, msg, ...rest] = pirTexts(convLog(moved, 'build'));
  assert.deepEqual(rest, [], 'one message for one red');
  assert.deepEqual(msg.split('\n'), [
    `pir ran the tests on your commit ${red.slice(0, 7)} and they failed: test \`test ! -f broken\` exited 1. Round 1 of 3.`,
    `They pass on the untouched starting point (main ${s.baseSha.slice(0, 7)}), so this change broke them.`,
    `Log: ${join(s.controlDir, 'tests-1.log')}`,
    '$ test ! -f broken',
    'Fix it, commit, and report again.',
  ]);
  // The baseline ran once, in a throwaway worktree that is gone; the reviewer changed nothing, so the
  // build's green result stands.
  assert.equal(readFileSync(join(moved, 'baseline.log'), 'utf8'), '$ test ! -f broken\n');
  assert.equal(existsSync(basePath(s)), false, 'the baseline worktree is gone');
  assert.equal(worktreeCount(s), 2);
  assert.deepEqual(testLogs(moved), ['tests-1.log', 'tests-2.log'], 'red, green, and no run for the review');
  assert.equal(st.tested.head, git(s.root, ['rev-parse', `pir/${name}`]).stdout.trim());
});

test('four reds that also fail on the starting point: one baseline, round 4 carries the past-limit line, the step then reads asking', async (t) => {
  const again = turn(report('built', 'never-green'), ...say('Reported again.'));
  const s = setup(
    t,
    [{ match: BUILDER_MATCH, script: builder('never-green', { after: [...again, ...again, ...again, ...turn(...say('It still fails and I am out of ideas. How should I go on?'))] }) }],
    { commands: { setup: [], test: ['test -f never.txt'] } },
  );
  const run = start(s, { env: { PIR_RUN: '1' } });
  t.after(() => run.stop.abort());
  const messages = () => pirTexts(convLog(s.controlDir, 'build')).slice(1);
  await waitFor(() => messages().length === 4, 'four red messages');
  const texts = messages();
  texts.forEach((text, i) => {
    assert.match(text, new RegExp(`and they failed: test \`test -f never\\.txt\` exited 1\\. Round ${i + 1} of 3\\.`));
    assert.ok(text.includes(`They also fail on the untouched starting point (main ${s.baseSha.slice(0, 7)}), so the failure may be older than this change.`), text);
    assert.ok(text.includes(`Log: ${join(s.controlDir, `tests-${i + 1}.log`)}`), text);
  });
  for (const text of texts.slice(0, 3)) assert.ok(text.endsWith('\nFix it, commit, and report again.'));
  assert.ok(
    texts[3].endsWith('\nThis is round 4, past the limit of 3: stop, tell the person what fails and what you tried, and ask how to go on. Report again only after they answer.'),
    texts[3],
  );
  assert.equal(run.lines.filter((l) => l === 'baseline run started').length, 1, 'the baseline is stored and reused');
  assert.equal(existsSync(basePath(s)), false);

  // The session stops on the person: the step reads asking, by the ordinary stopped-session rule.
  await waitFor(() => run.snaps.at(-1)?.runState.steps[0].phase === 'asking', 'the build step asking');
  const step = run.snaps.at(-1).runState.steps[0];
  assert.equal(step.asking, 'question');
  assert.equal(step.round, 4);
  assert.ok(Number.isFinite(step.stoppedAt));
  assert.equal(run.snaps.at(-1).runState.phase, 'working');
  assert.deepEqual(stateIn(s.controlDir).rounds, { build: 4, review: 0 });
  assert.equal(run.code, undefined, 'the run is still going');
  run.stop.abort();
  assert.equal(await run.done, 0);
});

test('a baseline that cannot run: the round goes on and the message says the starting point could not be tested', async (t) => {
  const script = builder('no-baseline', { after: [...turn(...say('Looking into it.'))] });
  // Its worktree cannot be made.
  const a = setup(t, [{ match: BUILDER_MATCH, script }], { commands: { setup: [], test: ['false'] } });
  const first = start(a, { deps: { openBaseline: () => { throw new Error('openBaseline: worktree add failed: disk full'); } } });
  t.after(() => first.stop.abort());
  let [msg] = await waitFor(() => (pirTexts(convLog(a.controlDir, 'build')).length > 1 ? pirTexts(convLog(a.controlDir, 'build')).slice(1) : null), 'the red message');
  assert.equal(msg.split('\n')[1], 'The untouched starting point could not be tested: its worktree could not be made (openBaseline: worktree add failed: disk full).');
  assert.match(msg, /Round 1 of 3\./);
  first.stop.abort();
  assert.equal(await first.done, 0);

  // Its setup fails there: the change is what makes the setup line pass.
  const b = setup(t, [{ match: BUILDER_MATCH, script }], { commands: { setup: ['test -f change.txt'], test: ['false'] } });
  const second = start(b);
  t.after(() => second.stop.abort());
  [msg] = await waitFor(() => (pirTexts(convLog(b.controlDir, 'build')).length > 1 ? pirTexts(convLog(b.controlDir, 'build')).slice(1) : null), 'the red message');
  assert.equal(msg.split('\n')[0].replace(/commit [0-9a-f]{7}/, 'commit X'), 'pir ran the tests on your commit X and they failed: test `false` exited 1. Round 1 of 3.');
  assert.equal(msg.split('\n')[1], 'The untouched starting point could not be tested: setup `test -f change.txt` exited 1.');
  assert.equal(existsSync(basePath(b)), false, 'the baseline worktree is gone');
  assert.equal(stateIn(b.controlDir).baseline.half, 'setup');
  second.stop.abort();
  assert.equal(await second.done, 0);
});

test('built with nothing committed, with a dirty tree, with a taken name: one message each, and the run continues', async (t) => {
  const s = setup(t, [
    {
      match: BUILDER_MATCH,
      script: [
        ...opening(),
        report('built', 'fix-it'),
        ...say('Reported.'),
        ...turn(commit('change.txt'), { sh: 'touch stray.txt' }, report('built', 'fix-it'), ...say('Reported.')),
        ...turn({ sh: 'rm stray.txt' }, report('built', 'taken-name'), ...say('Reported.')),
        ...turn(...say('Thinking of another name.')),
      ],
    },
  ]);
  git(s.root, ['branch', 'pir/taken-name', 'main']);
  const run = start(s);
  t.after(() => run.stop.abort());
  const messages = () => pirTexts(convLog(s.controlDir, 'build')).slice(1);
  await waitFor(() => messages().length === 3, 'three check messages');
  const [none, dirty, taken] = messages();
  assert.equal(none, 'pir did not accept your `built` report for pir/fix-it: nothing is committed on the branch yet. Commit the change, then drop the `built` report again.');
  assert.equal(dirty, 'pir did not accept your `built` report for pir/fix-it: The worktree has uncommitted changes (git status --porcelain is not empty). Commit everything you wrote, then drop the `built` report again.');
  assert.equal(taken, 'pir did not accept your `built` report for pir/taken-name: The name "taken-name" is taken: a branch pir/taken-name already exists. Choose another name, then drop the `built` report again.');
  const st = stateIn(s.controlDir);
  assert.deepEqual([st.step, st.accepted, st.name], ['build', null, null]);
  assert.deepEqual(testLogs(s.controlDir), [], 'no test run on a refused report');
  assert.equal(run.code, undefined);
  assert.equal(git(s.worktree, ['log', '-1', '--format=%an']).stdout.trim(), 'pir fake', 'pir committed nothing for the session');
  run.stop.abort();
  assert.equal(await run.done, 0);
});

test('dropped: the run finishes dropped, the branch and its body are kept, nothing is renamed', async (t) => {
  const s = setup(t, [{ match: BUILDER_MATCH, script: [...opening(), report('dropped', '-', 'Too big for a single run: use /plan.'), ...say('Dropped, as agreed.')] }]);
  const run = start(s, { env: { PIR_RUN: '1' } });
  assert.equal(await run.done, 0, run.lines.join('\n'));
  const st = stateIn(s.controlDir);
  assert.deepEqual([st.step, st.outcome, st.name], ['build', 'dropped', null]);
  assert.equal(st.accepted.body, 'Too big for a single run: use /plan.');
  assert.ok(git(s.root, ['rev-parse', '--verify', '--quiet', `refs/heads/pir/${ID}`]).ok, 'the branch is kept');
  assert.ok(existsSync(s.worktree));
  assert.equal(indexOf(s).finalState, 'finished');
  const snap = readSnapshot(s.controlDir);
  assert.equal(snap.finalState, 'finished');
  assert.deepEqual(snap.runState.steps.map((x) => x.phase), ['failed', 'pending', 'pending']);
  assert.deepEqual(workersIn(s.controlDir), []);
});

test('setup failing at the start: the builder is started anyway and its instruction carries the note', async (t) => {
  const s = setup(t, [{ match: BUILDER_MATCH, script: [...opening(), ...say('Looking at the setup.')] }], { commands: { setup: ['echo boom; exit 3'], test: ['true'] } });
  const run = start(s);
  t.after(() => run.stop.abort());
  const [text] = await waitFor(() => (pirTexts(convLog(s.controlDir, 'build')).length ? pirTexts(convLog(s.controlDir, 'build')) : null), 'the builder opening');
  const setupLog = join(s.controlDir, 'setup.log');
  const note = formatSingleSetupNote({ reason: '`echo boom; exit 3` exited 3', tail: '$ echo boom; exit 3\nboom', logPath: setupLog }, { setup: ['echo boom; exit 3'] });
  assert.equal(text, builderInstruction({ reportsDir: join(s.controlDir, 'reports'), base: 'main', baseSha: s.baseSha, prompt: PROMPT, setupNote: note }));
  assert.ok(text.includes('Get this worktree ready (the setup lines pir runs here: `echo boom; exit 3`), then carry on with the change.'));
  assert.equal(stateIn(s.controlDir).step, 'build');
  run.stop.abort();
  assert.equal(await run.done, 0);
});

test('the session commits while pir tests (the head moves): the green result is not taken and the tests run again', async (t) => {
  const name = 'moved-head';
  const s = setup(
    t,
    (p) => [
      {
        match: BUILDER_MATCH,
        script: [...opening(), commit('a.txt'), report('built', name), until(`[ -f ${q(join(p.controlDir, 'tests-1.log'))} ]`), commit('b.txt'), ...say('Reported, then one more commit.')],
      },
    ],
    { commands: { setup: [], test: ['sleep 1'] } },
  );
  const run = start(s);
  t.after(() => run.stop.abort());
  const moved = controlAfter(s, name);
  await waitFor(() => existsSync(join(moved, 'state.json')) && stateIn(moved).step === 'review', 'the build step done');
  const head = git(s.root, ['rev-parse', `pir/${name}`]).stdout.trim();
  assert.equal(git(s.root, ['log', '-1', '--format=%s', `pir/${name}`]).stdout.trim(), 'add b.txt');
  assert.deepEqual(testLogs(moved), ['tests-1.log', 'tests-2.log']);
  assert.deepEqual(stateIn(moved).tested, { head, ok: true }, 'green is about the commit that is there');
  run.stop.abort();
  assert.equal(await run.done, 0);
});

test('a commit after the green result, never reported: seen at the idle gate, checked again and tested before the step closes', async (t) => {
  const name = 'late-commit';
  const s = setup(t, (p) => [
    {
      match: BUILDER_MATCH,
      script: [
        ...opening(),
        commit('a.txt'),
        report('built', name),
        until(`${q(process.execPath)} -e ${q(TESTED_GREEN_JS)} ${q(join(p.controlDir, 'state.json'))}`),
        commit('b.txt'),
        ...say('One more commit after the tests.'),
      ],
    },
  ]);
  const run = start(s);
  t.after(() => run.stop.abort());
  const moved = controlAfter(s, name);
  await waitFor(() => existsSync(join(moved, 'state.json')) && stateIn(moved).step === 'review', 'the build step done');
  const head = git(s.root, ['rev-parse', `pir/${name}`]).stdout.trim();
  assert.ok(run.lines.some((l) => /the worktree changed after the green run on [0-9a-f]{7}: checking the built report again/.test(l)), run.lines.join('\n'));
  assert.deepEqual(testLogs(moved), ['tests-1.log', 'tests-2.log']);
  assert.deepEqual(stateIn(moved).tested, { head, ok: true });
  run.stop.abort();
  assert.equal(await run.done, 0);
});

test('tests that pass but leave a file git does not ignore: the session is told once, and nothing is rerun', async (t) => {
  const s = setup(t, [{ match: BUILDER_MATCH, script: builder('leaves-files', { after: [...turn(...say('I will look at the leftovers.'))] }) }], {
    commands: { setup: [], test: ['touch coverage.out'] },
  });
  const run = start(s, { env: { PIR_RUN: '1' } });
  t.after(() => run.stop.abort());
  const messages = () => pirTexts(convLog(s.controlDir, 'build')).slice(1);
  await waitFor(() => messages().length >= 1, 'the leftover message');
  await waitFor(() => run.snaps.at(-1)?.runState.steps[0].phase === 'asking', 'the step asking once the session stops');
  const head = git(s.worktree, ['rev-parse', 'HEAD']).stdout.trim();
  assert.deepEqual(messages(), [leftoverMessage({ sha: head, dirty: '?? coverage.out\n' })]);
  assert.deepEqual(testLogs(s.controlDir), ['tests-1.log']);
  const st = stateIn(s.controlDir);
  assert.deepEqual([st.step, st.accepted, st.running, st.rounds.build], ['build', null, null, 0]);
  run.stop.abort();
  assert.equal(await run.done, 0);
});

test('the session exits with no report → exit 1 with no final status (crashed)', async (t) => {
  const s = setup(t, [{ match: BUILDER_MATCH, script: [...opening(), { exit: 1 }] }]);
  const run = start(s, { env: { PIR_RUN: '1' } });
  assert.equal(await run.done, 1);
  assert.equal(readSnapshot(s.controlDir).finalState, null);
  assert.equal(indexOf(s).finalState, null);
  assert.equal(stateIn(s.controlDir).step, 'build');
  assert.deepEqual(workersIn(s.controlDir), []);
});

// ---- Stop and resume. ----

test('SIGTERM during a test run: the command is gone and the run stopped; --resume runs the tests again and goes on to ready', async (t) => {
  const name = 'stopped-testing';
  const s = setup(
    t,
    [
      { match: BUILDER_MATCH, script: builder(name) },
      { match: REVIEWER_MATCH, script: reviewer(name) },
    ],
    // The line passes once the gate file exists; until then it records its pid and hangs.
    { commands: (p) => ({ setup: [], test: [`if [ -f ${q(join(p.dir, 'gate'))} ]; then exit 0; fi; echo $$ > ${q(join(p.dir, 'pid'))}; exec sleep 60`] }) },
  );
  const child = spawnChild(process.execPath, [PROGRAM, '--control', s.controlDir], {
    env: { ...process.env, PATH: `${s.bin}:${process.env.PATH}`, PIR_HOME: s.home, PIR_RUN: '1', PARALLEL_REMOTE: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  const exited = new Promise((r) => child.on('exit', (code) => r(code)));
  t.after(() => child.kill('SIGKILL'));

  const pid = Number(await waitFor(() => existsSync(join(s.dir, 'pid')) && readFileSync(join(s.dir, 'pid'), 'utf8').trim(), `the test line running (${out})`));
  // The record follows the spawn by one `ps` call (the line's start time), so it is waited for.
  await waitFor(() => existsSync(commandFileOf(s.controlDir)), 'command.json');
  assert.equal(JSON.parse(readFileSync(commandFileOf(s.controlDir), 'utf8')).pid, pid, 'the running line is on record');
  await waitFor(() => readSnapshot(s.controlDir)?.runState.steps[0].phase === 'testing', 'the testing snapshot');
  const session = workersIn(s.controlDir)[0].pid;
  child.kill('SIGTERM');
  assert.equal(await exited, 0, out);
  await waitFor(() => gone(pid), 'the test process to go');
  assert.ok(gone(session), 'the builder session is gone');
  assert.deepEqual(workersIn(s.controlDir), []);
  assert.equal(existsSync(commandFileOf(s.controlDir)), false);
  assert.equal(readSnapshot(s.controlDir).finalState, 'stopped');
  assert.equal(indexOf(s).finalState, 'stopped');
  const stopped = stateIn(s.controlDir);
  assert.deepEqual([stopped.step, stopped.running, stopped.outcome], ['build', 'tests', null]);

  // Resume: the tests start again with no session (the accepted report stands), then the run goes on.
  writeFileSync(join(s.dir, 'gate'), '');
  const run = start(s, { resume: true });
  assert.equal(await run.done, 0, run.lines.join('\n'));
  const moved = controlAfter(s, name);
  assert.equal(stateIn(moved).outcome, 'ready');
  assert.deepEqual(testLogs(moved), ['tests-1.log', 'tests-2.log'], 'the interrupted run, then the restarted one');
  assert.equal(argvs(s).length, 2, 'the builder was not reopened: only the reviewer started after the resume');
  assert.deepEqual(stateIn(moved).sessions.build, stopped.sessions.build);
});

test('stop while the builder works, then --resume: the same session is reopened with the resume message', async (t) => {
  const name = 'resumed-builder';
  const s = setup(t, (p) => [
    { match: BUILDER_MATCH, script: [...opening(), ...say('Reading the README.'), until(`[ -f ${q(join(p.dir, 'gate'))} ]`), commit('change.txt'), report('built', name), ...say('Reported.')] },
    { match: REVIEWER_MATCH, script: reviewer(name) },
  ]);
  const first = start(s, { env: { PIR_RUN: '1' } });
  await waitFor(() => convLog(s.controlDir, 'build').some((e) => e.dir === 'in' && e.event.type === 'result'), 'the builder at work');
  await waitFor(() => stateIn(s.controlDir).sessions.build.length === 1, 'the session id in state.json');
  const builderId = stateIn(s.controlDir).sessions.build[0];
  first.stop.abort();
  assert.equal(await first.done, 0);
  assert.equal(indexOf(s).finalState, 'stopped');
  assert.deepEqual(workersIn(s.controlDir), []);

  writeFileSync(join(s.dir, 'gate'), '');
  const run = start(s, { resume: true });
  assert.equal(await run.done, 0, run.lines.join('\n'));
  const moved = controlAfter(s, name);
  const st = stateIn(moved);
  assert.equal(st.outcome, 'ready');
  assert.deepEqual(st.sessions.build, [builderId], 'resumed under the same id');
  assert.equal(existsSync(join(moved, 'conversations', 'build-2.ndjson')), false, 'no second builder log');
  assert.deepEqual(pirTexts(convLog(moved, 'build')), [
    builderInstruction({ reportsDir: join(s.controlDir, 'reports'), base: 'main', baseSha: s.baseSha, prompt: PROMPT }),
    resumeInstruction(),
  ]);
});

test('crash mid-rename with a baseline worktree and its test line left behind, then --resume: both go, the rename completes, a fresh reviewer finishes', async (t) => {
  const name = 'half-renamed';
  const s = setup(t, [{ match: REVIEWER_MATCH, script: reviewer(name) }]);
  // The branch as the builder left it, tested green; the program died after the branch rename only.
  writeFileSync(join(s.worktree, 'change.txt'), 'x\n');
  git(s.worktree, ['add', '-A']);
  git(s.worktree, ['commit', '-q', '-m', 'the change']);
  const head = git(s.worktree, ['rev-parse', 'HEAD']).stdout.trim();
  writeFileSync(
    join(s.controlDir, 'state.json'),
    JSON.stringify({ ...stateIn(s.controlDir), step: 'rename', name, sessions: { build: ['builder-session'], review: [] }, tested: { head, ok: true } }),
  );
  git(s.root, ['branch', '-m', `pir/${ID}`, `pir/${name}`]);
  openBaseline(ID, { root: s.root, from: s.baseSha });
  assert.ok(existsSync(basePath(s)));
  // And its test line is still running, on record in command.json.
  const orphan = spawnChild('/bin/sh', ['-c', 'exec sleep 60'], { detached: true, stdio: 'ignore' });
  t.after(() => orphan.kill('SIGKILL'));
  const orphanGone = new Promise((r) => orphan.on('exit', r));
  writeFileSync(commandFileOf(s.controlDir), JSON.stringify({ kind: 'baseline', pid: orphan.pid, startTime: await waitFor(() => startTimeOf(orphan.pid), 'its start time') }));

  const run = start(s, { resume: true, env: { PIR_RUN: '1' } });
  assert.equal(await run.done, 0, run.lines.join('\n'));
  const moved = controlAfter(s, name);
  assert.equal(existsSync(basePath(s)), false, 'the leftover baseline worktree is removed');
  await orphanGone;
  assert.ok(run.lines.some((l) => l === `killed a leftover command run (pid ${orphan.pid})`), run.lines.join('\n'));
  assert.equal(existsSync(commandFileOf(moved)), false);
  assert.equal(worktreeCount(s), 2);
  assert.ok(existsSync(join(s.root, '.claude', 'worktrees', `pir-${name}`)));
  assert.equal(existsSync(join(s.root, 'plans', ID)), false);
  assert.equal(indexOf(s, name).finalState, 'finished');
  const st = stateIn(moved);
  assert.equal(st.outcome, 'ready');
  assert.deepEqual(st.sessions.build, ['builder-session'], 'the builder was not resumed');
  assert.deepEqual(pirTexts(convLog(moved, 'review')), [reviewerInstruction({ reportsDir: join(moved, 'reports'), name, base: 'main', baseSha: s.baseSha, prompt: PROMPT })]);
  assert.deepEqual(testLogs(moved), [], 'the reviewer changed nothing: the build result stands');
});

test('--resume on a finished run exits 0 doing nothing', async (t) => {
  const s = setup(t, []);
  const done = { ...stateIn(s.controlDir), step: 'build', outcome: 'dropped', accepted: { kind: 'dropped', name: null, body: 'nothing to change' } };
  writeFileSync(join(s.controlDir, 'state.json'), JSON.stringify(done));
  const run = start(s, { resume: true, env: { PIR_RUN: '1' } });
  assert.equal(await run.done, 0);
  assert.deepEqual(stateIn(s.controlDir), done, 'state untouched');
  assert.equal(existsSync(s.received), false, 'no session started');
  assert.equal(indexOf(s).finalState, 'finished', 'the final status pir cleared is put back');
});

test('reapCommand: a recorded command line still running is killed with its group; a reused pid is left alone', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'pir-single-reap-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const child = spawnChild('/bin/sh', ['-c', 'sleep 60 & wait'], { detached: true, stdio: 'ignore' });
  t.after(() => {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      // already gone
    }
  });
  const exited = new Promise((r) => child.on('exit', r));
  const startTime = await waitFor(() => startTimeOf(child.pid), 'the start time');

  writeFileSync(commandFileOf(dir), JSON.stringify({ kind: 'tests', pid: child.pid, startTime: 'Thu Jan  1 00:00:00 1970' }));
  assert.equal(reapCommand(dir), null, 'another process at that number is never signalled');
  assert.equal(gone(child.pid), false);
  assert.equal(existsSync(commandFileOf(dir)), false, 'the stale record is dropped');

  writeFileSync(commandFileOf(dir), JSON.stringify({ kind: 'tests', pid: child.pid, startTime }));
  assert.equal(reapCommand(dir), child.pid);
  await exited;
  assert.equal(existsSync(commandFileOf(dir)), false);
  assert.equal(reapCommand(dir), null, 'no record, nothing to do');
});

// ---- The pure helpers. ----

test('singleChecks: each §2.7 failure is one plain line, several at once, and a clean valid claim passes', () => {
  let dirty = '';
  let count = '1';
  const git = (_cwd, args) => {
    if (args[0] === 'rev-list') return { ok: true, stdout: `${count}\n` };
    if (args[0] === 'status') return { ok: true, stdout: dirty };
    throw new Error(`unexpected git ${args}`);
  };
  let taken = null;
  const seen = [];
  const slugTaken = (name, opts) => {
    seen.push([name, opts.base]);
    return taken;
  };
  const run = { id: ID, name: null, base: 'dev' };
  const base = { run, worktree: '/w', root: '/r', repo: 'r', indexDir: '/i', startSha: 'abc', git, slugTaken };
  const built = (name) => singleChecks({ ...base, kind: 'built', name });
  assert.deepEqual(built('fix-typo'), { ok: true });
  assert.deepEqual(seen, [['fix-typo', 'dev']], 'the name is checked against the run base');
  for (const bad of ['Bad_Name', 'single-00ff', 'plan-00ff']) {
    const r = built(bad);
    assert.equal(r.failures.length, 1);
    assert.match(r.failures[0], /cannot be the branch name: it must be kebab-case .* not of the form single-xxxx or plan-xxxx/);
  }
  for (const [why, text] of [['branch', /a branch pir\/fix-typo already exists/], ['base-plan', /a plan plans\/fix-typo is already on dev/], ['index', /a pir run named fix-typo already exists/]]) {
    taken = why;
    assert.match(built('fix-typo').failures[0], text);
  }
  count = '0';
  dirty = '?? stray.txt\n';
  assert.deepEqual(
    built('fix-typo').failures.map((f) => f.split('.')[0]),
    ['The name "fix-typo" is taken: a pir run named fix-typo already exists', 'nothing is committed on the branch yet', 'The worktree has uncommitted changes (git status --porcelain is not empty)'],
  );

  const reviewed = (name) => singleChecks({ ...base, run: { ...run, name: 'fix-typo' }, kind: 'reviewed', name });
  assert.match(reviewed('fix-typo').failures[0], /uncommitted changes .* drop the `reviewed` report again/);
  dirty = '';
  assert.deepEqual(reviewed('fix-typo'), { ok: true }, 'a reviewer that committed nothing still passes');
  assert.deepEqual(reviewed('other').failures, ['This run is pir/fix-typo, not pir/other. Drop the `reviewed` report with single=fix-typo.']);
});

test('singleChecks against real git: the commit count is taken from the starting commit', (t) => {
  const s = setup(t, []);
  const args = { kind: 'built', name: 'fix-typo', run: { id: ID, name: null, base: 'main' }, worktree: s.worktree, root: s.root, repo: s.repo, indexDir: join(s.home, '.pir', 'runs'), startSha: s.baseSha };
  assert.match(singleChecks(args).failures[0], /^nothing is committed on the branch yet/);
  writeFileSync(join(s.worktree, 'change.txt'), 'x\n');
  assert.equal(singleChecks(args).failures.length, 2);
  git(s.worktree, ['add', '-A']);
  git(s.worktree, ['commit', '-q', '-m', 'change']);
  assert.deepEqual(singleChecks(args), { ok: true });
  assert.match(singleChecks({ ...args, name: ID }).failures[0], /cannot be the branch name/);
});

test('singleRunState: phases per step, testing over the stopped rule, a pending request still asks', () => {
  const st = (over) => ({ ...initialSingleState({ id: ID, base: 'main', baseSha: 'abc', commands: { setup: [], test: ['true'] } }), step: 'build', ...over });
  const sess = (step, activity, live = true) => ({ id: `${step}-1`, step, n: 1, logPath: `/c/${step}-1.ndjson`, cwd: '/w', live, activity });
  const busy = { state: 'busy', background: [] };
  const stopped = { state: 'idle', background: [] };
  const phases = (rs) => rs.steps.map((x) => x.phase);

  let rs = singleRunState(st({ step: 'setup', running: 'setup' }), { label: 'A change' });
  assert.deepEqual([rs.kind, rs.label, rs.name, rs.step, rs.phase, rs.outcome, rs.base], ['single', 'A change', null, 'setup', 'working', null, 'main']);
  assert.deepEqual(phases(rs), ['building', 'pending', 'pending'], 'setup is part of building');
  assert.deepEqual(rs.steps.map((x) => x.id), ['build', 'review', 'merge']);

  rs = singleRunState(st({}), { sessions: [sess('build', busy)], since: { build: 5 } });
  assert.deepEqual(phases(rs), ['building', 'pending', 'pending']);
  assert.equal(rs.steps[0].since, 5);
  assert.deepEqual(rs.steps[0].worker, { id: 'build-1', live: true, logPath: '/c/build-1.ndjson', cwd: '/w' });
  assert.deepEqual(rs.steps[0].workers, [{ id: 'build-1', role: 'builder', n: 1, logPath: '/c/build-1.ndjson', cwd: '/w' }]);

  // A stopped session with no report in hand asks the person.
  rs = singleRunState(st({ rounds: { build: 4, review: 0 } }), { sessions: [sess('build', stopped)], stoppedAt: { build: 9 } });
  assert.deepEqual([rs.steps[0].phase, rs.steps[0].asking, rs.steps[0].stoppedAt, rs.steps[0].round], ['asking', 'question', 9, 4]);
  assert.deepEqual(rs.rounds, { build: 4, review: 0 });

  // Waiting on pir: a report whose checks are pending, an accepted one, a test run, the baseline.
  assert.equal(singleRunState(st({ pending: { kind: 'built', name: 'x' } }), { sessions: [sess('build', stopped)] }).steps[0].phase, 'building');
  assert.equal(singleRunState(st({ accepted: { kind: 'built', name: 'x', head: 'h' } }), { sessions: [sess('build', stopped)] }).steps[0].phase, 'building');
  rs = singleRunState(st({ running: 'tests', accepted: { kind: 'built', name: 'x', head: 'h' } }), { sessions: [sess('build', stopped)], running: { kind: 'tests', since: 77 } });
  assert.deepEqual([rs.phase, rs.steps[0].phase, rs.steps[0].asking, rs.steps[0].testingSince], ['testing', 'testing', null, 77]);
  rs = singleRunState(st({ running: 'baseline' }), { sessions: [sess('build', stopped)] });
  assert.deepEqual([rs.phase, rs.steps[0].phase, rs.steps[0].asking], ['testing', 'testing', null], 'no report in hand, but pir is testing');
  for (const kind of ['permission', 'questions']) {
    rs = singleRunState(st({ running: 'tests' }), { sessions: [sess('build', { state: kind, background: [] })] });
    assert.deepEqual([rs.steps[0].phase, rs.steps[0].asking], ['asking', kind], 'a request is the person\'s even during a test run');
  }

  // Rename and review.
  assert.deepEqual(phases(singleRunState(st({ step: 'rename', name: 'n' }))), ['done', 'pending', 'pending']);
  rs = singleRunState(st({ step: 'review', name: 'n' }), { sessions: [sess('build', { state: 'exited' }, false), sess('review', busy)], took: { build: 1200 } });
  assert.deepEqual(phases(rs), ['done', 'reviewing', 'pending']);
  assert.equal(rs.steps[0].tookMs, 1200);
  assert.equal(rs.steps[1].workers[0].role, 'reviewer');
  assert.equal(singleRunState(st({ step: 'review', name: 'n', running: 'tests' }), { sessions: [sess('review', stopped)] }).steps[1].phase, 'testing');
  assert.equal(singleRunState(st({ step: 'review', name: 'n' }), { sessions: [sess('review', stopped)] }).steps[1].asking, 'question');

  // The outcomes. A finished run keeps the step it ended in.
  assert.deepEqual(phases(singleRunState(st({ step: 'review', name: 'n', outcome: 'ready' }))), ['done', 'done', 'ready']);
  assert.deepEqual(phases(singleRunState(st({ outcome: 'dropped' }))), ['failed', 'pending', 'pending']);
  assert.deepEqual(phases(singleRunState(st({ step: 'review', name: 'n', outcome: 'dropped' }))), ['done', 'failed', 'pending']);
  rs = singleRunState(st({ step: 'review', name: 'n', outcome: 'ready', running: 'tests' }), { sessions: [sess('review', stopped, false)] });
  assert.deepEqual([rs.phase, rs.steps[1].asking], ['working', null], 'a finished run neither tests nor asks');
});

test('formatSingleSetupNote: the failing line, its output, the log, and the setup lines to run', () => {
  assert.equal(
    formatSingleSetupNote({ reason: '`npm ci` exited 1', tail: '$ npm ci\nnpm ERR! missing\n', logPath: '/c/setup.log' }, { setup: ['nvm use', 'npm ci'] }),
    'The setup step failed in this worktree before you started: `npm ci` exited 1.\n' +
      'Last lines of its output:\n' +
      '  $ npm ci\n' +
      '  npm ERR! missing\n' +
      'Full output: /c/setup.log\n' +
      'Get this worktree ready (the setup lines pir runs here: `nvm use`, `npm ci`), then carry on with the change.',
  );
  const bare = formatSingleSetupNote({ reason: '`npm ci` could not run (ENOENT)', tail: '', logPath: '/c/setup.log' }, { setup: ['npm ci'] });
  assert.equal(bare.split('\n').length, 3, 'an empty tail drops its heading');
  assert.doesNotMatch(bare, /DESIGN\.md|plan/);
});

test('nextTestsLogPath counts from the folder; rootOf; parseArgs; findControlDir follows a moved folder', (t) => {
  const readdir = () => ['tests-1.log', 'tests-3.log', 'setup.log', 'baseline.log', 'tests-x.log'];
  assert.equal(nextTestsLogPath('/c', { readdir }), '/c/tests-4.log');
  assert.equal(nextTestsLogPath('/c', { readdir: () => { throw new Error('none'); } }), '/c/tests-1.log');
  assert.equal(rootOf('/r/repo/plans/single-ab12/.parallel/single'), '/r/repo');
  assert.deepEqual(parseArgs(['--control', '/x', '--resume']), { controlDir: '/x', resume: true });
  assert.match(parseArgs([]).error, /--control/);
  assert.match(parseArgs(['--control', '/x', '--bogus']).error, /--bogus/);

  const dir = mkdtempSync(join(tmpdir(), 'pir-single-find-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const moved = join(dir, 'repo', 'plans', 'the-name', '.parallel', 'single');
  mkdirSync(moved, { recursive: true });
  writeFileSync(join(moved, 'state.json'), JSON.stringify({ id: ID }));
  // A planning run's folder beside it is not mistaken for the run.
  mkdirSync(join(dir, 'repo', 'plans', 'a-plan', '.parallel', 'plan'), { recursive: true });
  writeFileSync(join(dir, 'repo', 'plans', 'a-plan', '.parallel', 'plan', 'state.json'), JSON.stringify({ id: ID }));
  const old = join(dir, 'repo', 'plans', ID, '.parallel', 'single');
  assert.equal(findControlDir(old), moved);
  assert.equal(findControlDir(moved), moved);
  const other = join(dir, 'repo', 'plans', 'single-ffff', '.parallel', 'single');
  assert.equal(findControlDir(other), other);
});
