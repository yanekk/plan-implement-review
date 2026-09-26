// pir-plan-command T05 — the fake `claude` standing in for every session of a run: a scripts file keyed
// by the opening message, `sh` steps, `{{reportsDir}}`, resume, the PATH shim, and the canned sessions.
// The fake is driven raw over stdio here (one NDJSON line per message), except where the test is that the
// real SDK reaches it through the shim. No test starts the real `claude`: every spawn is claude-stream.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assistantText, resultEvent } from './claude-stream.mjs';
import { writeClaudeShim } from './claude-shim.mjs';
import {
  plannerScript, reviewerScript, noPlanScript, workerScripts, PLANNER_MATCH, REVIEWER_MATCH, FAKE_TASK,
} from './sessions.mjs';
import { openingInstruction, resolveClaudePath } from '../platform.mjs';
import { startWorker } from '../worker-proc.mjs';
import { parseProgress } from '../../core/progress.mjs';
import { parseTestBlock } from '../../core/testblock.mjs';

const STREAM = fileURLToPath(new URL('./claude-stream.mjs', import.meta.url));
const S1 = '11111111-1111-4111-8111-111111111111';
const S2 = '22222222-2222-4222-8222-222222222222';

function scratch(t, prefix = 'pir-fake-') {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function gitRepo(dir) {
  const g = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' }).trim();
  g('init', '-q', '-b', 'main');
  g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'root');
  return g;
}

async function waitFor(pred, what, ms = 8000) {
  const start = Date.now();
  for (;;) {
    const v = pred();
    if (v) return v;
    if (Date.now() - start > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

// runFake(t, { env, args, cwd }) → a raw fake process: `send` writes one message line, `lines` is every
// stdout line parsed, `exit` resolves with the code.
function runFake(t, { env = {}, args = [], cwd }) {
  const child = spawn(process.execPath, [STREAM, ...args], {
    cwd,
    env: { ...process.env, PIR_FAKE_CLAUDE_SCRIPT: '', PIR_FAKE_CLAUDE_SCRIPTS: '', ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const lines = [];
  let buf = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (d) => {
    buf += d;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      lines.push(JSON.parse(buf.slice(0, nl)));
      buf = buf.slice(nl + 1);
    }
  });
  let stderr = '';
  child.stderr.on('data', (d) => (stderr += d));
  child.stdin.on('error', () => {});
  const exit = new Promise((r) => child.on('exit', (code) => r(code)));
  t.after(() => child.kill('SIGKILL'));
  return {
    child,
    lines,
    exit,
    stderr: () => stderr,
    send: (obj) => child.stdin.write(JSON.stringify(obj) + '\n'),
    user: (text) => child.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null }) + '\n'),
    texts: () => lines.filter((l) => l.type === 'assistant').flatMap((l) => l.message.content.map((c) => c.text ?? '')),
    result: () => lines.find((l) => l.type === 'result'),
    end: () => child.stdin.end(),
  };
}

const writeScripts = (dir, entries) => {
  const f = join(dir, 'scripts.json');
  writeFileSync(f, JSON.stringify(entries));
  return f;
};

const reports = (dir) =>
  existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith('.json')).map((n) => JSON.parse(readFileSync(join(dir, n), 'utf8'))) : [];

test('two sessions from one scripts file get different scripts by their opening message', async (t) => {
  const dir = scratch(t);
  const scripts = writeScripts(dir, [
    { match: '^alpha', script: [{ await: 'user' }, { emit: assistantText('I am alpha') }, { emit: resultEvent('success', 'a') }] },
    { match: 'beta', script: [{ await: 'user' }, { emit: assistantText('I am beta') }, { emit: resultEvent('success', 'b') }] },
  ]);
  const a = runFake(t, { env: { PIR_FAKE_CLAUDE_SCRIPTS: scripts }, args: [`--session-id=${S1}`], cwd: dir });
  const b = runFake(t, { env: { PIR_FAKE_CLAUDE_SCRIPTS: scripts }, args: [`--session-id=${S2}`], cwd: dir });
  a.user('alpha, go');
  b.user('this is beta');
  await waitFor(() => a.result() && b.result(), 'both results');
  assert.deepEqual(a.texts(), ['I am alpha']);
  assert.deepEqual(b.texts(), ['I am beta']);
});

test('an opening no entry matches is an error result, not a guess', async (t) => {
  const dir = scratch(t);
  const scripts = writeScripts(dir, [{ match: '^alpha', script: [{ emit: assistantText('no') }] }]);
  const f = runFake(t, { env: { PIR_FAKE_CLAUDE_SCRIPTS: scripts }, args: [`--session-id=${S1}`], cwd: dir });
  f.user('gamma');
  const r = await waitFor(() => f.result(), 'a result');
  assert.equal(r.is_error, true);
  assert.deepEqual(f.texts(), []);
  // stderr is a separate pipe from the result line on stdout, so it may land later: wait for it.
  await waitFor(() => /no script matches/.test(f.stderr()), 'the stderr line');
});

test('sh runs in the session cwd with FAKE_CWD and FAKE_OPENING, and its commit is in git', async (t) => {
  const dir = scratch(t);
  const g = gitRepo(dir);
  const scripts = writeScripts(scratch(t), [{
    match: 'commit',
    script: [
      { await: 'user' },
      { sh: 'printf %s "$FAKE_OPENING" > opening.txt && printf %s "$FAKE_CWD" > cwd.txt && git add -A && git -c user.name=f -c user.email=f@f commit -q -m "fake commit"' },
      { emit: resultEvent('success', 'ok') },
    ],
  }]);
  const f = runFake(t, { env: { PIR_FAKE_CLAUDE_SCRIPTS: scripts }, args: [`--session-id=${S1}`], cwd: dir });
  f.user('please commit this');
  const r = await waitFor(() => f.result(), 'the result');
  assert.equal(r.subtype, 'success');
  assert.equal(g('log', '-1', '--format=%s'), 'fake commit');
  assert.equal(g('show', 'HEAD:opening.txt'), 'please commit this');
  assert.equal(g('show', 'HEAD:cwd.txt'), dir);
});

test('a failing sh is an error result and ends the script', async (t) => {
  const dir = scratch(t);
  const scripts = writeScripts(dir, [{
    match: '.',
    script: [{ await: 'user' }, { sh: 'echo broke >&2; exit 4' }, { emit: assistantText('never') }],
  }]);
  const f = runFake(t, { env: { PIR_FAKE_CLAUDE_SCRIPTS: scripts }, args: [`--session-id=${S1}`], cwd: dir });
  f.user('go');
  const r = await waitFor(() => f.result(), 'the result');
  assert.equal(r.is_error, true);
  assert.match(r.errors[0], /sh exited 4: broke/);
  await new Promise((res) => setTimeout(res, 150));
  assert.deepEqual(f.texts(), []);
});

test('{{reportsDir}} is substituted from the opening message in emit and sh', async (t) => {
  const dir = scratch(t);
  const rep = join(dir, 'my repo', 'ctl', 'reports'); // a space: the path runs to the end of its line
  const scripts = writeScripts(dir, [{
    match: 'Reports folder',
    script: [{ await: 'user' }, { sh: 'mkdir -p "{{reportsDir}}" && touch "{{reportsDir}}/r.json"' }, { emit: assistantText('to {{reportsDir}}') }, { emit: resultEvent('success', 'ok') }],
  }]);
  const f = runFake(t, { env: { PIR_FAKE_CLAUDE_SCRIPTS: scripts }, args: [`--session-id=${S1}`], cwd: dir });
  f.user(`Run it. Reports folder: ${rep}\nBrief:\n\nx`);
  await waitFor(() => f.result(), 'the result');
  assert.deepEqual(f.texts(), [`to ${rep}`]);
  assert.ok(existsSync(join(rep, 'r.json')));
});

test('a resumed start is silent until a user message, then continues after the last completed step', async (t) => {
  const dir = scratch(t);
  const scripts = writeScripts(dir, [{
    match: 'begin',
    script: [
      { await: 'user' },
      { emit: assistantText('one') },
      { exit: 3 },
      { emit: assistantText('two') },
      { sh: 'printf %s "$FAKE_OPENING" > resumed-opening.txt' },
      { emit: resultEvent('success', 'done') },
    ],
  }]);
  const first = runFake(t, { env: { PIR_FAKE_CLAUDE_SCRIPTS: scripts }, args: [`--session-id=${S1}`], cwd: dir });
  first.user('begin please');
  assert.equal(await first.exit, 3);
  assert.deepEqual(first.texts(), ['one']);
  assert.ok(existsSync(join(dir, `fake-progress-${S1}.json`)));

  const again = runFake(t, { env: { PIR_FAKE_CLAUDE_SCRIPTS: scripts }, args: [`--resume=${S1}`], cwd: dir });
  // Answers control requests but takes no turn of its own.
  again.send({ type: 'control_request', request_id: 'init-1', request: { subtype: 'initialize' } });
  await waitFor(() => again.lines.some((l) => l.type === 'control_response'), 'the initialize ack');
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual(again.lines.filter((l) => l.type !== 'control_response'), [], 'silent before a user message');
  again.user('You were stopped; carry on.'); // unrelated text: the resume keeps its original script
  await waitFor(() => again.result(), 'the resumed result');
  assert.deepEqual(again.texts(), ['two']);
  assert.equal(readFileSync(join(dir, 'resumed-opening.txt'), 'utf8'), 'begin please');

  // The space-separated form a person types works the same.
  const third = runFake(t, { env: { PIR_FAKE_CLAUDE_SCRIPTS: scripts }, args: ['--resume', S1], cwd: dir });
  third.user('again');
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual(third.texts(), [], 'the script had already finished');
});

test('the shim on PATH is what resolveClaudePath returns, and startWorker completes one scripted turn through it', async (t) => {
  const dir = scratch(t);
  const bin = join(dir, 'bin');
  const received = join(dir, 'received.ndjson');
  const scripts = writeScripts(dir, [{
    match: 'hello',
    script: [{ await: 'user' }, { emit: assistantText('hi from the shim') }, { emit: resultEvent('success', 'hi') }],
  }]);
  const shim = writeClaudeShim(bin, { scriptsFile: scripts, received });
  const PATH = `${bin}:${process.env.PATH}`;
  const claudePath = resolveClaudePath({ exec: (cmd, args, opts) => execFileSync(cmd, args, { ...opts, env: { ...process.env, PATH } }) });
  assert.equal(claudePath, shim);

  const worker = startWorker({ cwd: dir, sessionId: S1, name: 'fake / shim / test', logPath: join(dir, 'log.ndjson'), claudePath });
  t.after(() => worker.close({ graceMs: 100, killMs: 300 }));
  worker.send('hello there', { from: 'pir' });
  await waitFor(() => worker.entries().find((e) => e.dir === 'in' && e.event.type === 'result'), 'the turn to finish');
  const said = worker.entries().filter((e) => e.dir === 'in' && e.event.type === 'assistant').map((e) => e.event.message.content[0].text);
  assert.deepEqual(said, ['hi from the shim']);
  const argv = JSON.parse(readFileSync(received, 'utf8').split('\n')[0]).argv;
  assert.ok(argv.includes(`--session-id=${S1}`), 'the SDK launched the shim with its own argv');
});

// ---- The canned sessions. ----

const PLANNER_OPENING = (reportsDir) =>
  `Load the pir-plan skill and run it. You are run by \`pir plan\`: follow its "Run by pir plan" section. Reports folder: ${reportsDir}\nBrief:\n\nA fake thing`;
const REVIEWER_OPENING = (slug, reportsDir) =>
  `Load the pir-review-plan skill and run it on plan ${slug}. You are run by \`pir plan\`: follow its "Run by pir plan" section. Reports folder: ${reportsDir}`;

test('plannerScript writes a plan with a valid test block that reads reviewed after reviewerScript', async (t) => {
  const dir = scratch(t);
  const g = gitRepo(dir);
  const slug = 'fake-thing';
  const rep = join(scratch(t), 'reports'); // outside the repo, as a real control folder is git-ignored
  const scripts = writeScripts(scratch(t), [
    { match: PLANNER_MATCH, script: plannerScript({ slug, question: 'Big or small?' }) },
    { match: REVIEWER_MATCH, script: reviewerScript({ slug }) },
  ]);

  const planner = runFake(t, { env: { PIR_FAKE_CLAUDE_SCRIPTS: scripts }, args: [`--session-id=${S1}`], cwd: dir });
  planner.user(PLANNER_OPENING(rep));
  const ask = await waitFor(() => planner.lines.find((l) => l.type === 'control_request'), 'the question');
  assert.equal(ask.request.tool_name, 'AskUserQuestion');
  assert.equal(ask.request.input.questions[0].question, 'Big or small?');
  planner.send({
    type: 'control_response',
    response: { subtype: 'success', request_id: ask.request_id, response: { behavior: 'allow', updatedInput: { ...ask.request.input, answers: { 'Big or small?': 'Small' } } } },
  });
  const r1 = await waitFor(() => planner.result(), 'the planner result');
  assert.equal(r1.subtype, 'success');

  const design = g('show', `HEAD:plans/${slug}/DESIGN.md`);
  const tb = parseTestBlock(design);
  assert.equal(tb.ok, true, tb.reason);
  assert.deepEqual(tb.test, ['true']);
  for (const f of ['PROGRESS.md', 'PLAN.md', `tasks/${FAKE_TASK.num}-${FAKE_TASK.slug}.md`]) g('cat-file', '-e', `HEAD:plans/${slug}/${f}`);
  const before = parseProgress(g('show', `HEAD:plans/${slug}/PROGRESS.md`));
  assert.equal(before.planReviewed.reviewed, false);
  assert.deepEqual(before.errors, []);
  assert.deepEqual(before.tasks.map((x) => [x.num, x.name, x.state]), [['T01', 'first-task', '⬜']]);
  assert.equal(g('status', '--porcelain'), '', 'the planner leaves the worktree clean');
  assert.match(reports(rep).map((x) => x.text).join('\n'), new RegExp(`^\\[pir:v1 kind=planned plan=${slug}\\]`, 'm'));

  const reviewer = runFake(t, { env: { PIR_FAKE_CLAUDE_SCRIPTS: scripts }, args: [`--session-id=${S2}`], cwd: dir });
  reviewer.user(REVIEWER_OPENING(slug, rep));
  const r2 = await waitFor(() => reviewer.result(), 'the reviewer result');
  assert.equal(r2.subtype, 'success');
  const after = parseProgress(g('show', `HEAD:plans/${slug}/PROGRESS.md`));
  assert.equal(after.planReviewed.reviewed, true);
  assert.equal(g('status', '--porcelain'), '');
  assert.match(reports(rep).map((x) => x.text).join('\n'), new RegExp(`^\\[pir:v1 kind=reviewed plan=${slug}\\]`, 'm'));
});

test('noPlanScript drops no-plan and writes nothing', async (t) => {
  const dir = scratch(t);
  const g = gitRepo(dir);
  const rep = join(dir, 'reports');
  const scripts = writeScripts(dir, [{ match: PLANNER_MATCH, script: noPlanScript() }]);
  const f = runFake(t, { env: { PIR_FAKE_CLAUDE_SCRIPTS: scripts }, args: [`--session-id=${S1}`], cwd: dir });
  f.user(PLANNER_OPENING(rep));
  await waitFor(() => f.result(), 'the result');
  assert.match(reports(rep)[0].text, /^\[pir:v1 kind=no-plan plan=-\]/);
  assert.equal(g('rev-list', '--count', 'HEAD'), '1');
});

test('workerScripts: the implementer marks 🔍 and reports implemented; the reviewer marks ✅, integrates and reports done', async (t) => {
  const main = scratch(t);
  const g = gitRepo(main);
  const slug = 'demo';
  const plan = join(main, 'plans', slug);
  mkdirSync(plan, { recursive: true });
  writeFileSync(join(plan, 'PROGRESS.md'), '# Progress\n\n**Plan reviewed:** yes\n\n| # | Task | Depends on | State | Notes |\n|---|---|---|---|---|\n| T01 | first-task | — | ⬜ | |\n');
  writeFileSync(join(main, '.gitignore'), 'plans/*/.parallel/\n');
  g('add', '-A');
  g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'plan');
  g('branch', `pir/${slug}`);
  const wt = join(main, '.claude', 'worktrees', `pir-${slug}-T01`);
  g('worktree', 'add', '-q', '-b', `pir/${slug}-T01`, wt, `pir/${slug}`);
  // The feature branch moves on meanwhile, so the reviewer's integrate is a real merge.
  g('checkout', '-q', `pir/${slug}`);
  writeFileSync(join(main, 'other.txt'), 'another task\n');
  g('add', 'other.txt');
  g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'T02: other');
  g('checkout', '-q', 'main');

  const scripts = writeScripts(scratch(t), workerScripts());
  const opening = (phase) => openingInstruction(phase, 'T01'); // the text pir really sends
  const rep = join(main, 'plans', slug, '.parallel', 'control', 'reports');
  const wg = (...a) => execFileSync('git', a, { cwd: wt, encoding: 'utf8' }).trim();

  const impl = runFake(t, { env: { PIR_FAKE_CLAUDE_SCRIPTS: scripts }, args: [`--session-id=${S1}`], cwd: wt });
  impl.user(opening('implement'));
  assert.equal((await waitFor(() => impl.result(), 'implement result')).subtype, 'success');
  assert.equal(parseProgress(wg('show', 'HEAD:plans/demo/PROGRESS.md')).tasks[0].state, '🔍');
  assert.equal(wg('log', '-1', '--format=%s'), 'T01: fake implementation');
  assert.match(reports(rep).map((x) => x.text).join('\n'), /^\[pir:v1 kind=implemented task=T01\]/m);

  const rev = runFake(t, { env: { PIR_FAKE_CLAUDE_SCRIPTS: scripts }, args: [`--session-id=${S2}`], cwd: wt });
  rev.user(opening('review'));
  assert.equal((await waitFor(() => rev.result(), 'review result')).subtype, 'success');
  assert.equal(parseProgress(wg('show', 'HEAD:plans/demo/PROGRESS.md')).tasks[0].state, '✅');
  wg('merge-base', '--is-ancestor', `pir/${slug}`, 'HEAD');
  assert.equal(wg('status', '--porcelain'), '');
  assert.match(reports(rep).map((x) => x.text).join('\n'), /^\[pir:v1 kind=done task=T01\]/m);
});
