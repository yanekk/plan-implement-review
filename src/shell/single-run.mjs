// The detached single program (single-runs DESIGN §2.4–§2.7, §2.9, §2.11, §3.4, §3.5).
//
//   node src/shell/single-run.mjs --control <dir> [--resume]
//
// `@repo/single <prompt>` (startSingleRun, T05) cuts the run's branch, writes <dir>/prompt.md and
// <dir>/state.json, and spawns this program detached. It holds the builder and then a fresh reviewer
// through the shared holder (held-session.mjs), runs the setup, the tests and the baseline as background
// command runs (commands.mjs startLines), checks each report against git, renames the run to the
// builder's name, and hands everything to core/singleflow's decideSingleStep, whose actions it executes
// in order. It decides nothing itself: every branch below is either an action of decideSingleStep or the
// plumbing that feeds it facts.
//
// `--resume` (§2.11) reads state.json, removes a leftover baseline worktree, finishes a half-done
// rename, and then either reopens the current step's last session by id or starts again the command run
// the last program died in.
//
// Under PIR_RUN=1 (set only by the launcher) it writes status.json on every change of what the screen
// would show, and the final status to the snapshot and the index entry, as plan-run.mjs does. Without it
// neither is touched, so a bare run in a test leaves no dashboard trace.

import { spawn as spawnLine } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { resumeInstruction } from '../core/planflow.mjs';
import { parseRecord } from '../core/runrecord.mjs';
import {
  builderInstruction,
  decideSingleStep,
  isValidSingleName,
  parseSingleReport,
  reviewerInstruction,
  singleSessionName,
} from '../core/singleflow.mjs';
import { workerActivity } from '../core/stream.mjs';
import { writeJsonAtomic } from './atomic-write.mjs';
import { startLines as startLinesReal } from './commands.mjs';
import { drainDropFolder } from './drop-folder.mjs';
import { isAlive as isAliveReal, startTimeOf as startTimeOfReal } from './identity.mjs';
import { STOP_CLOSE, createSessionHolder, sessionAsking, trackStoppedAt } from './held-session.mjs';
import { indexDir as indexDirOf, recordPath, removeRecord, renameRecord, updateRecord } from './index-store.mjs';
import { startPersonInbox } from './person-inbox.mjs';
import { resolveClaudePath } from './platform.mjs';
import { reapRecorded } from './reap.mjs';
import { writeSnapshot as writeSnapshotReal } from './snapshot-store.mjs';
import {
  git as gitReal,
  openBaseline as openBaselineReal,
  removeBaseline as removeBaselineReal,
  renamePlanBranch as renamePlanBranchReal,
  slugTaken as slugTakenReal,
} from './worktree.mjs';

// The wait between loop turns when nothing wakes it. A report, a person's input, any entry in the
// session's log and a command run settling wake it at once; this is the backstop for a missed event.
const POLL_MS = 5000;

const STEPS = ['build', 'review'];
const STEP_KINDS = { build: ['built', 'dropped'], review: ['reviewed', 'dropped'] };
const ROLE = { build: 'builder', review: 'reviewer' };
// The command runs a test run's result is read for (§2.9): the session waits on pir, not the person.
const TESTING = new Set(['tests', 'baseline']);

export const statePathOf = (controlDir) => join(controlDir, 'state.json');
export const reportsDirOf = (controlDir) => join(controlDir, 'reports');

// rootOf(controlDir) → the main checkout. The control folder is <main>/plans/{id|name}/.parallel/single
// (DESIGN §2.3), so the root is four levels up whichever name it sits under.
export function rootOf(controlDir) {
  return resolve(controlDir, '..', '..', '..', '..');
}

// findControlDir(controlDir) → the folder that holds the run's state.json. It is the one given, except
// after a crash between the control-folder move and the index rename (§2.4 step 4): the index entry, and
// so `pir`'s resume, still names the folder under the run id, while state.json has moved under the name.
export function findControlDir(controlDir, { readdir = readdirSync, exists = existsSync, readFile = readFileSync } = {}) {
  if (exists(statePathOf(controlDir))) return controlDir;
  const id = basename(resolve(controlDir, '..', '..'));
  const plans = join(rootOf(controlDir), 'plans');
  let names = [];
  try {
    names = readdir(plans);
  } catch {
    return controlDir;
  }
  for (const name of names) {
    const dir = join(plans, name, '.parallel', 'single');
    try {
      if (JSON.parse(readFile(statePathOf(dir), 'utf8')).id === id) return dir;
    } catch {
      // not a single run's folder
    }
  }
  return controlDir;
}

// formatSingleSetupNote({ reason, tail, logPath }, { setup }) → the note a builder's opening instruction
// carries when the setup lines failed before it started (§2.4 step 1). It is setupnote.mjs's note with
// the two lines that name a plan reworded: a single run has no plan and no DESIGN.md to point at, so the
// last line names the setup lines themselves (user, 2026-09-30).
export function formatSingleSetupNote({ reason, tail, logPath }, { setup = [] } = {}) {
  const parts = [`The setup step failed in this worktree before you started: ${reason}.`];
  const lines = (tail ?? '').replace(/\n+$/, '');
  if (lines.trim()) {
    parts.push('Last lines of its output:');
    parts.push(lines.split('\n').map((l) => `  ${l}`).join('\n'));
  }
  parts.push(`Full output: ${logPath}`);
  parts.push(
    `Get this worktree ready (the setup lines pir runs here: ${setup.map((l) => `\`${l}\``).join(', ')}), then carry on ` +
      'with the change.',
  );
  return parts.join('\n');
}

// singleChecks(...) → { ok: true } | { ok: false, failures: [text] } — a report is a claim checked
// against git (§2.7). Every failure is one plain line naming what failed and what to do; they are sent
// to the session as they are. `run` is the run's state ({ id, name, base }), `startSha` its starting
// commit. pir never commits for a session, so a dirty tree is the session's to commit.
export function singleChecks({ kind, name, run, worktree, root, repo, indexDir, startSha, git = gitReal, slugTaken = slugTakenReal }) {
  const again = `drop the \`${kind}\` report again`;
  const failures = [];
  if (kind === 'built') {
    if (!isValidSingleName(name)) {
      failures.push(
        `"${name}" cannot be the branch name: it must be kebab-case (a-z, 0-9, single hyphens) and not of the form single-xxxx or plan-xxxx. Choose another name, then ${again}.`,
      );
    } else {
      // Beyond slugTaken's three: a control folder under the name. Removing a run keeps its state.json
      // (control-run.mjs removeRun), and once its branch is deleted nothing else holds the name; the
      // rename would read that folder as this run's already moved and leave this run's split over two.
      const taken =
        slugTaken(name, { root, base: run.base, indexHas: (s) => existsSync(recordPath(repo, s, { dir: indexDir })) }) ??
        (existsSync(join(root, 'plans', name, '.parallel', 'single')) ? 'control' : null);
      if (taken) {
        const why = {
          branch: `a branch pir/${name} already exists`,
          'base-plan': `a plan plans/${name} is already on ${run.base}`,
          index: `a pir run named ${name} already exists`,
          control: `a folder plans/${name}/.parallel/single is left from an earlier run`,
        }[taken] ?? `it is in use (${taken})`;
        failures.push(`The name "${name}" is taken: ${why}. Choose another name, then ${again}.`);
      }
    }
    const count = git(worktree, ['rev-list', '--count', `${startSha}..HEAD`]);
    if (!count.ok || Number(count.stdout.trim()) < 1) {
      failures.push(`nothing is committed on the branch yet. Commit the change, then ${again}.`);
    }
  } else if (kind === 'reviewed') {
    if (name !== run.name) failures.push(`This run is pir/${run.name}, not pir/${name}. Drop the \`reviewed\` report with single=${run.name}.`);
  } else {
    failures.push(`a \`${kind}\` report has no checks`);
  }
  const status = git(worktree, ['status', '--porcelain']);
  if (!status.ok || status.stdout.trim() !== '') {
    failures.push(`The worktree has uncommitted changes (git status --porcelain is not empty). Commit everything you wrote, then ${again}.`);
  }
  return failures.length ? { ok: false, failures } : { ok: true };
}

// While pir holds a report of the step (checks pending, accepted) or runs a command for it, a stopped
// session waits on pir, not on the person (§2.9). sessionAsking reads exactly that from `accepted`.
const askingState = (state, running) => ({ accepted: state.accepted ?? state.pending ?? running ?? null });

// singleRunState(state, session) → the status.json runState of a single run (DESIGN §3.5). Pure.
// `session` is what the program holds beside state.json:
//   label      the dashboard name before the rename
//   sessions   every session this program started, in spawn order: { id, step, n, logPath, cwd, live, activity }
//   since      { build, review } — when that step's latest session started (ms)
//   stoppedAt  { build, review } — when that step's live session began asking the person (ms)
//   took       { build, review } — how long a finished step's sessions worked (ms), or absent
//   running    { kind: 'setup'|'tests'|'baseline', since } — the command run in flight, or null
// Each step's phase: 'building' | 'reviewing' while it is the current step and its session works (setup
// included), 'testing' while pir's tests or the baseline run, 'asking' while its live session asks the
// person, 'done', 'failed' for the step a `dropped` report ended, 'pending' before it starts. A pending
// request reads asking even during a test run; only the stopped-session rule is switched off then (§2.9).
// The `merge` row is 'ready' once the run is, else 'pending'; whether the person has merged is the
// dashboard's to find out (§2.8).
export function singleRunState(state, { label = null, sessions = [], since = {}, stoppedAt = {}, took = {}, running = null } = {}) {
  const runningKind = running?.kind ?? state.running ?? null;
  const testing = state.outcome == null && TESTING.has(runningKind);
  // A finished run keeps the step it ended in (singleflow), so a drop is charged to that step.
  const inReview = state.step === 'review' || state.step === 'rename';
  const stepRow = (id) => {
    const mine = sessions.filter((s) => s.step === id);
    const live = mine.filter((s) => s.live).at(-1) ?? null;
    const open = live ?? mine.at(-1) ?? null;
    const current = state.outcome == null && (id === 'build' ? !inReview : state.step === 'review');
    const asking = current ? sessionAsking(askingState(state, runningKind), live) : null;
    let phase;
    if (id === 'build') {
      if (inReview) phase = 'done';
      else if (state.outcome === 'dropped') phase = 'failed';
      else phase = asking ? 'asking' : testing ? 'testing' : 'building';
    } else if (state.outcome === 'ready') phase = 'done';
    else if (!inReview) phase = 'pending';
    else if (state.outcome === 'dropped') phase = 'failed';
    else if (state.step === 'review') phase = asking ? 'asking' : testing ? 'testing' : 'reviewing';
    else phase = 'pending';
    return {
      id,
      phase,
      since: current || phase === 'done' ? since[id] ?? null : null,
      stoppedAt: asking ? stoppedAt[id] ?? null : null,
      tookMs: phase === 'done' || phase === 'failed' ? took[id] ?? null : null,
      asking,
      round: state.rounds?.[id] ?? 0,
      testingSince: phase === 'testing' ? running?.since ?? null : null,
      worker: open ? { id: open.id, live: !!open.live, logPath: open.logPath ?? null, cwd: open.cwd ?? null } : null,
      workers: mine.map((s) => ({ id: s.id, role: ROLE[id], n: s.n ?? null, logPath: s.logPath ?? null, cwd: s.cwd ?? null })),
    };
  };
  return {
    kind: 'single',
    label,
    name: state.name ?? null,
    step: state.step,
    phase: testing ? 'testing' : 'working',
    outcome: state.outcome ?? null,
    base: state.base ?? null,
    rounds: { build: state.rounds?.build ?? 0, review: state.rounds?.review ?? 0 },
    steps: [
      stepRow('build'),
      stepRow('review'),
      { id: 'merge', phase: state.outcome === 'ready' ? 'ready' : 'pending', since: null, stoppedAt: null, tookMs: null, asking: null, worker: null, workers: [] },
    ],
  };
}

// nextTestsLogPath(controlDir) → tests-{n}.log, n one past the highest there (§3.5), counted from the
// folder so a resumed program never overwrites the log a message already named.
export function nextTestsLogPath(controlDir, { readdir = readdirSync } = {}) {
  let names = [];
  try {
    names = readdir(controlDir);
  } catch {
    names = [];
  }
  let max = 0;
  for (const n of names) {
    const m = /^tests-(\d+)\.log$/.exec(n);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return join(controlDir, `tests-${max + 1}.log`);
}

// The command line in flight is recorded in <control>/command.json as { kind, pid, startTime }. Each
// line runs in its own process group (startLines), so a program killed outright leaves it running in the
// run's worktree, and the successor must end it before it starts that run again (§2.11, §5.2).
export const commandFileOf = (controlDir) => join(controlDir, 'command.json');

// reapCommand(controlDir) → the pid killed, or null. As for a recorded session (reap.mjs), a pid is only
// signalled while the process at that number still has the recorded launch time; the whole group goes,
// since a test line forks children.
export function reapCommand(controlDir, { kill = process.kill, isAlive = isAliveReal, startTimeOf = startTimeOfReal, readFile = readFileSync, rm = rmSync } = {}) {
  const path = commandFileOf(controlDir);
  let rec;
  try {
    rec = JSON.parse(readFile(path, 'utf8'));
  } catch {
    return null;
  }
  let reaped = null;
  if (Number.isInteger(rec?.pid) && rec.pid > 0 && rec.startTime != null && isAlive(rec.pid) && startTimeOf(rec.pid) === rec.startTime) {
    try {
      kill(-rec.pid, 'SIGKILL');
    } catch {
      try {
        kill(rec.pid, 'SIGKILL');
      } catch {
        // gone between the check and the signal
      }
    }
    reaped = rec.pid;
  }
  rm(path, { force: true });
  return reaped;
}

// runSingle({ controlDir, resume, deps }) → exit code: 0 at a clean end (finished, stopped, or a
// `--resume` of a finished run), 1 when the session left no way forward or a step failed (crashed,
// resumable), 2 when the run cannot start. deps, all optional, as runPlanning's:
//   env, now, log, signal (an AbortSignal: a stop), claudePath, startWorker, startTimeOf, reap, git,
//   slugTaken, renamePlanBranch, writeSnapshot, updateRecord, watch, uuid, pollMs
// plus startLines (commands.mjs), openBaseline, removeBaseline (worktree.mjs).
export async function runSingle({ controlDir: givenControlDir, resume = false, deps = {} }) {
  const {
    env = process.env,
    now = Date.now,
    log = (line) => process.stdout.write(`${new Date(now()).toISOString()} ${line}\n`),
    signal,
    reap = reapRecorded,
    git = gitReal,
    slugTaken = slugTakenReal,
    renamePlanBranch = renamePlanBranchReal,
    openBaseline = openBaselineReal,
    removeBaseline = removeBaselineReal,
    startLines = startLinesReal,
    writeSnapshot = writeSnapshotReal,
    updateRecord: updateRecordFn = updateRecord,
    watch,
    pollMs = POLL_MS,
  } = deps;

  // Every path below is re-pointed when the control folder moves at the rename (§2.4 step 4).
  let controlDir = resume ? findControlDir(givenControlDir) : givenControlDir;
  if (controlDir !== givenControlDir) log(`state.json found in ${controlDir} (the rename had moved it)`);
  let statePath = statePathOf(controlDir);
  let reportsDir = reportsDirOf(controlDir);
  let state;
  let prompt;
  try {
    state = JSON.parse(readFileSync(statePath, 'utf8'));
    prompt = readFileSync(join(controlDir, 'prompt.md'), 'utf8');
  } catch (err) {
    log(`cannot start: ${err?.message ?? err}`);
    return 2;
  }

  const root = rootOf(controlDir);
  const repo = basename(root);
  const worktreesBase = join(root, '.claude', 'worktrees');
  const indexDir = indexDirOf({ env });
  const selfReport = !!env.PIR_RUN;
  const remote = env.PARALLEL_REMOTE !== '0';
  const indexKey = () => state.name ?? state.id;
  const controlOf = (name) => join(root, 'plans', name, '.parallel', 'single');
  const hasRecord = (key) => existsSync(recordPath(repo, key, { dir: indexDir }));
  const branchExists = (b) => git(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${b}`]).ok;

  // renamedOnDisk() → which rename sub-steps are done, read from git and the disk rather than
  // state.json, since a crash can fall between a sub-step and the state write that records it.
  const renamedOnDisk = () => {
    const name = state.name;
    if (!name) return { branch: false, worktree: false, control: false, index: false };
    return {
      branch: !branchExists(`pir/${state.id}`) && branchExists(`pir/${name}`),
      worktree: existsSync(join(worktreesBase, `pir-${name}`, '.git')) && !existsSync(join(worktreesBase, `pir-${state.id}`)),
      control: existsSync(statePathOf(controlOf(name))),
      index: !hasRecord(state.id),
    };
  };
  // The run's worktree, under whichever name it has now.
  const worktreeNow = () =>
    state.name && existsSync(join(worktreesBase, `pir-${state.name}`)) ? join(worktreesBase, `pir-${state.name}`) : join(worktreesBase, `pir-${state.id}`);
  // The branch head and whether the tree is clean, as the decision wants them after a test run.
  const treeNow = () => {
    const worktree = worktreeNow();
    const head = git(worktree, ['rev-parse', 'HEAD']);
    const status = git(worktree, ['status', '--porcelain']);
    const dirty = status.ok ? status.stdout : 'git status failed';
    return { head: head.ok ? head.stdout.trim() : null, clean: status.ok && dirty.trim() === '', dirty };
  };

  let claudePath = deps.claudePath;
  try {
    claudePath ??= resolveClaudePath();
  } catch (err) {
    log(err.message);
    return 2;
  }

  // A previous program killed outright may have left its session running, its command line running in
  // the worktree, and its baseline worktree behind (§2.11). The state's `running` makes the decision
  // start that command run again.
  try {
    const { reaped } = await reap(controlDir);
    if (reaped.length) log(`reaped leftover sessions ${reaped.join(', ')}`);
    const pid = reapCommand(controlDir);
    if (pid) log(`killed a leftover command run (pid ${pid})`);
  } catch (err) {
    log(`reap failed: ${err?.message ?? err}`);
  }
  const dropBaseline = () => {
    try {
      removeBaseline(state.id, { root });
    } catch (err) {
      log(`baseline worktree not removed: ${err?.message ?? err}`);
    }
  };
  if (resume) dropBaseline();

  // ---- The sessions this program holds, through the shared holder. ----
  // The failed setup's note is held for the one spawn it belongs to: the builder's opening.
  let setupNote = null;
  const holder = createSessionHolder({
    controlDir: () => controlDir,
    cwd: worktreeNow,
    taskLabel: 'single',
    roleOf: (step) => ROLE[step],
    nameOf: (step) => singleSessionName({ repo, run: indexKey(), step }),
    instructionOf: (step) =>
      step === 'build'
        ? builderInstruction({ reportsDir, base: state.base, baseSha: state.baseSha, prompt, setupNote })
        : reviewerInstruction({ reportsDir, name: state.name, base: state.base, baseSha: state.baseSha, prompt }),
    remote,
    claudePath,
    log,
    now,
    ...(deps.uuid ? { uuid: deps.uuid } : {}),
    ...(deps.startWorker ? { startWorker: deps.startWorker } : {}),
    ...(deps.startTimeOf ? { startTimeOf: deps.startTimeOf } : {}),
  });
  holder.load(state.sessions, STEPS);
  const { platform, waker, grants, since } = holder;
  const stoppedAt = {};
  const took = {};

  // ---- The command run in flight: setup, tests or baseline. One at a time. ----
  // { kind, since, poll() → null | commandDone, kill() }
  let command = null;
  const forgetCommandFile = () => rmSync(commandFileOf(controlDir), { force: true });
  const killCommand = () => {
    if (!command) return;
    const { kind } = command;
    command.kill();
    command = null;
    forgetCommandFile();
    log(`killed the ${kind} run`);
    if (kind === 'baseline') dropBaseline();
  };
  // startRun(kind, { setup, test, cwd, logPath }) → the handle of `setup` then `test` lines as one
  // background run with one log (the pair runFeatureTests runs at the end of a build, §2.4 step 3).
  // startLines spawns one child per line, in order, and stops at the first failure, so counting the
  // children says which half a failure fell in without guessing from the failing line's text (the same
  // line may stand in both lists). The step-1 setup run has no test half and its reason stands bare, as
  // formatSetupNote's wording expects.
  const startRun = (kind, { setup, test, cwd, logPath }) => {
    let started = 0;
    const handle = startLines([...setup, ...test], {
      cwd,
      logPath,
      onSettled: () => waker.wake(),
      spawn: (...args) => {
        started += 1;
        const child = spawnLine(...args);
        try {
          if (child.pid) writeJsonAtomic(commandFileOf(controlDir), { kind, pid: child.pid, startTime: startTimeOfReal(child.pid) });
        } catch (err) {
          log(`command.json write failed: ${err?.message ?? err}`);
        }
        return child;
      },
    });
    return {
      kind,
      since: now(),
      kill: () => handle.kill(),
      poll: () => {
        const r = handle.poll();
        if (!r) return null;
        if (r.ok) return { kind, ok: true, half: null, reason: null, logPath: r.logPath ?? logPath, tail: '' };
        const half = started <= setup.length ? 'setup' : 'test';
        return { kind, ok: false, half, reason: kind === 'setup' ? r.reason : `${half} ${r.reason}`, logPath: r.logPath ?? logPath, tail: r.tail ?? '' };
      },
    };
  };
  const startCommand = (kind) => {
    if (command) killCommand();
    const { setup, test } = state.commands;
    if (kind === 'setup') {
      command = startRun(kind, { setup, test: [], cwd: worktreeNow(), logPath: join(controlDir, 'setup.log') });
    } else if (kind === 'tests') {
      command = startRun(kind, { setup, test, cwd: worktreeNow(), logPath: nextTestsLogPath(controlDir) });
    } else {
      // The baseline (§2.5): the same pair at the starting commit, in a throwaway worktree. One that
      // cannot be made is a result too: the message then says the starting point could not be tested.
      let path;
      try {
        path = openBaseline(state.id, { root, from: state.baseSha }).path;
      } catch (err) {
        const failed = { kind, ok: false, half: null, reason: `its worktree could not be made (${String(err?.message ?? err).trim()})`, logPath: null, tail: '' };
        command = { kind, since: now(), kill() {}, poll: () => failed };
        waker.wake();
        return;
      }
      command = startRun(kind, { setup, test, cwd: path, logPath: join(controlDir, 'baseline.log') });
    }
    log(`${kind} run started`);
  };
  // commandDone() → the finished run as the decision's fact, or null while it runs (or there is none).
  const commandDone = () => {
    const done = command?.poll() ?? null;
    if (!done) return null;
    command = null;
    forgetCommandFile();
    if (done.kind === 'baseline') dropBaseline();
    const fact = done.kind === 'tests' ? { ...done, ...treeNow() } : done;
    log(`${done.kind} run ${done.ok ? 'green' : `red: ${done.reason}`}${done.kind === 'tests' ? ` (head ${String(fact.head).slice(0, 7)}, ${fact.clean ? 'clean' : 'dirty'})` : ''}`);
    return fact;
  };

  // ---- The snapshot and the index (PIR_RUN only). ----
  const record = () => {
    for (const key of [indexKey(), state.id]) {
      try {
        const rec = parseRecord(readFileSync(recordPath(repo, key, { dir: indexDir }), 'utf8'));
        if (rec) return rec;
      } catch {
        // not under this name
      }
    }
    return null;
  };
  const indexed = selfReport ? record() : null;
  const label = indexed?.label ?? null;
  const proc = {
    pid: process.pid,
    startTime: indexed?.startTime ?? env.PIR_START_TIME ?? null,
    repo,
    startedAt: new Date(now()).toISOString(),
  };
  const stepFinished = (step) => {
    const inReview = state.step === 'review' || state.step === 'rename';
    if (state.outcome !== null) return step === 'build' || inReview;
    return step === 'build' && inReview;
  };
  const runState = () => {
    const views = holder.views();
    const running = command ? { kind: command.kind, since: command.since } : null;
    trackStoppedAt(askingState(state, running?.kind ?? state.running), views, stoppedAt, now);
    // A finished step's time, read once from its logs when none of its sessions is live any more.
    for (const step of STEPS) {
      if (step in took || holder.sessions.some((x) => x.step === step && x.live)) continue;
      if (stepFinished(step)) took[step] = holder.workedMs(step);
    }
    // The label names the run only until it has a name (the index rename clears it there).
    return singleRunState(state, { label: state.name && state.renamed?.index ? null : label, sessions: views, since, stoppedAt, took, running });
  };
  const branchNow = () => (state.name && branchExists(`pir/${state.name}`) ? `pir/${state.name}` : `pir/${state.id}`);
  let lastPainted = null;
  const paint = (finalState = null) => {
    if (!selfReport) return;
    const rs = runState();
    const text = JSON.stringify([rs, finalState, controlDir]);
    if (text === lastPainted && finalState === null) return;
    lastPainted = text;
    try {
      writeSnapshot(controlDir, { proc: { ...proc, slug: indexKey(), branch: branchNow() }, finalState, runState: rs });
    } catch (err) {
      log(`snapshot write failed: ${err?.message ?? err}`);
    }
  };
  const recordFinal = (finalState) => {
    paint(finalState);
    if (!selfReport) return;
    try {
      // Under the name once the entry is renamed; a stop in the middle of the rename still finds it.
      const key = state.name && hasRecord(state.name) ? state.name : state.id;
      updateRecordFn({ repo, slug: key }, { finalState, updatedAt: new Date(now()).toISOString() }, { dir: indexDir });
    } catch (err) {
      log(`index final-status update failed: ${err?.message ?? err}`);
    }
  };

  const saveState = (next) => {
    state = next;
    writeJsonAtomic(statePath, state);
  };

  let personInbox = startPersonInbox({ controlDir, platform, grants, watch, log });

  // ---- The rename (§2.4 step 4), one sub-step at a time; each is a no-op when already done. It is
  // planning's rename (plan-run.mjs renameStep) on the single run's control folder. ----
  const renameStep = (substep) => {
    const name = state.name;
    if (substep === 'branch' || substep === 'worktree') {
      // renamePlanBranch does both, skipping whichever is already done, so a crash between them is
      // finished by the same call.
      const done = renamedOnDisk();
      if (done.branch && done.worktree) return;
      renamePlanBranch(state.id, name, { root });
      log(`renamed branch and worktree to pir/${name}`);
    } else if (substep === 'control') {
      const from = controlOf(state.id);
      const to = controlOf(name);
      // The inbox watch is on the old folder; it is restarted on the new one below.
      personInbox.stop();
      if (!existsSync(statePathOf(to))) {
        if (existsSync(to)) throw new Error(`single-run: ${to} already exists and is not this run's control folder`);
        mkdirSync(dirname(to), { recursive: true });
        renameSync(from, to);
      }
      // Never a recursive delete: only the emptied folders go. run.log keeps being written: its open
      // descriptor follows the moved file.
      for (const dir of [join(root, 'plans', state.id, '.parallel'), join(root, 'plans', state.id)]) {
        try {
          rmdirSync(dir);
        } catch (err) {
          if (err?.code !== 'ENOENT') log(`left ${dir} in place: ${err?.code ?? err?.message ?? err}`);
        }
      }
      controlDir = to;
      statePath = statePathOf(to);
      reportsDir = reportsDirOf(to);
      personInbox = startPersonInbox({ controlDir, platform, grants, watch, log });
      holder.controlMoved(from, to);
      log(`moved the control folder to ${to}`);
    } else if (substep === 'index') {
      if (hasRecord(name)) {
        // A crash inside renameRecord left both entries: the new one is whole, the old one goes.
        if (hasRecord(state.id)) removeRecord({ repo, slug: state.id }, { dir: indexDir });
      } else if (hasRecord(state.id)) {
        renameRecord({ repo, from: state.id, to: name }, { label: null, controlDir, branch: `pir/${name}` }, { dir: indexDir });
        log(`renamed the index entry to ${repo}__${name}`);
      }
    }
  };

  // ---- The loop. ----
  let first = true;
  // The answer to the last `check` action, handed to the decision on the next turn.
  let checked = null;
  try {
    for (;;) {
      if (signal?.aborted) {
        // `stopped` goes on record first: closing a session that will not go takes the whole 4 s before
        // pir's SIGKILL, and a program killed before it records reads as crashed. The command run is
        // killed before the close for the same reason: it must not outlive a program that is SIGKILLed
        // while it waits on the session. state.json keeps `running`, so a resume starts that run again.
        recordFinal('stopped');
        killCommand();
        await holder.closeCurrent(STOP_CLOSE);
        paint('stopped');
        log('stopped');
        return 0;
      }
      personInbox.drain(); // the backstop for a drop the forwarder's watch missed

      let reports = drainDropFolder(reportsDir, { onBad: (n, e) => log(`unreadable report ${n}: ${e?.message ?? e}`) })
        .map((r) => parseSingleReport(r?.text))
        .filter(Boolean);
      for (const r of reports) log(`report: ${r.kind} single=${r.name ?? '-'}`);

      // What the decision is told of the session describes the one held now, read here and nowhere
      // earlier: a session reopened by the last turn's actions must not be read as the one that exited.
      const current = holder.current();
      const activity = current?.live ? workerActivity(current.worker.entries()) : null;
      // Idle is a turn ended with no request pending and no background job of its own still running:
      // the idle gate closes a session on it, and a job of the session's may still be committing.
      const idle = !!activity && activity.state === 'idle' && !(activity.background?.length > 0);
      const isResume = first && resume;
      first = false;
      const done = commandDone();
      let facts = {
        resume: isResume,
        reports,
        checks: checked?.checks ?? null,
        head: checked?.head ?? null,
        idle,
        live: !!current,
        exited: !!current && !current.live,
        sessionId: current?.id ?? null,
        commandDone: done,
      };
      checked = null;
      if (isResume || state.step === 'rename') facts.renamed = renamedOnDisk();

      // The decision closes a step on a green result for the head it recorded. A session that commits or
      // edits after that result without reporting is seen here, at the idle gate: its accepted claim is
      // put to the checks again, so the close never goes ahead on a commit pir did not test (§2.4 step 3,
      // §2.12), as the planning run re-checks an accepted plan before it closes the planner.
      const kinds = STEP_KINDS[state.step] ?? [];
      const acc = state.accepted;
      if (
        acc && acc.kind !== 'dropped' && !state.pending && !state.running && !done && facts.checks === null &&
        !reports.some((r) => kinds.includes(r.kind)) &&
        state.tested?.ok === true && state.tested.head === acc.head && (idle || !current?.live)
      ) {
        const tree = treeNow();
        if (tree.head !== acc.head || !tree.clean) {
          log(`the worktree changed after the green run on ${String(acc.head).slice(0, 7)}: checking the ${acc.kind} report again`);
          reports = [...reports, { kind: acc.kind, name: acc.name, body: '' }];
          facts = { ...facts, reports };
        }
      }

      const prev = state;
      const { state: next, actions } = decideSingleStep(state, facts);

      // A run with nothing left to do: a `--resume` of a finished run, which is not resumable (§2.11).
      if (next.outcome !== null && actions.length === 0) {
        // `pir`'s resume cleared the final status with the new pid; put it back so the row is not crashed.
        if (selfReport && indexed && indexed.finalState == null) recordFinal('finished');
        log(`nothing to resume: the run is finished (${next.outcome})`);
        return 0;
      }

      // The rename runs between the sessions. state.json is written at step `rename` before the builder
      // is closed, so a crash from here on resumes into the rename, never into the closed builder, and
      // each sub-step is recorded as it lands; the decision's own state is written once the last one has.
      // A resume already at `review` stays at `review`, so the reviewer's session is reopened rather
      // than started afresh.
      const renaming = actions.some((a) => a.type === 'rename');
      let partial = false;
      if (renaming) {
        const onDisk = facts.renamed ?? renamedOnDisk();
        saveState({ ...next, step: prev.step === 'review' ? 'review' : 'rename', renamed: { ...onDisk }, live: false });
        partial = true;
      } else if (JSON.stringify(next) !== JSON.stringify(prev)) {
        saveState(next);
      }

      let again = false;
      for (const a of actions) {
        if (a.type === 'rename') {
          renameStep(a.substep);
          saveState({ ...state, renamed: { ...state.renamed, [a.substep]: true } });
          paint();
          continue;
        }
        // Anything after the closing session's close and the sub-steps acts on the renamed run.
        if (partial && a.type !== 'closeWhenIdle') {
          saveState(next);
          partial = false;
        }
        if (a.type === 'runSetup') startCommand('setup');
        else if (a.type === 'runTests') startCommand('tests');
        else if (a.type === 'runBaseline') startCommand('baseline');
        else if (a.type === 'spawn') {
          setupNote = a.note ? formatSingleSetupNote(a.note, { setup: state.commands.setup }) : null;
          holder.spawn(a.step);
          setupNote = null;
          again = true;
        } else if (a.type === 'resumeSession') {
          const rec = holder.spawn(a.step, a.sessionId);
          rec.worker.send(resumeInstruction(), { from: 'pir' });
          again = true;
        } else if (a.type === 'check') {
          const worktree = worktreeNow();
          const checks = singleChecks({ kind: a.kind, name: a.name, run: state, worktree, root, repo, indexDir, startSha: state.baseSha, git, slugTaken });
          const head = git(worktree, ['rev-parse', 'HEAD']);
          checked = { checks, head: head.ok ? head.stdout.trim() : null };
          log(`checks for ${a.kind} ${a.name}: ${checks.ok ? 'ok' : checks.failures.join(' | ')}`);
          again = true;
        } else if (a.type === 'send') {
          if (!holder.current()?.worker.send(a.text, { from: 'pir' })) log('a message to the session was not delivered');
        } else if (a.type === 'closeWhenIdle') {
          await holder.closeCurrent();
        } else if (a.type === 'finish') {
          // A `dropped` can land while pir's tests run; nobody will read their result.
          killCommand();
          recordFinal('finished');
          log(`finished: ${a.outcome}`);
          return 0;
        } else if (a.type === 'exitCrashed') {
          paint();
          log('the session exited without a report it can act on: exiting with no final status (crashed)');
          return 1;
        }
      }
      if (partial) saveState(next);
      // A check's answer and a fresh session's id go to the decision at once. The checks are not painted
      // in between: for that one turn the report is neither accepted nor refused, and an idle session
      // would flash as asking.
      if (checked) continue;
      paint();
      if (again) continue;
      await waker.wait([reportsDir, personInbox.inboxDir], pollMs, { watch, signal, unref: true });
    }
  } catch (err) {
    log(`error: ${err?.stack ?? err}`);
    await holder.closeCurrent(STOP_CLOSE);
    return 1;
  } finally {
    killCommand();
    personInbox.stop();
  }
}

// parseArgs(argv) → { controlDir, resume } | { error }.
export function parseArgs(argv) {
  let controlDir = null;
  let resume = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--control' && argv[i + 1]) controlDir = argv[++i];
    else if (argv[i] === '--resume') resume = true;
    else return { error: `unknown argument "${argv[i]}"` };
  }
  if (!controlDir) return { error: 'missing --control <dir>' };
  return { controlDir: resolve(controlDir), resume };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  if (args.error) {
    process.stderr.write(`single-run: ${args.error}\nusage: node src/shell/single-run.mjs --control <dir> [--resume]\n`);
    process.exit(2);
  }
  // A `pir` stop is SIGTERM (§2.11): the loop kills the command run, closes the session, records
  // `stopped` and returns.
  const stop = new AbortController();
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => stop.abort());
  runSingle({ controlDir: args.controlDir, resume: args.resume, deps: { signal: stop.signal } }).then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`${err?.stack ?? err}\n`);
      process.exit(1);
    },
  );
}
