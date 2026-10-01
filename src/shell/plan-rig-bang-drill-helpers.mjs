// The bang drill (bang-commands T08, DESIGN §2 whole, §2.5 in particular): the person's `!` and a command an
// agent hands them, used on the real `pir` screen in each kind of session a run holds, against the real hosts
// (plan-run.mjs, single-run.mjs, coordinate.mjs) on the fake claude. A build worker's `!` and hand request are
// the conversation rig's (defineBangTest, defineHandTest, T06/T07); here are the planner (`!`, a hand request,
// Esc), a single run's builder (`!`), and a build with the coordinator agent on: a worker's hand request is the
// person's at once and the agent only notes it, and the agent's own `!` runs in the feature worktree. Each size
// is its own test file (plan-rig-bang-drill-{size}.test.mjs) so node runs them side by side. Not a test file.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join, sep } from 'node:path';
import { BANG_HAND_COMMAND, BANG_HAND_REASON, BANG_HAND_REPLY, BANG_HAND_SLUG, BANG_REPLY } from './fake/sessions.mjs';
import { indexDir, listRecords } from './index-store.mjs';
import { BRIEF, ENTER, LEFT, RIGHT, DOWN, UP, git, ndjson, rigWithTeardown, typeSettled, until } from './plan-rig-helpers.mjs';

// A machine busy with the other test files stretches every wait.
const SLOW = 60000;
const ESC = '\x1b';
// A sentence the conversation view may wrap at any space.
const said = (text) => new RegExp(text.split(' ').map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'));
// The screen with every space and line break taken out, so a long path the view wrapped still reads whole.
const squeezed = (screen) => screen.text().replace(/\s+/g, '');

function convLog(controlDir, prefix) {
  const dir = join(controlDir, 'conversations');
  const f = readdirSync(dir).find((n) => n.startsWith(prefix) && n.endsWith('.ndjson'));
  return f ? ndjson(join(dir, f)) : [];
}
const shellEntries = (log, kind) => log.filter((e) => e.dir === 'shell' && e.kind === kind);
const liveRecord = (rig) => listRecords({ dir: indexDir({ env: rig.env }) }).find((r) => r.finalState === null) ?? null;

// PIR_DRILL_DUMP=<prefix> appends the screen at each checkpoint to <prefix>-bang-{cols}x{rows}.txt, for judging
// the frames by eye against DESIGN §2.8 and the prototype.
function snap(screen, cols, rows, what) {
  if (process.env.PIR_DRILL_DUMP) appendFileSync(`${process.env.PIR_DRILL_DUMP}-bang-${cols}x${rows}.txt`, `==== ${what}\n${screen.text()}\n`);
}

function assertFits(screen, cols) {
  for (const r of screen.text().split('\n')) assert.ok([...r].length <= cols, `a line wider than ${cols}: ${r}`);
  assert.equal(screen.overflows(), 0, 'no frame was clipped to fit the window');
}

// `! pwd` in the open conversation: the block names the folder and ends `sent to {label}`; the log's start entry
// carries the same folder. Returns that folder (realpath).
async function bangPwd(screen, { log, label, reply }) {
  screen.send('! pwd');
  await screen.waitFor(/^! pwd\s*$/m);
  screen.send(ENTER);
  const sent = new RegExp(`✓ exit 0 · \\d+s · sent to ${label}`);
  await screen.waitFor((x) => sent.test(x) && reply.test(x.slice(x.lastIndexOf('you ! pwd'))), SLOW);
  const start = await until(() => shellEntries(log(), 'start').find((e) => e.command === 'pwd'), 'the start entry');
  const end = await until(() => shellEntries(log(), 'end').find((e) => e.id === start.id), 'the end entry');
  assert.deepEqual([end.code, end.sent], [0, 'message']);
  const output = shellEntries(log(), 'output').filter((e) => e.id === start.id).map((e) => e.text).join('').trim();
  assert.equal(realpathSync(output), realpathSync(start.cwd), 'pwd printed the folder it ran in');
  assert.ok(squeezed(screen).includes(output), `the block shows the folder ${output}:\n${screen.text()}`);
  const out = log().find((e) => e.dir === 'out' && e.shell === start.id);
  assert.match(out?.text ?? '', /^\[pir\] The person ran a command in your working folder:\n\$ pwd\nexit 0 · \d+s\n/, 'one message, from the person');
  assert.equal(out.from, 'person');
  return realpathSync(start.cwd);
}

export function defineBangDrill([cols, rows]) {
  const at = `${cols}×${rows}`;

  test(`bang drill, planner at ${at}: ! runs in the planning worktree, a handed command is run from its pin, Esc stops a command`, { timeout: 180000 }, async (t) => {
    const rig = rigWithTeardown(t, { scripts: 'bang-plan' });
    const screen = rig.openScreen({ cols, rows, args: ['plan', BRIEF] });
    try {
      await screen.waitFor(said("I'm the drill's pretend planner."), SLOW);
      const record = await until(() => liveRecord(rig), 'the planning run');
      const log = () => convLog(record.controlDir, 'plan-');

      // `!` in the planner's conversation: the block names the planning worktree, the planner answers.
      const cwd = await bangPwd(screen, { log, label: 'plan', reply: new RegExp(`plan ▸ ${BANG_REPLY.replace('.', '\\.')}`) });
      snap(screen, cols, rows, 'planner: after ! pwd');
      assert.ok(cwd.startsWith(realpathSync(rig.repoDir) + sep + join('.claude', 'worktrees')), `a worktree of the repo: ${cwd}`);
      assert.match(git(cwd, 'branch', '--show-current'), /^pir\//, 'on the planning branch');

      // The planner hands the person a command: pinned, and the step's row asks.
      let s = await screen.waitFor(/^! plan asks you to run a command\s*$/m, SLOW);
      snap(screen, cols, rows, 'planner: the hand pin');
      assert.doesNotMatch(s.join('\n'), /hand_command/, "the hand tool's own step is not drawn");
      let y = s.findIndex((l) => /^! plan asks you to run a command/.test(l));
      assert.match(s[y + 1], new RegExp(`^ {2}${BANG_HAND_COMMAND}\\s*$`));
      assert.match(s.slice(y + 2).join(' '), said(`why: ${BANG_HAND_REASON}`));
      screen.send(LEFT);
      s = await screen.waitFor(/pick a step/);
      snap(screen, cols, rows, 'planner: the steps view while it asks');
      assert.match(s.join('\n'), /plan +planner +asking you · run a command/);
      screen.send(RIGHT);
      await screen.waitFor(/^! plan asks you to run a command\s*$/m);
      screen.send(ENTER);
      s = await screen.waitFor(new RegExp(`plan ▸ ${BANG_HAND_REPLY.replace(/\./g, '\\.')}`), SLOW);
      snap(screen, cols, rows, 'planner: the hand answered');
      assert.doesNotMatch(s.join('\n'), /hand_command/, "the hand tool's own step is not drawn");
      const asked = s.findIndex((l) => /^! plan asked you to run: printf handed/.test(l));
      assert.ok(asked >= 0, s.join('\n'));
      assert.deepEqual(s.slice(asked + 1, asked + 3).map((l) => l.trimEnd()), ['you ! printf handed', '  handed']);
      assert.doesNotMatch(s.join('\n'), /^! plan asks you to run a command/m, 'nothing pinned once answered');
      const handStart = shellEntries(log(), 'start').find((e) => e.requestId);
      assert.equal(realpathSync(handStart.cwd), cwd, 'the handed command ran in the planning worktree too');
      assert.equal(shellEntries(log(), 'end').find((e) => e.id === handStart.id).sent, 'answer');

      // A long command, stopped with Esc: the planner gets `stopped by the person` and answers.
      screen.send('! sleep 30');
      await screen.waitFor(/^! sleep 30\s*$/m);
      screen.send(ENTER);
      await screen.waitFor(/● running your command · \d+s · esc stops it/, SLOW);
      snap(screen, cols, rows, 'planner: running');
      screen.send(ESC);
      await screen.waitFor(/✗ stopped by you · \d+s · sent to plan/, SLOW);
      snap(screen, cols, rows, 'planner: stopped');
      await until(() => log().filter((e) => e.dir === 'out' && e.shell && /stopped by the person/.test(e.text)).length === 1, 'the stopped message');
      assert.equal(log().filter((e) => e.dir === 'out' && e.kind === 'interrupt').length, 0, 'the planner was never interrupted');
      screen.send(LEFT);
      s = await screen.waitFor(/pick a step/);
      // An idle planner reads as asking (it waits on the person's words), but no longer for a command.
      assert.doesNotMatch(s.join('\n'), /run a command/, 'the step no longer asks for the command');
      assertFits(screen, cols);
    } finally {
      await screen.close();
    }
  });

  test(`bang drill, single run's builder at ${at}: ! runs in the single run's worktree`, { timeout: 180000 }, async (t) => {
    const rig = rigWithTeardown(t, { scripts: 'bang-single' });
    const screen = rig.openScreen({ cols, rows });
    try {
      await screen.waitFor(/new {2}start with @repo/, SLOW);
      await typeSettled(screen, 'repo/single ', 'fix the typo');
      screen.send(ENTER);
      await screen.waitFor(said("I'm the drill's pretend builder."), SLOW);
      const record = await until(() => liveRecord(rig), 'the single run');
      const log = () => convLog(record.controlDir, 'build-');
      const cwd = await bangPwd(screen, { log, label: 'build', reply: new RegExp(`build ▸ ${BANG_REPLY.replace('.', '\\.')}`) });
      assert.ok(cwd.startsWith(realpathSync(rig.repoDir) + sep + join('.claude', 'worktrees')), `a worktree of the repo: ${cwd}`);
      snap(screen, cols, rows, 'single builder: after ! pwd');
      assert.match(git(cwd, 'branch', '--show-current'), /^pir\/single-/, "on the single run's branch");
      assertFits(screen, cols);
    } finally {
      await screen.close();
    }
  });

  test(`bang drill, build with the coordinator agent at ${at}: a worker's handed command is the person's at once, the agent's ! runs in the feature worktree`, { timeout: 180000 }, async (t) => {
    const rig = rigWithTeardown(t, { scripts: 'bang-build' });
    const screen = rig.openScreen({ cols, rows, args: ['start', BANG_HAND_SLUG] });
    const frames = [];
    const iv = setInterval(() => {
      const now = screen.text();
      if (now !== frames.at(-1)) frames.push(now);
    }, 20);
    const rowOf = (text) => text.split('\n').find((l) => /^[▎ ] . T01 /.test(l)) ?? '';
    try {
      let s = (await screen.waitFor(/T01 +hand-ask +asking you · run a command/, SLOW)).join('\n');
      snap(screen, cols, rows, 'build: T01 asks');
      assert.match(s, /1 asking you/);
      const controlDir = join(rig.repoDir, 'plans', BANG_HAND_SLUG, '.parallel', 'control');
      const agentLog = () => convLog(controlDir, 'coordinator-');

      // The agent's conversation: its note on the handed command, and no answer to it.
      screen.send('c');
      s = (await screen.waitFor(said('T01 handed you a command to run, and only you run it.'), SLOW)).join('\n');
      snap(screen, cols, rows, "build: the agent's note");
      assert.match(s, /^coordinator +agent [0-9a-f]{8} · live/m);
      assert.doesNotMatch(s, /Allowed T01/);

      // The agent's own `!`: in the feature worktree, and the agent receives it.
      const cwd = await bangPwd(screen, { log: agentLog, label: 'coordinator', reply: said('Noted: [pir] The person ran a command in your working folder:') });
      snap(screen, cols, rows, "build: the agent's ! pwd");
      assert.equal(git(cwd, 'branch', '--show-current'), `pir/${BANG_HAND_SLUG}`, 'the feature worktree');

      // T01's conversation: the pin, run with Enter; the worker gets the result and goes on.
      screen.send(LEFT);
      await screen.waitFor(/c coordinator/);
      for (const key of [null, ...Array(4).fill(UP), ...Array(4).fill(DOWN)]) {
        if (key) {
          screen.send(key);
          await screen.waitFor();
        }
        if (rowOf(screen.text()).startsWith('▎')) break;
      }
      assert.ok(rowOf(screen.text()).startsWith('▎'), `T01 selected:\n${screen.text()}`);
      screen.send(RIGHT);
      await screen.waitFor(/^! T01 asks you to run a command\s*$/m, SLOW);
      snap(screen, cols, rows, "build: T01's pin");
      assert.doesNotMatch(screen.text(), /hand_command/, "the hand tool's own step is not drawn");
      screen.send(ENTER);
      await screen.waitFor(new RegExp(`T01 ▸ ${BANG_HAND_REPLY.replace(/\./g, '\\.')}`), SLOW);
      screen.send(LEFT);
      await screen.waitFor((x) => /T01 +hand-ask/.test(x) && !/T01 +hand-ask +asking/.test(x), SLOW);

      clearInterval(iv);
      for (const f of frames) {
        assert.doesNotMatch(rowOf(f), /asking coordinator/, `T01's handed command was never the agent's:\n${f}`);
        for (const r of f.split('\n')) assert.ok([...r].length <= cols, `a line wider than ${cols}: ${r}`);
      }
      assert.equal(screen.overflows(), 0, 'no frame was clipped to fit the window');
      // The agent noted it and decided nothing: its ledger holds one pass for T01, no answer.
      const ledger = readFileSync(join(controlDir, 'coordinator', 'ledger.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
      assert.deepEqual(ledger.filter((l) => l.task === 'T01').map((l) => l.kind), ['pass']);
    } finally {
      clearInterval(iv);
      await screen.close();
    }
  });
}
