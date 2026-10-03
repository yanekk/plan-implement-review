// The single-run drill's scenario tests (single-runs T11, DESIGN §2.1, §2.5, §2.8, §2.10, §2.11): the whole
// flow as a person meets it, through the real `pir` screen under a pty, from the box to the finisher's Go
// and `finished` (single-finisher T07); and the
// dropped and taken-name runs, from the box too. Each size is its own test file (plan-rig-single-drill-
// {size}.test.mjs), as the conversation rig's sizes are, so node runs them side by side: a walk waits up to
// 30 s on the merged check. Not a test file itself.
//
// The seatbelts are the planning rig's: a scratch repo, a scratch home, the fake `claude` first on PATH. The
// phone alerts go to a fake ntfy server on 127.0.0.1 that the scratch home's notify.json names, since the
// single program is detached and cannot be handed a fake publisher (FINDINGS 2026-09-30).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:http';
import {
  BUILDER_MATCH, FINISHER_ASKING_AGAIN, FINISHER_GO_QUESTION, FINISHER_NOT_YET, FINISHER_RECHECKED, FINISHER_SUMMARY, SINGLE_FINISHER_MATCH,
  SINGLE_FIX_MATCH, SINGLE_RED_FILE, SINGLE_RESOLVE_MATCH, SINGLE_REVIEWER_MATCH, singleBuilderScript, singleFinisherScript, singleFixScript, singleResolveScript,
} from './fake/sessions.mjs';
import { indexDir, listRecords } from './index-store.mjs';
import { SINGLE_HINT } from './list-view.mjs';
import { writeNotifyConfig } from './notify-config.mjs';
import { SINGLE_RIG_DROP_ASK, SINGLE_RIG_NAME, SINGLE_RIG_QUESTION, SINGLE_RIG_TAKEN, startSingle } from './plan-rig.mjs';
import { CTRL_S, DOWN, ENTER, LEFT, RIGHT, UP, boxText, esc, git, headOf, lastLine, rigWithTeardown, selectRow, typeSettled, until } from './plan-rig-helpers.mjs';

// A machine busy with the other test files stretches every wait.
const SLOW = 60000;
const CTRL_R = '\x12';
const TOPIC = 'pir-drill';

const recordsOf = (rig) => listRecords({ dir: indexDir({ env: rig.env }) });
// The screen as running prose: a conversation wraps its lines at the frame's width, a different place at
// each size, so a sentence is matched with every run of white space folded to one space.
const flat = (rows) => rows.join(' ').replace(/\s+/g, ' ');

// fakeNtfy(t, rig) → { hits }: a local stand-in for ntfy that records each request ({ method, url, body }),
// named by the scratch home's notify.json so every program under the rig publishes to it.
async function fakeNtfy(t, rig) {
  const hits = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      hits.push({ method: req.method, url: req.url, body: body ? JSON.parse(body) : null });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => {
    // The programs' keep-alive connections would hold close() open.
    server.closeAllConnections();
    return new Promise((r) => server.close(r));
  });
  writeNotifyConfig({ server: `http://127.0.0.1:${server.address().port}`, topic: TOPIC }, rig.env);
  return { hits, alerts: () => hits.filter((h) => h.method === 'POST').map((h) => h.body) };
}

// The builder of the walk: it asks its question, then its first commit is red (single-asks and single-red
// in one run, as the drill walks them).
function askThenRed(rig) {
  const entries = JSON.parse(readFileSync(rig.scriptsFile, 'utf8')).map((e) =>
    e.match === BUILDER_MATCH ? { ...e, script: singleBuilderScript({ name: SINGLE_RIG_NAME, question: SINGLE_RIG_QUESTION, red: true }) } : e,
  );
  writeFileSync(rig.scriptsFile, JSON.stringify(entries));
}

// The rig's screen in colour (the basic table: NO_COLOR and COLORTERM dropped), to read a cell's style.
function openLit(rig, cols, rows) {
  const { NO_COLOR: _nc, FORCE_COLOR: _fc, COLORTERM: _ct, ...env } = rig.env;
  return rig.openScreen({ cols, rows, env });
}

// Amber and bold, the style of a row that wants the person (palette.mjs `asking` and `your-go`).
function assertAmber(screen, rows, text) {
  const y = rows.findIndex((l) => l.includes(text));
  assert.ok(y >= 0, `${text} is on the screen:\n${rows.join('\n')}`);
  const x = rows[y].indexOf(text);
  assert.deepEqual([screen.fgAt(y, x), screen.boldAt(y, x)], ['33', true], `${text} is amber and bold`);
}

// From the list: `@repo/single {prompt}` typed in the box and sent.
async function startFromBox(screen, prompt) {
  await screen.waitFor(/new {2}start with @repo/, SLOW);
  await typeSettled(screen, 'repo/single ', prompt);
  const typed = await screen.waitFor();
  assert.equal(headOf(typed), 'new  change in repo');
  assert.equal(boxText(typed), `@repo/single ${prompt}`);
  // A hint wider than the frame is cut by the frame.
  assert.ok(SINGLE_HINT.startsWith(lastLine(typed)), lastLine(typed));
  screen.send(ENTER);
}

// defineSingleDrill([cols, rows]) — the three scenario tests at one size.
export function defineSingleDrill([cols, rows]) {
  const at = `${cols}×${rows}`;

  test(`the drill at ${at}: from the box, the builder's question answered, a red round, the view following into the reviewer, ready for your go, the finisher's Go, finished; an alert for the question and none for ready to merge`, { timeout: 240000 }, async (t) => {
    const rig = rigWithTeardown(t, { scripts: 'single-asks' });
    askThenRed(rig);
    const ntfy = await fakeNtfy(t, rig);
    const mainBefore = git(rig.repoDir, 'rev-parse', 'main');
    const screen = rig.openScreen({ cols, rows });
    const lit = openLit(rig, cols, rows);
    try {
      await lit.waitFor(/No runs yet/, SLOW);
      await startFromBox(screen, 'fix the typo');

      // The builder's conversation, its question open; the phone is told once.
      const asked = await screen.waitFor(new RegExp(esc(SINGLE_RIG_QUESTION)), SLOW);
      assert.match(asked[0], /^build {2}worker \S+ · live/, asked.join('\n'));
      await until(() => ntfy.alerts().length >= 1, 'the asking alert', SLOW);
      assert.deepEqual([ntfy.alerts()[0].title, ntfy.alerts()[0].message, ntfy.alerts()[0].topic], ['fix the typo · builder', `asks: ${SINGLE_RIG_QUESTION}`, TOPIC]);

      // The list calls for the person in amber; the steps view names the step and how to answer.
      const listAsking = await lit.waitFor(/single +● asking you +repo +build …/, SLOW);
      assert.match(listAsking.join('\n'), /1 run · 0 running · 0 finished · 0 crashed · 1 waiting for/);
      assertAmber(lit, listAsking, '● asking you');
      screen.send(LEFT);
      const stepsAsking = (await screen.waitFor(/pick a step/, SLOW)).join('\n');
      assert.match(stepsAsking, /^"fix the typo" · building · pir\/single-[0-9a-f]{4}$/m);
      assert.match(stepsAsking, /^▎ ● build +builder +asking you · a question +\d+:\d\d$/m, 'the clock is whole at every size');
      assert.match(stepsAsking, /^ {2}○ review +reviewer +waits on build$/m);
      assert.match(stepsAsking, /^ {2}○ sync +— +waits on review$/m);
      assert.match(stepsAsking, /^ {2}○ merge +— +waits on sync$/m);
      assert.match(stepsAsking, /^● build — asking you; open it \(→\) to answer$/m);

      // Back in, the first option sent: the builder builds, pir's tests go red once, its fix is green, and
      // the view follows into the reviewer.
      screen.send(RIGHT);
      await screen.waitFor(new RegExp(esc(SINGLE_RIG_QUESTION)), SLOW);
      screen.send(ENTER);
      const followed = await screen.waitFor(/the builder finished; the reviewer has started/, SLOW);
      assert.equal(followed[0], 'the builder finished; the reviewer has started');
      assert.match(followed[1], /^review {2}worker \S+/, followed.join('\n'));
      await screen.waitFor(new RegExp(`pir/${SINGLE_RIG_NAME} is reviewed\\.`), SLOW);

      // Ready for the go: amber on the list, the question's alert cleared when it was answered, and no
      // `ready to merge` alert for a run the finisher takes over (single-finisher §2.12; its own alerts are T06's).
      const listReady = await lit.waitFor(new RegExp(`${SINGLE_RIG_NAME} +single +● ready for your go +repo +build ✓ re`), SLOW);
      assert.match(listReady.join('\n'), /1 run · 0 running · 0 finished · 0 crashed · 1 waiting for/);
      assertAmber(lit, listReady, '● ready for your go');
      const [asking] = ntfy.alerts();
      await until(() => ntfy.hits.some((h) => h.method === 'PUT' && h.url === `/${TOPIC}/${asking.sequence_id}/clear`), 'the asking alert cleared', SLOW);
      assert.ok(!ntfy.alerts().some((x) => /ready to merge/.test(x.title)), JSON.stringify(ntfy.alerts()));
      assert.equal(git(rig.repoDir, 'rev-parse', 'main'), mainBefore, 'main is untouched');

      // The steps view: the sync up to date, the finisher waiting for the go, in amber.
      lit.send(ENTER);
      const litSteps = await lit.waitFor(/◆ finisher {2}waiting for your go/, SLOW);
      assertAmber(lit, litSteps, '◆ finisher  waiting for your go');
      lit.send(LEFT);
      screen.send(LEFT);
      const stepsReady = (await screen.waitFor(/pick a step/, SLOW)).join('\n');
      assert.match(stepsReady, new RegExp(`^${SINGLE_RIG_NAME} · ready for your go · pir/${SINGLE_RIG_NAME}$`, 'm'));
      assert.match(stepsReady, /^ {2}✔ build +builder +built +\d+:\d\d$/m);
      assert.match(stepsReady, /^▎ ✔ review +reviewer +reviewed +\d+:\d\d$/m);
      assert.match(stepsReady, /^ {2}✔ sync +— +up to date · tests green$/m);
      assert.match(stepsReady, /^ {2}● merge +— +◆ finisher {2}waiting for your go$/m);
      assert.doesNotMatch(stepsReady, /git switch|Hand-off/, 'the finisher has the merge');
      assert.match(stepsReady, /Ctrl\+S/, 'the run still runs while it waits');

      // The red round, in the builder's conversation: what failed, the round, the untouched starting point.
      screen.send(UP);
      screen.send(RIGHT);
      const built = flat(await screen.waitFor(/read only/, SLOW));
      assert.match(built, /pir ran the tests on your commit [0-9a-f]{7} and they failed: test `test ! -f red\.txt` exited 1\. Round 1 of 3\./);
      assert.match(built, /They pass on the untouched starting point \(main [0-9a-f]{7}\), so this change broke them\./);
      assert.match(built, /Fix it, commit, and report again\. build ▸ The tests should pass now; reported built again\./);
      screen.send(LEFT);
      await screen.waitFor(/pick a step/, SLOW);

      // → on merge: the finisher's conversation and its go question; the person's Go ends the run finished.
      screen.send(DOWN);
      screen.send(DOWN);
      screen.send(DOWN);
      screen.send(RIGHT);
      const fin = flat(await screen.waitFor(new RegExp(esc(FINISHER_GO_QUESTION)), SLOW));
      // At 20 rows the summary above has scrolled off; its steps and the question stay in view.
      if (rows >= 24) assert.ok(fin.includes(FINISHER_SUMMARY), fin);
      assert.ok(fin.includes('The steps, once you say go:'), fin);
      assert.match(fin, /finisher agent \S+ · live/);
      screen.send(ENTER);
      await screen.waitFor(/Done: merged and installed\./, SLOW);
      screen.send(LEFT);
      const ended = (await screen.waitFor(new RegExp(`^${SINGLE_RIG_NAME} · finished · pir/${SINGLE_RIG_NAME}$`, 'm'), SLOW)).join('\n');
      assert.match(ended, /^▎ ✔ merge +— +merged$/m);
      assert.doesNotMatch(ended, /git switch/);
      assert.notEqual(git(rig.repoDir, 'rev-parse', 'main'), mainBefore, 'the finisher merged into main');
      screen.send(RIGHT);
      const noted = (await screen.waitFor(/merge has no conversation/, SLOW)).join('\n');
      assert.match(noted, /^merge has no conversation — the branch is already merged\.$/m);
      screen.send(LEFT);
      const list = (await screen.waitFor(new RegExp(`${SINGLE_RIG_NAME} +single +◌ finished +repo +build ✓ re`), SLOW)).join('\n');
      assert.match(list, /^1 run · 0 running · 1 finished · 0 crashed$/m, 'a finished run no longer waits');
      assert.deepEqual([screen.overflows(), lit.overflows()], [0, 0], 'no line ran past the frame');
    } finally {
      await screen.close();
      await lit.close();
    }
  });

  test(`the drill at ${at}: single-dropped from the box — the builder asks in plain words, the reply typed in its conversation, the row finished with build ✗, the footer giving the reason, no ready alert`, { timeout: 120000 }, async (t) => {
    const rig = rigWithTeardown(t, { scripts: 'single-dropped' });
    const ntfy = await fakeNtfy(t, rig);
    const screen = rig.openScreen({ cols, rows });
    try {
      await startFromBox(screen, 'make it bigger');
      // The whole ask is waited for rather than read off the next quiet frame, which on a loaded machine can be one
      // drawn before the rest of the message arrived.
      const ask = await screen.waitFor((x) => /Shall I drop it/.test(x) && flat(x.split('\n')).includes(SINGLE_RIG_DROP_ASK), SLOW);
      assert.ok(flat(ask).includes(SINGLE_RIG_DROP_ASK));
      await typeSettled(screen, 'Yes, drop it.');
      screen.send(ENTER);
      await screen.waitFor(/Dropped, as agreed\./, SLOW);
      const record = await until(() => recordsOf(rig).find((r) => r.finalState === 'finished'), 'the run finished', SLOW);

      screen.send(LEFT);
      const steps = (await screen.waitFor(/^Dropped: /m, SLOW)).join('\n');
      assert.match(steps, new RegExp(`^"make it bigger" · finished · ${esc(record.branch)}$`, 'm'));
      assert.match(steps, /^▎ ✗ build +builder +dropped +\d+:\d\d$/m);
      assert.match(steps, /^ {2}○ review +reviewer +not started$/m);
      assert.match(steps, /^ {2}○ sync +— +not started$/m);
      assert.match(steps, /^ {2}○ merge +— +not started$/m);
      assert.match(steps, /^Dropped: Too big for a single run: use \/plan\.$/m);
      screen.send(LEFT);
      const list = (await screen.waitFor(/single +◌ finished +repo +build ✗/, SLOW)).join('\n');
      assert.match(list, /^1 run · 0 running · 1 finished · 0 crashed$/m);
      // Dropping needs the person's agreement in the conversation, so nothing is sent for it (§2.10).
      assert.deepEqual(ntfy.alerts().map((a) => a.title), ['make it bigger · builder']);
      assert.equal(screen.overflows(), 0);
    } finally {
      await screen.close();
    }
  });

  test(`the drill at ${at}: single-taken from the box — pir's check message is in the builder's conversation, and the run reaches the go under the second name`, { timeout: 120000 }, async (t) => {
    const rig = rigWithTeardown(t, { scripts: 'single-taken' });
    const taken = git(rig.repoDir, 'rev-parse', `pir/${SINGLE_RIG_TAKEN}`);
    const screen = rig.openScreen({ cols, rows });
    try {
      await startFromBox(screen, 'fix the typo');
      const stateFile = join(rig.repoDir, 'plans', SINGLE_RIG_NAME, '.parallel', 'single', 'state.json');
      await until(() => existsSync(stateFile) && JSON.parse(readFileSync(stateFile, 'utf8')).step === 'wait', 'the run waiting for the go', SLOW);
      // Nothing parks this builder, so whether the view was still in its conversation when the reviewer
      // started is a race; either way one ← is the steps view.
      await screen.waitFor(/worker \S+ · (finished|exited), read only/, SLOW);
      screen.send(LEFT);
      // The finisher reads `preparing` for a frame or two before its go question is up.
      await screen.waitFor(new RegExp(`^${SINGLE_RIG_NAME} · ready for your go · pir/${SINGLE_RIG_NAME}$`, 'm'), SLOW);
      screen.send(UP);
      screen.send(UP);
      screen.send(RIGHT);
      const built = flat(await screen.waitFor(/^build {2}worker \S+ · (finished|exited), read only/m, SLOW));
      const refusal = `pir did not accept your \`built\` report for pir/${SINGLE_RIG_TAKEN}: The name "${SINGLE_RIG_TAKEN}" is taken: a branch pir/${SINGLE_RIG_TAKEN} already exists. Choose another name, then drop the \`built\` report again.`;
      assert.ok(built.includes(`build ▸ Reported built as ${SINGLE_RIG_TAKEN}. pir ▸ ${refusal} build ▸ The change is committed; reported built as ${SINGLE_RIG_NAME}.`), built);
      screen.send(LEFT);
      await screen.waitFor(/pick a step/, SLOW);
      screen.send(LEFT);
      await screen.waitFor(new RegExp(`${SINGLE_RIG_NAME} +single +● ready for your go +repo +build ✓ re`), SLOW);
      assert.equal(git(rig.repoDir, 'rev-parse', `pir/${SINGLE_RIG_TAKEN}`), taken, 'the taken branch is not touched');
      assert.equal(screen.overflows(), 0);
    } finally {
      await screen.close();
    }
  });
}

// ---- The single-run finisher drill (single-finisher T08, DESIGN §2.2–§2.12). ----
//
// The new ending as a person meets it, on pir's real screen, against the fake Claude. The scenarios of the
// task doc are chained into four runs, so each size costs four runs rather than ten:
//   clash      the base moved with a clash → a resolve helper asks, answered in its conversation → the
//              finisher ready → the base moves again before the go → preparing, the old Go does nothing →
//              a fresh ready → `Not yet` → the person writes → asked again → Go → finished, main holds the change
//   merged     the base moved cleanly → a sync merge commit, tested → the finisher ready → stopped and resumed
//              from the list while it waits → the finisher back, Go → finished
//   red        the base moved in a way that breaks the tests → the fix helper fails → `✗ not ready` → the base
//              moves again (the breakage reverted) → re-synced green → the finisher ready → the person merges
//              by hand → merged, the finisher closed
//   fallback   a finisher that dies on every start → `● ready to merge` with the hand-merge line → merged by hand
// The happy path with the sync up to date is defineSingleDrill's first test, at the same three sizes.

const RIG_FINISHER_STATUS = (rig) => join(rig.repoDir, 'plans', SINGLE_RIG_NAME, '.parallel', 'single', 'finisher', 'status');
const runDir = (rig) => join(rig.repoDir, 'plans', SINGLE_RIG_NAME, '.parallel', 'single');
const RESOLVE_QUESTION = 'Both sides changed change.txt. Keep both?';
const RED_FIX = 'echo tried >> fix-attempt.txt';
const GIT_ID_SH = "git -c user.name='pir rig' -c user.email=rig@pir.invalid";
const shq = (s) => `'${String(s).replaceAll("'", `'\\''`)}'`;

// commitOnMain(rig, file, text) — the person (or another run) moves the base: one commit on main in the
// scratch repo's main checkout. `text` null removes the file.
function commitOnMain(rig, file, text) {
  if (text === null) git(rig.repoDir, 'rm', '-q', file);
  else {
    writeFileSync(join(rig.repoDir, file), text);
    git(rig.repoDir, 'add', file);
  }
  git(rig.repoDir, '-c', 'user.name=pir rig', '-c', 'user.email=rig@pir.invalid', 'commit', '-q', '-m', `main: ${text === null ? 'remove' : 'change'} ${file}`);
  return git(rig.repoDir, 'rev-parse', 'main');
}

// endScripts(rig, { baseFile, baseText, resolve, fix, finisher }) — rewrite the rig's scripts for the ending:
// the reviewer moves main (one commit of `baseFile`) before its own commit, so the sync finds the base moved;
// the resolve and fix helpers are scripted; the finisher is `finisher` (a finisherScript variant).
function endScripts(rig, { baseFile = null, baseText = '', resolve = null, fix = null, finisher = 'finisher' }) {
  const moveMain = baseFile
    ? [{ sh: `cd ${shq(rig.repoDir)} && printf '%s' ${shq(baseText)} > ${shq(baseFile)} && ${GIT_ID_SH} add ${shq(baseFile)} && ${GIT_ID_SH} commit -q -m ${shq(`main: ${baseFile} moved`)}` }]
    : [];
  const entries = JSON.parse(readFileSync(rig.scriptsFile, 'utf8'))
    .filter((e) => e.match !== SINGLE_FINISHER_MATCH)
    .map((e) => {
      if (e.match !== SINGLE_REVIEWER_MATCH || !moveMain.length) return e;
      const at = e.script.findIndex((st) => typeof st.sh === 'string' && st.sh.includes('review: a fix'));
      return { ...e, script: [...e.script.slice(0, at), ...moveMain, ...e.script.slice(at)] };
    });
  const extra = [{ match: SINGLE_FINISHER_MATCH, script: singleFinisherScript({ name: SINGLE_RIG_NAME, statusDir: RIG_FINISHER_STATUS(rig), repoRoot: rig.repoDir, variant: finisher }) }];
  if (resolve) extra.push({ match: SINGLE_RESOLVE_MATCH, script: singleResolveScript({ name: SINGLE_RIG_NAME, ...resolve }) });
  if (fix) extra.push({ match: SINGLE_FIX_MATCH, script: singleFixScript({ name: SINGLE_RIG_NAME, fix }) });
  writeFileSync(rig.scriptsFile, JSON.stringify([...extra, ...entries]));
}

// onMain(rig) → whether the builder's commit has reached main in the scratch repo's main checkout.
const onMain = (rig) => git(rig.repoDir, 'log', '--format=%s', 'main').split('\n').includes('fix: the fake change');

const listRow = (state, progress = '') => new RegExp(`${SINGLE_RIG_NAME} +single +${esc(state)} +repo +${esc(progress)}`);
const stepsHead = (state) => new RegExp(`^${SINGLE_RIG_NAME} · ${esc(state)} · pir/${SINGLE_RIG_NAME}$`, 'm');

// The style of a cell: [fg, bold] where `text` starts on the screen.
function styleOf(screen, rows, text) {
  const y = rows.findIndex((l) => l.includes(text));
  assert.ok(y >= 0, `${text} is on the screen:\n${rows.join('\n')}`);
  const x = rows[y].indexOf(text);
  return [screen.fgAt(y, x), screen.boldAt(y, x)];
}

// No amber anywhere on the screen except on the rows that hold one of `allowed` (DESIGN §2.11: amber where
// the person is needed and nowhere else). Amber is fg 33 in the basic table.
function assertAmberOnlyOn(screen, rows, allowed) {
  for (let y = 0; y < rows.length; y++) {
    const amber = [...rows[y]].some((_, x) => screen.fgAt(y, x) === '33');
    if (!amber) continue;
    assert.ok(allowed.some((a) => rows[y].includes(a)), `amber on a row that does not want the person: "${rows[y]}"\n${rows.join('\n')}`);
  }
}

// The whole steps view of the run: its four rows, read once the head shows `state`.
async function stepsAt(screen, state) {
  return (await screen.waitFor(stepsHead(state), SLOW)).join('\n');
}

export function defineSingleFinisherDrill([cols, rows]) {
  const at = `${cols}×${rows}`;

  test(`finisher drill at ${at}: a clash resolved after the helper asks; the base moves before the go, the old Go does nothing; Not yet, then Go → finished`, { timeout: 300000 }, async (t) => {
    const rig = rigWithTeardown(t, { scripts: 'single-happy' });
    endScripts(rig, { baseFile: 'change.txt', baseText: 'main side\n', resolve: { question: RESOLVE_QUESTION }, finisher: 'finisher-resync' });
    const screen = rig.openScreen({ cols, rows });
    const lit = openLit(rig, cols, rows);
    try {
      await lit.waitFor(/No runs yet/, SLOW);
      assert.equal(startSingle(rig, 'fix the typo').started, true);

      // The resolve helper asks: the list in amber, the sync row asking, the steps view's footer pointing at it.
      const listAsking = await lit.waitFor(listRow('● asking you', 'build ✓ re'), SLOW);
      assertAmber(lit, listAsking, '● asking you');
      assertAmberOnlyOn(lit, listAsking, ['● asking you', 'waiting for']);
      lit.send(ENTER);
      const litSteps = await lit.waitFor(/sync +resolve +asking you · a question/, SLOW);
      assertAmber(lit, litSteps, 'asking you · a question');
      assertAmberOnlyOn(lit, litSteps, ['asking you']);
      await screen.waitFor(listRow('● asking you'), SLOW);
      screen.send(ENTER);
      const asking = (await screen.waitFor(/pick a step/, SLOW)).join('\n');
      assert.match(asking, /^ {2}✔ review +reviewer +reviewed +\d+:\d\d$/m);
      assert.match(asking, /^[▎ ] ● sync +resolve +asking you · a question +\d+:\d\d$/m, asking);
      assert.match(asking, /^ {2}○ merge +— +waits on sync$/m);
      assert.match(asking, /^● sync — asking you; open it \(→\) to answer$/m);

      // → on sync: the helper's conversation, its question; the first option (Keep both) sent.
      await selectRow(screen, 'sync');
      screen.send(RIGHT);
      const helper = flat(await screen.waitFor(new RegExp(esc(RESOLVE_QUESTION)), SLOW));
      assert.match(helper, /^sync worker \S+ · live/, helper);
      assert.ok(helper.includes(`Resolving the clash on pir/${SINGLE_RIG_NAME}.`), helper);
      screen.send(ENTER);
      await screen.waitFor(/Resolved and committed\./, SLOW);
      screen.send(LEFT);

      // Resolved, tested: the finisher asks for the go, and nothing is merged yet.
      const ready = await stepsAt(screen, 'ready for your go');
      assert.match(ready, /^[▎ ] ✔ sync +— +main brought in · tests green$/m, ready);
      assert.match(ready, /^[▎ ] ● merge +— +◆ finisher {2}waiting for your go$/m, ready);
      const litReady = await lit.waitFor(/◆ finisher {2}waiting for your go/, SLOW);
      assertAmber(lit, litReady, '◆ finisher  waiting for your go');
      assertAmberOnlyOn(lit, litReady, ['waiting for your go', 'ready for your go']);
      // The helper's conversation stays a → away once the sync settled.
      await selectRow(screen, 'sync');
      screen.send(RIGHT);
      await screen.waitFor(/Resolved and committed\./, SLOW);
      screen.send(LEFT);
      await screen.waitFor(/pick a step/, SLOW);
      assert.ok(!onMain(rig), 'nothing is merged before the go');
      await selectRow(screen, 'merge');
      screen.send(RIGHT);
      await screen.waitFor(new RegExp(esc(FINISHER_GO_QUESTION)), SLOW);

      // The base moves before the go: the finisher drops back to preparing, and a Go to the old question
      // does nothing.
      commitOnMain(rig, 'other.txt', 'main moved again\n');
      screen.send(LEFT);
      // The finisher is back in `preparing` with its old question still open, which the build finisher's row
      // reads as `asking you` (display.mjs finisherRow), amber: the session cannot go on until it is answered.
      // While the base comes in the head reads `syncing` and the sync row `bringing in main`; once settled:
      const prep = await screen.waitFor((x) => /◆ finisher {2}asking you/.test(x) && /✔ sync/.test(x), SLOW);
      assert.match(prep.join('\n'), stepsHead('asking you'));
      assert.match(prep.join('\n'), /^[▎ ] ● merge +— +◆ finisher {2}asking you$/m);
      const litPrep = await lit.waitFor(/◆ finisher {2}asking you/, SLOW);
      assertAmber(lit, litPrep, '◆ finisher  asking you');
      screen.send(RIGHT);
      await screen.waitFor(new RegExp(esc(FINISHER_GO_QUESTION)), SLOW);
      screen.send(ENTER);
      const stale = flat(await screen.waitFor((x) => flat(x.split('\n')).includes(FINISHER_RECHECKED), SLOW));
      // pir's word to the finisher; at 20 rows it has scrolled off above the fresh question, so the log is read.
      if (rows >= 24) assert.ok(stale.includes('That Go does not count'), stale);
      const finLog = readFileSync(join(runDir(rig), 'conversations', 'finisher-1.ndjson'), 'utf8');
      assert.ok(finLog.includes('That Go does not count'), 'pir told the finisher the old Go does not count');
      assert.ok(!onMain(rig), 'the old Go merged nothing');

      // A fresh ready, answered `Not yet`: nothing happens until the person writes.
      await screen.waitFor((x) => (x.match(new RegExp(esc(FINISHER_GO_QUESTION), 'g')) ?? []).length >= 1 && flat(x.split('\n')).includes(FINISHER_RECHECKED), SLOW);
      screen.send(DOWN);
      await typeSettled(screen, ENTER);
      await screen.waitFor((x) => flat(x.split('\n')).includes(FINISHER_NOT_YET), SLOW);
      screen.send(LEFT);
      const notYet = await stepsAt(screen, 'ready for your go');
      assert.match(notYet, /◆ finisher {2}waiting for your go$/m, notYet);
      assert.ok(!onMain(rig), 'Not yet merged nothing');
      screen.send(RIGHT);
      await screen.waitFor(/live/, SLOW);
      await typeSettled(screen, 'Ask me again, please.');
      screen.send(ENTER);
      await screen.waitFor((x) => flat(x.split('\n')).includes(FINISHER_ASKING_AGAIN), SLOW);
      screen.send(ENTER);
      await screen.waitFor(/Done: merged and installed\./, SLOW);
      screen.send(LEFT);
      const ended = await stepsAt(screen, 'finished');
      assert.match(ended, /✔ merge +— +merged$/m);
      assert.ok(onMain(rig), 'main holds the change');
      lit.send(LEFT);
      const listEnd = await lit.waitFor(listRow('◌ finished', 'build ✓ re'), SLOW);
      assertAmberOnlyOn(lit, listEnd, []);
      assert.deepEqual([screen.overflows(), lit.overflows()], [0, 0], 'no line ran past the frame');
    } finally {
      await screen.close();
      await lit.close();
    }
  });
  // The sync is up to date here: a resume after a sync that merged re-syncs the finisher (DESIGN §2.10), which a
  // real finisher answers with a fresh `ready`, and the fake, resuming at its open question, cannot.
  test(`finisher drill at ${at}: stopped and resumed from the list while the finisher waits for the go; the same finisher back, Go → finished`, { timeout: 300000 }, async (t) => {
    const rig = rigWithTeardown(t, { scripts: 'single-happy' });
    endScripts(rig, {});
    const screen = rig.openScreen({ cols, rows });
    const lit = openLit(rig, cols, rows);
    try {
      await lit.waitFor(/No runs yet/, SLOW);
      assert.equal(startSingle(rig, 'fix the typo').started, true);
      const listReady = await lit.waitFor(listRow('● ready for your go', 'build ✓ re'), SLOW);
      assertAmber(lit, listReady, '● ready for your go');
      assertAmberOnlyOn(lit, listReady, ['● ready for your go', 'waiting for']);
      await screen.waitFor(listRow('● ready for your go'), SLOW);
      screen.send(ENTER);
      const ready = await stepsAt(screen, 'ready for your go');
      assert.match(ready, /^[▎ ] ✔ sync +— +up to date · tests green$/m, ready);
      assert.match(ready, /^[▎ ] ● merge +— +◆ finisher {2}waiting for your go$/m, ready);
      // → on sync: pir checked main itself, with no helper.
      await selectRow(screen, 'sync');
      screen.send(RIGHT);
      await screen.waitFor(/sync has no session — pir brought main in itself\./, SLOW);

      // Stopped from the list while the finisher waits for the go, then resumed.
      screen.send(LEFT);
      await screen.waitFor(listRow('● ready for your go'), SLOW);
      screen.send(CTRL_S);
      await screen.waitFor(new RegExp(`Ctrl\\+S again to stop ${SINGLE_RIG_NAME}`), SLOW);
      screen.send(CTRL_S);
      const stopped = (await screen.waitFor(listRow('◼ stopped'), SLOW)).join('\n');
      assert.match(stopped, /1 run · 0 running · 0 finished · 0 crashed · 1 stopped$/m, stopped);
      assert.ok(!onMain(rig), 'nothing merged by the stop');
      screen.send(ENTER);
      const stale = await stepsAt(screen, 'stopped');
      assert.match(stale, /^[▎ ] ✗ merge +— +stopped$/m, stale);
      assert.ok(flat(stale.split('\n')).includes('— stopped · this frame is stale. Ctrl+R Ctrl+R on the list resumes it.'), stale);
      screen.send(LEFT);
      await screen.waitFor(listRow('◼ stopped'), SLOW);
      screen.send(CTRL_R);
      await screen.waitFor(new RegExp(`Ctrl\\+R again to resume ${SINGLE_RIG_NAME}`), SLOW);
      screen.send(CTRL_R);
      await screen.waitFor(listRow('● ready for your go'), SLOW);
      screen.send(ENTER);
      await stepsAt(screen, 'ready for your go');
      await selectRow(screen, 'merge');
      screen.send(RIGHT);
      // The finisher is the same session, reopened: its go question asked again after the resume.
      // At 20 rows the resume marker scrolls off, so the log says it was resumed, and the screen that it is live.
      const finLog = join(runDir(rig), 'conversations', 'finisher-1.ndjson');
      await until(() => readFileSync(finLog, 'utf8').split('\n').some((l) => l.includes('"kind":"resumed"')), 'the finisher resumed in its own log', SLOW);
      const back = flat(await screen.waitFor((x) => /· live/.test(x) && /Ready to finish\?/.test(x) && /finisher asks you 1 question/.test(x), SLOW));
      if (rows >= 24) assert.match(back, /resumed/, back);
      assert.match(back, /^finisher agent \S+ · live/, back);
      screen.send(ENTER);
      await screen.waitFor(/Done: merged and installed\./, SLOW);
      screen.send(LEFT);
      const ended = await stepsAt(screen, 'finished');
      assert.match(ended, /✔ merge +— +merged$/m);
      assert.ok(onMain(rig), 'main holds the change');
      assert.deepEqual([screen.overflows(), lit.overflows()], [0, 0], 'no line ran past the frame');
    } finally {
      await screen.close();
      await lit.close();
    }
  });

  test(`finisher drill at ${at}: red after the sync → the fix helper cannot fix it → not ready; the base moves → re-synced green → the finisher; a merge by hand ends it merged`, { timeout: 300000 }, async (t) => {
    const rig = rigWithTeardown(t, { scripts: 'single-happy' });
    endScripts(rig, { baseFile: SINGLE_RED_FILE, baseText: 'red\n', fix: RED_FIX });
    const screen = rig.openScreen({ cols, rows });
    const lit = openLit(rig, cols, rows);
    try {
      await lit.waitFor(/No runs yet/, SLOW);
      assert.equal(startSingle(rig, 'fix the typo').started, true);
      const listRed = await lit.waitFor(listRow('✗ not ready', 'build ✓ re'), SLOW);
      assert.equal(styleOf(lit, listRed, '✗ not ready')[0], '31', 'not ready is red, not amber');
      assertAmberOnlyOn(lit, listRed, []);
      assert.doesNotMatch(listRed.join('\n'), /waiting for/, 'a red wait is not counted as waiting for the person');
      lit.send(ENTER);
      const litSteps = await lit.waitFor(/not ready · tests red/, SLOW);
      assertAmberOnlyOn(lit, litSteps, []);
      await screen.waitFor(listRow('✗ not ready'), SLOW);
      screen.send(ENTER);
      const red = await stepsAt(screen, 'not ready');
      assert.match(red, /^[▎ ] ✗ sync +— +not ready · tests red$/m, red);
      assert.match(red, /^[▎ ] ✗ merge +— +not ready · tests red$/m, red);
      assert.doesNotMatch(red, /git switch/, 'no merge is offered');
      // → on sync: the fix helper's conversation, its one attempt.
      await selectRow(screen, 'sync');
      screen.send(RIGHT);
      const fix = flat(await screen.waitFor(/Fixed and committed\./, SLOW));
      assert.match(fix, /the tests failed: test `test ! -f red\.txt` exited 1\./, fix);
      screen.send(LEFT);
      await screen.waitFor(/pick a step/, SLOW);

      // The person reverts the breakage on main: pir sees the base move, re-syncs, and the tests are green.
      commitOnMain(rig, SINGLE_RED_FILE, null);
      const ready = await stepsAt(screen, 'ready for your go');
      assert.equal(git(rig.repoDir, 'log', '-1', '--format=%s', `pir/${SINGLE_RIG_NAME}`), `sync main into pir/${SINGLE_RIG_NAME}`, 'a sync merge commit');
      assert.match(ready, /^[▎ ] ✔ sync +— +main brought in · tests green$/m, ready);
      assert.match(ready, /^[▎ ] ● merge +— +◆ finisher {2}waiting for your go$/m, ready);
      const litReady = await lit.waitFor(/◆ finisher {2}waiting for your go/, SLOW);
      assertAmber(lit, litReady, '◆ finisher  waiting for your go');

      // The person merges by hand instead of saying go: merged, the finisher closed.
      git(rig.repoDir, '-c', 'user.name=pir rig', '-c', 'user.email=rig@pir.invalid', 'merge', '-q', '--no-edit', `pir/${SINGLE_RIG_NAME}`);
      const ended = await stepsAt(screen, 'merged');
      assert.match(ended, /✔ merge +— +merged$/m, ended);
      screen.send(LEFT);
      const list = (await screen.waitFor(listRow('◌ merged', 'build ✓ re'), SLOW)).join('\n');
      assert.match(list, /1 run · 0 running · 1 finished · 0 crashed$/m);
      await until(() => readFileSync(join(runDir(rig), 'run.log'), 'utf8').includes('finisher closed'), 'the finisher closed', SLOW);
      assert.deepEqual([screen.overflows(), lit.overflows()], [0, 0], 'no line ran past the frame');
    } finally {
      await screen.close();
      await lit.close();
    }
  });

  test(`finisher drill at ${at}: the base moved cleanly → a sync merge commit, tested; a finisher that dies on every start → ready to merge with the hand-merge line; merged by hand`, { timeout: 300000 }, async (t) => {
    const rig = rigWithTeardown(t, { scripts: 'single-happy' });
    endScripts(rig, { baseFile: 'other.txt', baseText: 'main moved\n', finisher: 'finisher-exits' });
    const screen = rig.openScreen({ cols, rows });
    const lit = openLit(rig, cols, rows);
    try {
      await lit.waitFor(/No runs yet/, SLOW);
      assert.equal(startSingle(rig, 'fix the typo').started, true);
      const listReady = await lit.waitFor(listRow('● ready to merge', 'build ✓ re'), SLOW);
      assertAmber(lit, listReady, '● ready to merge');
      assert.match(listReady.join('\n'), /1 run · 0 running · 0 finished · 0 crashed · 1 waiting for/);
      await screen.waitFor(listRow('● ready to merge'), SLOW);
      screen.send(ENTER);
      const steps = await stepsAt(screen, 'ready to merge');
      const line = `git switch main && git merge pir/${SINGLE_RIG_NAME}`;
      // Where the row is too narrow for it, the hand-off note under the rows holds the whole command.
      if (cols < 80) assert.match(steps, new RegExp(`^Hand-off: ${esc(line)}$`, 'm'), steps);
      else assert.doesNotMatch(steps, /Hand-off:/, 'said once where the row holds it whole');
      // Too wide for the row at 60 columns, it ends at a word with `…` (user 2026-10-03).
      assert.match(steps, new RegExp(`^[▎ ] ● merge +— +${cols >= 80 ? esc(line) : 'git switch main && git merge…'}$`, 'm'), steps);
      assert.match(steps, /^[▎ ] ✔ sync +— +main brought in · tests green$/m, steps);
      assert.equal(git(rig.repoDir, 'log', '-1', '--format=%s', `pir/${SINGLE_RIG_NAME}`), `sync main into pir/${SINGLE_RIG_NAME}`, 'a sync merge commit');
      lit.send(ENTER);
      const litSteps = await lit.waitFor(/git switch main/, SLOW);
      assertAmber(lit, litSteps, 'git switch main');
      git(rig.repoDir, '-c', 'user.name=pir rig', '-c', 'user.email=rig@pir.invalid', 'merge', '-q', '--no-edit', `pir/${SINGLE_RIG_NAME}`);
      const ended = await stepsAt(screen, 'merged');
      assert.match(ended, /✔ merge +— +merged$/m, ended);
      assert.deepEqual([screen.overflows(), lit.overflows()], [0, 0], 'no line ran past the frame');
    } finally {
      await screen.close();
      await lit.close();
    }
  });
}
