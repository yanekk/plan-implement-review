// A single run on the real `pir` screen (single-runs T10, DESIGN §2.8, §2.9, §2.11): its row through every
// state, its steps view, the `merged` check against a real merge, and stop, resume and remove. The rig's
// seatbelts hold: a scratch repo, a scratch home, the fake `claude` first on PATH.
//
// The fake sessions and the rig's test line are instant, so a state would be gone between two frames. Each
// test paces them: a sleep before a session's commit, and a slower test line through the scratch home's
// settings file, which overrides the repo's key by key (DESIGN §2.2).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BUILDER_MATCH, SINGLE_RED_FILE, SINGLE_REVIEWER_MATCH } from './fake/sessions.mjs';
import { indexDir, listRecords } from './index-store.mjs';
import { startSingle, SINGLE_RIG_NAME } from './plan-rig.mjs';
import { CTRL_S, ENTER, LEFT, RIGHT, SIZES, esc, git, ndjson, rigWithTeardown } from './plan-rig-helpers.mjs';

const SKIP_T07 = "skip: T07 — waits for the old 'ready to merge' row, which a single run no longer reaches since single-finisher T05; T07 re-enables it";

const PROMPT = 'Fix the typo in the README\n\nand nothing else';
const LABEL = '"Fix the typo in the REA…"';
const CTRL_R = '\x12';
const CTRL_X = '\x18';
// A machine busy with the other test files stretches every wait.
const SLOW = 60000;

// pace(rig, { buildMs, fixMs, reviewMs, testSeconds }) — hold the builder before its commit, before its fix of
// a red run, the reviewer before its commit, and make each of pir's test runs last `testSeconds`.
function pace(rig, { buildMs = 0, fixMs = 0, reviewMs = 0, testSeconds = 0 } = {}) {
  const before = (script, marker, ms) => {
    const at = script.findIndex((st) => typeof st.sh === 'string' && st.sh.includes(marker));
    assert.ok(at >= 0, `the script has a step committing "${marker}"`);
    return ms > 0 ? [...script.slice(0, at), { sleep: ms }, ...script.slice(at)] : script;
  };
  const entries = JSON.parse(readFileSync(rig.scriptsFile, 'utf8')).map((e) => {
    if (e.match === BUILDER_MATCH) {
      let script = before(e.script, 'fix: the fake change', buildMs);
      if (fixMs > 0) script = before(script, 'fix: make the tests pass', fixMs);
      return { ...e, script };
    }
    if (e.match === SINGLE_REVIEWER_MATCH) return { ...e, script: before(e.script, 'review: a fix', reviewMs) };
    return e;
  });
  writeFileSync(rig.scriptsFile, JSON.stringify(entries));
  if (testSeconds > 0) {
    const dir = join(rig.home, '.pir', 'repo');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ test: [`sleep ${testSeconds} && test ! -f ${SINGLE_RED_FILE}`] }) + '\n');
  }
}

// The dashboard open at both sizes on one run: two readers of the same files (docs/detached-runs.md).
function openBoth(rig) {
  const screens = SIZES.map(([cols, rows]) => ({ size: `${cols}×${rows}`, screen: rig.openScreen({ cols, rows }) }));
  return {
    // Every screen shows `until`; resolves to each screen's text, in SIZES order.
    all: (until, limit = SLOW) => Promise.all(screens.map(async ({ size, screen }) => {
      try {
        return (await screen.waitFor(until, limit)).join('\n');
      } catch (err) {
        throw new Error(`${size}: ${err.message}`);
      }
    })),
    send: (bytes) => screens.forEach(({ screen }) => screen.send(bytes)),
    overflows: () => screens.map(({ screen }) => screen.overflows()),
    close: () => Promise.all(screens.map(({ screen }) => screen.close())),
  };
}

// From the list to the list again through a chord pressed twice.
async function chordTwice(screen, key, armed, then, limit = SLOW) {
  screen.send(key);
  await screen.waitFor(armed, limit);
  screen.send(key);
  return (await screen.waitFor(then, limit)).join('\n');
}

const recordsOf = (rig) => listRecords({ dir: indexDir({ env: rig.env }) });

test('end to end at 80×24 and 120×40: single-happy — the row goes building, testing, reviewing, testing, ready to merge; the steps view hands the merge over; the merge turns it merged', { skip: SKIP_T07 }, async (t) => {
  const rig = rigWithTeardown(t, { scripts: 'single-happy' });
  pace(rig, { buildMs: 4000, reviewMs: 4000, testSeconds: 4 });
  const both = openBoth(rig);
  try {
    await both.all(/No runs yet/);
    const started = startSingle(rig, PROMPT);
    assert.equal(started.started, true, JSON.stringify(started));

    // The row, state by state. Before the rename it is named by its label; the builder's tests run before it.
    const building = await both.all(new RegExp(`${esc(LABEL)} +single +● building +repo +build … +1`));
    for (const text of building) assert.match(text, /SLUG +TYPE +STATE +REPO +PROGRESS +WK/);
    for (const text of building) assert.match(text, /1 run · 1 running · 0 finished · 0 crashed$/m);
    await both.all(new RegExp(`${esc(LABEL)} +single +● testing +repo +build · tests …`));
    await both.all(new RegExp(`${SINGLE_RIG_NAME} +single +● reviewing +repo +build ✓ review … +1`));
    await both.all(new RegExp(`${SINGLE_RIG_NAME} +single +● testing +repo +build ✓ review · tests …`));
    const ready = await both.all(new RegExp(`${SINGLE_RIG_NAME} +single +● ready to merge +repo +build ✓ review ✓ +·`));
    for (const text of ready) assert.match(text, /1 run · 0 running · 0 finished · 0 crashed · 1 waiting for you/, 'ready to merge waits on the person');

    // Open the row: both steps done, and the merge row is the hand-off.
    both.send(ENTER);
    const steps = await both.all(/pick a step/);
    for (const text of steps) {
      assert.match(text, new RegExp(`^${SINGLE_RIG_NAME} · ready to merge · pir/${SINGLE_RIG_NAME}$`, 'm'));
      assert.match(text, /^▎ ✔ build +builder +built +\d+:\d\d$/m);
      assert.match(text, /^ {2}✔ review +reviewer +reviewed +\d+:\d\d$/m);
      assert.match(text, new RegExp(`^ {2}● merge +— +git switch main && git merge pir/${SINGLE_RIG_NAME}$`, 'm'));
      assert.doesNotMatch(text, /Ctrl\+S/, 'a finished run offers no stop');
    }
    // → on the build row: the builder's conversation, read only.
    both.send(RIGHT);
    const conv = await both.all(/read only/);
    for (const text of conv) {
      assert.match(text, /^build +worker \w+ · (finished|exited), read only/m);
      assert.match(text, /I read the change that was asked for\./);
      assert.match(text, /The change is committed; reported built as rig-fix\./);
    }
    both.send(LEFT);
    await both.all(/pick a step/);

    // The person's merge, by hand, in the scratch repo: within the check interval the run reads merged.
    const mainBefore = git(rig.repoDir, 'rev-parse', 'main');
    git(rig.repoDir, 'merge', '-q', `pir/${SINGLE_RIG_NAME}`);
    assert.notEqual(git(rig.repoDir, 'rev-parse', 'main'), mainBefore);
    const merged = await both.all(new RegExp(`^${SINGLE_RIG_NAME} · merged · pir/${SINGLE_RIG_NAME}$`, 'm'), 45000);
    for (const text of merged) {
      assert.match(text, /^ {2}✔ merge +— +merged$/m);
      assert.doesNotMatch(text, /git switch/);
    }
    both.send(LEFT);
    const list = await both.all(new RegExp(`${SINGLE_RIG_NAME} +single +◌ merged +repo +build ✓ review ✓`));
    for (const text of list) {
      assert.match(text, /1 run · 0 running · 1 finished · 0 crashed$/m, 'a merged run is finished and no longer waits');
      assert.doesNotMatch(text, /waiting for you/);
    }
    assert.deepEqual(both.overflows(), [0, 0], 'nothing wraps at either size');
  } finally {
    await both.close();
  }
});

test('end to end at 80×24 and 120×40: single-red — the steps view shows testing…, then tests red · round 1, then the build green', { skip: SKIP_T07 }, async (t) => {
  const rig = rigWithTeardown(t, { scripts: 'single-red' });
  pace(rig, { buildMs: 1500, fixMs: 5000, reviewMs: 500, testSeconds: 2 });
  const both = openBoth(rig);
  try {
    await both.all(/No runs yet/);
    assert.equal(startSingle(rig, PROMPT).started, true);
    await both.all(new RegExp(`${esc(LABEL)} +single +● `));
    both.send(ENTER);
    const testing = await both.all(/^▎ \S build +builder +testing… +\d+:\d\d$/m);
    for (const text of testing) {
      assert.match(text, new RegExp(`^${esc(LABEL)} · testing · pir/single-[0-9a-f]{4}$`, 'm'));
      assert.match(text, /^ {2}○ review +reviewer +waits on build$/m);
      assert.match(text, /^ {2}○ merge +— +waits on review$/m);
      assert.match(text, /Ctrl\+S Ctrl\+S stop this run/);
      assert.doesNotMatch(text, /asking you/, 'a session waiting on pir\'s tests is not asking');
    }
    // The red run went back to the builder, who is at work on it.
    const red = await both.all(/^▎ \S build +builder +tests red · round 1 +\d+:\d\d$/m);
    for (const text of red) assert.match(text, new RegExp(`^${esc(LABEL)} · building · pir/single-`, 'm'));
    // Then green: the build step is done and the reviewer takes over under the builder's name.
    // The build reads `built` from the moment the rename starts, but the header keeps the label until the
    // rename's last sub-step (the index entry) is done; on a loaded machine a frame lands in between. So wait
    // for the frame that shows both, rather than asserting the name on the first `built` frame.
    await both.all(new RegExp(`^${SINGLE_RIG_NAME} · [\\s\\S]*^▎ ✔ build +builder +built +\\d+:\\d\\d$`, 'm'));
    await both.all(new RegExp(`● merge +— +git switch main && git merge pir/${SINGLE_RIG_NAME}$`, 'm'));
    both.send(LEFT);
    await both.all(new RegExp(`${SINGLE_RIG_NAME} +single +● ready to merge +repo +build ✓ review ✓`));
    assert.deepEqual(both.overflows(), [0, 0]);
  } finally {
    await both.close();
  }
});

test('end to end at 120×40: Ctrl+S twice stops a running single run, Ctrl+R twice resumes it into the same conversation, Ctrl+X twice removes it and the branch stays', async (t) => {
  const rig = rigWithTeardown(t, { scripts: 'single-asks' });
  const screen = rig.openScreen({ cols: 120, rows: 40 });
  try {
    await screen.waitFor(/No runs yet/, SLOW);
    const started = startSingle(rig, PROMPT);
    assert.equal(started.started, true);
    const branch = `pir/${started.runId}`;
    const row = new RegExp(`${esc(LABEL)} +single +`);
    // The builder parks on its question: a running run that stays put.
    const asking = (await screen.waitFor(new RegExp(`${row.source}● asking you +repo +build … +1`), SLOW)).join('\n');
    assert.match(asking, /1 run · 0 running · 0 finished · 0 crashed · 1 waiting for you/);

    // Ctrl+X is not offered on a running run; Ctrl+S twice stops it.
    screen.send(CTRL_X);
    assert.doesNotMatch((await screen.waitFor()).join('\n'), /Ctrl\+X again/);
    await chordTwice(screen, CTRL_S, new RegExp(`Ctrl\\+S again to stop ${started.runId} now`), new RegExp(`${row.source}◼ stopped +repo +build …`));
    screen.send(ENTER);
    const stopped = (await screen.waitFor(/this frame is stale/, SLOW)).join('\n');
    assert.match(stopped, new RegExp(`^${esc(LABEL)} · stopped · ${branch}$`, 'm'));
    assert.match(stopped, /^▎ ✗ build +builder +stopped$/m);
    assert.match(stopped, /^— stopped · this frame is stale\. Ctrl\+R Ctrl\+R on the list resumes it\.$/m);
    assert.doesNotMatch(stopped, /Ctrl\+S Ctrl\+S stop this run/);
    screen.send(LEFT);
    await screen.waitFor(/SLUG/);

    // Ctrl+R twice: the same session is reopened, in the conversation it left.
    await chordTwice(screen, CTRL_R, new RegExp(`Ctrl\\+R again to resume ${esc(LABEL)}`), new RegExp(`${row.source}● (building|asking you)`));
    screen.send(ENTER);
    await screen.waitFor(/pick a step/, SLOW);
    screen.send(RIGHT);
    // A → before the resumed program's first snapshot opens it read only; pir turns it live on a later refresh
    // (reliveWorker), so the live header is waited for with the resume message, not read from the first frame.
    const resumed = (await screen.waitFor((x) => /You were stopped and have been resumed/.test(x) && /^build +worker \w+ · live/m.test(x), SLOW)).join('\n');
    assert.match(resumed, /^build +worker \w+ · live/m, 'the resumed session is live, not read only');
    // The conversation it left is the one it is back in: the question it had open (lost with the old
    // process) is above the resume, not in a second log.
    assert.match(resumed, /\? build asks you 1 question\n +→ never answered[\s\S]*· resumed/);
    const argvs = ndjson(rig.received).filter((x) => x.argv).map((x) => x.argv);
    assert.equal(argvs.length, 2, 'two processes: the builder, and the builder resumed');
    const [sessionId] = JSON.parse(readFileSync(join(started.controlDir, 'state.json'), 'utf8')).sessions.build;
    assert.ok(argvs[1].includes(`--resume=${sessionId}`), `the builder's own session is reopened: ${argvs[1].join(' ')}`);
    assert.ok(!argvs[0].some((a) => a.startsWith('--resume')), 'the first start was a fresh session');
    assert.equal(existsSync(join(started.controlDir, 'conversations', 'build-2.ndjson')), false, 'no second conversation');
    screen.send(LEFT);
    await screen.waitFor(/pick a step/, SLOW);
    screen.send(LEFT);
    await screen.waitFor(/SLUG/);

    // Stop it again, then Ctrl+X twice removes the row; the branch and its worktree stay.
    await chordTwice(screen, CTRL_S, /Ctrl\+S again to stop/, new RegExp(`${row.source}◼ stopped`));
    screen.send(CTRL_S);
    assert.doesNotMatch((await screen.waitFor()).join('\n'), /Ctrl\+S again/, 'a stopped run offers no stop');
    const gone = await chordTwice(screen, CTRL_X, new RegExp(`Ctrl\\+X again to remove ${started.runId}'s record`), /No runs yet/);
    assert.doesNotMatch(gone, /single/);
    assert.deepEqual(recordsOf(rig), []);
    assert.notEqual(git(rig.repoDir, 'branch', '--list', branch), '', 'the branch stays');
    assert.ok(existsSync(join(started.record.repoPath, '.claude', 'worktrees', `pir-${started.runId}`)), 'and its worktree');
    assert.equal(screen.overflows(), 0);
  } finally {
    await screen.close();
  }
});
