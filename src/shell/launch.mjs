// The engine behind `pir {slug}` (DESIGN §2.5, §2.9, §3.4): run the pre-flight, launch the
// coordinator detached from the terminal, register the run in the cross-repo index, and hold the Mac
// awake for the run's lifetime. This is the piece that makes a run outlive WezTerm — the detached
// spawn was proven on this machine to reparent to launchd and keep running after its parent exited
// (FINDINGS 2026-09-22). The front-end (`bin/pir` → `pir.mjs`, T11) calls startRun and, on
// `already-running`, opens the live view instead of starting a second run.
//
// Everything the tests must not really do is injected: `spawn` (no real coordinator, no real
// caffeinate), `exec`/`kill` (no real `ps`/`kill` — these ride through to identity.mjs), `fs` (no real
// run.log), `now` (a fixed clock), and `env` (a scratch `~/.pir`). Only `readReviewGate` reads the real
// filesystem — the same gate the coordinator enforces (DESIGN §2.1), so `pir` refuses an unreviewed
// plan for exactly the reason and with exactly the verdict the coordinator would.

import { spawn as realSpawn } from 'node:child_process';
import { mkdirSync, openSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { basename, join } from 'node:path';

import { readReviewGate } from './coordinate.mjs';
import { startTimeOf, resolveLiveness } from './identity.mjs';
import { indexDir, listRecords, writeRecord } from './index-store.mjs';
import { classifyRun } from '../core/runstate.mjs';

// The filesystem calls startRun makes directly — only to prepare the coordinator's run.log. The index
// writes go through index-store's own fs (a scratch dir via $PIR_HOME in tests); this pair is what a
// caller injects to keep the run.log open off the real disk.
const DEFAULT_FS = { mkdirSync, openSync };

// startRun(slug, { cwd, spawn, exec, kill, fs, now, env }) →
//   { started:true, pid, record } | { started:false, reason, alreadyRunning? }
//   reason: 'no-plan' | 'not-reviewed' | 'already-running'
//
// cwd is the target repo's root: `pir` is invoked from inside the repo whose plan is being run, so its
// basename is the repo name the index entry and the coordinator's worker names share (DESIGN §2.8), and
// the coordinator is spawned with this as its cwd so it finds the same plan (the coordinator re-derives
// its own root from cwd). The engine's own coordinate.mjs is resolved from THIS file's location, never
// as a path under cwd — `pir` is the installed engine driving a run in whatever repo it is called from.
export function startRun(
  slug,
  { cwd = process.cwd(), spawn = realSpawn, exec, kill, fs = DEFAULT_FS, now = () => new Date(), env = process.env } = {},
) {
  const repoRoot = cwd;
  const repo = basename(repoRoot);
  const controlDir = join(repoRoot, 'plans', slug, '.parallel', 'control');
  const branch = `pir/${slug}`;
  const dir = indexDir({ env });

  // Pre-flight, in order, before anything is spawned (DESIGN §2.5): a pre-flight failure that only
  // surfaced after detaching would show the user a crashed run instead of a clean error.

  // 1 & 2: the plan folder and its review gate, via the coordinator's own gate. `missing` means there
  // is no plans/{slug}/PROGRESS.md at all — the plain "no such plan" case; a present-but-unreviewed
  // plan is refused with the same 'not-reviewed' the coordinator uses.
  const gate = readReviewGate(slug, { root: repoRoot });
  if (gate.missing) return { started: false, reason: 'no-plan' };
  if (!gate.reviewed) return { started: false, reason: 'not-reviewed' };

  // 3: no run for this slug is already live. Read the index entry (T06), resolve liveness (T05) and
  // classify it (T01); only a `running` classification blocks a start. A crashed, stopped or finished
  // run does NOT block — re-running its slug is exactly how a run resumes (DESIGN §2.5, §6), and the
  // coordinator reconciles from committed work.
  const existing = listRecords({ dir }).find((r) => r.repo === repo && r.slug === slug);
  if (existing) {
    const { alive, liveStartTime } = resolveLiveness(existing.pid, { kill, exec });
    const state = classifyRun({
      recordedStartTime: existing.startTime,
      finalState: existing.finalState,
      alive,
      liveStartTime,
    });
    if (state === 'running') {
      // The caller opens the live view instead of starting a second run (DESIGN §2.5).
      return { started: false, reason: 'already-running', alreadyRunning: true };
    }
  }

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
    env: { ...env, PARALLEL_LIVE: '1', PIR_RUN: '1' },
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
  };
  writeRecord(record, { dir });

  // Keep-awake tied to the coordinator's lifetime: `-i` blocks idle sleep, `-w {pid}` makes caffeinate
  // wait on the coordinator and exit when it dies, so any death of the run — clean exit, stop, crash or
  // force-kill — releases the Mac and no path strands it awake (DESIGN §2.9). Detached and unref'd for
  // the same reason as the coordinator: it must outlive `pir` returning into the TUI.
  spawn('caffeinate', ['-i', '-w', String(child.pid)], { detached: true, stdio: 'ignore' }).unref();

  return { started: true, pid: child.pid, record };
}
