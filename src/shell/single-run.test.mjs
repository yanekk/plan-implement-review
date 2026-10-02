// single-runs T04 — the single program (setup, builder, tests, red rounds, baseline, rename, reviewer,
// stop and resume), run against the fake Claude in scratch repos with real git and real `sh` test lines.
// No real `claude` is ever started: every session is the shim.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn as spawnChild } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resumeInstruction } from '../core/planflow.mjs';
import { parseRecord } from '../core/runrecord.mjs';
import { builderInstruction, initialSingleState, leftoverMessage, reviewerInstruction } from '../core/singleflow.mjs';
import { writeClaudeShim } from './fake/claude-shim.mjs';
import {
  FINISHER_GO_QUESTION,
  SINGLE_FINISHER_MATCH,
  SINGLE_FIX_MATCH,
  SINGLE_RESOLVE_MATCH,
  singleFinisherScript,
  singleFixScript,
  singleResolveScript,
} from './fake/sessions.mjs';
import { initEvent, assistantText, resultEvent } from './fake/claude-stream.mjs';
import { startTimeOf } from './identity.mjs';
import { recordPath, writeRecord } from './index-store.mjs';
import { notifyPaths, writeNotifyConfig } from './notify-config.mjs';
import { dropPersonInput } from './person-inbox.mjs';
import { readSnapshot } from './snapshot-store.mjs';
import { git, openBaseline, openPlanBranch, syncBase as syncBaseReal, syncPending as syncPendingReal } from './worktree.mjs';
import { canResume } from '../core/dashboard.mjs';
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
  singleNotifyViews,
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

// The run's state.json, wherever the rename has put the control folder.
function liveState(s) {
  const dirs = [s.controlDir];
  try {
    for (const n of readdirSync(join(s.root, 'plans'))) dirs.push(join(s.root, 'plans', n, '.parallel', 'single'));
  } catch {
    // no plans folder yet
  }
  for (const d of dirs) {
    try {
      return { dir: d, state: JSON.parse(readFileSync(join(d, 'state.json'), 'utf8')) };
    } catch {
      // not here
    }
  }
  return null;
}

// The fake finisher of a single run named `name` (fake/sessions.mjs): ready, the Go question, the merge.
const finisherEntry = (x, name) => ({
  match: SINGLE_FINISHER_MATCH,
  script: singleFinisherScript({ name, statusDir: join(controlAfter(x, name), 'finisher', 'status'), repoRoot: x.root }),
});
const finisherId = (s, name) => JSON.parse(readFileSync(join(controlAfter(s, name), 'finisher', 'session.json'), 'utf8')).sessionId;
// goAsked(s, name, run, { n }) → the go question's request once the finisher's conversation n has it open.
async function goAsked(s, name, run, { n = 1, after = 0 } = {}) {
  return waitFor(
    () => convLog(controlAfter(s, name), 'finisher', n).filter((e) => e.dir === 'request' && e.toolName === 'AskUserQuestion').at(after) ?? null,
    `the finisher's go question\n${run?.lines.join('\n')}`,
  );
}
// The person answers the go question in the finisher's conversation, as the conversation view drops it.
function sayGo(s, name, ask, answer = 'Go') {
  const r = dropPersonInput(controlAfter(s, name), { to: finisherId(s, name), kind: 'answers', requestId: ask.requestId, answers: { [FINISHER_GO_QUESTION]: answer } }, { coordinatorAlive: true });
  assert.deepEqual(r, { ok: true });
}

// Once the run waits (single-finisher DESIGN §2.4), the person merges by hand in the main checkout, which
// ends it `merged` (§2.5 step 5). The tests written before the ending existed end their runs this way.
function mergeWhenWaiting(s) {
  let merged = false;
  const timer = setInterval(() => {
    const live = liveState(s);
    if (merged || !live || live.state.step !== 'wait' || live.state.outcome !== null) return;
    merged = true;
    git(s.root, ['-c', 'user.name=T04', '-c', 'user.email=t04@test.local', 'merge', '-q', '--no-edit', `pir/${live.state.name}`]);
  }, 50);
  return () => clearInterval(timer);
}

// runSingle in this process, with a stop lever, the program's log and its snapshots kept. `handMerge`
// (default on) merges the branch by hand once the run waits on the finisher.
function start(s, { env = {}, deps = {}, resume = false, controlDir = s.controlDir, handMerge = true } = {}) {
  const stop = new AbortController();
  const lines = [];
  const snaps = [];
  let code;
  const unmerge = handMerge ? mergeWhenWaiting(s) : () => {};
  const done = runSingle({
    controlDir,
    resume,
    deps: {
      env: { PIR_HOME: s.home, PARALLEL_REMOTE: '0', ...env },
      // The finisher's rules are looked up under this home, never the person's (DESIGN §5.2).
      home: s.home,
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
  }).then((c) => {
    unmerge();
    return (code = c);
  });
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

test('happy path: setup, builder, checks, tests green, rename, a fresh reviewer, tests green, base unmoved, the finisher, Go, merged, finished; testing is never asking', async (t) => {
  const name = 'fix-typo';
  const s = setup(
    t,
    (x) => [
      { match: BUILDER_MATCH, script: builder(name) },
      { match: REVIEWER_MATCH, script: reviewer(name, { steps: [commit('review.txt', 'review: a fix')] }) },
      finisherEntry(x, name),
    ],
    { commands: { setup: ['echo setup-ran'], test: ['sleep 0.4', 'test -f change.txt'] } },
  );
  const mainBefore = git(s.root, ['rev-parse', 'main']).stdout.trim();
  const run = start(s, { env: { PIR_RUN: '1' }, handMerge: false });
  // Nothing changes in the main checkout before the go (single-finisher §1).
  const ask = await goAsked(s, name, run);
  assert.equal(git(s.root, ['rev-parse', 'main']).stdout.trim(), mainBefore, 'main untouched before the go');
  assert.equal(stateIn(controlAfter(s, name)).step, 'wait');
  sayGo(s, name, ask);
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
  assert.equal(av.length, 3, 'three sessions: builder, reviewer, finisher');
  assert.ok(av[0].includes(`${s.repo} / ${ID} / single / builder`), av[0].join(' '));
  assert.ok(av[1].includes(`${s.repo} / ${name} / single / reviewer`), av[1].join(' '));
  assert.ok(av[2].includes(`${s.repo} / ${name} / single / finisher`), av[2].join(' '));
  assert.ok(av[1].some((a) => a.startsWith('--session-id')), 'the reviewer is a fresh session');
  const buildLog = convLog(moved, 'build');
  const lastResult = buildLog.findLastIndex((e) => e.dir === 'in' && e.event.type === 'result');
  assert.ok(buildLog.findIndex((e) => e.dir === 'note' && e.kind === 'exited') > lastResult, 'the builder was closed only after its turn ended');

  // The end: finished by the finisher's merge, on the renamed branch, nothing left running.
  const st = stateIn(moved);
  assert.deepEqual([st.step, st.outcome, st.name, st.running], ['wait', 'finished', name, null]);
  assert.deepEqual([st.end.sync.state, st.end.tests, st.end.finisher], ['up-to-date', 'green', 'on']);
  assert.deepEqual(st.renamed, { branch: true, worktree: true, control: true, index: true });
  assert.deepEqual([st.sessions.build.length, st.sessions.review.length], [1, 1]);
  assert.deepEqual(st.rounds, { build: 0, review: 0 });
  assert.equal(git(s.root, ['log', '-1', '--format=%s', `pir/${name}`]).stdout.trim(), 'review: a fix');
  assert.ok(git(s.root, ['merge-base', '--is-ancestor', `pir/${name}`, 'main']).ok, 'the finisher merged the branch into main');
  assert.deepEqual(testLogs(moved).filter((n) => n.startsWith('sync-')), [], 'an up-to-date sync runs no tests');
  assert.ok(run.lines.some((l) => /finisher closed/.test(l)), run.lines.join('\n'));
  assert.deepEqual(workersIn(moved), []);
  assert.equal(existsSync(commandFileOf(moved)), false);
  assert.equal(worktreeCount(s), 2, 'the main checkout and the run, no baseline');

  // The snapshots (§3.5, §2.9): while pir's tests run the step reads testing, and no step ever asked.
  const snap = readSnapshot(moved);
  assert.equal(snap.finalState, 'finished');
  assert.deepEqual([snap.proc.slug, snap.proc.branch], [name, `pir/${name}`]);
  assert.deepEqual([snap.runState.kind, snap.runState.name, snap.runState.outcome, snap.runState.base, snap.runState.label], ['single', name, 'finished', 'main', null]);
  // The sync and merge rows are T07's; the snapshot carries what they will read.
  assert.deepEqual(snap.runState.steps.map((x) => [x.id, x.phase]), [['build', 'done'], ['review', 'done'], ['merge', 'pending']]);
  assert.equal(snap.runState.end.finisher, 'on');
  assert.ok(run.snaps.some((x) => x.runState.finisher?.state === 'awaiting-go'), 'a snapshot carries the finisher waiting for the go');
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
  assert.equal(st.outcome, 'merged');
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

test('SIGTERM during a test run: the command is gone and the run stopped; --resume runs the tests again and goes on to the hand merge', async (t) => {
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
  assert.equal(stateIn(moved).outcome, 'merged');
  assert.deepEqual(testLogs(moved), ['tests-1.log', 'tests-2.log'], 'the interrupted run, then the restarted one');
  assert.equal(argvs(s).length, 3, 'the builder was not reopened: only the reviewer and the finisher started after the resume');
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
  assert.equal(st.outcome, 'merged');
  assert.deepEqual(st.sessions.build, [builderId], 'resumed under the same id');
  assert.equal(existsSync(join(moved, 'conversations', 'build-2.ndjson')), false, 'no second builder log');
  assert.deepEqual(pirTexts(convLog(moved, 'build')), [
    builderInstruction({ reportsDir: join(s.controlDir, 'reports'), base: 'main', baseSha: s.baseSha, prompt: PROMPT }),
    resumeInstruction(),
  ]);
});

// A command line that hangs, its pid on record, until the gate file exists; `then` is what it does once
// the gate is there.
const gated = (p, then = 'exit 0') => `if [ -f ${q(join(p.dir, 'gate'))} ]; then ${then}; fi; echo $$ > ${q(join(p.dir, 'pid'))}; exec sleep 60`;
const pidIn = (s) => waitFor(() => existsSync(join(s.dir, 'pid')) && Number(readFileSync(join(s.dir, 'pid'), 'utf8').trim()), 'the command line running');

test('stop during the setup run: its process is gone, no session was started; --resume runs the setup again and goes on to the hand merge', async (t) => {
  const name = 'stopped-setup';
  const s = setup(
    t,
    [
      { match: BUILDER_MATCH, script: builder(name) },
      { match: REVIEWER_MATCH, script: reviewer(name) },
    ],
    { commands: (p) => ({ setup: [gated(p)], test: ['true'] }) },
  );
  const first = start(s);
  const pid = await pidIn(s);
  first.stop.abort();
  assert.equal(await first.done, 0);
  await waitFor(() => gone(pid), 'the setup process to go');
  assert.equal(existsSync(commandFileOf(s.controlDir)), false);
  assert.deepEqual([stateIn(s.controlDir).step, stateIn(s.controlDir).running], ['setup', 'setup']);
  assert.equal(existsSync(s.received), false, 'no session before the setup is done');

  writeFileSync(join(s.dir, 'gate'), '');
  const run = start(s, { resume: true });
  assert.equal(await run.done, 0, run.lines.join('\n'));
  const moved = controlAfter(s, name);
  assert.equal(stateIn(moved).outcome, 'merged');
  assert.equal(run.lines.filter((l) => l === 'setup run started').length, 1);
  assert.doesNotMatch(pirTexts(convLog(moved, 'build'))[0], /setup step failed/, 'the killed setup run left no note');
});

test('stop during the baseline run: its process and its worktree are gone; --resume runs it again and the red message reaches the reopened builder', async (t) => {
  const name = 'stopped-baseline';
  // Red in the run's worktree (the change is there); on the starting point it hangs until the gate.
  const s = setup(t, [{ match: BUILDER_MATCH, script: builder(name, { after: [...turn(...say('Looking into it.'))] }) }], {
    commands: (p) => ({ setup: [], test: [`if [ -f change.txt ]; then exit 1; fi; ${gated(p, 'exit 1')}`] }),
  });
  const first = start(s);
  const pid = await pidIn(s);
  assert.ok(existsSync(basePath(s)), 'the baseline runs in its own worktree');
  first.stop.abort();
  assert.equal(await first.done, 0);
  await waitFor(() => gone(pid), 'the baseline process to go');
  assert.equal(existsSync(basePath(s)), false, 'the baseline worktree is gone');
  assert.equal(worktreeCount(s), 2);
  assert.equal(existsSync(commandFileOf(s.controlDir)), false);
  assert.deepEqual(workersIn(s.controlDir), []);
  const stopped = stateIn(s.controlDir);
  assert.deepEqual([stopped.step, stopped.running, stopped.baseline, stopped.rounds.build], ['build', 'baseline', null, 1]);

  writeFileSync(join(s.dir, 'gate'), '');
  const run = start(s, { resume: true, env: { PIR_RUN: '1' } });
  t.after(() => run.stop.abort());
  const texts = await waitFor(() => (pirTexts(convLog(s.controlDir, 'build')).length === 3 ? pirTexts(convLog(s.controlDir, 'build')) : null), 'the red message');
  assert.equal(texts[1], resumeInstruction());
  assert.match(texts[2], /Round 1 of 3\.\nThey also fail on the untouched starting point/);
  assert.equal(existsSync(basePath(s)), false);
  assert.equal(worktreeCount(s), 2);
  const st = stateIn(s.controlDir);
  assert.deepEqual([st.running, st.baseline.half, st.rounds.build, st.sessions.build.length], [null, 'test', 1, 1]);
  assert.equal(existsSync(join(s.controlDir, 'conversations', 'build-2.ndjson')), false, 'the same builder, reopened');
  run.stop.abort();
  assert.equal(await run.done, 0);
});

test('stop while the reviewer works, then --resume from the renamed folder: the same reviewer is reopened and the run ends merged by hand', async (t) => {
  const name = 'resumed-reviewer';
  const s = setup(t, (p) => [
    { match: BUILDER_MATCH, script: builder(name) },
    { match: REVIEWER_MATCH, script: [...opening(), ...say('Reading the change.'), until(`[ -f ${q(join(p.dir, 'gate'))} ]`), report('reviewed', name), ...say('Reported reviewed.')] },
  ]);
  const moved = controlAfter(s, name);
  const first = start(s, { env: { PIR_RUN: '1' } });
  await waitFor(() => convLog(moved, 'review').some((e) => e.dir === 'in' && e.event.type === 'result'), 'the reviewer at work');
  await waitFor(() => stateIn(moved).sessions.review.length === 1, 'the reviewer id in state.json');
  const reviewerId = stateIn(moved).sessions.review[0];
  first.stop.abort();
  assert.equal(await first.done, 0);
  assert.equal(indexOf(s, name).finalState, 'stopped');
  assert.deepEqual(workersIn(moved), []);

  writeFileSync(join(s.dir, 'gate'), '');
  const run = start(s, { resume: true, controlDir: moved, env: { PIR_RUN: '1' } });
  assert.equal(await run.done, 0, run.lines.join('\n'));
  const st = stateIn(moved);
  assert.deepEqual([st.outcome, st.sessions.review], ['merged', [reviewerId]]);
  assert.equal(argvs(s).length, 4, 'builder, reviewer, the reviewer reopened, the finisher: the builder is never resumed');
  assert.equal(existsSync(join(moved, 'conversations', 'review-2.ndjson')), false);
  assert.deepEqual(pirTexts(convLog(moved, 'review')), [
    reviewerInstruction({ reportsDir: join(moved, 'reports'), name, base: 'main', baseSha: s.baseSha, prompt: PROMPT }),
    resumeInstruction(),
  ]);
  assert.equal(indexOf(s, name).finalState, 'finished');
  assert.deepEqual(testLogs(moved), ['tests-1.log'], 'the reviewer changed nothing');
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
  assert.equal(st.outcome, 'merged');
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

  // A removed run leaves its control folder behind (removeRun keeps state.json), and once its branch is
  // deleted nothing else holds the name. The rename would then split this run's folder in two.
  mkdirSync(join(s.root, 'plans', 'fix-typo', '.parallel', 'single'), { recursive: true });
  assert.deepEqual(singleChecks(args).failures, [
    'The name "fix-typo" is taken: a folder plans/fix-typo/.parallel/single is left from an earlier run. Choose another name, then drop the `built` report again.',
  ]);
  assert.deepEqual(singleChecks({ ...args, name: 'fix-readme-typo' }), { ok: true });
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

// ---- Phone alerts (T06, DESIGN §2.10). No test here reaches the network: publish and clear are fakes. ----

const TOPIC = 'pir-secrettopicabcdefghijklmn';
const NTFY = { server: 'https://ntfy.sh', topic: TOPIC };
const ICON = 'https://example.test/icon.png';

function fakeNtfy() {
  const pubs = [];
  const clears = [];
  return {
    pubs,
    clears,
    deps: {
      ntfyPublish: async (fields) => {
        pubs.push(fields);
        return { ok: true, status: 200 };
      },
      ntfyClear: async (fields) => {
        clears.push(fields);
        return { ok: true, status: 200 };
      },
    },
  };
}

// A builder that writes down the presence variable it was started with, asks the person in plain text,
// and builds once it is answered.
const askingBuilder = (p, name) => [
  ...opening(),
  { sh: `printf %s "$CLAUDE_CLIENT_PRESENCE_FILE" > ${q(join(p.dir, 'presence-seen'))}` },
  ...say('Which file has the typo?'),
  ...turn(commit('change.txt'), report('built', name), ...say('Reported built.')),
];

test('alerts: an asking builder sends one alert, one reminder after 15 minutes, the answer clears it, and the hand-over sends no end alert', async (t) => {
  const name = 'fix-typo';
  const s = setup(t, (p) => [
    { match: BUILDER_MATCH, script: askingBuilder(p, name) },
    { match: REVIEWER_MATCH, script: reviewer(name) },
  ]);
  const env = { PIR_HOME: s.home, PIR_RUN: '1', PIR_NOTIFY_ICON: ICON };
  writeNotifyConfig(NTFY, env);
  const ntfy = fakeNtfy();
  let skew = 0;
  const run = start(s, { env, deps: { ...ntfy.deps, now: () => Date.now() + skew } });
  t.after(() => run.stop.abort());

  await waitFor(() => ntfy.pubs.length === 1, 'the asking alert');
  const sessionId = stateIn(s.controlDir).sessions.build[0];
  const seq = `pir-${sessionId}-1`;
  // Remote Control is off here (PARALLEL_REMOTE=0), so there is no link to wait for or to tap.
  assert.deepEqual(ntfy.pubs[0], { ...NTFY, title: 'Fix the typo in the READ · builder', message: 'asks: Which file has the typo?', click: null, seq, icon: ICON });
  assert.equal(run.snaps.at(-1).runState.steps[0].asking, 'question', 'the row says the same');

  // Two more turns of the loop send nothing; fifteen minutes on, exactly one reminder.
  await new Promise((r) => setTimeout(r, 1200));
  assert.equal(ntfy.pubs.length, 1);
  skew = 900_000;
  await waitFor(() => ntfy.pubs.length === 2, 'the reminder');
  assert.deepEqual(ntfy.pubs[1], { ...ntfy.pubs[0], message: 'Still waiting: asks: Which file has the typo?' });
  skew = 2 * 900_000;
  await new Promise((r) => setTimeout(r, 1200));
  assert.equal(ntfy.pubs.length, 2, 'one reminder per episode');
  assert.deepEqual(ntfy.clears, []);

  // The answer ends the episode: the phone is told to clear it, and the run goes on to the finisher.
  assert.deepEqual(dropPersonInput(s.controlDir, { to: sessionId, kind: 'message', text: 'README.md' }, { coordinatorAlive: true }), { ok: true });
  await waitFor(() => ntfy.clears.length === 1, 'the clear');
  assert.deepEqual(ntfy.clears[0], { ...NTFY, seq });
  assert.equal(await run.done, 0, run.lines.join('\n'));
  // `ready to merge` is no longer sent when the finisher takes over (single-finisher DESIGN §2.12); the
  // ending's own alerts are T06's.
  assert.equal(ntfy.pubs.length, 2, 'the reviewer never asked, and no end alert followed');
  assert.equal(ntfy.clears.length, 1, 'nothing left to clear at the exit');

  // The session was started with the Claude app's own push silenced, the marker made to exist.
  const { presence } = notifyPaths(env);
  assert.equal(readFileSync(join(s.dir, 'presence-seen'), 'utf8'), presence);
  assert.ok(existsSync(presence));

  // Each send is noted in the session's conversation and logged without the topic.
  const moved = controlAfter(s, name);
  assert.deepEqual(convLog(moved, 'build').filter((e) => e.dir === 'note' && e.kind === 'notified').map((e) => e.reminder), [false, true]);
  assert.ok(run.lines.includes(`notify send ${sessionId} ${seq} ok 200`), run.lines.join('\n'));
  assert.ok(run.lines.includes(`notify clear ${sessionId} ${seq} ok 200`));
  assert.ok(!run.lines.includes('notify send end - ok 200'));
  assert.ok(!run.lines.some((l) => l.includes(TOPIC)), 'the topic is never logged');

  // A resume of the finished run sends nothing more.
  const again = start(s, { env, resume: true, controlDir: moved, deps: ntfy.deps });
  assert.equal(await again.done, 0);
  assert.equal(ntfy.pubs.length, 2);
});

test('alerts: a stop while a session asks clears its alert; a dropped run sends nothing', async (t) => {
  const s = setup(t, (p) => [{ match: BUILDER_MATCH, script: askingBuilder(p, 'never-built') }]);
  const env = { PIR_HOME: s.home };
  writeNotifyConfig(NTFY, env);
  const ntfy = fakeNtfy();
  const run = start(s, { env, deps: ntfy.deps });
  t.after(() => run.stop.abort());
  await waitFor(() => ntfy.pubs.length === 1, 'the asking alert');
  assert.equal(ntfy.pubs[0].title, `${ID} · builder`, 'with no label on record the run id names the run');
  run.stop.abort();
  assert.equal(await run.done, 0);
  assert.deepEqual(ntfy.clears, [{ ...NTFY, seq: ntfy.pubs[0].seq }]);
  assert.equal(ntfy.pubs.length, 1);

  const d = setup(t, [{ match: BUILDER_MATCH, script: [...opening(), report('dropped', '-', 'Too big for a single run.'), ...say('Dropped, as agreed.')] }]);
  const denv = { PIR_HOME: d.home };
  writeNotifyConfig(NTFY, denv);
  const none = fakeNtfy();
  const dropped = start(d, { env: denv, deps: none.deps });
  assert.equal(await dropped.done, 0, dropped.lines.join('\n'));
  assert.equal(stateIn(d.controlDir).outcome, 'dropped');
  assert.deepEqual([none.pubs, none.clears], [[], []]);
});

test('alerts: with no notify.json nothing is sent, asking or ready, and the session environment is left alone', async (t) => {
  const name = 'quiet';
  const s = setup(t, (p) => [
    { match: BUILDER_MATCH, script: askingBuilder(p, name) },
    { match: REVIEWER_MATCH, script: reviewer(name) },
  ]);
  const ntfy = fakeNtfy();
  const run = start(s, { env: { PIR_RUN: '1' }, deps: ntfy.deps });
  t.after(() => run.stop.abort());
  await waitFor(() => run.snaps.at(-1)?.runState.steps[0].phase === 'asking', 'the build step asking');
  const sessionId = stateIn(s.controlDir).sessions.build[0];
  assert.deepEqual(dropPersonInput(s.controlDir, { to: sessionId, kind: 'message', text: 'README.md' }, { coordinatorAlive: true }), { ok: true });
  assert.equal(await run.done, 0, run.lines.join('\n'));
  assert.equal(stateIn(controlAfter(s, name)).outcome, 'merged');
  assert.deepEqual([ntfy.pubs, ntfy.clears], [[], []]);
  // The session inherits whatever this process has (a pir worker running the suite has the variable set).
  assert.equal(readFileSync(join(s.dir, 'presence-seen'), 'utf8'), process.env.CLAUDE_CLIENT_PRESENCE_FILE ?? '');
  assert.equal(existsSync(notifyPaths({ PIR_HOME: s.home }).presence), false);
  assert.ok(!run.lines.some((l) => l.startsWith('notify ')), 'nothing logged either');
});

test('singleNotifyViews: one view per asking live session, worded by alertText; none while pir tests or once the run is finished', () => {
  const st = (over) => ({ ...initialSingleState({ id: ID, base: 'main', baseSha: 'abc', commands: { setup: [], test: ['true'] } }), step: 'build', ...over });
  const stopped = { state: 'idle', background: [], pending: [] };
  const sess = (step, activity, live = true) => ({ id: `${step}-1`, step, n: 1, logPath: null, cwd: '/w', live, activity });
  const views = (state, session, extra = {}, opts = {}) =>
    singleNotifyViews(singleRunState(state, { label: 'A change', sessions: [session] }), [{ id: session.id, activity: session.activity, lastText: 'Which file?', url: null, remoteRefused: false, ...extra }], { id: ID, ...opts });

  // A plain-text question, before the run has a name: the label names it; the link is waited for.
  assert.deepEqual(views(st({}), sess('build', stopped)), [
    { id: 'build-1', waiting: 'question', title: 'A change · builder', message: 'asks: Which file?', remote: 'wanted', url: null },
  ]);
  // A permission request from the reviewer, by the run's name, with its link.
  const pending = [{ kind: 'permission', requestId: 'r1', toolName: 'Bash', input: { command: 'npm ci' } }];
  assert.deepEqual(views(st({ step: 'review', name: 'fix-typo' }), sess('review', { state: 'permission', background: [], pending }), { url: 'https://claude.ai/code/x' }), [
    { id: 'review-1', waiting: 'permission', title: 'fix-typo · reviewer', message: 'wants to run Bash npm ci', remote: 'wanted', url: 'https://claude.ai/code/x' },
  ]);
  const questions = [{ kind: 'questions', requestId: 'q1', questions: [{ question: 'Tabs or spaces?' }, { question: 'Which port?' }] }];
  const [v] = views(st({}), sess('build', { state: 'questions', background: [], pending: questions }), { remoteRefused: true });
  assert.deepEqual([v.waiting, v.message, v.remote], ['questions', 'asks: Tabs or spaces? (+1 more)', 'refused']);
  assert.equal(views(st({}), sess('build', stopped), {}, { remoteOn: false })[0].remote, 'off');
  // With neither a name nor a label, the run id.
  assert.equal(singleNotifyViews(singleRunState(st({}), { sessions: [sess('build', stopped)] }), [{ id: 'build-1', activity: stopped, lastText: null }], { id: ID })[0].title, `${ID} · builder`);

  // Waiting on pir, not the person (§2.9): no view, so no alert and an open episode ends.
  assert.deepEqual(views(st({ running: 'tests', accepted: { kind: 'built', name: 'x', head: 'h' } }), sess('build', stopped)), []);
  assert.deepEqual(views(st({ accepted: { kind: 'built', name: 'x', head: 'h' } }), sess('build', stopped)), []);
  assert.deepEqual(views(st({}), sess('build', { state: 'busy', background: [], pending: [] })), []);
  assert.deepEqual(views(st({ step: 'review', name: 'n', outcome: 'ready' }), sess('review', stopped)), []);
  assert.deepEqual(views(st({}), sess('build', stopped, false)), [], 'an exited session asks nothing');
});

test('alerts: red rounds send nothing until the builder stops on the person past the limit; a reviewer asking is titled by the run name', async (t) => {
  const again = turn(report('built', 'never-green'), ...say('Reported again.'));
  const s = setup(
    t,
    [{ match: BUILDER_MATCH, script: builder('never-green', { after: [...again, ...again, ...again, ...turn(...say('It still fails. How should I go on?'))] }) }],
    { commands: { setup: [], test: ['test -f never.txt'] } },
  );
  const env = { PIR_HOME: s.home, PIR_RUN: '1' };
  writeNotifyConfig(NTFY, env);
  const ntfy = fakeNtfy();
  const run = start(s, { env, deps: ntfy.deps });
  t.after(() => run.stop.abort());
  // Remote Control is off, so a session read as asking for even one turn between rounds would alert at once.
  await waitFor(() => ntfy.pubs.length > 0 && run.snaps.at(-1)?.runState.steps[0].round === 4, 'the alert at round 4');
  await new Promise((r) => setTimeout(r, 1200));
  assert.deepEqual(ntfy.pubs.map((p) => [p.title, p.message]), [['Fix the typo in the READ · builder', 'asks: It still fails. How should I go on?']]);
  assert.deepEqual(ntfy.clears, []);

  // After the rename the reviewer's alert carries the name, and its note lands in the moved folder.
  const name = 'fix-typo';
  const r = setup(t, [
    { match: BUILDER_MATCH, script: builder(name) },
    { match: REVIEWER_MATCH, script: [...opening(), ...say('Is the second typo in scope?'), ...turn(report('reviewed', name), ...say('Reported reviewed.'))] },
  ]);
  const renv = { PIR_HOME: r.home, PIR_RUN: '1' };
  writeNotifyConfig(NTFY, renv);
  const rn = fakeNtfy();
  const rrun = start(r, { env: renv, deps: rn.deps });
  t.after(() => rrun.stop.abort());
  await waitFor(() => rn.pubs.length === 1, 'the reviewer asking alert');
  const moved = controlAfter(r, name);
  const reviewerId = stateIn(moved).sessions.review[0];
  assert.deepEqual([rn.pubs[0].title, rn.pubs[0].message, rn.pubs[0].seq], ['fix-typo · reviewer', 'asks: Is the second typo in scope?', `pir-${reviewerId}-1`]);
  assert.deepEqual(dropPersonInput(moved, { to: reviewerId, kind: 'message', text: 'No.' }, { coordinatorAlive: true }), { ok: true });
  assert.equal(await rrun.done, 0, rrun.lines.join('\n'));
  assert.deepEqual(rn.clears.map((c) => c.seq), [`pir-${reviewerId}-1`]);
  assert.deepEqual(rn.pubs.slice(1).map((p) => p.title), [], 'no end alert when the finisher takes over (T06 owns the ending alerts)');
  assert.deepEqual(convLog(moved, 'review').filter((e) => e.dir === 'note' && e.kind === 'notified').length, 1);
});

test('alerts: a session that exits while it asks has its alert cleared on the crashed exit', async (t) => {
  const s = setup(t, [{ match: BUILDER_MATCH, script: [...opening(), ...say('Which file?'), { sh: 'sleep 1.5' }, { exit: 1 }] }]);
  const env = { PIR_HOME: s.home };
  writeNotifyConfig(NTFY, env);
  const ntfy = fakeNtfy();
  const run = start(s, { env, deps: ntfy.deps });
  assert.equal(await run.done, 1, run.lines.join('\n'));
  assert.equal(ntfy.pubs.length, 1);
  assert.deepEqual(ntfy.clears, [{ ...NTFY, seq: ntfy.pubs[0].seq }]);
});

// ---- The person's `!` in a single run (bang-commands T03, DESIGN §2.2–§2.5). ----

test('builder: a `!` drop runs in the run worktree and its result reaches the builder; a stop kills a running one as session-closed', async (t) => {
  const idle = [{ await: 'user' }, { emit: initEvent() }, { emit: assistantText('Waiting.') }, { emit: resultEvent('success', 'Waiting.') }, { chat: { workMs: 10 } }];
  const s = setup(t, [{ match: BUILDER_MATCH, script: idle }]);
  const run = start(s);
  t.after(() => run.stop.abort());
  const log = () => convLog(s.controlDir, 'build');
  await waitFor(() => log().some((e) => e.dir === 'in' && e.event.type === 'result'), 'the builder to go idle');
  const sessionId = workersIn(s.controlDir)[0].id;
  const drop = (input) => assert.deepEqual(dropPersonInput(s.controlDir, { to: sessionId, ...input }, { coordinatorAlive: true }), { ok: true });

  drop({ kind: 'shell', command: 'printf hi' });
  const end = await waitFor(() => log().find((e) => e.dir === 'shell' && e.kind === 'end'), 'the command to end');
  assert.equal(realpathSync(log().find((e) => e.dir === 'shell' && e.kind === 'start').cwd), realpathSync(s.worktree));
  assert.deepEqual([end.code, end.sent], [0, 'message']);
  assert.match(log().find((e) => e.dir === 'out' && e.shell === end.id).text, /\nexit 0 · \d+s\nhi$/);

  drop({ kind: 'shell', command: 'sleep 30' });
  const record = join(s.controlDir, 'shells', `${sessionId}.json`);
  await waitFor(() => existsSync(record), 'the running record');
  const { pid } = JSON.parse(readFileSync(record, 'utf8'));
  run.stop.abort();
  await run.done;
  const ends = log().filter((e) => e.dir === 'shell' && e.kind === 'end');
  assert.deepEqual([ends.length, ends[1].stopped, ends[1].sent], [2, 'session-closed', 'none']);
  assert.equal(existsSync(record), false);
  await waitFor(() => gone(pid), 'the sleep to die');
});

// ---- The end sequence: sync, helpers, finisher, wait (single-finisher T05, DESIGN §2.2–§2.10). ----

// A commit on main in the main checkout: the base moving while the run works.
function commitOnMain(s, file, content) {
  writeFileSync(join(s.root, file), content);
  git(s.root, ['add', file]);
  git(s.root, ['commit', '-q', '-m', `main: ${file}`]);
  return git(s.root, ['rev-parse', 'main']).stdout.trim();
}
const ledgerOf = (s, name) => readLog(join(controlAfter(s, name), 'finisher', 'ledger.jsonl'));
const syncTestLogs = (dir) => readdirSync(dir).filter((n) => /^sync-tests-\d+\.log$/.test(n)).sort();
const holdsTip = (s, name) => git(s.root, ['merge-base', '--is-ancestor', `pir/${name}`, 'main']).ok;
const basic = (x, name, extra = []) => [
  { match: BUILDER_MATCH, script: builder(name) },
  { match: REVIEWER_MATCH, script: reviewer(name) },
  finisherEntry(x, name),
  ...extra,
];

test('end: the base moved with no clash → a sync merge commit on pir/{name}, the tests run, the finisher starts', async (t) => {
  const name = 'moved-base';
  const s = setup(t, (x) => basic(x, name));
  const mainSha = commitOnMain(s, 'other.txt', 'from main\n');
  const run = start(s);
  assert.equal(await run.done, 0, run.lines.join('\n'));
  const moved = controlAfter(s, name);
  const st = stateIn(moved);
  assert.deepEqual([st.step, st.outcome, st.end.sync.state, st.end.sync.baseSha, st.end.tests], ['wait', 'merged', 'merged', mainSha, 'green']);
  assert.equal(git(s.root, ['log', '-1', '--format=%s', `pir/${name}~0^{/^sync}`]).stdout.trim(), `sync main into pir/${name}`);
  assert.deepEqual(testLogs(moved), ['tests-1.log']);
  assert.deepEqual(syncTestLogs(moved), ['sync-tests-2.log'], 'the sync run continues the numbering');
  assert.ok(run.lines.includes('finisher started'), run.lines.join('\n'));
  assert.ok(run.lines.includes('finisher closed'), 'the hand merge closed the finisher');
});

test('end: the base moved with a clash → a resolve helper with the files; after `resolved` the tests, then the finisher', async (t) => {
  const name = 'clash';
  const s = setup(t, (x) => basic(x, name, [{ match: SINGLE_RESOLVE_MATCH, script: singleResolveScript({ name }) }]));
  commitOnMain(s, 'change.txt', 'main side\n');
  const run = start(s);
  assert.equal(await run.done, 0, run.lines.join('\n'));
  const moved = controlAfter(s, name);
  const st = stateIn(moved);
  assert.deepEqual([st.outcome, st.end.sync.state, st.end.sync.files, st.end.tests], ['merged', 'resolved', ['change.txt'], 'green']);
  assert.equal(st.sessions.resolve.length, 1);
  const opening = pirTexts(convLog(moved, 'resolve'))[0];
  assert.match(opening, /run it as the resolve helper of pir\/clash\. You are run by `pir single`\./);
  assert.match(opening, /\n {2}change\.txt\n/);
  assert.ok(argvs(s).some((a) => a.includes(`${s.repo} / ${name} / single / resolve`)));
  const content = readFileSync(join(s.root, 'change.txt'), 'utf8');
  assert.ok(content.includes('main side') && content.includes('x'), content);
  assert.deepEqual(syncTestLogs(moved), ['sync-tests-2.log']);
  assert.ok(run.lines.includes('finisher started'));
});

test('end: red after the sync → one fix helper; green after it → the finisher', async (t) => {
  const name = 'red-sync';
  const s = setup(t, (x) => basic(x, name, [{ match: SINGLE_FIX_MATCH, script: singleFixScript({ name, fix: `${GIT} rm -q broken` }) }]), {
    commands: { setup: [], test: ['test ! -f broken'] },
  });
  commitOnMain(s, 'broken', 'x\n');
  const run = start(s);
  assert.equal(await run.done, 0, run.lines.join('\n'));
  const moved = controlAfter(s, name);
  const st = stateIn(moved);
  assert.deepEqual([st.outcome, st.end.tests, st.end.fixUsed, st.sessions.fix.length], ['merged', 'green', true, 1]);
  const opening = pirTexts(convLog(moved, 'fix'))[0];
  assert.match(opening, /the tests failed: test `test ! -f broken` exited 1\./);
  assert.match(opening, new RegExp(`Log: ${join(moved, 'sync-tests-2.log').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.deepEqual(syncTestLogs(moved), ['sync-tests-2.log', 'sync-tests-3.log']);
  assert.ok(run.lines.includes('finisher started'));
});

test('end: red after the fix → no finisher; the run waits red and a hand merge ends it merged', async (t) => {
  const name = 'still-red';
  const s = setup(t, (x) => basic(x, name, [{ match: SINGLE_FIX_MATCH, script: singleFixScript({ name, fix: 'echo y >> other.txt' }) }]), {
    commands: { setup: [], test: ['test ! -f broken'] },
  });
  commitOnMain(s, 'broken', 'x\n');
  const run = start(s, { handMerge: false });
  const waiting = await waitFor(() => {
    const live = liveState(s);
    return live?.state.step === 'wait' ? live.state : null;
  }, 'the red wait');
  assert.deepEqual([waiting.end.tests, waiting.end.finisher, waiting.outcome], ['red', null, null]);
  // Two passes later it is still waiting: red does not end the run.
  await new Promise((r) => setTimeout(r, 1200));
  assert.equal(run.code, undefined);
  git(s.root, ['merge', '-q', '--no-edit', `pir/${name}`]);
  assert.equal(await run.done, 0, run.lines.join('\n'));
  assert.equal(stateIn(controlAfter(s, name)).outcome, 'merged');
  assert.ok(!run.lines.some((l) => /finisher (started|resumed)/.test(l)), 'never handed over');
  assert.equal(stateIn(controlAfter(s, name)).sessions.fix.length, 1, 'one fix helper only');
});

test('end: the person merges by hand while the finisher waits for the go → merged, the finisher closed', async (t) => {
  const name = 'by-hand';
  const s = setup(t, (x) => basic(x, name));
  const run = start(s, { handMerge: false });
  await goAsked(s, name, run);
  git(s.root, ['merge', '-q', '--no-edit', `pir/${name}`]);
  assert.equal(await run.done, 0, run.lines.join('\n'));
  assert.equal(stateIn(controlAfter(s, name)).outcome, 'merged');
  assert.ok(run.lines.includes('finisher closed'));
  assert.ok(!ledgerOf(s, name).some((e) => e.kind === 'go'));
});

test('end: the base moves before the go → the finisher is told resyncing, then resynced; a Go in between does not count', async (t) => {
  const name = 'resync';
  // The re-sync's tests are slow only once main brings slow.txt in, so the Go lands while they run.
  const s = setup(t, (x) => basic(x, name), { commands: { setup: [], test: ['[ ! -f slow.txt ] || sleep 2'] } });
  const run = start(s, { handMerge: false });
  const ask = await goAsked(s, name, run);
  const before = git(s.root, ['rev-parse', 'main']).stdout.trim();
  commitOnMain(s, 'slow.txt', 'slow\n');
  await waitFor(() => ledgerOf(s, name).some((e) => e.kind === 'resyncing'), 'resyncing');
  sayGo(s, name, ask);
  await waitFor(() => ledgerOf(s, name).some((e) => e.kind === 'resync'), `resynced\n${run.lines.join('\n')}`);
  const kinds = ledgerOf(s, name).map((e) => e.kind);
  assert.ok(kinds.indexOf('resyncing') < kinds.indexOf('stale-go') && kinds.indexOf('stale-go') < kinds.indexOf('resync'), kinds.join(' '));
  assert.ok(!kinds.includes('go'), 'no go counted');
  assert.notEqual(git(s.root, ['rev-parse', 'main']).stdout.trim(), before);
  assert.equal(holdsTip(s, name), false, 'the finisher merged nothing');
  const st = stateIn(controlAfter(s, name));
  assert.deepEqual([st.step, st.end.seq, st.end.sync.state, st.end.tests], ['wait', 2, 'merged', 'green']);
  git(s.root, ['merge', '-q', '--no-edit', `pir/${name}`]);
  assert.equal(await run.done, 0, run.lines.join('\n'));
  assert.equal(stateIn(controlAfter(s, name)).outcome, 'merged');
});

test('end: the finisher writes `close` → the run ends closed', async (t) => {
  const name = 'closing';
  const s = setup(t, (x) => [
    { match: BUILDER_MATCH, script: builder(name) },
    { match: REVIEWER_MATCH, script: reviewer(name) },
    {
      match: SINGLE_FINISHER_MATCH,
      script: [
        ...opening(),
        { sh: `mkdir -p ${q(join(controlAfter(x, name), 'finisher', 'status'))} && printf '%s' '{"kind":"close","reason":"the person said leave it"}' > ${q(join(controlAfter(x, name), 'finisher', 'status', '1-close.json'))}` },
        ...say('Closed, as asked.'),
      ],
    },
  ]);
  const run = start(s, { handMerge: false });
  assert.equal(await run.done, 0, run.lines.join('\n'));
  const st = stateIn(controlAfter(s, name));
  assert.equal(st.outcome, 'closed');
  assert.equal(holdsTip(s, name), false);
  assert.ok(run.lines.includes('finisher closed'));
});

test('end: the finisher fails to start → fallback; a hand merge ends the run merged', async (t) => {
  const name = 'no-finisher';
  const s = setup(t, (x) => basic(x, name));
  const run = start(s, { deps: { startFinisher: () => { throw new Error('boom'); } } });
  assert.equal(await run.done, 0, run.lines.join('\n'));
  const st = stateIn(controlAfter(s, name));
  assert.deepEqual([st.outcome, st.end.finisher, st.end.fallback], ['merged', 'fallback', 'failed']);
  assert.ok(run.lines.includes('finisher failed to start: boom'), run.lines.join('\n'));
  assert.equal(argvs(s).length, 2, 'no finisher session');
});

test('end: a stop during the wait, then --resume → the finisher resumed by id; a Go after it still finishes', async (t) => {
  const name = 'resumed';
  const s = setup(t, (x) => basic(x, name));
  const first = start(s, { handMerge: false });
  await goAsked(s, name, first);
  const id = finisherId(s, name);
  first.stop.abort();
  assert.equal(await first.done, 0);
  const moved = controlAfter(s, name);
  assert.deepEqual([stateIn(moved).step, stateIn(moved).outcome], ['wait', null]);
  assert.equal(holdsTip(s, name), false);

  const run = start(s, { resume: true, controlDir: moved, handMerge: false });
  const ask = await goAsked(s, name, run, { after: 1 });
  assert.equal(finisherId(s, name), id);
  const av = argvs(s);
  assert.equal(av.length, 4);
  assert.ok(av[3].some((a) => a === `--resume=${id}` || a === id), av[3].join(' '));
  assert.ok(run.lines.includes('finisher resumed'));
  sayGo(s, name, ask);
  assert.equal(await run.done, 0, run.lines.join('\n'));
  assert.equal(stateIn(moved).outcome, 'finished');
  assert.ok(holdsTip(s, name));
});

test('end: a stop with the clash merge still in progress → --resume aborts it and syncs again', async (t) => {
  const name = 'cut-off';
  const s = setup(t, (x) => basic(x, name, [{ match: SINGLE_RESOLVE_MATCH, script: singleResolveScript({ name }) }]));
  commitOnMain(s, 'change.txt', 'main side\n');
  let first;
  const syncThenStop = (...args) => {
    const r = syncBaseReal(...args);
    first.stop.abort();
    return r;
  };
  first = start(s, { deps: { syncBase: syncThenStop }, handMerge: false });
  assert.equal(await first.done, 0, first.lines.join('\n'));
  const moved = controlAfter(s, name);
  const worktree = join(s.root, '.claude', 'worktrees', `pir-${name}`);
  assert.equal(stateIn(moved).end.phase, 'merge');
  assert.ok(syncPendingReal(worktree), 'the merge is left in progress');
  assert.equal(stateIn(moved).sessions.resolve.length, 0);

  const run = start(s, { resume: true, controlDir: moved });
  assert.equal(await run.done, 0, run.lines.join('\n'));
  assert.ok(run.lines.includes('the merge left in progress was aborted'), run.lines.join('\n'));
  const st = stateIn(moved);
  assert.deepEqual([st.outcome, st.end.sync.state, st.sessions.resolve.length], ['merged', 'resolved', 1]);
  assert.equal(git(worktree, ['status', '--porcelain']).stdout, '');
});

test('end: a `Go` typed as a chat message to the finisher does not merge', async (t) => {
  const name = 'chat-go';
  const s = setup(t, (x) => basic(x, name));
  const run = start(s, { handMerge: false });
  await goAsked(s, name, run);
  assert.deepEqual(dropPersonInput(controlAfter(s, name), { to: finisherId(s, name), kind: 'message', text: 'Go' }, { coordinatorAlive: true }), { ok: true });
  await waitFor(() => convLog(controlAfter(s, name), 'finisher').some((e) => e.dir === 'out' && e.from === 'person' && e.text === 'Go'), 'the message delivered');
  await new Promise((r) => setTimeout(r, 1200));
  assert.equal(holdsTip(s, name), false);
  assert.ok(!ledgerOf(s, name).some((e) => e.kind === 'go'));
  assert.equal(run.code, undefined, 'still waiting for the go');
  git(s.root, ['merge', '-q', '--no-edit', `pir/${name}`]);
  assert.equal(await run.done, 0);
  assert.equal(stateIn(controlAfter(s, name)).outcome, 'merged');
});

test('singleChecks: `resolved` refused while a merge is in progress or the tree is dirty; `fixed` refused on a dirty tree', () => {
  const run = { id: ID, name: 'fix-typo', base: 'main' };
  const gitWith = (status) => (cwd, args) => (args[0] === 'status' ? { ok: true, stdout: status } : { ok: true, stdout: '' });
  const check = (kind, { status = '', pending = false, name = 'fix-typo' } = {}) =>
    singleChecks({ kind, name, run, worktree: '/w', root: '/r', repo: 'repo', indexDir: '/i', startSha: 'a', git: gitWith(status), syncPending: () => pending });
  assert.deepEqual(check('resolved'), { ok: true });
  assert.deepEqual(check('fixed'), { ok: true });
  assert.deepEqual(check('resolved', { pending: true }).failures, ['The merge is still in progress. Resolve every clashing file, commit the merge, then drop the `resolved` report again.']);
  assert.match(check('resolved', { status: ' M a\n' }).failures[0], /uncommitted changes/);
  assert.match(check('fixed', { status: ' M a\n' }).failures[0], /uncommitted changes/);
  assert.deepEqual(check('fixed', { pending: true }), { ok: true }, 'a fix helper is not asked about a merge');
  assert.equal(check('fixed', { name: 'other' }).failures[0], 'This run is pir/fix-typo, not pir/other. Drop the `fixed` report with single=fix-typo.');
});

test('canResume: a stopped or crashed single run in sync or wait resumes; a finished one never does', () => {
  for (const step of ['sync', 'wait']) {
    for (const state of ['stopped', 'crashed']) {
      assert.equal(canResume({ state, record: { kind: 'single' }, snapshot: { runState: { kind: 'single', step, outcome: null } } }), true, `${state} in ${step}`);
    }
  }
  for (const outcome of ['finished', 'merged', 'closed', 'dropped', 'ready']) {
    assert.equal(canResume({ state: 'finished', record: { kind: 'single' }, snapshot: { runState: { kind: 'single', step: 'wait', outcome } } }), false, outcome);
  }
});
