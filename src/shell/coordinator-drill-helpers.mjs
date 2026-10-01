// Shared by the coordinator-drill-*.test.mjs files (fast-tests T03, DESIGN §2.4): the drill used to be one
// file whose six tests ran one after another; each drill × size is now its own file so node runs them side by
// side. The three drills are defined here once, taking the window size, and each file calls one of them for
// one size. Not a test file itself.
//
// The coordinator drill (pir-coordinator T07, DESIGN §2.3–§2.10 as seen on screen): the whole flow on the
// real `pir` screen, as the person would use it, at 80×24 and 120×40. `pir start drill` in the planning rig
// runs the real coordinator command, the real coordinator-agent session and three real worker sessions,
// each on the fake claude (fake/sessions.mjs drillScripts): T01's routine request is allowed by the agent,
// T02's force-push is the person's at once, T03's question is passed on with the agent's pointer. The person
// answers both in the workers' conversations, talks to the agent, and the run ends in `ready to merge`.
// The same plan with --no-coordinator must read as it did before this plan.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startPlanRig } from './plan-rig.mjs';
import { indexDir, listRecords } from './index-store.mjs';
import { stopRun } from './control-run.mjs';
import { waitFor } from './conversation-rig-helpers.mjs';
import { selectRow } from './plan-rig-helpers.mjs';
import { DRILL_QUESTION, DRILL_SLUG, HELPER_DRILL_QUESTION, HELPER_DRILL_SLUG } from './fake/sessions.mjs';

const RIGHT = '\x1b[C';
const LEFT = '\x1b[D';
const ENTER = '\r';
// A sentence the conversation view may wrap at any space, and indent on the next line.
const said = (text) => new RegExp(text.split(' ').map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'));
const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();
// The ceiling for a wait on the run's spawned programs. The first asks wait on the whole run starting: pir
// spawns the coordinator, which adds a worktree per task and spawns the agent and three workers (each a fake
// claude), and every one of them must start and reach its ask. On a machine busy with the other test files that
// alone has taken all of 30 s, so these waits, and those on the agent's replies, get a minute.
const SPAWNED_MS = 60000;

function drillRig(t, scripts = 'coordinator-drill') {
  const rig = startPlanRig({ scripts });
  t.after(async () => {
    for (const record of listRecords({ dir: indexDir({ env: rig.env }) })) {
      if (record.finalState === null) await stopRun(record).catch(() => {});
    }
    await rig.settle();
    rig.cleanup();
  });
  return rig;
}

// Every frame the screen shows, sampled far faster than a pass, so a row that reads a label for one pass
// only is still caught (the drill's claim is "never", so the sample must be dense).
function recordFrames(screen) {
  const frames = [];
  let last = '';
  const iv = setInterval(() => {
    const now = screen.text();
    if (now !== last) frames.push((last = now));
  }, 20);
  return { frames, stop: () => clearInterval(iv) };
}

const rowOf = (text, task) => text.split('\n').find((l) => new RegExp(`^[▎ ] . ${task} `).test(l)) ?? null;

// The coordinator agent's pinned row (T12): the separator line straight above it, and the row itself.
const AGENT_ROW = /^[▎ ] ◆ coordinator agent +(on duty|holding \d+ questions?|restarting|given up · questions come to you)$/m;
function assertAgentRow(text, what) {
  const lines = text.split('\n');
  const i = lines.findIndex((l) => AGENT_ROW.test(l));
  assert.ok(i > 0, `the agent's row is on screen ${what}:\n${text}`);
  assert.match(lines[i - 1], /^ {2}─{20,}$/, `the separator is straight above the agent's row ${what}:\n${text}`);
  return lines[i];
}

// Move the run view's cursor (▎) to `task` (selectRow: each key waited for, so a loaded machine's late frame
// cannot make the walk overshoot).
const select = selectRow;

// The coordinator drill proper: agent answers, passes on, the person answers and talks to it.
export function coordinatorDrill(cols, rows) {
  test(`coordinator drill at ${cols}×${rows}: agent answers, passes on, the person answers and talks to it, ready to merge`, { timeout: 180000 }, async (t) => {
    const rig = drillRig(t);
    const screen = rig.openScreen({ cols, rows, args: ['start', DRILL_SLUG] });
    const rec = recordFrames(screen);
    try {
      // 1–3. All three ask. T02's force-push is the person's from the first frame it asks; T03's question is
      // the agent's until it passes it; T01's routine request is allowed without the person.
      await screen.waitFor(/T02 +reserved-ask +asking you · allow a command\?/, SPAWNED_MS);
      let s = (await screen.waitFor(/T03 +passed-question +asking you · a question/, SPAWNED_MS)).join('\n');
      await screen.waitFor((x) => /T01 +routine-ask +(building|reviewing|merging|merged)/.test(x), SPAWNED_MS);
      s = screen.text();
      assert.match(s, /2 asking you/, 'the header counts the two the person holds, not T01');
      assert.match(s, /c coordinator/, 'the hint offers the agent');
      // T12: the agent's own row, below the tasks and a separator; T03 above it, nothing below it yet.
      assertAgentRow(s, 'during the build');
      assert.ok(s.indexOf(rowOf(s, 'T03')) < s.indexOf('◆ coordinator agent'), 'the tasks come first');

      // T12: ↓ reaches the agent's row (stepping over the separator) and → opens its conversation.
      await select(screen, 'coordinator');
      screen.send(RIGHT);
      s = (await screen.waitFor(/^coordinator +agent [0-9a-f]{8} · live/m)).join('\n');
      screen.send(LEFT);
      await screen.waitFor(/c coordinator/);
      await select(screen, 'T01');

      // The agent's conversation: what it allowed, both pointers, each naming where to answer.
      screen.send('c');
      s = (await screen.waitFor(said("Answer it in T03's conversation; I would keep it."))).join('\n');
      assert.match(s, /^coordinator +agent [0-9a-f]{8} · live/m, 'the header names the coordinator agent, not a worker');
      assert.match(s, said("Allowed T01's request: a read-only git command."));
      assert.match(s, said('T02 wants to force-push its task branch, and that is yours'));
      assert.match(s, said("Answer it in T02's conversation; I would allow it."));

      // 4. The person gives the agent an instruction and sees it delivered.
      screen.send("don't approve new tasks tonight");
      await screen.waitFor(/don't approve new tasks tonight/);
      screen.send(ENTER);
      await screen.waitFor(/Noted: don't approve new tasks tonight/, SPAWNED_MS);
      screen.send(LEFT);
      await screen.waitFor(/c coordinator/);

      // 3. The person answers T02 and T03 in their own conversations; each row goes back to work.
      await select(screen, 'T02');
      screen.send(RIGHT);
      await screen.waitFor(/git push --force origin HEAD/);
      screen.send(ENTER);
      await screen.waitFor(/→ allowed/);
      screen.send(LEFT);
      await screen.waitFor((x) => !/T02 +reserved-ask +asking/.test(x) && /c coordinator/.test(x), SPAWNED_MS);

      await select(screen, 'T03');
      screen.send(RIGHT);
      await screen.waitFor(new RegExp(DRILL_QUESTION.replace(/\?/g, '\\?')));
      screen.send(ENTER);
      await screen.waitFor(/→ Keep it/);
      screen.send(LEFT);
      await screen.waitFor((x) => !/T03 +passed-question +asking/.test(x) && /c coordinator/.test(x), SPAWNED_MS);

      // 5. The end: preparing while main is synced and the report written, then the finisher takes over.
      s = (await screen.waitFor(/preparing: syncing main, writing the report\n/, 60000)).join('\n');

      // finisher T05: the pass after ready closes the agent and starts the finisher. The agent's hand-off
      // carries no merge line, and its row and `c` go with it. finisher T07: the finisher's row takes the
      // agent's place and the footer points at `c`. The drill's fake has no finisher script (T09 adds it),
      // so it stays `preparing`.
      // The `ready to merge` frame in between is not waited for: settling ready wakes the loop (fast-tests
      // DESIGN §2.3), so the hand-over pass runs one pass gap (250 ms) later, inside the screen's 500 ms refresh.
      s = (await screen.waitFor((x) => !AGENT_ROW.test(x) && !/c coordinator/.test(x) && /◆ finisher +preparing/.test(x), 60000)).join('\n');
      for (const task of ['T01', 'T02', 'T03']) assert.match(rowOf(s, task) ?? '', /merged/, `${task} merged`);
      assert.ok(git(rig.repoDir, 'show', `pir/${DRILL_SLUG}:plans/${DRILL_SLUG}/REPORT.md`).length > 0, 'the report is committed on the feature branch');
      assert.match(s, /◆ finisher preparing · c to watch/);
      assert.match(s, /c finisher/);
      assert.doesNotMatch(s, /git merge/, 'no merge line beside the finisher');
      const conv = join(rig.repoDir, 'plans', DRILL_SLUG, '.parallel', 'control', 'conversations');
      const readAgentLog = () => readdirSync(conv).filter((f) => f.startsWith('coordinator-')).map((f) => readFileSync(join(conv, f), 'utf8')).join('\n');
      // The hand-over closes the agent gracefully (worker-proc close: input ended, SIGTERM only after its
      // grace), and its reply to the hand-off lands inside that grace, after the finisher's row is already
      // drawn. Under load that is later than this frame, so the log is waited for, not read once.
      const agentLog = await waitFor(() => {
        const log = readAgentLog();
        return /The branch is ready\. The finisher takes the merge from here\./.test(log) ? log : null;
      }, { what: "the agent's reply to the hand-off", timeoutMs: SPAWNED_MS }).catch(() => readAgentLog());
      assert.match(agentLog, /The branch is ready\. The finisher takes the merge from here\./);
      assert.doesNotMatch(agentLog, /Merge it yourself/);
      assert.ok(readdirSync(conv).some((f) => f.startsWith('finisher-')), 'the finisher was started');
      screen.send(LEFT);
      s = (await screen.waitFor(/drill +work +● running/)).join('\n');
      assert.doesNotMatch(s, /ready to merge/, 'the finisher is working, not waiting on the person');
      screen.send(RIGHT);
      await screen.waitFor(/◆ finisher +preparing/);

      rec.stop();
      // PIR_DRILL_DUMP=<prefix> writes every frame to <prefix>-{cols}x{rows}.txt, for judging them by eye.
      if (process.env.PIR_DRILL_DUMP) writeFileSync(`${process.env.PIR_DRILL_DUMP}-${cols}x${rows}.txt`, rec.frames.join("\n==========\n"));
      // "Never" and "at once", over every frame the screen showed.
      for (const f of rec.frames) {
        assert.doesNotMatch(rowOf(f, 'T01') ?? '', /asking you/, `T01's routine request never reached the person:\n${f}`);
        assert.doesNotMatch(rowOf(f, 'T02') ?? '', /asking coordinator/, `T02's force-push was never the agent's:\n${f}`);
        assert.doesNotMatch(f, /◆ coordinator agent.*\d+:\d\d$/m, `the agent's row has no clock:\n${f}`);
        for (const r of f.split('\n')) assert.ok([...r].length <= cols, `a line wider than ${cols}: ${r}`);
      }
      assert.ok(rec.frames.some((f) => /T03 +passed-question +asking coordinator/.test(rowOf(f, 'T03') ?? '')), 'T03 was the agent\'s before it passed it');
      assert.ok(rec.frames.some((f) => /◆ coordinator agent +holding [12] questions?$/m.test(f)), 'the agent\'s row counted what it held');
      assert.equal(screen.overflows(), 0, 'no frame was clipped to fit the window');

      // What the run left behind: the ledger names each decision, the report is on the feature branch.
      const ledger = readFileSync(join(rig.repoDir, 'plans', DRILL_SLUG, '.parallel', 'control', 'coordinator', 'ledger.jsonl'), 'utf8')
        .trim().split('\n').map((l) => JSON.parse(l));
      assert.deepEqual(ledger.map((l) => [l.task, l.kind]).sort(), [['T01', 'permission'], ['T02', 'pass'], ['T03', 'pass']]);
      const report = git(rig.repoDir, 'show', `pir/${DRILL_SLUG}:plans/${DRILL_SLUG}/REPORT.md`);
      assert.match(report, /## What was delivered\n\nThe three drill tasks\./);
    } finally {
      rec.stop();
      await screen.close();
    }
  });
}

// Both sizes, as the flow above (T07 review: the task names 80×24 and 120×40 for every step, step 6 too).
export function noCoordinatorDrill(cols, rows) {
  test(`coordinator drill with --no-coordinator at ${cols}×${rows}: every request is the person's and the end is today's`, { timeout: 180000 }, async (t) => {
    const rig = drillRig(t);
    const screen = rig.openScreen({ cols, rows, args: ['start', DRILL_SLUG, '--no-coordinator'] });
    try {
      let s = (await screen.waitFor(/3 asking you/, SPAWNED_MS)).join('\n');
      assert.match(s, /T01 +routine-ask +asking you · allow a command\?/);
      assert.match(s, /T02 +reserved-ask +asking you · allow a command\?/);
      assert.match(s, /T03 +passed-question +asking you · a question/);
      assert.doesNotMatch(s, /coordinator/, 'no agent, no mention of one');
      assert.doesNotMatch(s, /─{10}|◆/, 'no separator and no agent row (T12)');

      for (const [task, until, answered] of [['T01', /git status --short/, /→ allowed/], ['T02', /git push --force/, /→ allowed/], ['T03', /drill log be kept/, /→ Keep it/]]) {
        await select(screen, task);
        screen.send(RIGHT);
        await screen.waitFor(until);
        screen.send(ENTER);
        await screen.waitFor(answered);
        screen.send(LEFT);
        await screen.waitFor(/pick a task/);
      }
      s = (await screen.waitFor(/git merge pir\/drill/, 90000)).join('\n');
      assert.doesNotMatch(s, /ready to merge|preparing|REPORT\.md/, 'the end is today\'s: no hand-off, no report');
      assert.doesNotMatch(s, /─{10}|◆|coordinator/, 'no separator and no agent row at the end either (T12)');
      assert.equal(screen.overflows(), 0);
    } finally {
      await screen.close();
    }
  });
}

// The end-of-run helper's row (pir-coordinator T11): the one-task plan's tests are red at the end, so the
// run spawns its tests-fix helper. The helper asks a question, the agent passes it on, and the person finds
// the helper as a row below the tasks, opens it with → and answers there, as for any task. The helper then
// commits the fix, the run settles `ready to merge` and the finisher takes over (finisher T05).
export function endHelperDrill(cols, rows) {
  test(`end-helper drill at ${cols}×${rows}: the tests-fix helper's passed-on question is answered from its row in pir`, { timeout: 180000 }, async (t) => {
    const rig = drillRig(t, 'end-helper');
    const screen = rig.openScreen({ cols, rows, args: ['start', HELPER_DRILL_SLUG] });
    const rec = recordFrames(screen);
    try {
      let s = (await screen.waitFor(/tests-fix +fix-red-tests +asking you · a question/, 60000)).join('\n');
      // T12: while a helper runs, the agent's row sits between the tasks and the helper.
      assertAgentRow(s, 'while a helper runs');
      assert.ok(s.indexOf('◆ coordinator agent') < s.indexOf(rowOf(s, 'tests-fix')), 'the helper is below the agent');
      assert.ok(s.indexOf(rowOf(s, 'T01')) < s.indexOf('◆ coordinator agent'), 'the task is above it');
      s = (await screen.waitFor(/● tests-fix fix-red-tests — asking you; open it \(→\) to answer/, SPAWNED_MS)).join('\n');
      assert.match(s, /1\/1 done/, 'the header counts the plan task only');

      // The agent's pointer names the helper's conversation.
      screen.send('c');
      await screen.waitFor(said("Answer it in tests-fix's conversation; I would add the file."), SPAWNED_MS);
      screen.send(LEFT);
      await screen.waitFor(/c coordinator/);

      // The person walks down to the helper's row, opens it and answers there.
      await select(screen, 'tests-fix');
      screen.send(RIGHT);
      await screen.waitFor(new RegExp(HELPER_DRILL_QUESTION.replace(/[.?]/g, '\\$&')));
      screen.send(ENTER);
      await screen.waitFor(/→ Add it/);
      screen.send(LEFT);

      // The `ready to merge` frame is one pass gap long (see the coordinator drill), so the end waited for is
      // the finisher's row in the agent's place.
      s = (await screen.waitFor((x) => !AGENT_ROW.test(x) && /◆ finisher +preparing/.test(x), 60000)).join('\n');
      assert.equal(rowOf(s, 'tests-fix'), null, 'the helper\'s row is gone once it has finished');
      assert.doesNotMatch(s, /git merge/, 'no merge line beside the finisher');
      assert.match(rowOf(s, 'T01') ?? '', /merged/);

      rec.stop();
      if (process.env.PIR_DRILL_DUMP) writeFileSync(`${process.env.PIR_DRILL_DUMP}-helper-${cols}x${rows}.txt`, rec.frames.join('\n==========\n'));
      const withHelper = rec.frames.filter((f) => rowOf(f, 'tests-fix'));
      assert.ok(withHelper.length > 0, 'the helper had a row');
      assert.ok(withHelper.some((f) => /asking coordinator/.test(rowOf(f, 'tests-fix'))), 'the question was the agent\'s before it passed it');
      for (const f of rec.frames) {
        assert.doesNotMatch(f, /\/2 done/, `the helper is never counted as a task:\n${f}`);
        for (const r of f.split('\n')) assert.ok([...r].length <= cols, `a line wider than ${cols}: ${r}`);
      }
      assert.equal(screen.overflows(), 0, 'no frame was clipped to fit the window');
      assert.equal(git(rig.repoDir, 'show', `pir/${HELPER_DRILL_SLUG}:fixed.txt`), 'ok', 'the helper committed its fix on the feature branch');
    } finally {
      rec.stop();
      await screen.close();
    }
  });
}
