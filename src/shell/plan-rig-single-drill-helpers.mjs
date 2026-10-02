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
import { BUILDER_MATCH, FINISHER_GO_QUESTION, FINISHER_SUMMARY, singleBuilderScript } from './fake/sessions.mjs';
import { indexDir, listRecords } from './index-store.mjs';
import { SINGLE_HINT } from './list-view.mjs';
import { writeNotifyConfig } from './notify-config.mjs';
import { SINGLE_RIG_DROP_ASK, SINGLE_RIG_NAME, SINGLE_RIG_QUESTION, SINGLE_RIG_TAKEN } from './plan-rig.mjs';
import { DOWN, ENTER, LEFT, RIGHT, UP, boxText, esc, git, headOf, lastLine, rigWithTeardown, typeSettled, until } from './plan-rig-helpers.mjs';

// A machine busy with the other test files stretches every wait.
const SLOW = 60000;
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
