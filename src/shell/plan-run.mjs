// The detached planning program (pir-plan-command DESIGN §2.2–§2.5, §2.16, §3.4, §3.5).
//
//   node src/shell/plan-run.mjs --control <dir> [--resume]
//
// `pir plan` (startPlanRun, T08) cuts the plan branch, writes <dir>/brief.md and <dir>/state.json, and
// spawns this program detached. It holds one Claude session at a time through the build's worker line
// (startWorker, startPersonInbox, workers.json), reads the session's report files, runs the git checks
// a report claims, and hands everything to core/planflow's decidePlanStep, whose actions it executes in
// order. It decides nothing itself: every branch below is either an action of decidePlanStep or the
// plumbing that feeds it facts.
//
// The run: the planner (T06), then at its accepted `planned` the rename of branch, worktree, control
// folder and index entry (§2.6), then a fresh reviewer, finished on its `reviewed` or `not-reviewed`
// (§2.7). `--resume` (§2.14) reads state.json, finishes a half-done rename, and reopens the current
// step's last session by its id, sending it resumeInstruction() rather than the opening again (T07).
//
// Under PIR_RUN=1 (set only by the launcher, as for the coordinator) it writes status.json on every
// change of what the screen would show, and the final status to the snapshot and the index entry. Without
// it neither is touched, so a bare run in a test leaves no dashboard trace.

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import {
  decidePlanStep,
  isValidSlug,
  parsePlanReport,
  planSessionName,
  plannerInstruction,
  reviewerInstruction,
} from '../core/planflow.mjs';
import { parseProgress } from '../core/progress.mjs';
import { parseTestBlock } from '../core/testblock.mjs';
import { parseRecord } from '../core/runrecord.mjs';
import { allowResult, workerActivity } from '../core/stream.mjs';
import { writeJsonAtomic } from './atomic-write.mjs';
import { drainDropFolder, waitForDrop } from './drop-folder.mjs';
import { startTimeOf as startTimeOfReal } from './identity.mjs';
import { indexDir as indexDirOf, recordPath, removeRecord, renameRecord, updateRecord } from './index-store.mjs';
import { createGrants, startPersonInbox } from './person-inbox.mjs';
import { resolveClaudePath } from './platform.mjs';
import { reapRecorded } from './reap.mjs';
import { writeSnapshot as writeSnapshotReal } from './snapshot-store.mjs';
import { startWorker as startWorkerReal, writeWorkersFile } from './worker-proc.mjs';
import { git as gitReal, renamePlanBranch as renamePlanBranchReal, slugTaken as slugTakenReal } from './worktree.mjs';

// The wait between loop turns when nothing wakes it. A report, a person's input or any entry in the
// session's log wakes it at once; this is only the backstop for a missed watch event.
const POLL_MS = 5000;

// A stop has 4 s before `pir` sends SIGKILL (DESIGN §2.16), so the session gets 1 s to go on its own
// input closing and 3 s after its SIGTERM; the reap covers anything left.
const STOP_CLOSE = { graceMs: 1000, killMs: 3000 };

// The report kinds each step acts on (DESIGN §2.4). Only `planned` and `reviewed` claims need the git
// checks; `no-plan` and `not-reviewed` end the run on the session's word.
const STEP_KINDS = { plan: ['planned', 'no-plan'], review: ['reviewed', 'not-reviewed'] };
const CHECKED_KINDS = new Set(['planned', 'reviewed']);

// A pending request is the session asking the person (a permission prompt or a question set).
const REQUEST_KINDS = new Set(['permission', 'questions']);

const ROLE = { plan: 'planner', review: 'reviewer' };

export const statePathOf = (controlDir) => join(controlDir, 'state.json');
export const reportsDirOf = (controlDir) => join(controlDir, 'reports');

// rootOf(controlDir) → the main checkout. The control folder is <main>/plans/{id|slug}/.parallel/plan
// (DESIGN §2.2, §2.6), so the root is four levels up whichever name it sits under.
export function rootOf(controlDir) {
  return resolve(controlDir, '..', '..', '..', '..');
}

// nextPlanLogPath(controlDir, step) → conversations/plan-{n}.ndjson or review-{n}.ndjson, n one past the
// highest there (DESIGN §2.3), counted from the folder so a second session of a step never overwrites
// the first one's conversation.
export function nextPlanLogPath(controlDir, step, { readdir = readdirSync } = {}) {
  const prefix = step === 'plan' ? 'plan' : 'review';
  const dir = join(controlDir, 'conversations');
  let names = [];
  try {
    names = readdir(dir);
  } catch {
    names = [];
  }
  const re = new RegExp(`^${prefix}-(\\d+)\\.ndjson$`);
  let max = 0;
  for (const n of names) {
    const m = re.exec(n);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return join(dir, `${prefix}-${max + 1}.ndjson`);
}

// plannerChecks({ slug, worktree, root, repo, indexDir, git, slugTaken }) → { ok, reason } — the §2.5
// checks of a `planned` claim, all on the committed tree of the plan branch. The reason is sent to the
// planner as is, so each one says what failed and what to do.
export function plannerChecks({ slug, worktree, root, repo, indexDir, git = gitReal, slugTaken = slugTakenReal }) {
  const again = 'commit, and drop the `planned` report again';
  const rename = `Choose another name with the person, rename the plans/${slug} folder to it, ${again}.`;
  if (!isValidSlug(slug)) {
    return {
      ok: false,
      reason: `"${slug}" cannot be a plan name: it must be kebab-case (a-z, 0-9, single hyphens) and not of the form plan-xxxx. ${rename}`,
    };
  }
  const files = ['PROGRESS.md', 'PLAN.md', 'DESIGN.md'].map((f) => `plans/${slug}/${f}`);
  const listed = git(worktree, ['ls-tree', '--name-only', 'HEAD', '--', ...files]);
  const present = new Set(listed.ok ? listed.stdout.split('\n').map((l) => l.trim()) : []);
  const missing = files.filter((f) => !present.has(f));
  if (missing.length) {
    return { ok: false, reason: `${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not committed on this branch. Write ${missing.length === 1 ? 'it' : 'them'}, ${again}.` };
  }
  const taken = slugTaken(slug, { root, indexHas: (s) => existsSync(recordPath(repo, s, { dir: indexDir })) });
  if (taken) {
    const why = {
      branch: `a branch pir/${slug} already exists`,
      'main-plan': `a plan plans/${slug} is already on main`,
      index: `a pir run named ${slug} already exists`,
    }[taken] ?? `it is in use (${taken})`;
    return { ok: false, reason: `The name "${slug}" is taken: ${why}. ${rename}` };
  }
  const status = git(worktree, ['status', '--porcelain']);
  if (!status.ok || status.stdout.trim() !== '') {
    return { ok: false, reason: `The worktree has uncommitted changes (git status --porcelain is not empty). Commit everything you wrote, then drop the \`planned\` report again.` };
  }
  return { ok: true, reason: null };
}

// planRunState(state, session) → the status.json runState of a planning run (DESIGN §3.5), for T12 to
// paint. Pure. `session` is what this program holds beside state.json:
//   label      the dashboard name before the rename
//   sessions   every session this program started, in spawn order: { id, step, n, logPath, cwd, live, activity }
//   since      { plan, review } — when that step's latest session started (ms)
//   stoppedAt  { plan, review } — when that step's live session began asking the person (ms)
//   took       { plan, review } — how long a finished step's sessions worked (ms, stepWorkedMs), or absent
// Each step's phase: 'planning' | 'reviewing' while it is the current step (the dashboard tells a gone
// process crashed by itself), 'asking' while its live session has a request pending, 'done', 'failed'
// for the step a no-plan or not-reviewed outcome ended, 'pending' before it starts. `build` is pending
// here; the go and the build are read from the index (§2.8).
export function planRunState(state, { label = null, sessions = [], since = {}, stoppedAt = {}, took = {} } = {}) {
  const at = { plan: 0, rename: 1, review: 2, done: 3 }[state.step] ?? 0;
  const stepRow = (id) => {
    const mine = sessions.filter((s) => s.step === id);
    const live = mine.filter((s) => s.live).at(-1) ?? null;
    const open = live ?? mine.at(-1) ?? null;
    const asking = live && REQUEST_KINDS.has(live.activity?.state) ? live.activity.state : null;
    let phase;
    if (id === 'plan') {
      if (state.outcome === 'no-plan') phase = 'failed';
      else if (at >= 1) phase = 'done';
      else phase = asking ? 'asking' : 'planning';
    } else if (state.outcome === 'not-reviewed') phase = 'failed';
    else if (state.outcome === 'reviewed') phase = 'done';
    else if (at === 2) phase = asking ? 'asking' : 'reviewing';
    else phase = 'pending';
    const current = phase === 'planning' || phase === 'reviewing' || phase === 'asking';
    return {
      id,
      phase,
      since: current || phase === 'done' ? since[id] ?? null : null,
      stoppedAt: asking ? stoppedAt[id] ?? null : null,
      tookMs: phase === 'done' || phase === 'failed' ? took[id] ?? null : null,
      asking,
      worker: open ? { id: open.id, live: !!open.live, logPath: open.logPath ?? null, cwd: open.cwd ?? null } : null,
      workers: mine.map((s) => ({ id: s.id, role: ROLE[id], n: s.n ?? null, logPath: s.logPath ?? null, cwd: s.cwd ?? null })),
    };
  };
  return {
    kind: 'plan',
    label,
    slug: state.slug ?? null,
    step: state.step,
    outcome: state.outcome ?? null,
    steps: [
      stepRow('plan'),
      stepRow('review'),
      { id: 'build', phase: 'pending', since: null, stoppedAt: null, tookMs: null, asking: null, worker: null, workers: [] },
    ],
  };
}

// A wake-up the loop waits on: a drop in either folder, any entry in the live session's log, the
// session's exit, a stop, or the backstop timeout.
function createWaker() {
  let pending = null;
  let early = false;
  return {
    wake() {
      if (pending) {
        const r = pending;
        pending = null;
        r();
      } else {
        early = true;
      }
    },
    async wait(dirs, ms, { watch, signal } = {}) {
      if (early || signal?.aborted) {
        early = false;
        return;
      }
      const ac = new AbortController();
      const onAbort = () => ac.abort();
      signal?.addEventListener('abort', onAbort, { once: true });
      await Promise.race([
        waitForDrop(dirs, ms, { signal: ac.signal, unref: true, ...(watch ? { watch } : {}) }),
        new Promise((r) => (pending = r)),
      ]);
      pending = null;
      early = false;
      ac.abort();
      signal?.removeEventListener('abort', onAbort);
    },
  };
}

// findControlDir(controlDir) → the folder that holds the run's state.json. It is the one given, except
// after a crash between the control-folder move (§2.6 step 3) and the index rename (step 4): the index
// entry, and so `pir`'s resume, still names the folder under the run id, while state.json has moved
// under the slug. The run id is the folder name under plans/, so the moved folder is found by it.
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
    const dir = join(plans, name, '.parallel', 'plan');
    try {
      if (JSON.parse(readFile(statePathOf(dir), 'utf8')).id === id) return dir;
    } catch {
      // not a planning run's folder
    }
  }
  return controlDir;
}

// stepWorkedMs(logs) → how long a finished step's sessions worked, in ms, from their conversation logs'
// `t` stamps, or null when no log has two stamps. A resumed session appends to the log it exited in
// after a `resumed` note, so each log is cut into segments at those notes and the time between a stop
// and its resume is not counted, as the task rows' clocks do not count time nobody was working (T14,
// user 2026-09-26: a finished step shows how long it took, as the prototype does). Pure: `logs` is one
// array of parsed entries per log.
export function stepWorkedMs(logs) {
  let total = 0;
  let any = false;
  for (const entries of logs) {
    let first = null;
    let last = null;
    const close = () => {
      if (first != null && last != null && last > first) {
        total += last - first;
        any = true;
      }
      first = last = null;
    };
    for (const e of entries) {
      if (e?.dir === 'note' && e.kind === 'resumed') close();
      if (!Number.isFinite(e?.t)) continue;
      first ??= e.t;
      last = e.t;
    }
    close();
  }
  return any ? total : null;
}

// A conversation log's entries, the lines that parse; a missing log reads as none.
function readLogEntries(path) {
  let text = '';
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return [];
  }
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // a torn last line of a killed session: skipped
    }
  }
  return out;
}

// findSessionLog(controlDir, step, sessionId) → the conversation log a session wrote, or null: the
// highest-n plan-{n} / review-{n} log whose `init` carries that session id. A resumed session appends
// to it, so the person reads one conversation (DESIGN §2.3, §2.14).
export function findSessionLog(controlDir, step, sessionId, { readdir = readdirSync, readFile = readFileSync } = {}) {
  const prefix = step === 'plan' ? 'plan' : 'review';
  const dir = join(controlDir, 'conversations');
  let names = [];
  try {
    names = readdir(dir);
  } catch {
    return null;
  }
  const re = new RegExp(`^${prefix}-(\\d+)\\.ndjson$`);
  const logs = names
    .map((name) => ({ name, n: Number(re.exec(name)?.[1] ?? NaN) }))
    .filter((l) => Number.isFinite(l.n))
    .sort((a, b) => b.n - a.n);
  const needle = `"session_id":${JSON.stringify(sessionId)}`;
  for (const l of logs) {
    let text = '';
    try {
      text = readFile(join(dir, l.name), 'utf8');
    } catch {
      continue;
    }
    if (text.includes(needle)) return { logPath: join(dir, l.name), n: l.n };
  }
  return null;
}

// reviewerChecks({ slug, worktree, git }) → { ok, reason } — the §2.7 checks of a `reviewed` claim, on
// the committed tree of the plan branch: the review gate reads reviewed as the build will read it
// (readReviewGate), the setup/test block parses as the build's pre-flight will parse it, and the
// worktree is clean. The reason is sent to the reviewer as is.
export function reviewerChecks({ slug, worktree, git = gitReal }) {
  const again = 'commit, and drop the `reviewed` report again';
  const show = (file) => git(worktree, ['show', `HEAD:plans/${slug}/${file}`]);
  const progress = show('PROGRESS.md');
  if (!progress.ok) return { ok: false, reason: `plans/${slug}/PROGRESS.md is not committed on this branch. Restore it, ${again}.` };
  if (!parseProgress(progress.stdout).planReviewed.reviewed) {
    return { ok: false, reason: `The committed plans/${slug}/PROGRESS.md does not read reviewed: its **Plan reviewed:** line is missing, empty or "not yet". Mark it reviewed, ${again}.` };
  }
  const design = show('DESIGN.md');
  const block = design.ok ? parseTestBlock(design.stdout) : { ok: false, reason: 'the file is not committed' };
  if (!block.ok) {
    return { ok: false, reason: `The setup/test block at the top of the committed plans/${slug}/DESIGN.md does not parse (${block.reason ?? 'invalid'}). Fix it, ${again}.` };
  }
  const status = git(worktree, ['status', '--porcelain']);
  if (!status.ok || status.stdout.trim() !== '') {
    return { ok: false, reason: `The worktree has uncommitted changes (git status --porcelain is not empty). Commit everything you wrote, then drop the \`reviewed\` report again.` };
  }
  return { ok: true, reason: null };
}

// runPlanning({ controlDir, resume, deps }) → exit code: 0 at a clean end (finished, stopped, or a
// `--resume` of a run with nothing left to do), 1 when the session left no way forward or a step failed
// (crashed, resumable), 2 when the run cannot start. deps, all optional:
//   env, now, log, signal (an AbortSignal: a stop), claudePath, startWorker, startTimeOf, reap, git,
//   slugTaken, renamePlanBranch, writeSnapshot, updateRecord, watch, uuid, pollMs
export async function runPlanning({ controlDir: givenControlDir, resume = false, deps = {} }) {
  const {
    env = process.env,
    now = Date.now,
    log = (line) => process.stdout.write(`${new Date(now()).toISOString()} ${line}\n`),
    signal,
    startWorker = startWorkerReal,
    startTimeOf = startTimeOfReal,
    reap = reapRecorded,
    git = gitReal,
    slugTaken = slugTakenReal,
    renamePlanBranch = renamePlanBranchReal,
    writeSnapshot = writeSnapshotReal,
    updateRecord: updateRecordFn = updateRecord,
    watch,
    uuid = randomUUID,
    pollMs = POLL_MS,
  } = deps;

  // Every path below is re-pointed when the control folder moves at the rename (§2.6 step 3).
  let controlDir = resume ? findControlDir(givenControlDir) : givenControlDir;
  if (controlDir !== givenControlDir) log(`state.json found in ${controlDir} (the rename had moved it)`);
  let statePath = statePathOf(controlDir);
  let reportsDir = reportsDirOf(controlDir);
  let state;
  let brief;
  try {
    state = JSON.parse(readFileSync(statePath, 'utf8'));
    brief = readFileSync(join(controlDir, 'brief.md'), 'utf8');
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
  const indexKey = () => state.slug ?? state.id;
  const controlOf = (name) => join(root, 'plans', name, '.parallel', 'plan');
  const hasRecord = (key) => existsSync(recordPath(repo, key, { dir: indexDir }));
  const branchExists = (b) => git(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${b}`]).ok;

  // renamedOnDisk() → which §2.6 sub-steps are done, read from git and the disk rather than state.json,
  // since a crash can fall between a sub-step and the state write that records it. An index with no
  // entry under either name has nothing to rename; one with both (renameRecord wrote the new entry and
  // died before removing the old) is not done, and the executor finishes it.
  const renamedOnDisk = () => {
    const slug = state.slug;
    if (!slug) return { branch: false, worktree: false, control: false, index: false };
    return {
      branch: !branchExists(`pir/${state.id}`) && branchExists(`pir/${slug}`),
      worktree: existsSync(join(worktreesBase, `pir-${slug}`, '.git')) && !existsSync(join(worktreesBase, `pir-${state.id}`)),
      control: existsSync(statePathOf(controlOf(slug))),
      index: !hasRecord(state.id),
    };
  };
  // The session's working directory: the plan branch's worktree, under whichever name it has now.
  const worktreeNow = () =>
    state.slug && existsSync(join(worktreesBase, `pir-${state.slug}`)) ? join(worktreesBase, `pir-${state.slug}`) : join(worktreesBase, `pir-${state.id}`);

  let claudePath = deps.claudePath;
  try {
    claudePath ??= resolveClaudePath();
  } catch (err) {
    log(err.message);
    return 2;
  }

  // A previous program killed outright may have left its session running (DESIGN §2.16).
  try {
    const { reaped } = await reap(controlDir);
    if (reaped.length) log(`reaped leftover sessions ${reaped.join(', ')}`);
  } catch (err) {
    log(`reap failed: ${err?.message ?? err}`);
  }

  // ---- The sessions this program holds, and the platform the person inbox forwards through. ----
  // A session from an earlier program (a resume) is listed closed, with its log, so the screen can still
  // open its conversation; a resumed one is taken up again in the same record.
  const sessions = []; // { id, step, n, logPath, worker, live, startTime }
  for (const step of ['plan', 'review']) {
    for (const id of state.sessions?.[step] ?? []) {
      const found = findSessionLog(controlDir, step, id);
      sessions.push({ id, step, n: found?.n ?? null, logPath: found?.logPath ?? null, worker: null, live: false, startTime: null });
    }
  }
  let current = null;
  const since = {};
  const stoppedAt = {};
  const took = {};
  const waker = createWaker();
  const grants = createGrants();
  const byId = (id) => sessions.find((s) => s.id === id) ?? null;
  const workerOf = (id) => byId(id)?.worker ?? null;

  const writeWorkers = () => {
    try {
      writeWorkersFile(
        controlDir,
        sessions.filter((s) => s.live).map((s) => ({ id: s.id, task: 'plan', role: ROLE[s.step], pid: s.worker.pid, startTime: s.startTime, cwd: worktreeNow() })),
      );
    } catch (err) {
      log(`workers.json write failed: ${err?.message ?? err}`);
    }
  };

  const platform = {
    send: (id, text, opts) => ({ ok: !!workerOf(id)?.send(text, opts) }),
    interrupt: (id, opts) => {
      const w = workerOf(id);
      if (!w) return { ok: false };
      w.interrupt(opts).catch(() => {});
      return { ok: byId(id).live };
    },
    answer: (id, requestId, result, opts) => ({ ok: !!workerOf(id)?.answer(requestId, result, opts) }),
    pending: (id) => (byId(id)?.live ? byId(id).worker.pending() : []),
    note: (id, kind, fields) => {
      const w = workerOf(id);
      if (!w) return { ok: false };
      w.note(kind, fields);
      return { ok: true };
    },
    logPathOf: (id) => byId(id)?.logPath ?? null,
  };

  // spawn(step, resumeSessionId?) → a fresh session with its opening instruction, or the step's last
  // session reopened (§2.14): same id, same worktree, the same log after a `resumed` note, and no
  // opening instruction; decidePlanStep's next action sends it resumeInstruction().
  const spawn = (step, resumeSessionId = null) => {
    const prior = resumeSessionId ? byId(resumeSessionId) : null;
    const id = resumeSessionId ?? uuid();
    let logPath = prior?.logPath ?? null;
    if (!logPath) logPath = nextPlanLogPath(controlDir, step);
    const n = prior?.n ?? Number(/-(\d+)\.ndjson$/.exec(logPath)[1]);
    const name = planSessionName({ repo, plan: indexKey(), step });
    const cwd = worktreeNow();
    const worker = resumeSessionId
      ? startWorker({ cwd, resume: id, name, logPath, claudePath })
      : startWorker({ cwd, sessionId: id, name, logPath, claudePath });
    const rec = prior ?? { id, step, n, logPath, worker: null, live: false, startTime: null };
    Object.assign(rec, { n, logPath, worker, live: true });
    rec.startTime = worker.pid ? startTimeOf(worker.pid) : null;
    if (!prior) sessions.push(rec);
    current = rec;
    since[step] = now();
    worker.onEvent((entry) => {
      // The same grants as a build worker (DESIGN §2.3): a request a "do not ask again" covers is
      // allowed by pir at once. A question set is never answered by a grant.
      if (entry.dir === 'request' && entry.toolName !== 'AskUserQuestion') {
        const request = { toolName: entry.toolName, input: entry.input };
        if (grants.decide(id, request) === 'allow-by-grant') {
          queueMicrotask(() => {
            if (worker.answer(entry.requestId, allowResult(request), { from: 'pir' })) {
              worker.note('delivered-by-grant', { requestId: entry.requestId, toolName: entry.toolName });
            }
          });
        }
      }
      waker.wake();
    });
    worker.onExit(() => {
      if (rec.worker === worker) rec.live = false;
      writeWorkers();
      waker.wake();
    });
    writeWorkers();
    if (resumeSessionId) worker.note('resumed', { sessionId: id });
    else worker.send(step === 'plan' ? plannerInstruction({ reportsDir, brief }) : reviewerInstruction({ reportsDir, slug: state.slug }), { from: 'pir' });
    // On for the session's whole life, a resumed one included (DESIGN §2.3); close() switches it off first.
    if (remote) worker.remoteControl(true).catch(() => {});
    log(`${ROLE[step]} ${resumeSessionId ? 'resumed' : 'started'}: session ${id}, log ${logPath}`);
    return rec;
  };

  const closeCurrent = async (opts) => {
    const rec = current;
    current = null;
    if (!rec) return;
    await rec.worker.close(opts).catch(() => {});
    rec.live = false;
    writeWorkers();
    log(`${ROLE[rec.step]} closed: session ${rec.id}`);
  };

  const activityOf = (rec) => {
    if (!rec) return 'none';
    if (!rec.live) return 'exited';
    return workerActivity(rec.worker.entries()).state;
  };

  // ---- The snapshot and the index (PIR_RUN only). ----
  const record = () => {
    try {
      return parseRecord(readFileSync(recordPath(repo, indexKey(), { dir: indexDir }), 'utf8'));
    } catch {
      try {
        return parseRecord(readFileSync(recordPath(repo, state.id, { dir: indexDir }), 'utf8'));
      } catch {
        return null;
      }
    }
  };
  const indexed = selfReport ? record() : null;
  const label = indexed?.label ?? null;
  const proc = {
    pid: process.pid,
    startTime: indexed?.startTime ?? env.PIR_START_TIME ?? null,
    repo,
    startedAt: new Date(now()).toISOString(),
  };
  const runState = () => {
    const views = sessions.map((s) => ({
      // Every session runs in the one planning worktree, named as it is now, so a planner whose folder
      // the rename moved still names where its work is.
      id: s.id, step: s.step, n: s.n, logPath: s.logPath, cwd: worktreeNow(), live: s.live,
      activity: s.worker ? workerActivity(s.worker.entries()) : { state: 'exited' },
    }));
    for (const v of views) {
      if (v.live && REQUEST_KINDS.has(v.activity.state)) stoppedAt[v.step] ??= now();
      else if (v.live) delete stoppedAt[v.step];
    }
    // A finished step's time, read once from its logs when none of its sessions is live any more; a
    // finished step does not change, so the logs are not re-read on every paint.
    for (const step of ['plan', 'review']) {
      if (step in took || sessions.some((x) => x.step === step && x.live)) continue;
      const finished = step === 'plan' ? state.step !== 'plan' || state.outcome === 'no-plan' : state.outcome === 'reviewed' || state.outcome === 'not-reviewed';
      if (!finished) continue;
      const paths = [...new Set(sessions.filter((x) => x.step === step && x.logPath).map((x) => x.logPath))];
      took[step] = stepWorkedMs(paths.map(readLogEntries));
    }
    // The label names the run only until it has a slug (§2.6 step 4 clears it in the index).
    return planRunState(state, { label: state.slug && state.renamed?.index ? null : label, sessions: views, since, stoppedAt, took });
  };
  // The branch the run is on: the renamed one once git says so.
  const branchNow = () => (state.slug && branchExists(`pir/${state.slug}`) ? `pir/${state.slug}` : `pir/${state.id}`);
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
      // Under the slug once the entry is renamed; a stop in the middle of the rename still finds it.
      const key = state.slug && hasRecord(state.slug) ? state.slug : state.id;
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

  // ---- The rename (§2.6), one sub-step at a time; each is a no-op when already done. ----
  const renameStep = (substep) => {
    const slug = state.slug;
    if (substep === 'branch' || substep === 'worktree') {
      // renamePlanBranch does both, skipping whichever is already done, so a crash between them is
      // finished by the same call.
      const done = renamedOnDisk();
      if (done.branch && done.worktree) return;
      renamePlanBranch(state.id, slug, { root });
      log(`renamed branch and worktree to pir/${slug}`);
    } else if (substep === 'control') {
      const from = controlOf(state.id);
      const to = controlOf(slug);
      // The inbox watch is on the old folder; it is restarted on the new one below.
      personInbox.stop();
      if (!existsSync(statePathOf(to))) {
        if (existsSync(to)) throw new Error(`plan-run: ${to} already exists and is not this run's control folder`);
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
      const oldPrefix = from + '/';
      for (const s of sessions) if (s.logPath?.startsWith(oldPrefix)) s.logPath = join(to, s.logPath.slice(oldPrefix.length));
      controlDir = to;
      statePath = statePathOf(to);
      reportsDir = reportsDirOf(to);
      personInbox = startPersonInbox({ controlDir, platform, grants, watch, log });
      writeWorkers();
      log(`moved the control folder to ${to}`);
    } else if (substep === 'index') {
      if (hasRecord(slug)) {
        // A crash inside renameRecord left both entries: the new one is whole, the old one goes
        // (FINDINGS 2026-09-26: renameRecord refuses EEXIST whenever its target exists).
        if (hasRecord(state.id)) removeRecord({ repo, slug: state.id }, { dir: indexDir });
      } else if (hasRecord(state.id)) {
        renameRecord({ repo, from: state.id, to: slug }, { label: null, controlDir, branch: `pir/${slug}` }, { dir: indexDir });
        log(`renamed the index entry to ${repo}__${slug}`);
      }
    }
  };

  // ---- The loop. ----
  let first = true;
  try {
    for (;;) {
      if (signal?.aborted) {
        // `stopped` goes on record first: closing a session that will not go takes the whole 4 s before
        // pir's SIGKILL, and a program killed before it records reads as crashed. A session that outlives
        // us is reaped from workers.json. The snapshot is written again once the session is closed.
        recordFinal('stopped');
        await closeCurrent(STOP_CLOSE);
        paint('stopped');
        log('stopped');
        return 0;
      }
      personInbox.drain(); // the backstop for a drop the forwarder's watch missed

      const reports = drainDropFolder(reportsDir, { onBad: (n, e) => log(`unreadable report ${n}: ${e?.message ?? e}`) })
        .map((r) => parsePlanReport(r?.text))
        .filter(Boolean);
      for (const r of reports) log(`report: ${r.kind} plan=${r.plan ?? '-'}`);
      const activity = activityOf(current);

      // The checks run for the claim decidePlanStep will act on: the last report of the current step this
      // call, or, when the session has gone quiet on a claim accepted earlier, that claim again, so a
      // session that edited after its report is not closed over a dirty or changed tree (FINDINGS T01).
      const kinds = STEP_KINDS[state.step] ?? [];
      const isResume = first && resume;
      let facts = { resume: isResume, reports, activity, checks: null, sessionId: current?.id ?? null };
      if (isResume || state.step === 'rename') facts.renamed = renamedOnDisk();
      const claim = reports.filter((r) => kinds.includes(r.kind) && (state.step !== 'review' || r.plan === state.slug)).at(-1);
      const recheck = !claim && state.accepted && (activity === 'idle' || activity === 'exited');
      const checked = claim && CHECKED_KINDS.has(claim.kind) ? claim : recheck ? state.accepted : null;
      if (checked) {
        const worktree = worktreeNow();
        const checks =
          checked.kind === 'planned'
            ? plannerChecks({ slug: checked.plan, worktree, root, repo, indexDir, git, slugTaken })
            : reviewerChecks({ slug: checked.plan, worktree, git });
        facts = { ...facts, checks, reports: claim ? reports : [...reports, checked] };
        log(`checks for ${checked.kind} ${checked.plan}: ${checks.ok ? 'ok' : checks.reason}`);
      }
      first = false;

      const prev = state;
      const { state: next, actions } = decidePlanStep(state, facts);

      // A run with nothing left to do: a `--resume` of a finished run that is not resumable (§2.14).
      if (next.step === 'done' && actions.length === 0) {
        // `pir`'s resume cleared the final status with the new pid; put it back so the row is not crashed.
        if (selfReport && indexed && indexed.finalState == null) recordFinal('finished');
        log(`nothing to resume: the run is finished (${next.outcome})`);
        return 0;
      }

      // The rename runs between the sessions. state.json is written at step `rename` before the planner
      // is closed, so a crash from here on resumes into the rename, never into the closed planner, and
      // each sub-step is recorded as it lands; the step becomes `review` only as the reviewer is spawned.
      // A resume already at `review` (its state was written just before a sub-step reached the disk) stays
      // at `review`, so the reviewer's session is resumed rather than started afresh.
      const renaming = actions.some((a) => a.type === 'rename');
      if (renaming) {
        const onDisk = facts.renamed ?? renamedOnDisk();
        saveState({
          ...next,
          step: prev.step === 'review' ? 'review' : 'rename',
          renamed: { ...onDisk },
          live: false,
          accepted: null,
          rejected: null,
        });
      } else if (JSON.stringify(next) !== JSON.stringify(prev)) {
        saveState(next);
      }

      let spawned = false;
      for (const a of actions) {
        if (a.type === 'spawn') {
          if (renaming) saveState(next);
          spawn(a.step, a.resumeSessionId ?? null);
          spawned = true;
        } else if (a.type === 'send') {
          if (!current?.worker.send(a.text, { from: 'pir' })) log('a message to the session was not delivered');
        } else if (a.type === 'close') {
          await closeCurrent();
        } else if (a.type === 'rename') {
          renameStep(a.substep);
          saveState({ ...state, renamed: { ...state.renamed, [a.substep]: true } });
          paint();
        } else if (a.type === 'finish') {
          recordFinal('finished');
          log(`finished: ${a.outcome}`);
          return 0;
        } else if (a.type === 'exitCrashed') {
          paint();
          log('the session exited without a report it can act on: exiting with no final status (crashed)');
          return 1;
        }
      }
      paint();
      // A fresh session's id is recorded by the next call; take it at once rather than after a wait.
      if (spawned) continue;
      await waker.wait([reportsDir, personInbox.inboxDir], pollMs, { watch, signal });
    }
  } catch (err) {
    log(`error: ${err?.stack ?? err}`);
    await closeCurrent(STOP_CLOSE);
    return 1;
  } finally {
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
    process.stderr.write(`plan-run: ${args.error}\nusage: node src/shell/plan-run.mjs --control <dir> [--resume]\n`);
    process.exit(2);
  }
  // A `pir` stop is SIGTERM (DESIGN §2.16): the loop closes the session, records `stopped` and returns.
  const stop = new AbortController();
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => stop.abort());
  runPlanning({ controlDir: args.controlDir, resume: args.resume, deps: { signal: stop.signal } }).then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`${err?.stack ?? err}\n`);
      process.exit(1);
    },
  );
}
