// coordinate.mjs — the entry the `pir-coordinate` skill drives (DESIGN §2.1–§2.9, §3.2 loop.mjs).
// It is the production coordinator: it wires the reviewed loop (loop.mjs, T05) to the REAL platform
// (spawn/list/close + messaging, T08) and the REAL worktree (feature/task branches, T06), and gives
// the skill the three verbs the skill cannot get from the loop alone — run one pass, route a user's
// answer down to a parked worker, and defer a task to ⛔. loop.mjs already turns decideDispatch into
// spawns, reviews, merges, closes and the one promotion; this module is the thin conversational
// wrapper around it plus the plan-reviewed refusal and the `pir coordinate {slug}` bin.
//
// The controller is injected with its platform and worktree, exactly as runPass is, so the whole of
// dispatch/surfacing/routing is proven against the fakes in coordinate.test.mjs (DESIGN §4) and the
// same code runs the live CLI + git in the bin below.
//
// The one thing this module does NOT do itself is move message bytes. There is no `claude` subcommand
// that sends a cross-session message — SendMessage is an agent tool (platform.mjs header, FINDINGS
// 2026-09-08) — so a Node process cannot deliver an answer to a worker or receive a worker's question.
// The wire format and addressing live here (via platform.send / platform.inbox, which own the wire);
// the actual send/receive is bridged to the coordinator AGENT through files (createAgentBridge), and
// the skill is what performs SendMessage and hands received messages back. In the tests the fake
// platform IS the bus, so the bridge is not exercised there — its live behaviour is T10's hand-verify.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { parseProgress, reconcileTaskRow, progressPathFor } from '../core/progress.mjs';
import { workerName, coordinatorName } from '../core/naming.mjs';
import { runPass, createRunState } from './loop.mjs';
import { createPlatform } from './platform.mjs';
import { createWorktree } from './worktree.mjs';

const DONE_GLYPH = '✅';
const READY_GLYPH = '⬜';
const BLOCKED_GLYPH = '⛔';

// The phase the loop parks a worker in when it is waiting on the user (loop.mjs AWAITING). Kept here
// so answer() can clear the parked decision it resolves.
const AWAITING = 'awaiting-answer';

// --- The plan-reviewed gate (DESIGN §2.1) -----------------------------------------------------
//
// The coordinator refuses to start on a plan whose PROGRESS.md has not been reviewed, exactly as
// pir-work does: an unreviewed plan copies its defects into every task, and running many at once
// multiplies that. This reads the file (so it is shell, not core) and delegates the actual verdict to
// the pure parseProgress gate, which is conservative — anything short of a positive "reviewed" note
// (missing line, empty note, "not yet …") reads as not reviewed.
export function readReviewGate(slug, { root = process.cwd() } = {}) {
  const path = join(root, progressPathFor(slug));
  if (!existsSync(path)) {
    return { reviewed: false, note: '', missing: true };
  }
  const { planReviewed } = parseProgress(readFileSync(path, 'utf8'));
  return { reviewed: planReviewed.reviewed, note: planReviewed.note, missing: false };
}

// --- Plain-English surfacing (DESIGN §2.2, §2.5) ----------------------------------------------
//
// The loop emits `surface` actions — a worker's question, an unresolved merge conflict, a red feature
// branch, a promotion that will not merge. The user owns every one of these decisions, and CLAUDE.md
// requires the coordinator to put them to the user in ordinary words. renderSurface turns one action
// into a message the skill relays verbatim; the skill presents them one at a time (DESIGN §2.5).
function renderSurface(a) {
  const who = a.task ? `The worker on ${a.task}` : 'The coordinator';
  let message;
  switch (a.kind) {
    case 'question':
      message = `${who} needs a decision from you: ${a.text}`;
      break;
    case 'conflict':
      message = `${who} hit a merge conflict it could not resolve on its own: ${a.text}. It is waiting for you.`;
      break;
    case 'red-feature':
      message =
        'Every task is built, but the tests fail on the assembled plan, so it is NOT being merged to main. ' +
        'The failure needs fixing before the plan can land.';
      break;
    case 'promote-conflict':
      message = 'The finished plan will not merge cleanly into main. It needs a hand before it can land.';
      break;
    default:
      message = `${who}: ${a.text ?? a.kind}`;
  }
  return { task: a.task ?? null, kind: a.kind, text: a.text ?? '', message };
}

// The ready-but-unstarted tasks whose dependencies are all ✅ and which no worker holds — the tasks
// that would run now if a slot were free. Used to tell "the ceiling is full, work is waiting" from
// "there is simply nothing more to do". assignedNums is the set of tasks the coordinator is already
// tracking a worker for (state.tasks), which after a pass includes anything just spawned.
function readyWaiting(tasks, assignedNums) {
  const doneNums = new Set(tasks.filter((t) => t.state === DONE_GLYPH).map((t) => t.num));
  return tasks
    .filter((t) => t.state === READY_GLYPH)
    .filter((t) => !assignedNums.has(t.num))
    .filter((t) => t.deps.every((d) => doneNums.has(d)))
    .map((t) => t.num);
}

// startCoordinator({ slug, repo, platform, worktree, maxWorkers, control, runTests }) → the controller
// the skill drives. `platform` and `worktree` are injected (the fakes in tests, the real CLI+git in
// the bin); `repo` is the repo name the worker/coordinator names are built from (DESIGN §2.8); control
// and runTests default the same way runPass defaults them (never halted, tests green).
export function startCoordinator({
  slug,
  repo,
  platform,
  worktree,
  maxWorkers = 4,
  control,
  runTests,
} = {}) {
  if (!slug) throw new Error('startCoordinator: no slug');
  if (!repo) throw new Error('startCoordinator: no repo (worker names are built from it, DESIGN §2.8)');
  if (!platform || !worktree) throw new Error('startCoordinator: platform and worktree must be injected');

  const state = createRunState();
  const passOpts = { platform, worktree, repo, slug, maxWorkers, state };
  if (control) passOpts.control = control;
  if (runTests) passOpts.runTests = runTests;

  // The account of what one pass did, in the shape the skill acts on. It re-expresses the loop's raw
  // actions as the four things the skill has to do something about: surface a decision, tell the user
  // to go drive a `you` worker, report a task reaching ✅, and know when the run is done or blocked.
  function pass() {
    const r = runPass(passOpts);
    const of = (type) => r.actions.filter((a) => a.type === type);

    const surfaces = of('surface').map(renderSurface);
    const spawned = of('spawn').map((a) => ({ task: a.task, runs: a.runs, role: a.role }));
    // A `you` task is spawned as a hands-on worker the USER drives (DESIGN §2.6); the skill points the
    // user at it by name. The worker name is deterministic, so it is rebuilt, never looked up.
    const youToDrive = spawned
      .filter((a) => a.role === 'verify')
      .map((a) => ({ task: a.task, worker: workerName({ repo, plan: slug, task: a.task }) }));
    const reviewing = of('review').map((a) => ({ task: a.task }));
    // A merge this pass is a task reaching ✅ on the feature branch (DESIGN §2.9) — what the skill
    // reports to the user as progress.
    const completed = of('merge').map((a) => a.task);
    const closed = of('close').map((a) => ({ task: a.task ?? null, reason: a.reason ?? 'closed' }));

    // Ceiling accounting (DESIGN §2.4): if the plan has ready work it could not start because every
    // slot is taken, that is logged and reported, so a slow run reads as "throttled at the ceiling",
    // not "stuck". A task simply waits for a slot; nothing is dropped.
    const assigned = new Set(Object.keys(state.tasks));
    const waiting = readyWaiting(r.tasks, assigned);
    const ceilingFull = !r.halted && r.liveAfter >= maxWorkers && waiting.length > 0;
    if (ceilingFull && control) {
      control.log(`ceiling full: ${r.liveAfter}/${maxWorkers} busy, waiting: ${waiting.join(', ')}`);
    }

    const allDone = r.tasks.length > 0 && r.tasks.every((t) => t.state === DONE_GLYPH);

    return {
      actions: r.actions,
      surfaces,
      spawned,
      youToDrive,
      reviewing,
      completed,
      closed,
      ceilingFull,
      waiting,
      live: r.liveAfter,
      halted: r.halted,
      promoted: r.promoted,
      done: r.promoted || (allDone && r.liveAfter === 0),
      tasks: r.tasks,
    };
  }

  // answer({ task, text }) → route the user's decision straight down to the parked worker, immediately
  // (DESIGN §2.2, §2.5 — the down-channel is direct). Addressed by the worker's deterministic name; the
  // worker un-parks and resumes on the next pass. The parked decision is cleared so a later pass does
  // not treat the task as still waiting.
  function answer({ task, text }) {
    if (!task) throw new Error('answer: no task');
    const name = workerName({ repo, plan: slug, task });
    const res = platform.send(name, { kind: 'answer', task, text: text ?? '' });
    const t = state.tasks[task];
    if (t && t.phase === AWAITING) t.decision = null;
    return { ok: res?.ok !== false, worker: name };
  }

  // defer({ task }) → the user has decided not to answer this task's question for now (DESIGN §2.5,
  // §2.6). Its row is marked ⛔ on the feature branch so the state survives a restart and its dependents
  // wait, and its parked worker is closed to free the slot. reconcileTaskRow touches only that row, so
  // the coordinator stays PROGRESS.md's single writer. Requires the feature branch to be open (a pass
  // has run), because that is where PROGRESS.md the coordinator owns lives.
  function defer({ task, note = 'deferred by the user' }) {
    if (!task) throw new Error('defer: no task');
    if (!state.feature) throw new Error('defer: no feature branch open yet (run a pass first)');
    const progressPath = join(state.feature.path, progressPathFor(slug));
    const updated = reconcileTaskRow(readFileSync(progressPath, 'utf8'), {
      num: task,
      state: BLOCKED_GLYPH,
      notes: note,
    });
    writeFileSync(progressPath, updated);
    worktree.commitFeature(`defer ${task} → ⛔`);

    // Free the slot: the parked worker has nothing more to do. close is session-only; remove takes the
    // worktree and branch down (DESIGN §2.3).
    const t = state.tasks[task];
    if (t) {
      if (t.workerId) platform.close(t.workerId);
      if (t.worktree) worktree.remove(t.worktree);
      delete state.tasks[task];
    }
    return { ok: true, task };
  }

  // drive({ maxPasses, onPass }) → run passes until the plan promotes, the kill switch has closed
  // everything, or the run goes quiet (every remaining worker parked on the user, or nothing left to
  // do). It mirrors loop.drain's stop conditions but runs through pass(), so onPass sees the surfaced
  // decisions and the completions — which is how the skill loop and the dry-run harness both step it.
  // A live conversational run does not use this: it steps pass() itself between the user's turns.
  function drive({ maxPasses = 200, onPass } = {}) {
    let idle = 0;
    for (let p = 1; p <= maxPasses; p++) {
      const r = pass();
      if (onPass) onPass(r, p);
      if (r.promoted) return { reason: 'promoted', passes: p, promoted: true };
      if (r.halted) return { reason: 'halted', passes: p, promoted: false };
      const productive = r.actions.some((a) =>
        ['spawn', 'review', 'merge', 'close', 'promote'].includes(a.type),
      );
      idle = productive ? 0 : idle + 1;
      if (idle >= 2) {
        return { reason: r.live > 0 ? 'parked' : 'stalled', passes: p, promoted: false };
      }
    }
    return { reason: 'maxPasses', passes: maxPasses, promoted: false };
  }

  return { state, pass, answer, defer, drive };
}

// --- The agent bridge: SendMessage and the inbox, done by the coordinator AGENT (DESIGN §2.2) --
//
// A Node process cannot call SendMessage or hold a cross-session inbox — both are agent tools. So the
// live coordinator is the SKILL agent, and this bridge is how the deterministic driver and the agent
// hand messages across a filesystem boundary the way spawn-one-scratch (T08) proved a file bridge can:
//   - inbox  — the agent APPENDS each worker message it receives ({from, text}, one JSON per line);
//              transport.drain() reads and clears it, so the next pass sees the worker's question/done.
//   - outbox — platform.send writes each coordinator→worker message here (the answer to a parked
//              worker); the agent reads it and performs the actual SendMessage.
// The wire format and addressing stay in platform.mjs (it owns encodeMessage/parseMessage); this only
// moves the already-encoded strings across the boundary. Live behaviour is T10's hand-verify; the unit
// tests use the fake platform, which is its own bus and needs no bridge.
export function createAgentBridge({ dir } = {}) {
  mkdirSync(dir, { recursive: true });
  const inboxPath = join(dir, 'inbox');
  const outboxPath = join(dir, 'outbox');

  const readLines = (path) =>
    existsSync(path)
      ? readFileSync(path, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)
      : [];

  return {
    inboxPath,
    outboxPath,
    // The transport platform.mjs's createMessaging binds to: deliver one message, drain the received.
    transport: {
      deliver(name, text) {
        writeFileSync(outboxPath, JSON.stringify({ to: name, text }) + '\n', { flag: 'a' });
        return { ok: true };
      },
      drain() {
        const lines = readLines(inboxPath);
        if (existsSync(inboxPath)) writeFileSync(inboxPath, ''); // consumed
        return lines.map((l) => {
          try {
            const { from, text } = JSON.parse(l);
            return { from, text };
          } catch {
            return { from: null, text: l };
          }
        });
      },
    },
  };
}

// --- The `pir coordinate {slug}` bin entry ----------------------------------------------------
//
// A thin front door: refuse an unreviewed plan (the same gate the skill checks), otherwise stand up the
// real platform + worktree + control and drive the loop, printing each pass's surfaces and completions
// for the skill to relay. The live message bytes are bridged to the agent through createAgentBridge (an
// answer the agent SendMessages, a worker message the agent appends to the inbox). This bin is the
// deterministic half of the coordinator; the conversational half — relaying to the user, taking answers
// — is the skill (skills/pir-coordinate). The full live drive over real agents is verified in T10; run
// here it will spawn real paid workers, so it is guarded to a bounded ceiling.

function gitStdout(cwd, args) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch {
    return '';
  }
}

// The main (primary) worktree of the repo, whose basename is the repo name the agent names are built
// from (DESIGN §2.8), and the checkout that stays on main until promotion (DESIGN §2.9).
function mainWorktree(cwd) {
  const first = gitStdout(cwd, ['worktree', 'list', '--porcelain'])
    .split('\n')
    .find((l) => l.startsWith('worktree '));
  return first ? first.slice('worktree '.length).trim() : '';
}

function fileControl(repo, slug) {
  const dir = join(repo, 'plans', slug, '.parallel', 'control');
  mkdirSync(dir, { recursive: true });
  const flag = join(dir, 'HALT');
  const logPath = join(dir, 'log');
  return {
    dir,
    flag,
    logPath,
    isHalted: () => existsSync(flag),
    log: (line) => {
      try {
        writeFileSync(logPath, `${new Date().toISOString()} ${line}\n`, { flag: 'a' });
      } catch {
        /* logging must never break the loop */
      }
    },
  };
}

async function main(argv) {
  const slug = argv[0];
  if (!slug) {
    console.error('usage: node src/shell/coordinate.mjs {slug}');
    process.exit(2);
  }

  const root = mainWorktree(process.cwd()) || process.cwd();
  const repo = basename(root);

  // The gate (DESIGN §2.1): refuse an unreviewed plan and name the line, exactly as pir-work does.
  const gate = readReviewGate(slug, { root });
  if (!gate.reviewed) {
    const why = gate.missing
      ? `plans/${slug}/PROGRESS.md was not found`
      : gate.note
        ? `the plan-reviewed gate says: "${gate.note}"`
        : 'the plan has no positive "Plan reviewed:" line';
    console.error(
      `Refusing to coordinate "${slug}": it has not been reviewed (${why}).\n` +
        `A defect in an unreviewed plan is copied into every task, and running many workers at once\n` +
        `multiplies it. Review the plan first:\n\n  /pir-review-plan ${slug}\n`,
    );
    process.exit(1);
  }

  console.log(`Coordinator ${coordinatorName({ repo, plan: slug })} — plan reviewed (${gate.note}).`);

  const maxWorkers = Number(process.env.PARALLEL_MAX_WORKERS ?? 4);

  // Live seatbelt (DESIGN §5.2). This bin spawns REAL, paid `claude` workers and, on success, merges to
  // the user's main. A full multi-worker live drive is not hand-verified until T10, and the rule is
  // never to run the unbounded version to find something out. So the loop only runs with an explicit
  // opt-in; without it the bin does the safe half — confirm the gate, show what it WOULD dispatch — and
  // stops. The T09 person-check runs the live path deliberately on the scratch plan, ceiling 1:
  //   PARALLEL_LIVE=1 PARALLEL_MAX_WORKERS=1 node src/shell/coordinate.mjs scratch
  if (process.env.PARALLEL_LIVE !== '1') {
    const { tasks } = parseProgress(readFileSync(join(root, progressPathFor(slug)), 'utf8'));
    const ready = readyWaiting(tasks, new Set());
    console.log(
      `\nDRY: not spawning real workers (set PARALLEL_LIVE=1 to actually drive — the multi-worker\n` +
        `live drive is hand-verified in T10, and the first live run is seatbelted: scratch plan, ceiling 1).\n` +
        `Ready to dispatch now: ${ready.length ? ready.join(', ') : '(none)'}.`,
    );
    return;
  }

  console.log('LIVE: spawning real workers (PARALLEL_LIVE=1).');

  const control = fileControl(root, slug);
  const bridge = createAgentBridge({ dir: control.dir });
  const platform = createPlatform({ root, transport: bridge.transport });
  const worktree = createWorktree({ root });
  const coordinator = startCoordinator({ slug, repo, platform, worktree, maxWorkers, control });

  console.log(`ceiling: ${maxWorkers}   control: ${control.dir}`);
  console.log(`ABORT:   touch ${control.flag}`);
  console.log(`inbox:   ${bridge.inboxPath}   outbox: ${bridge.outboxPath}\n`);

  const POLL_MS = Number(process.env.PARALLEL_POLL_MS ?? 5000);
  const MAX_PASSES = Number(process.env.PARALLEL_MAX_PASSES ?? 480);

  for (let p = 1; p <= MAX_PASSES; p++) {
    const r = coordinator.pass();
    for (const c of r.completed) console.log(`  ✅ ${c} reached done and merged into the feature branch`);
    for (const y of r.youToDrive) console.log(`  hands-on: go drive worker "${y.worker}" for ${y.task}`);
    for (const s of r.surfaces) console.log(`  DECISION NEEDED (${s.task ?? '-'}): ${s.message}`);
    if (r.ceilingFull) console.log(`  (ceiling full; waiting: ${r.waiting.join(', ')})`);
    if (r.halted) {
      console.log('\n=== HALTED by the kill switch — workers stopped, nothing promoted ===');
      return;
    }
    if (r.promoted) {
      console.log('\n=== PROMOTED — the whole plan reached main ===');
      return;
    }
    await sleep(POLL_MS);
  }
  console.log('\n=== ran out of passes ===');
}

// Only run the bin when invoked directly, never on import (the tests import the functions above).
if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
