// spawn-one-scratch.mjs — the T08 hand-verified run: ONE real worker, ONE trivial task, seatbelted.
//
// This is the first time any of the machine touches a real `claude` agent, so it is deliberately the
// smallest version (DESIGN §5.2): a scratch plan with a single trivial task, the worker ceiling at 1,
// the kill switch wired, run in a THROWAWAY CLONE of this repo — never the real project's `main`. It
// wires the real platform (spawn/list/close, T08) and the real worktree (T06) into the reviewed
// coordinator loop (T05) in place of the fakes, and drives exactly one task from ⬜ through implement,
// fresh review, merge, and promotion to the scratch clone's `main`.
//
// Run it two ways:
//   node src/shell/spawn-one-scratch.mjs                 # DEFAULT: dry run, fakes only, no live agent
//   PARALLEL_DRY_RUN=0 node src/shell/spawn-one-scratch.mjs   # the real one-worker spawn (a person watches)
// To abort at any time, in another terminal:
//   touch plans/scratch/.parallel/control/HALT
//
// Why a bespoke paced loop and not loop.drain(): drain() stops after a couple of idle passes, which is
// right for the fake (its list() advances a worker one step per call, so a pass is a tick) but wrong
// for a real agent, whose work takes wall-clock minutes across many idle passes. So the real path polls
// on a timer until the plan promotes or HALT fires. The dry path polls with no delay.
//
// Why a file-observing transport for the real path (see fileTransport below): a worker signals the
// coordinator with SendMessage, but SendMessage is an agent tool — a plain Node script has no inbox to
// receive one, and there is no `claude` subcommand that delivers a cross-session message (platform.mjs
// header). The production transport, backed by the coordinator agent's own SendMessage and inbox, is
// T09's coordinate.mjs. Here, standing in for it, the coordinator learns "implemented"/"done" by
// reading the worker's own task-branch PROGRESS.md row (🔍 → implemented, ✅ → done). For the single
// trivial task there are no siblings, so a worker's pre-done integration of the feature branch is a
// no-op and ✅ safely stands in for "done". This shim is T08-scratch-only; it does not ship.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { parseProgress, progressPathFor } from '../core/progress.mjs';
import { workerName } from '../core/naming.mjs';
import { createPlatform, encodeMessage } from './platform.mjs';
import { createWorktree } from './worktree.mjs';
import { createFakePlatform } from './fake/platform.mjs';
import { createFakeWorktree } from './fake/worktree.mjs';
import { runPass, createRunState } from './loop.mjs';

const SLUG = 'scratch';
const DRY = process.env.PARALLEL_DRY_RUN !== '0'; // default: dry (safe). PARALLEL_DRY_RUN=0 goes live.
const POLL_MS = DRY ? 0 : Number(process.env.PARALLEL_POLL_MS ?? 5000);
const MAX_PASSES = Number(process.env.PARALLEL_MAX_PASSES ?? (DRY ? 50 : 240)); // ~20 min at 5s, live

const git = (cwd, args) => {
  try {
    return { ok: true, stdout: execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }) };
  } catch (e) {
    return { ok: false, stdout: e.stdout ?? '', stderr: e.stderr ?? String(e) };
  }
};

// The scratch plan committed onto the clone's main so the loop has something to drain and the worker
// has a real task doc to build. One trivial task, deliberately small: write a file, no new tests.
const SCRATCH_FILES = {
  'plans/scratch/PROGRESS.md': `# Progress

**Plan reviewed:** 2026-01-01 — scratch plan, pre-approved for the T08 smoke run.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and done · ⛔ blocked.

| # | Task | Runs | Depends on | State | Notes |
|---|---|---|---|---|---|
| T01 | Write the scratch marker file | auto | — | ⬜ | |
`,
  'plans/scratch/DESIGN.md': `# Scratch plan (T08 smoke)

Throwaway plan for the T08 one-worker hand-verified run. Not a real feature.

## Environment
Test command: \`npm test\`. It is the only evidence a session may produce on its own.
`,
  'plans/scratch/PLAN.md': `# Scratch plan\n\nT01 — write a marker file. That is the whole plan.\n`,
  'plans/scratch/FINDINGS.md': `# Findings log\n\n| Date | | Finding |\n|---|---|---|\n`,
  'plans/scratch/tasks/T01-marker.md': `# T01 — Write the scratch marker file

**Runs:** auto

## Goal
Create a file \`scratch-ok.txt\` at the repo root whose only contents are the text \`ok\`. That is all.

## Files
- \`scratch-ok.txt\` — new.

## Tests
None. This is a scratch smoke task; write no new tests and leave \`npm test\` green.

## Done when
- [ ] \`scratch-ok.txt\` exists and contains \`ok\`.
- [ ] \`npm test\` is still green.
`,
};

function scaffoldScratchPlan(repo) {
  let created = false;
  for (const [rel, content] of Object.entries(SCRATCH_FILES)) {
    const abs = join(repo, rel);
    if (existsSync(abs)) continue;
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
    created = true;
  }
  if (created) {
    git(repo, ['add', '-A']);
    git(repo, ['-c', 'commit.gpgsign=false', 'commit', '-m', 'scratch: T08 smoke plan', '--no-edit']);
  }
  return created;
}

// The kill switch (DESIGN §2.4): a flag file halts all dispatch and delivery and closes every worker.
// log() appends to a sibling log so the run is auditable after the fact.
function fileControl(repo) {
  const dir = join(repo, 'plans', SLUG, '.parallel', 'control');
  mkdirSync(dir, { recursive: true });
  const flag = join(dir, 'HALT');
  const logPath = join(dir, 'log');
  return {
    isHalted: () => existsSync(flag),
    log: (line) => {
      try {
        writeFileSync(logPath, `${new Date().toISOString()} ${line}\n`, { flag: 'a' });
      } catch {
        /* logging must never break the loop */
      }
    },
    flag,
    logPath,
  };
}

// The T08-scratch stand-in for T09's SendMessage inbox (see the header). It turns the worker's own
// task-branch PROGRESS.md row transitions into the loop's inbound messages. deliver() only logs: a
// clean trivial task raises no question, so the coordinator never needs to send an answer down here.
function fileTransport(state, repoName, control) {
  const seen = {}; // task id → the row state we last emitted a message for, so each fires once
  return {
    deliver(name, text) {
      control.log(`down ${name}: ${text.split('\n')[0]}`);
      return { ok: true }; // no real bus in the scratch run; T09 backs this with SendMessage
    },
    drain() {
      const out = [];
      for (const [num, t] of Object.entries(state.tasks)) {
        const path = t.worktree?.path;
        if (!path) continue;
        // Read the COMMITTED row (git show HEAD), not the working tree. The worker writes 🔍/✅ before
        // it commits, so reacting to the working-tree change could close the worker mid-commit and lose
        // its work (its task branch would merge empty). git show HEAD reflects only committed state, so
        // the coordinator acts only once the worker's turn has actually landed a commit (FINDINGS
        // 2026-09-09 — the implementer was interrupted right at its commit).
        const r = git(path, ['show', `HEAD:${progressPathFor(SLUG)}`]);
        if (!r.ok) continue; // no commit yet on the task branch
        const row = parseProgress(r.stdout).tasks.find((x) => x.num === num);
        if (!row || seen[num] === row.state) continue;
        seen[num] = row.state;
        const from = workerName({ repo: repoName, plan: SLUG, task: num, role: 'implement' });
        if (row.state === '🔍') out.push({ from, text: encodeMessage({ kind: 'implemented', task: num }) });
        else if (row.state === '✅') out.push({ from, text: encodeMessage({ kind: 'done', task: num }) });
      }
      return out;
    },
  };
}

// The MAIN worktree of the current repo (from porcelain, first record). promote() merges the feature
// branch into THIS checkout's main, so it — not a linked worktree we happen to be sitting in — is the
// identity that matters for the seatbelt and the one used to name the coordinator/workers.
function mainWorktree(cwd) {
  const out = git(cwd, ['worktree', 'list', '--porcelain']).stdout;
  const first = out.split('\n').find((l) => l.startsWith('worktree '));
  return first ? first.slice('worktree '.length).trim() : '';
}

// Ensure the scratch repo has a `main` branch checked out (DESIGN §2.9: the feature branch is cut from
// main and promoted back to it, and worktree.mjs hardcodes `main` as the real project always has one).
// A clone taken off a side branch has NO local main — only origin/main — so `git branch pir/scratch
// main` fails with "not a valid object name: 'main'". Here we point main at the CURRENT HEAD (which
// carries the code and the pir skills the worker needs) and check it out. Safe because this runs only
// on the live path, which the guard has already confined to a throwaway non-real clone.
function ensureMainCheckedOut(repo) {
  const cur = git(repo, ['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim();
  if (cur === 'main') return;
  // Pin main to the exact current commit — `checkout -B main HEAD`, not a bare `checkout -B main`.
  // The bare form guesses a start point and, when a same-named remote branch exists, silently points
  // main at origin/main (the old code) instead of HEAD (observed with the user, 2026-09-09). The
  // explicit HEAD removes that ambiguity, so main always carries the code we are running.
  const r = git(repo, ['checkout', '-B', 'main', 'HEAD']);
  if (!r.ok) throw new Error(`could not set up a main branch in the scratch clone: ${r.stderr}`);
  console.log(`prepared main at the current commit (clone was on "${cur}", which has no local main)`);
}

async function main() {
  const inRepo = git(process.cwd(), ['rev-parse', '--is-inside-work-tree']).ok;
  const repo = mainWorktree(process.cwd());
  if (!inRepo || !repo) {
    console.error('Not inside a git repository. Run this from a scratch clone of the project.');
    process.exit(1);
  }

  // Seatbelt: never promote into the real project's main. A scratch clone is named anything but the
  // canonical repo (T06 used src/pir-2). PARALLEL_ALLOW_HERE=1 overrides for a same-named clone. The
  // check is on the MAIN worktree's name, so it holds even when launched from a linked worktree.
  const repoName = basename(repo);
  const guarded = repoName === 'plan-implement-review' && !process.env.PARALLEL_ALLOW_HERE;
  if (!DRY && guarded) {
    console.error(
      `Refusing to run the LIVE spawn inside "${repoName}" — this would open pir/${SLUG} off THIS\n` +
        `repo's main and, on success, merge it back into THIS main. Run it in a throwaway clone\n` +
        `instead (e.g. \`git clone . ../pir-scratch && cd ../pir-scratch\`), the way T06 used src/pir-2.\n` +
        `If this really is a scratch clone that happens to share the name, set PARALLEL_ALLOW_HERE=1.`,
    );
    process.exit(1);
  }

  console.log(`\n=== T08 one-worker scratch run (${DRY ? 'DRY — fakes, no live agent' : 'LIVE — real claude'}) ===`);
  console.log(`repo:     ${repo}`);
  console.log(`plan:     plans/${SLUG}   ceiling: 1`);
  if (!DRY) {
    console.log(`WATCH:    claude agents --json   (the worker appears; its cwd is the task worktree)`);
    console.log(`ABORT:    touch plans/${SLUG}/.parallel/control/HALT`);
    console.log(`On success this MERGES pir/${SLUG} into ${repoName}'s main.`);
  }
  console.log('');

  const control = fileControl(repo);
  const state = createRunState();

  let platform, worktree;
  if (DRY) {
    // Fully in-memory / scratch-repo, no live agent. The fake emits its own inbox, so no transport.
    worktree = createFakeWorktree({ progress: SCRATCH_FILES['plans/scratch/PROGRESS.md'], slug: SLUG });
    platform = createFakePlatform({ behaviors: {} });
  } else {
    ensureMainCheckedOut(repo);
    scaffoldScratchPlan(repo);
    worktree = createWorktree({ root: repo });
    platform = createPlatform({ root: repo, transport: fileTransport(state, repoName, control) });
  }

  // Circuit-breaker (T08, added 2026-09-09 after the first live run ran away). It bounds the blast
  // radius if the coordinator ever loses track of its workers, stopping every live worker BY ITS
  // LISTED id (the authoritative id, not the one spawn returned).
  //
  // But it must not fire on the benign review handoff. When an implemented task moves to review, the
  // loop spawns the reviewer and stops the implementer; `claude stop` is async, so for a moment BOTH
  // are live — CEILING+1. That is a session being torn down, not real concurrent work, and it settles
  // within a poll (FINDINGS 2026-09-09). So tolerate a single over-ceiling worker briefly: abort only
  // on a clear runaway (more than one over the ceiling) or an overage that will not settle (persists
  // several passes). A real runaway climbs fast (the first bug hit ~12), so this still trips quickly.
  const CEILING = 1;
  const OVER_GRACE = 3; // consecutive passes at exactly CEILING+1 tolerated before it counts as stuck
  let over = 0;
  let result = 'ran out of passes';
  for (let p = 1; p <= MAX_PASSES; p++) {
    const r = runPass({ platform, worktree, repo: repoName, slug: SLUG, maxWorkers: CEILING, state, control });
    for (const a of r.actions) console.log(`  pass ${p}: ${a.type} ${a.task ?? a.branch ?? a.workerId ?? ''}`.trimEnd());
    if (r.halted) {
      result = 'HALTED by the kill switch — workers stopped, nothing promoted';
      break;
    }
    if (r.promoted) {
      result = 'PROMOTED — the scratch plan reached main';
      break;
    }
    const live = DRY ? [] : platform.list();
    if (live.length > CEILING) {
      over += 1;
      const runaway = live.length > CEILING + 1 || over >= OVER_GRACE;
      if (runaway) {
        console.error(
          `\nABORT: ${live.length} live workers, ceiling ${CEILING}, for ${over} pass(es) — a real ` +
            `runaway, not a review handoff (see FINDINGS 2026-09-09). Stopping every live worker now.`,
        );
        for (const w of live) platform.close(w.id);
        result = `ABORTED — runaway (${live.length} > ${CEILING} for ${over} passes); every live worker stopped`;
        break;
      }
      console.warn(`  (transient: ${live.length} live > ceiling ${CEILING} — a review handoff overlaps while the old session stops; tolerating)`);
    } else {
      over = 0;
    }
    if (POLL_MS) await sleep(POLL_MS);
  }

  console.log(`\n=== ${result} ===`);
  // What is left behind, for the person to confirm the close was clean (DESIGN §5.1).
  const wtList = git(repo, ['worktree', 'list']).stdout.trim();
  console.log(`\ngit worktree list:\n${wtList}`);
  if (!DRY) {
    console.log(`\nNow confirm by hand:`);
    console.log(`  claude agents --json     # no scratch worker should remain`);
    console.log(`  git -C ${repo} log --oneline -3 main   # main should carry the T01 marker commit`);
    console.log(`  cat ${join(repo, 'scratch-ok.txt')}     # should say: ok`);
  } else if (worktree.cleanup) {
    worktree.cleanup();
    console.log('(dry run scratch repo cleaned up)');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
