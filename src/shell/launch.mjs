// The engine behind `pir start {slug}` and `pir plan` (DESIGN §2.5, §2.9, §3.4): run the pre-flight, launch the
// coordinator detached from the terminal, register the run in the cross-repo index, and hold the Mac
// awake for the run's lifetime. This is the piece that makes a run outlive WezTerm — the detached
// spawn was proven on this machine to reparent to launchd and keep running after its parent exited
// (FINDINGS 2026-09-22). The front-end (`bin/pir` → `pir.mjs`, T11) calls startRun and, on
// `already-running`, opens the live view instead of starting a second run.
//
// Everything the tests must not really do is injected: `spawn` (no real coordinator, no real
// caffeinate), `exec`/`kill` (no real `ps`/`kill` — these ride through to identity.mjs), `fs` (no real
// run.log), `now` (a fixed clock), and `env` (a scratch `~/.pir`). Only the two plan gates read for real
// — the working tree and, for a plan that lives only on branch pir/{slug}, git (planHome,
// pir-plan-command §2.9) — the same gates the coordinator enforces (DESIGN §2.1), so `pir` refuses an
// unreviewed plan for exactly the reason and with exactly the verdict the coordinator would. The `exec`
// injected here is identity.mjs's `ps` probe, not git, so it is deliberately not passed to the gates.

import { spawn as realSpawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import * as nodeFs from 'node:fs';
import { mkdirSync, openSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { basename, join } from 'node:path';

import { readReviewGate, readTestBlockGate } from './coordinate.mjs';
import { startTimeOf, resolveLiveness } from './identity.mjs';
import { indexDir, listRecords, recordPath, updateRecord, writeRecord } from './index-store.mjs';
import { planHome } from './plan-home.mjs';
import { openPlanBranch } from './worktree.mjs';
import { prepareBase as prepareBaseReal, resolveBaseSetting } from './base-branch.mjs';
import { refusalText } from '../core/basebranch.mjs';
import { writeFileAtomic, writeJsonAtomic } from './atomic-write.mjs';
import { classifyRun } from '../core/runstate.mjs';
import { initialPlanState, runIdFrom } from '../core/planflow.mjs';
import { labelFromBrief } from '../core/runrecord.mjs';

// The filesystem calls startRun makes directly — only to prepare the coordinator's run.log. The index
// writes go through index-store's own fs (a scratch dir via $PIR_HOME in tests); this pair is what a
// caller injects to keep the run.log open off the real disk.
const DEFAULT_FS = { mkdirSync, openSync };

// startRun(slug, { cwd, spawn, exec, kill, fs, now, env }) →
//   { started:true, pid, record } | { started:false, reason, alreadyRunning? }
//   { started:false, reason:'no-test-block', detail }   // detail: the parser's reason
//   reason: 'no-plan' | 'not-reviewed' | 'no-test-block' | 'already-running'
//
// cwd is the target repo's root: `pir` is invoked from inside the repo whose plan is being run, so its
// basename is the repo name the index entry and the coordinator's worker names share (DESIGN §2.8), and
// the coordinator is spawned with this as its cwd so it finds the same plan (the coordinator re-derives
// its own root from cwd). The engine's own coordinate.mjs is resolved from THIS file's location, never
// as a path under cwd — `pir` is the installed engine driving a run in whatever repo it is called from.
//
// `coordinator: false` is `pir start {slug} --no-coordinator` (pir-coordinator DESIGN §2.1): the child gets
// PARALLEL_COORDINATOR=0 and the index record keeps `coordinator: false`, so resumeRun passes it on.
export function startRun(
  slug,
  {
    cwd = process.cwd(),
    spawn = realSpawn,
    exec,
    kill,
    fs = DEFAULT_FS,
    now = () => new Date(),
    env = process.env,
    coordinator = true,
  } = {},
) {
  const repoRoot = cwd;
  const repo = basename(repoRoot);
  const controlDir = join(repoRoot, 'plans', slug, '.parallel', 'control');
  const branch = `pir/${slug}`;
  const dir = indexDir({ env });

  // Pre-flight, in order, before anything is spawned (DESIGN §2.5): a pre-flight failure that only
  // surfaced after detaching would show the user a crashed run instead of a clean error.

  // 1 & 2: the plan folder and its review gate, via the coordinator's own gate. `missing` means there
  // is no plans/{slug}/PROGRESS.md at all, neither in this checkout nor committed on pir/{slug}
  // (planHome) — the plain "no such plan" case; a present-but-unreviewed
  // plan is refused with the same 'not-reviewed' the coordinator uses.
  const gate = readReviewGate(slug, { root: repoRoot });
  if (gate.missing) return { started: false, reason: 'no-plan' };
  // Whether a run of this slug is live now: only a `running` classification counts. A crashed, stopped
  // or finished run does NOT block a start — re-running its slug is exactly how a run resumes (DESIGN
  // §2.5, §6), and the coordinator reconciles from committed work.
  const existing = listRecords({ dir }).find((r) => r.repo === repo && r.slug === slug);
  const running = () => {
    if (!existing) return false;
    const { alive, liveStartTime } = resolveLiveness(existing.pid, { kill, exec });
    return classifyRun({ recordedStartTime: existing.startTime, finalState: existing.finalState, alive, liveStartTime }) === 'running';
  };
  if (!gate.reviewed) {
    // A plan that lives only on pir/{slug} is a `pir plan` run not yet reviewed: `pir` names resume
    // rather than /pir-review-plan (pir-plan-command §2.16). A plan on main keeps today's exact result.
    if (planHome(slug, { root: repoRoot }).where === 'branch') {
      // Its planning run is live (being planned or reviewed): open it, as `pir start` opens a live build,
      // rather than tell the person to resume what is not stopped (user, T14 drill, 2026-09-26).
      if (running()) return { started: false, reason: 'already-running', alreadyRunning: true };
      return { started: false, reason: 'not-reviewed', where: 'branch' };
    }
    return { started: false, reason: 'not-reviewed' };
  }

  // 2b: a plan without a valid setup/test block in DESIGN.md counts as not reviewed (declared-test-command
  // DESIGN §2.3) — checked after the review gate so an unreviewed plan still reports not-reviewed first.
  const block = readTestBlockGate(slug, { root: repoRoot });
  if (!block.ok) return { started: false, reason: 'no-test-block', detail: block.reason };

  // 3: no run for this slug is already live (the index entry T06, liveness T05, classification T01).
  // The caller opens the live view instead of starting a second run (DESIGN §2.5).
  if (running()) return { started: false, reason: 'already-running', alreadyRunning: true };

  // Launch. The coordinator path is the engine's own sibling coordinate.mjs, resolved from this file's
  // URL — NOT the bare relative 'src/shell/coordinate.mjs', which would look under the target repo's
  // cwd rather than the installed engine.
  const coordinatorPath = fileURLToPath(new URL('./coordinate.mjs', import.meta.url));

  // The detached child's stdout and stderr go to run.log in the control folder, opened for append so a
  // restarted run adds to it rather than truncating the last run's tail.
  fs.mkdirSync(controlDir, { recursive: true });
  const logFd = fs.openSync(join(controlDir, 'run.log'), 'a');

  // detached:true gives the child its own session and process group, so closing the terminal does not
  // send it the hang-up signal — this is what lets the run outlive WezTerm (FINDINGS 2026-09-22). unref
  // lets the parent (`pir`) exit into the TUI without waiting on the child. PIR_RUN switches the
  // coordinator into its self-reporting/snapshot mode (DESIGN §3.5); PARALLEL_LIVE is the live seatbelt
  // that lets it actually spawn workers (DESIGN §5.2).
  const child = spawn('node', [coordinatorPath, slug], {
    cwd: repoRoot,
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: { ...env, PARALLEL_LIVE: '1', PIR_RUN: '1', ...(coordinator ? {} : { PARALLEL_COORDINATOR: '0' }) },
  });
  child.unref();

  // Capture the coordinator's launch time right after spawn: classifyRun compares this recorded time
  // against the live one to tell a real run from a reused process number (DESIGN §3.3, T01/T05).
  const startTime = startTimeOf(child.pid, { exec });
  const record = {
    version: 1,
    slug,
    repo,
    repoPath: repoRoot,
    controlDir,
    pid: child.pid,
    startTime,
    startedAt: now().toISOString(),
    branch,
    finalState: null,
    updatedAt: null,
    ...(coordinator ? {} : { coordinator: false }),
  };
  writeRecord(record, { dir });

  // Keep-awake tied to the coordinator's lifetime: `-i` blocks idle sleep, `-w {pid}` makes caffeinate
  // wait on the coordinator and exit when it dies, so any death of the run — clean exit, stop, crash or
  // force-kill — releases the Mac and no path strands it awake (DESIGN §2.9). Detached and unref'd for
  // the same reason as the coordinator: it must outlive `pir` returning into the TUI.
  spawn('caffeinate', ['-i', '-w', String(child.pid)], { detached: true, stdio: 'ignore' }).unref();

  return { started: true, pid: child.pid, record };
}

// ---- Planning runs (pir-plan-command T08, DESIGN §2.2, §2.14, §2.16) ----
//
// startPlanRun is the one entry every surface uses to start a planning run (the `pir plan` commands,
// the brief box), and resumeRun the one entry to resume a stopped or crashed run of either type (the
// dashboard's Ctrl+R chord). Git runs for real — the pre-flight and openPlanBranch are git questions and
// the tests drive them against scratch repos — while `spawn`, `exec` (identity.mjs's `ps` probe, as in
// startRun) and `kill` are injected so no process is ever started by a test.

// The planning program, resolved from this file like the coordinator: the installed engine's own copy,
// never a path under the target repo.
const planRunPath = () => fileURLToPath(new URL('./plan-run.mjs', import.meta.url));

// How many run ids are drawn before giving up. 65 536 ids exist; hitting this means the random source
// is broken (a stuck injected one), not that the repo is full.
const MAX_ID_TRIES = 64;

function gitOk(cwd, args) {
  try {
    const stdout = execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return { ok: true, stdout };
  } catch {
    return { ok: false, stdout: '' };
  }
}

// planPreflight({ cwd, env, prepareBase }) → { ok: true, root, repo, base, baseSha, remote, file }
//   | { ok: false, reason, message?, base?, remote? }       (file: the settings file that named the base)
//   reason: 'not-a-repo'|'no-base-setting'|'bad-settings'|'no-base-branch'|'fetch-failed'|'diverged'
// pir-plan-command DESIGN §2.2 steps 1–2 and base-branch DESIGN §2.6, in order. There is no repo-name
// check: the canonical-repo guard was removed (dashboard-plan-box DESIGN §2.8), so planning works in any
// checkout. The brief is the caller's: bare `pir plan` runs this before the person has typed one
// (§2.13). A base refusal carries `message`, the §2.9 refusal text, and creates nothing; the only
// changes a pre-flight may leave are the remote-tracking ref the fetch updated and a local base branch
// §2.3 created or moved forward, both safe (base-branch §2.6). The fetch runs here, synchronously in
// pir's own process, so a refusal reaches the person before the detached planning program starts.
export function planPreflight({ cwd = process.cwd(), env = process.env, prepareBase = prepareBaseReal } = {}) {
  // 1. Inside a work tree. The root is the MAIN worktree, whichever folder or linked worktree `pir plan`
  // was typed in: `git worktree list` names the main one first from anywhere in the repo.
  const inside = gitOk(cwd, ['rev-parse', '--is-inside-work-tree']);
  if (!inside.ok || inside.stdout.trim() !== 'true') return { ok: false, reason: 'not-a-repo' };
  const first = gitOk(cwd, ['worktree', 'list', '--porcelain']).stdout.split('\n').find((l) => l.startsWith('worktree '));
  if (!first) return { ok: false, reason: 'not-a-repo' };
  const root = first.slice('worktree '.length).trim();
  const repo = basename(root);

  // 2. The base branch, stated in the settings (base-branch §2.1, §2.2), never guessed.
  const setting = resolveBaseSetting(root, { env });
  if (!setting.ok) return { ok: false, reason: setting.reason, message: refusalText(setting, { repo }) };
  const base = setting.base;

  // 3. The newest commit of that base (§2.3). Never checks anything out: the person's checkout stays put.
  const prep = prepareBase(root, base, { env });
  if (!prep.ok) {
    return {
      ok: false,
      reason: prep.reason,
      message: refusalText(prep, { repo, base, file: setting.file }),
      base,
      remote: prep.remote ?? null,
    };
  }
  return { ok: true, root, repo, base, baseSha: prep.sha, remote: prep.remote ?? null, file: setting.file };
}

function defaultRandom() {
  return randomBytes(2).toString('hex');
}

// A run id is taken when anything the run would create under it already exists: its branch, its index
// entry (the file, parseable or not, since writeRecord would overwrite it) or its plans/ folder.
function runIdTaken(runId, { root, repo, dir, fs }) {
  if (gitOk(root, ['rev-parse', '--verify', '--quiet', `refs/heads/pir/${runId}`]).ok) return true;
  if (fs.existsSync(recordPath(repo, runId, { dir }))) return true;
  return fs.existsSync(join(root, 'plans', runId));
}

// Spawn a detached node program with its output appended to <controlDir>/run.log, plus the caffeinate
// that holds the Mac awake for exactly its lifetime — startRun's launch, for the planning program.
function spawnDetached(args, { cwd, controlDir, spawn, fs, env }) {
  fs.mkdirSync(controlDir, { recursive: true });
  const logFd = fs.openSync(join(controlDir, 'run.log'), 'a');
  const child = spawn('node', args, {
    cwd,
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: { ...env, PIR_RUN: '1' },
  });
  child.unref();
  // The child holds its own copy of the descriptor; pir keeps running its screen, so close ours.
  if (typeof fs.closeSync === 'function') fs.closeSync(logFd);
  return child;
}

function keepAwake(pid, spawn) {
  spawn('caffeinate', ['-i', '-w', String(pid)], { detached: true, stdio: 'ignore' }).unref();
}

// startPlanRun(brief, { cwd, spawn, exec, fs, now, env, random }) →
//   { started: true, runId, pid, record, controlDir }
//   | { started: false, reason: 'not-a-repo'|'empty-brief'|<a planPreflight base reason>, message?, base?, remote? }
// `random()` returns four lowercase hex characters. `fs` is node:fs-shaped (existsSync, mkdirSync,
// openSync, closeSync, writeFileSync, renameSync) and defaults to the real one.
export function startPlanRun(
  brief,
  {
    cwd = process.cwd(),
    spawn = realSpawn,
    exec,
    fs = nodeFs,
    now = () => new Date(),
    env = process.env,
    random = defaultRandom,
    prepareBase = prepareBaseReal,
  } = {},
) {
  const pre = planPreflight({ cwd, env, prepareBase });
  if (!pre.ok) {
    const { ok, ...refusal } = pre;
    return { started: false, ...refusal };
  }
  if (typeof brief !== 'string' || brief.trim() === '') return { started: false, reason: 'empty-brief' };
  const { root, repo, base, baseSha } = pre;
  const dir = indexDir({ env });

  let runId = null;
  for (let i = 0; i < MAX_ID_TRIES && runId === null; i += 1) {
    const candidate = runIdFrom(random());
    if (!runIdTaken(candidate, { root, repo, dir, fs })) runId = candidate;
  }
  if (runId === null) throw new Error(`startPlanRun: no free run id after ${MAX_ID_TRIES} tries`);

  let branch;
  try {
    // Cut from the commit the pre-flight chose, not the local base's tip: that may be behind the
    // remote's (base-branch §2.3, §2.6). openPlanBranch records pirBase on the new branch (§2.5).
    ({ branch } = openPlanBranch(runId, { root, base, from: baseSha }));
  } catch (err) {
    // The chosen commit vanished between the pre-flight and here: still nothing created.
    if (err && err.code === 'no-base-branch') {
      const refusal = { reason: 'no-base-branch', remote: pre.remote };
      return { started: false, ...refusal, base, message: refusalText(refusal, { repo, base, file: pre.file }) };
    }
    throw err;
  }

  // Under plans/{runId}/, not .git: the planner writes its reports here and Claude Code never
  // auto-approves a write under .git (§2.2). Ignored by plans/*/.parallel/.
  const controlDir = join(root, 'plans', runId, '.parallel', 'plan');
  fs.mkdirSync(controlDir, { recursive: true });
  writeFileAtomic(join(controlDir, 'brief.md'), brief, { fs });
  writeJsonAtomic(join(controlDir, 'state.json'), initialPlanState({ id: runId }), { fs });

  const child = spawnDetached([planRunPath(), '--control', controlDir], { cwd: root, controlDir, spawn, fs, env });
  const record = {
    version: 1,
    kind: 'plan',
    label: labelFromBrief(brief),
    go: null,
    slug: runId,
    repo,
    repoPath: root,
    controlDir,
    pid: child.pid,
    startTime: startTimeOf(child.pid, { exec }),
    startedAt: now().toISOString(),
    branch,
    baseBranch: base,
    finalState: null,
    updatedAt: null,
  };
  writeRecord(record, { dir });
  keepAwake(child.pid, spawn);
  return { started: true, runId, pid: child.pid, record, controlDir };
}

// resumeRun(record, { spawn, exec, kill, fs, now, env }) → { resumed: true, pid } | { resumed: false, reason }
// A plan record: the planning program again, detached, with --resume on the record's control folder
// (it reads state.json and resumes the step's last session, §2.14). A work record: startRun, exactly
// `pir start {slug}`, whose own refusals come back as the reason. A run still running is refused for
// either kind: two programs on one control folder would fight over it.
export function resumeRun(
  record,
  { spawn = realSpawn, exec, kill, fs = nodeFs, now = () => new Date(), env = process.env } = {},
) {
  const { alive, liveStartTime } = resolveLiveness(record.pid, { kill, exec });
  const state = classifyRun({ recordedStartTime: record.startTime, finalState: record.finalState, alive, liveStartTime });
  if (state === 'running') return { resumed: false, reason: 'already-running' };

  if (record.kind !== 'plan') {
    // The run's coordinator choice is kept across a resume (pir-coordinator DESIGN §2.1).
    const choice = record.coordinator === false ? { coordinator: false } : {};
    const r = startRun(record.slug, { cwd: record.repoPath, spawn, exec, kill, fs, now, env, ...choice });
    return r.started ? { resumed: true, pid: r.pid } : { resumed: false, reason: r.reason };
  }

  const child = spawnDetached([planRunPath(), '--control', record.controlDir, '--resume'], {
    cwd: record.repoPath,
    controlDir: record.controlDir,
    spawn,
    fs,
    env,
  });
  // finalState is cleared with the new pid: a resumed `stopped` or finished-not-reviewed run that kept
  // its old final status would classify as ended while its program runs again.
  updateRecord(
    { repo: record.repo, slug: record.slug },
    { pid: child.pid, startTime: startTimeOf(child.pid, { exec }), finalState: null, updatedAt: null },
    { dir: indexDir({ env }) },
  );
  keepAwake(child.pid, spawn);
  return { resumed: true, pid: child.pid };
}
