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
// T06 is the planner half. At the planner's accepted `planned` the program writes state.json at step
// `rename` and stops with no final status; T07 adds the rename, the reviewer and `--resume`, and until
// then a resume or a state past `plan` is refused with exit 2 (see `unsupported`).
//
// Under PIR_RUN=1 (set only by the launcher, as for the coordinator) it writes status.json on every
// change of what the screen would show, and the final status to the snapshot and the index entry. Without
// it neither is touched, so a bare run in a test leaves no dashboard trace.

import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import {
  decidePlanStep,
  isValidSlug,
  parsePlanReport,
  planSessionName,
  plannerInstruction,
} from '../core/planflow.mjs';
import { parseRecord } from '../core/runrecord.mjs';
import { allowResult, workerActivity } from '../core/stream.mjs';
import { writeJsonAtomic } from './atomic-write.mjs';
import { drainDropFolder, waitForDrop } from './drop-folder.mjs';
import { startTimeOf as startTimeOfReal } from './identity.mjs';
import { indexDir as indexDirOf, recordPath, updateRecord } from './index-store.mjs';
import { createGrants, startPersonInbox } from './person-inbox.mjs';
import { resolveClaudePath } from './platform.mjs';
import { reapRecorded } from './reap.mjs';
import { writeSnapshot as writeSnapshotReal } from './snapshot-store.mjs';
import { startWorker as startWorkerReal, writeWorkersFile } from './worker-proc.mjs';
import { git as gitReal, slugTaken as slugTakenReal } from './worktree.mjs';

// The wait between loop turns when nothing wakes it. A report, a person's input or any entry in the
// session's log wakes it at once; this is only the backstop for a missed watch event.
const POLL_MS = 5000;

// A stop has 4 s before `pir` sends SIGKILL (DESIGN §2.16), so the session gets 1 s to go on its own
// input closing and 3 s after its SIGTERM; the reap covers anything left.
const STOP_CLOSE = { graceMs: 1000, killMs: 3000 };

// The report kinds the planner step acts on (DESIGN §2.4). Only a `planned` claim needs the git checks.
const PLAN_KINDS = ['planned', 'no-plan'];

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
//   sessions   every session this program started, in spawn order: { id, step, n, logPath, live, activity }
//   since      { plan, review } — when that step's latest session started (ms)
//   stoppedAt  { plan, review } — when that step's live session began asking the person (ms)
// Each step's phase: 'planning' | 'reviewing' while it is the current step (the dashboard tells a gone
// process crashed by itself), 'asking' while its live session has a request pending, 'done', 'failed'
// for the step a no-plan or not-reviewed outcome ended, 'pending' before it starts. `build` is pending
// here; the go and the build are read from the index (§2.8).
export function planRunState(state, { label = null, sessions = [], since = {}, stoppedAt = {} } = {}) {
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
      asking,
      worker: open ? { id: open.id, live: !!open.live, logPath: open.logPath ?? null } : null,
      workers: mine.map((s) => ({ id: s.id, role: ROLE[id], n: s.n ?? null, logPath: s.logPath ?? null })),
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
      { id: 'build', phase: 'pending', since: null, stoppedAt: null, asking: null, worker: null, workers: [] },
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

// T07 adds the worker's `resume` option and the steps after the planner. Until then this program runs a
// fresh planner step only; anything else is refused rather than half-done.
function unsupported({ resume, state }) {
  if (resume) return 'resume is not built yet (pir-plan-command T07)';
  if (state.step !== 'plan') return `state.json is at step "${state.step}", which pir-plan-command T07 carries on from`;
  return null;
}

// runPlanning({ controlDir, resume, deps }) → exit code: 0 at a clean end (finished, stopped, or the
// planner step handed on to the rename), 1 when the session left no way forward (crashed), 2 when the
// run cannot start. deps, all optional:
//   env, now, log, signal (an AbortSignal: a stop), claudePath, startWorker, startTimeOf, reap, git,
//   slugTaken, writeSnapshot, updateRecord, watch, uuid, pollMs
export async function runPlanning({ controlDir, resume = false, deps = {} }) {
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
    writeSnapshot = writeSnapshotReal,
    updateRecord: updateRecordFn = updateRecord,
    watch,
    uuid = randomUUID,
    pollMs = POLL_MS,
  } = deps;

  const statePath = statePathOf(controlDir);
  let state;
  let brief;
  try {
    state = JSON.parse(readFileSync(statePath, 'utf8'));
    brief = readFileSync(join(controlDir, 'brief.md'), 'utf8');
  } catch (err) {
    log(`cannot start: ${err?.message ?? err}`);
    return 2;
  }
  const refused = unsupported({ resume, state });
  if (refused) {
    log(`cannot start: ${refused}`);
    return 2;
  }

  const root = rootOf(controlDir);
  const repo = basename(root);
  const worktree = join(root, '.claude', 'worktrees', `pir-${state.id}`);
  const reportsDir = reportsDirOf(controlDir);
  const indexDir = indexDirOf({ env });
  const selfReport = !!env.PIR_RUN;
  const remote = env.PARALLEL_REMOTE !== '0';
  const indexKey = () => state.slug ?? state.id;

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
  const sessions = []; // { id, step, n, logPath, worker, live }
  let current = null;
  const since = {};
  const stoppedAt = {};
  const waker = createWaker();
  const grants = createGrants();
  const byId = (id) => sessions.find((s) => s.id === id) ?? null;

  const writeWorkers = () => {
    try {
      writeWorkersFile(
        controlDir,
        sessions.filter((s) => s.live).map((s) => ({ id: s.id, task: 'plan', role: ROLE[s.step], pid: s.worker.pid, startTime: s.startTime })),
      );
    } catch (err) {
      log(`workers.json write failed: ${err?.message ?? err}`);
    }
  };

  const platform = {
    send: (id, text, opts) => ({ ok: !!byId(id)?.worker.send(text, opts) }),
    interrupt: (id, opts) => {
      const s = byId(id);
      if (!s) return { ok: false };
      s.worker.interrupt(opts).catch(() => {});
      return { ok: s.live };
    },
    answer: (id, requestId, result, opts) => ({ ok: !!byId(id)?.worker.answer(requestId, result, opts) }),
    pending: (id) => (byId(id)?.live ? byId(id).worker.pending() : []),
    note: (id, kind, fields) => {
      const s = byId(id);
      if (!s) return { ok: false };
      s.worker.note(kind, fields);
      return { ok: true };
    },
    logPathOf: (id) => byId(id)?.logPath ?? null,
  };

  const spawn = (step) => {
    if (step !== 'plan') throw new Error(`plan-run: a ${ROLE[step] ?? step} session needs pir-plan-command T07`);
    const id = uuid();
    const logPath = nextPlanLogPath(controlDir, step);
    const n = Number(/-(\d+)\.ndjson$/.exec(logPath)[1]);
    const name = planSessionName({ repo, plan: indexKey(), step });
    const worker = startWorker({ cwd: worktree, sessionId: id, name, logPath, claudePath });
    const rec = { id, step, n, logPath, worker, live: true, startTime: null };
    rec.startTime = worker.pid ? startTimeOf(worker.pid) : null;
    sessions.push(rec);
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
      rec.live = false;
      writeWorkers();
      waker.wake();
    });
    writeWorkers();
    worker.send(plannerInstruction({ reportsDir, brief }), { from: 'pir' });
    // On for the session's whole life (DESIGN §2.3); close() switches it off first.
    if (remote) worker.remoteControl(true).catch(() => {});
    log(`${ROLE[step]} started: session ${id}, log ${logPath}`);
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
      return null;
    }
  };
  const indexed = selfReport ? record() : null;
  const label = indexed?.label ?? null;
  const proc = {
    pid: process.pid,
    startTime: indexed?.startTime ?? env.PIR_START_TIME ?? null,
    slug: indexKey(),
    repo,
    branch: `pir/${state.id}`,
    startedAt: new Date(now()).toISOString(),
  };
  const runState = () => {
    const views = sessions.map((s) => ({ id: s.id, step: s.step, n: s.n, logPath: s.logPath, live: s.live, activity: workerActivity(s.worker.entries()) }));
    for (const v of views) {
      if (v.live && REQUEST_KINDS.has(v.activity.state)) stoppedAt[v.step] ??= now();
      else if (v.live) delete stoppedAt[v.step];
    }
    return planRunState(state, { label, sessions: views, since, stoppedAt });
  };
  let lastPainted = null;
  const paint = (finalState = null) => {
    if (!selfReport) return;
    const rs = runState();
    const text = JSON.stringify([rs, finalState]);
    if (text === lastPainted && finalState === null) return;
    lastPainted = text;
    try {
      writeSnapshot(controlDir, { proc: { ...proc, slug: indexKey() }, finalState, runState: rs });
    } catch (err) {
      log(`snapshot write failed: ${err?.message ?? err}`);
    }
  };
  const recordFinal = (finalState) => {
    paint(finalState);
    if (!selfReport) return;
    try {
      updateRecordFn({ repo, slug: indexKey() }, { finalState, updatedAt: new Date(now()).toISOString() }, { dir: indexDir });
    } catch (err) {
      log(`index final-status update failed: ${err?.message ?? err}`);
    }
  };

  const saveState = (next) => {
    state = next;
    writeJsonAtomic(statePath, state);
  };

  // ---- The loop. ----
  const personInbox = startPersonInbox({ controlDir, platform, grants, watch, log });
  let first = true;
  try {
    for (;;) {
      if (signal?.aborted) {
        await closeCurrent(STOP_CLOSE);
        recordFinal('stopped');
        log('stopped');
        return 0;
      }
      personInbox.drain(); // the backstop for a drop the forwarder's watch missed

      const reports = drainDropFolder(reportsDir, { onBad: (n, e) => log(`unreadable report ${n}: ${e?.message ?? e}`) })
        .map((r) => parsePlanReport(r?.text))
        .filter(Boolean);
      for (const r of reports) log(`report: ${r.kind} plan=${r.plan ?? '-'}`);
      const activity = activityOf(current);

      // The checks run for the claim decidePlanStep will act on: the last planner report this call, or,
      // when the session has gone quiet on a claim accepted earlier, that claim again, so a planner that
      // edited after its report is not closed and renamed over a dirty or changed tree (FINDINGS T01).
      let facts = { resume: first && resume, reports, activity, checks: null, sessionId: current?.id ?? null };
      const claim = reports.filter((r) => PLAN_KINDS.includes(r.kind)).at(-1);
      const recheck = !claim && state.accepted && (activity === 'idle' || activity === 'exited');
      const checked = claim?.kind === 'planned' ? claim : recheck ? state.accepted : null;
      if (checked) {
        const checks = plannerChecks({ slug: checked.plan, worktree, root, repo, indexDir, git, slugTaken });
        facts = { ...facts, checks, reports: claim ? reports : [...reports, checked] };
        log(`checks for ${checked.kind} ${checked.plan}: ${checks.ok ? 'ok' : checks.reason}`);
      }
      first = false;

      const prev = state;
      const { state: next, actions } = decidePlanStep(state, facts);

      // The planner's claim is accepted and it is quiet: decidePlanStep closes it and goes on through the
      // rename to the reviewer in one call. state.json is written at step `rename` first, so a crash
      // before the rename is done resumes into the rename, never into the closed planner (FINDINGS T01).
      // T07 carries on from here; this program closes the planner and stops.
      if (actions.some((a) => a.type === 'rename')) {
        saveState({ ...next, step: 'rename', renamed: { ...prev.renamed }, live: false, accepted: null, rejected: null });
        for (const a of actions) {
          if (a.type === 'rename') break;
          if (a.type === 'close') await closeCurrent();
        }
        paint();
        log(`planner done: plan ${state.slug}; state.json at step rename`);
        return 0;
      }

      if (JSON.stringify(next) !== JSON.stringify(prev)) saveState(next);

      let spawned = false;
      for (const a of actions) {
        if (a.type === 'spawn') {
          if (a.resumeSessionId) throw new Error('plan-run: a resumed session needs pir-plan-command T07');
          spawn(a.step);
          spawned = true;
        } else if (a.type === 'send') {
          if (!current?.worker.send(a.text, { from: 'pir' })) log('a message to the session was not delivered');
        } else if (a.type === 'close') {
          await closeCurrent();
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
