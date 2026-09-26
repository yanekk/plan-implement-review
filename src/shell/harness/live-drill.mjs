#!/usr/bin/env node
// The live screen drill (live-workers T18): the real `pir` screen, under a pseudo-terminal, driving a real
// run of the live-workers-demo practice plan, the way the person would. It is the machine's half of the
// T18 hand-over: every key the person's drill asks for is pressed here first, and every screen is saved,
// so what the person is asked to judge has already been seen working.
//
//   node src/shell/harness/live-drill.mjs --into <trusted scratch> [--out <screens file>] [--only T03,T04]
//
// It installs the fixture into the scratch folder, opens `pir live-workers-demo` there under a pty (which
// starts the run, PARALLEL_MAX_WORKERS=2), and then, every two seconds, reads the workers' conversation
// logs and does the one thing each task needs (nextAction): Esc on T01 while its 90 s pause runs, then a
// typed instruction; Enter on T02's permission; the single-choice question on T01 with ↓ Enter; the
// pick-several and typed-answer questions on T03; `go` to T04, which waits for it, and a look at T04 while
// its background work runs. `--only` marks the other tasks done first, so a rerun drills just those. It ends
// when the run's live view shows the green hand-off, or on its own deadline (15 min), and then stops the
// run with Ctrl+S twice if it is still going. Paid: a whole small plan of real workers (DESIGN §5.3,
// `T18 end-to-end run`, bin `ask`).

import { existsSync, readdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { workerActivity } from '../../core/stream.mjs';
import { installFixture } from './fixtures.mjs';
import { parseLog, parseLogName } from './capture.mjs';
import { openScreen } from '../conversation-rig.mjs';

const SLUG = 'live-workers-demo';
const PAUSE_MARK = 'setTimeout(() => {}, 90000)';
export const INTERRUPT_TEXT = 'Skip the pause and carry on with the task.';
export const TYPED_NAME = 'Typed in the drill';

// taskViews(logs) → { Txx: { role, state, pending, pausing } } from the latest log of each task: the
// worker's activity (stream.mjs workerActivity) and whether its pause command is running (a tool use of the
// pause with no result yet). Pure.
export function taskViews(logs) {
  const latest = {};
  for (const { file, entries } of logs) {
    const p = parseLogName(file);
    if (!p) continue;
    const prev = latest[p.task];
    const order = (x) => (x.role === 'review' ? 1000 : 0) + x.n;
    if (!prev || order(p) > order(prev)) latest[p.task] = { ...p, entries };
  }
  const out = {};
  for (const [task, { role, entries }] of Object.entries(latest)) {
    const activity = workerActivity(entries);
    const pauseIds = new Set();
    const resultIds = new Set();
    for (const e of entries) {
      for (const b of e?.event?.message?.content ?? []) {
        if (b?.type === 'tool_use' && String(b.input?.command ?? '').includes(PAUSE_MARK)) pauseIds.add(b.id);
        if (b?.type === 'tool_result') resultIds.add(b.tool_use_id);
      }
    }
    const pausing = [...pauseIds].some((id) => !resultIds.has(id));
    const exited = entries.some((e) => e?.dir === 'note' && e.kind === 'exited');
    out[task] = { role, state: exited ? 'exited' : activity.state, pending: activity.pending, pausing };
  }
  return out;
}

// nextAction(views, done) → the next thing to do on the screen, or null. `done` is the set of actions
// already taken, so each happens once. The order is the order a person would meet them in. Pure.
export function nextAction(views, done = new Set()) {
  const v = (t) => views[t] ?? {};
  const pendingOf = (t, kind) => (v(t).pending ?? []).find((r) => r.kind === kind);
  if (!done.has('interrupt') && v('T01').role === 'implement' && v('T01').pausing) return { id: 'interrupt', task: 'T01' };
  for (const t of ['T01', 'T02', 'T03', 'T04']) {
    const perm = pendingOf(t, 'permission');
    if (perm && !done.has(`permission:${perm.requestId}`)) return { id: `permission:${perm.requestId}`, task: t, kind: 'permission' };
    const qs = pendingOf(t, 'questions');
    if (qs && !done.has(`questions:${qs.requestId}`)) return { id: `questions:${qs.requestId}`, task: t, kind: 'questions', request: qs };
  }
  // T04 waits for the person's go (user 2026-09-26) before it starts its background work.
  if (!done.has('go') && v('T04').role === 'implement' && v('T04').state === 'idle') return { id: 'go', task: 'T04' };
  if (done.has('go') && !done.has('watch-background') && v('T04').role === 'implement' && v('T04').state === 'idle') return { id: 'watch-background', task: 'T04' };
  return null;
}

// The keys that answer one question set on the picker: a pick-several question ticks its first and last
// option; a question naming a name is answered on its Other line with TYPED_NAME; any other pick-one
// question takes its second option with ↓ Enter (one Enter answers it, user 2026-09-26). Each step is
// { keys, until } for the screen. Pure.
export function questionKeys(request) {
  const DOWN = '\x1b[B';
  const UP = '\x1b[A';
  const steps = [];
  const qs = request.questions ?? [];
  qs.forEach((q, i) => {
    const last = i === qs.length - 1;
    const after = last ? /answer sent|→/ : new RegExp(escape(qs[i + 1].question));
    if (q.multiSelect) {
      steps.push({ keys: ' ', until: /\[x\]/ });
      for (let k = 1; k < q.options.length; k++) steps.push({ keys: DOWN });
      steps.push({ keys: ' ' });
      steps.push({ keys: '\r', until: after });
    } else if (/name/i.test(q.question)) {
      steps.push({ keys: UP, until: /❯ .*Other/ });
      steps.push({ keys: '\r' });
      steps.push({ keys: TYPED_NAME, until: new RegExp(escape(TYPED_NAME)) });
      steps.push({ keys: '\r', until: new RegExp(`Other: ${escape(TYPED_NAME)}`) });
      steps.push({ keys: '\r', until: after });
    } else {
      steps.push({ keys: DOWN });
      steps.push({ keys: '\r', until: after });
    }
  });
  return steps;
}

const escape = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function readLogs(controlDir) {
  const dir = join(controlDir, 'conversations');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => parseLogName(f))
    .map((file) => {
      try {
        return { file, entries: parseLog(readFileSync(join(dir, file), 'utf8')) };
      } catch {
        return { file, entries: [] };
      }
    });
}

// markDoneExcept(into, keep) → marks every task of the installed practice plan not in `keep` ✅ and
// commits that on main, so a rerun drills only the tasks named (user 2026-09-26: rerun T03 and T04).
export function markDoneExcept(into, keep) {
  const path = join(into, 'plans', SLUG, 'PROGRESS.md');
  const text = readFileSync(path, 'utf8').replace(/^\| (T\d\d) \|(.*)\| ⬜ \|/gm, (row, id, mid) => (keep.includes(id) ? row : `| ${id} |${mid}| ✅ |`));
  writeFileSync(path, text);
  const git = (...args) => execFileSync('git', ['-c', 'user.name=PIR Fixture', '-c', 'user.email=fixture@pir.local', '-c', 'commit.gpgsign=false', ...args], { cwd: into, stdio: 'pipe' });
  git('commit', '-qam', `drill: only ${keep.join(', ')}`);
}

async function main(argv) {
  const into = argv[argv.indexOf('--into') + 1];
  if (!argv.includes('--into') || !into) throw new Error('usage: live-drill.mjs --into <trusted scratch> [--out <file>]');
  const out = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : join(into, '..', `live-drill-${Date.now()}.txt`);
  writeFileSync(out, '');
  const shot = (label, rows) => appendFileSync(out, `\n===== ${label} =====\n${rows.join('\n')}\n`);
  const say = (line) => {
    console.log(line);
    appendFileSync(out, `\n# ${line}\n`);
  };

  installFixture(SLUG, { into });
  if (argv.includes('--only')) markDoneExcept(into, argv[argv.indexOf('--only') + 1].split(','));
  const controlDir = join(into, 'plans', SLUG, '.parallel', 'control');
  const screen = openScreen({ cols: 100, rows: 34, args: [SLUG], cwd: into, env: { ...process.env, PARALLEL_MAX_WORKERS: '2' } });
  const LEFT = '\x1b[D';
  const RIGHT = '\x1b[C';
  const DOWN = '\x1b[B';
  const UP = '\x1b[A';

  // Move the run view's selection bar onto `task` and open its worker.
  async function openTask(task) {
    await screen.waitFor(/pick a task/, 30000);
    for (let i = 0; i < 8; i++) {
      const sel = screen.text().split('\n').find((l) => l.startsWith('▎'));
      const at = sel?.match(/T\d\d/)?.[0];
      if (at === task) break;
      screen.send(at && at > task ? UP : DOWN);
      await screen.waitFor(null, 5000);
    }
    screen.send(RIGHT);
    return screen.waitFor(new RegExp(`^${task}  worker`, 'm'), 15000);
  }
  async function back() {
    screen.send(LEFT);
    await screen.waitFor(/pick a task/, 15000);
  }

  const done = new Set();
  const deadline = Date.now() + 15 * 60 * 1000;
  let result = 'deadline';
  try {
    shot('opening', await screen.waitFor(/live-workers-demo/, 30000));
    while (Date.now() < deadline) {
      if (/git merge pir\/live-workers-demo/.test(screen.text())) {
        result = 'green hand-off';
        break;
      }
      if (/Not ready to merge/.test(screen.text())) {
        result = 'red';
        break;
      }
      const action = nextAction(taskViews(readLogs(controlDir)), done);
      if (!action) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      done.add(action.id);
      say(`action ${action.id} on ${action.task}`);
      shot(`${action.task} open`, await openTask(action.task));
      if (action.id === 'interrupt') {
        screen.send('\x1b');
        shot('after Esc', await screen.waitFor(/⎋ interrupted the worker/, 15000));
        screen.send(INTERRUPT_TEXT);
        await screen.waitFor(new RegExp(escape(INTERRUPT_TEXT)), 5000);
        screen.send('\r');
        shot('instruction sent', await screen.waitFor(/you ▸ Skip the pause/, 15000));
      } else if (action.kind === 'permission') {
        shot('permission pinned', await screen.waitFor(/↵ allow · n refuse/, 15000));
        screen.send('\r');
        shot('after Enter', await screen.waitFor(/answer sent|→ allowed/, 15000));
      } else if (action.kind === 'questions') {
        shot('picker pinned', await screen.waitFor(/asks you/, 15000));
        for (const step of questionKeys(action.request)) {
          screen.send(step.keys);
          shot(`key ${JSON.stringify(step.keys)}`, await screen.waitFor(step.until ?? null, 15000));
        }
      } else if (action.id === 'go') {
        shot('T04 waiting for go', await screen.waitFor(/T04 ▸ .*[Rr]eady/, 15000));
        screen.send('go');
        await screen.waitFor(/^go\s*$/m, 5000);
        screen.send('\r');
        shot('go sent', await screen.waitFor(/you ▸ go/, 15000));
      } else if (action.id === 'watch-background') {
        // The worker is between turns with its commands and monitor still going: the view must say so
        // (user 2026-09-26), not look idle.
        shot('T04 while its background work runs', await screen.waitFor(/◌ \d running in the background/, 15000));
      }
      await back();
    }
    shot(`end: ${result}`, screen.text().split('\n'));
  } catch (e) {
    say(`drill failed: ${e.message}`);
    result = 'failed';
  } finally {
    if (!/git merge pir\/live-workers-demo|Not ready to merge/.test(screen.text())) {
      // Stop the run (Ctrl+S twice in the live view) so no paid worker outlives the drill.
      try {
        screen.send(LEFT);
        await screen.waitFor(null, 3000);
        screen.send('\x13');
        screen.send('\x13');
        await screen.waitFor(null, 5000);
      } catch {
        /* the HALT below still stops it */
      }
      writeFileSync(join(controlDir, 'HALT'), 'live drill stop\n');
    }
    await screen.close();
  }
  say(`result: ${result}; screens in ${out}`);
  process.exit(result === 'green hand-off' ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
