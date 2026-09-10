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
import { workerName, coordinatorName, isWorkerOf, parseAgentName } from '../core/naming.mjs';
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
    case 'decision':
      // A worker sends `question` (something unspecified) or `decision` (a genuine choice); both are
      // the user's to answer and read the same in plain English (DESIGN §2.5, pir-worker skill).
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
  // The DOWN-channel for the user's decisions (T12 Problem 2). The drill's bin only ran pass() and
  // printed surfaces — it never called answer()/defer() and read no input, so a task that raised a
  // question was surfaced and then stuck: the decision had no way down. This file is symmetric to the
  // inbox — the skill APPENDS one JSON line per user decision, `{ "task": "T05", "text": "…" }` to
  // answer or `{ "task": "T05", "defer": true, "note": "…" }` to defer — and the bin drains it each
  // pass and routes it to answer()/defer(). That makes the two drive models one: the bin is the
  // long-running driver, and every up/down message crosses through a control file the skill owns.
  const answersPath = join(dir, 'answers');

  const readLines = (path) =>
    existsSync(path)
      ? readFileSync(path, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)
      : [];

  const drainJsonLines = (path) => {
    const lines = readLines(path);
    if (existsSync(path)) writeFileSync(path, ''); // consumed
    return lines;
  };

  return {
    inboxPath,
    outboxPath,
    answersPath,
    // The transport platform.mjs's createMessaging binds to: deliver one message, drain the received.
    transport: {
      deliver(name, text) {
        writeFileSync(outboxPath, JSON.stringify({ to: name, text }) + '\n', { flag: 'a' });
        return { ok: true };
      },
      drain() {
        return drainJsonLines(inboxPath).map((l) => {
          try {
            const { from, text } = JSON.parse(l);
            return { from, text };
          } catch {
            return { from: null, text: l };
          }
        });
      },
    },
    // drainAnswers() → the user decisions the skill has written since the last drain, each an
    // { task, text } to answer or { task, defer: true, note? } to defer (DESIGN §2.5). The bin feeds
    // each to answer()/defer(). A malformed line is dropped, never guessed into a decision.
    drainAnswers() {
      return drainJsonLines(answersPath)
        .map((l) => {
          try {
            return JSON.parse(l);
          } catch {
            return null;
          }
        })
        .filter((d) => d && d.task);
    },
  };
}

// --- Tearing down a run's workers, so no exit path orphans one (DESIGN §2.3, §2.4; T12 P6) ----
//
// The drill's bin ran out its pass budget and printed "ran out of passes" while a worker was still
// live and parked, leaving a paid session orphaned that had to be stopped by hand. So EVERY exit path
// that is not a clean promotion/halt (a safety cap, a stall, a signal, an error) must close this run's
// live workers. `platform.close` is stop + SIGTERM — `claude stop` alone only interrupts (FINDINGS
// 2026-09-09), so this is what actually ends the session. Closing an already-gone id is a safe no-op.
export function teardownRun({ platform, worktree, state, repo, slug, control } = {}) {
  const closed = new Set();
  const removeWorktree = (num) => {
    const t = num ? state?.tasks?.[num] : null;
    if (t?.worktree && worktree) {
      try {
        worktree.remove(t.worktree);
      } catch {
        /* best-effort cleanup; the session close is what matters for orphan-avoidance */
      }
    }
  };
  const closeId = (id, name) => {
    if (!id || closed.has(id)) return;
    try {
      platform.close(id);
    } catch {
      /* already gone */
    }
    closed.add(id);
    control?.log?.(`teardown: closed ${name ?? ''} (${id})`.trim());
  };

  // Every worker of THIS run the platform still lists — the authoritative live sessions.
  let live = [];
  try {
    live = platform.list().filter((w) => isWorkerOf(w.name, { repo, plan: slug }));
  } catch {
    live = [];
  }
  for (const w of live) {
    closeId(w.id, w.name);
    removeWorktree(parseAgentName(w.name).task);
  }
  // Plus any worker this run spawned that we still track — covers the appear-grace window in which a
  // just-spawned session is not listed yet, so a spawn is never left behind on an early exit.
  for (const [num, t] of Object.entries(state?.tasks ?? {})) {
    if (t.workerId) {
      closeId(t.workerId, workerName({ repo, plan: slug, task: num }));
      removeWorktree(num);
    }
  }
  return { closed: [...closed] };
}

// --- The runaway circuit-breaker verdict (DESIGN §5.2; ported from spawn-one-scratch.mjs, T12 P5) --
//
// The first live spawn-one-scratch run "ran away" to ~12 workers before a breaker existed; coordinate
// .mjs had none. A review handoff briefly holds CEILING+1 (the implementer is stopped async as the
// reviewer spawns — FINDINGS 2026-09-09), so a single over-ceiling worker is tolerated for `overGrace`
// consecutive passes; more than one over, or an overage that persists, is a real runaway. Pure so the
// bin's safety net is tested without a live process. `liveCount` is THIS run's workers only (the
// caller filters with isWorkerOf), so the coordinator's own session never trips it.
export function runawayVerdict({ liveCount, ceiling, overPasses = 0, overGrace = 3 }) {
  if (liveCount <= ceiling) return { abort: false, over: 0 };
  const over = overPasses + 1;
  return { abort: liveCount > ceiling + 1 || over >= overGrace, over };
}

// --- The scratch-repo promotion guard (DESIGN §5.2; ported from spawn-one-scratch.mjs, T12 P5) ----
//
// The LIVE bin opens the feature branch off THIS checkout's main and, on success, merges it back into
// main. Never let that happen inside the canonical project by accident: refuse when the main
// worktree's basename is the canonical repo unless PARALLEL_ALLOW_HERE=1 (a same-named scratch clone).
// Pure predicate so it is tested directly.
const CANONICAL_REPO = 'plan-implement-review';
export function canPromoteHere(repoName, { allowHere = false } = {}) {
  return repoName !== CANONICAL_REPO || allowHere;
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

// A git runner that reports success/failure (unlike gitStdout, which swallows it), so ensureMain can
// tell "no local main" from "the checkout is broken". Injected into ensureMain so a test drives it
// against a scratch repo.
export function gitRun(cwd, args) {
  try {
    const stdout = execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { ok: true, stdout, stderr: '' };
  } catch (e) {
    return { ok: false, stdout: e.stdout ?? '', stderr: e.stderr ?? String(e) };
  }
}

// Ensure a checkout has a local `main` (DESIGN §2.9; T12 Problem 4). worktree.mjs cuts the feature
// branch with `git branch pir/{plan} main` and promotes back into main — `main` hardcoded, as the real
// project always has one. A scratch clone taken off a side branch has only origin/main and no local
// `main`, so pass 1 throws "not a valid object name: 'main'" (the drill created one by hand). When
// there is no local main, create it at the current HEAD and check it out; a checkout that already has
// main is left exactly as it is. Runs only on the LIVE path, which the canonical-repo guard confines
// to a scratch checkout, so pointing main at HEAD is safe (mirrors ensureMainCheckedOut, verified with
// the user 2026-09-09). `-B main HEAD` pins main to the exact commit, never a same-named origin/main.
export function ensureMain(root, { git = gitRun } = {}) {
  if (git(root, ['rev-parse', '--verify', '--quiet', 'refs/heads/main']).ok) {
    return { created: false };
  }
  const from = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim();
  const r = git(root, ['checkout', '-B', 'main', 'HEAD']);
  if (!r.ok) throw new Error(`ensureMain: could not create a local main at HEAD: ${r.stderr}`);
  return { created: true, from };
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

  // Promotion guard (DESIGN §5.2; T12 Problem 5): never open+merge the feature branch inside the
  // canonical project by accident. A scratch clone is named anything else; PARALLEL_ALLOW_HERE=1
  // overrides for a same-named clone.
  if (!canPromoteHere(repo, { allowHere: process.env.PARALLEL_ALLOW_HERE === '1' })) {
    console.error(
      `Refusing the LIVE run inside "${repo}" — this opens pir/${slug} off THIS repo's main and, on\n` +
        `success, merges it back into THIS main. Run it in a throwaway clone instead (e.g.\n` +
        `\`git clone . ../pir-scratch && cd ../pir-scratch\`). If this really is a scratch clone that\n` +
        `happens to share the name, set PARALLEL_ALLOW_HERE=1.`,
    );
    process.exit(1);
  }

  // Ensure a local `main` exists (DESIGN §2.9; T12 Problem 4): a scratch clone off a side branch has
  // only origin/main, and openFeature would throw on pass 1 without this.
  const mained = ensureMain(root);
  if (mained.created) console.log(`prepared a local main at HEAD (checkout was on "${mained.from}", which had none).`);

  const control = fileControl(root, slug);
  const bridge = createAgentBridge({ dir: control.dir });
  const platform = createPlatform({ root, transport: bridge.transport });
  const worktree = createWorktree({ root });
  const coordinator = startCoordinator({ slug, repo, platform, worktree, maxWorkers, control });

  console.log(`ceiling: ${maxWorkers}   control: ${control.dir}`);
  console.log(`ABORT:   touch ${control.flag}`);
  console.log(`inbox:   ${bridge.inboxPath}   outbox: ${bridge.outboxPath}   answers: ${bridge.answersPath}\n`);

  // Tear down every live worker of this run on any exit that is not a clean promotion or a kill-switch
  // halt (both of which the loop already handled). This is the P6 orphan-guard: a safety cap, a stall,
  // a Ctrl-C or an error must not leave a paid session running. Idempotent (close is safe twice).
  const teardown = () => teardownRun({ platform, worktree, state: coordinator.state, repo, slug, control });
  let tornDown = false;
  const teardownOnce = (why) => {
    if (tornDown) return;
    tornDown = true;
    const { closed } = teardown();
    if (closed.length) console.log(`\n=== ${why}: closed ${closed.length} live worker(s) so none is orphaned ===`);
  };
  // A signal (Ctrl-C, or the OS asking us to stop) must close workers before we go. Register once.
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      teardownOnce(`${sig} received`);
      process.exit(130);
    });
  }

  const POLL_MS = Number(process.env.PARALLEL_POLL_MS ?? 5000);
  // A safety cap only — the run's real end is promotion, halt, or a stall, not a fixed pass budget
  // (the drill exited on its budget and orphaned a worker; T12 Problem 6). At the cap we tear down.
  const MAX_PASSES = Number(process.env.PARALLEL_MAX_PASSES ?? 5000);
  const CEILING = maxWorkers;
  const OVER_GRACE = Number(process.env.PARALLEL_OVER_GRACE ?? 3);
  const STALL_GRACE = 3; // consecutive quiet passes with nothing live before the run is declared done

  let over = 0;
  let idle = 0;
  try {
    for (let p = 1; p <= MAX_PASSES; p++) {
      // Route any user decisions the skill has written to the answers file DOWN to their workers
      // before this pass runs (DESIGN §2.5; T12 Problem 2). answer() sends to the parked worker;
      // defer() marks ⛔ and frees the slot. Guarded so a bad line never breaks the loop.
      for (const d of bridge.drainAnswers()) {
        try {
          if (d.defer) {
            coordinator.defer({ task: d.task, note: d.note });
            console.log(`  routed: deferred ${d.task} (⛔)`);
          } else {
            coordinator.answer({ task: d.task, text: d.text ?? '' });
            console.log(`  routed: answer → ${d.task}`);
          }
        } catch (e) {
          console.error(`  could not route a decision for ${d.task}: ${e.message}`);
        }
      }

      const r = coordinator.pass();
      for (const c of r.completed) console.log(`  ✅ ${c} reached done and merged into the feature branch`);
      for (const y of r.youToDrive) console.log(`  hands-on: go drive worker "${y.worker}" for ${y.task}`);
      for (const s of r.surfaces) console.log(`  DECISION NEEDED (${s.task ?? '-'}): ${s.message}`);
      if (r.ceilingFull) console.log(`  (ceiling full; waiting: ${r.waiting.join(', ')})`);
      if (r.halted) {
        console.log('\n=== HALTED by the kill switch — workers stopped, nothing promoted ===');
        return; // the halt pass already closed every worker
      }
      if (r.promoted) {
        console.log('\n=== PROMOTED — the whole plan reached main ===');
        return; // the promotion pass already closed every worker
      }

      // Runaway breaker (DESIGN §5.2; T12 Problem 5). Count THIS run's workers only — the coordinator's
      // own session shares the git-dir and must not trip it. r.live is already that count (loop.mjs
      // filters), so reuse it rather than re-listing.
      const verdict = runawayVerdict({ liveCount: r.live, ceiling: CEILING, overPasses: over, overGrace: OVER_GRACE });
      over = verdict.over;
      if (verdict.abort) {
        console.error(`\nABORT: ${r.live} live workers over ceiling ${CEILING} for ${over} pass(es) — a runaway.`);
        teardownOnce('runaway');
        return;
      }

      // Stall detection: a pass that did nothing AND has nothing live is the run genuinely finished
      // (all tasks ✅ but nothing to promote, or everything deferred). A parked worker (live > 0) is
      // NOT a stall — it waits for the user's answer, so the loop keeps polling for it.
      const productive = r.actions.some((a) => ['spawn', 'review', 'merge', 'close', 'promote'].includes(a.type));
      idle = !productive && r.live === 0 ? idle + 1 : 0;
      if (idle >= STALL_GRACE) {
        console.log('\n=== nothing left to do (no live workers, nothing to dispatch or promote) ===');
        teardownOnce('stalled'); // a no-op when nothing is live; still safe
        return;
      }

      await sleep(POLL_MS);
    }
    console.log('\n=== safety cap reached ===');
    teardownOnce('safety cap');
  } catch (e) {
    teardownOnce('error');
    throw e;
  }
}

// Only run the bin when invoked directly, never on import (the tests import the functions above).
if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
