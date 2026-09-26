// The `pir` entry point (DESIGN §2.1 of pir-plan-command; detached-runs §2.5, §2.9): parse the three
// verbs and dispatch them.
//   pir                 → open the cross-repo dashboard.
//   pir plan ["brief"]  → start a planning run (startPlanRun) and watch it; bare `pir plan` opens the brief
//                         box (T13 supplies it; until then a stub that asks for the brief as an argument).
//   pir start {slug}    → start a detached build (startRun); if one is already running, open its live view
//                         instead of starting a second — "start or open".
//   pir <other>         → a usage error pointing at `pir start <other>`. The bare-slug form was removed, not
//                         aliased, because `plan` and `start` would otherwise be indistinguishable from slugs
//                         and a plan named `plan` would silently change meaning (user 2026-09-26).
// This module owns the argv handling and the hand-off; the TUI painting — openDashboard and openWatch —
// is the raw-mode loop in pir-tui.mjs, re-exported here so the dispatch and the bin call it as the
// default while the tests inject spies in its place.
//
// The dispatch is a pure function with its collaborators injected, so it is tested without spawning a
// coordinator or entering raw mode. A refused start is a scriptable failure — it prints to stderr and
// exits 1 — not a dashboard state.

import { startRun as startRunDefault, startPlanRun as startPlanRunDefault } from './launch.mjs';
import { testBlockRefusal } from './coordinate.mjs';
import { openDashboard as openDashboardTui, openWatch as openWatchTui } from './pir-tui.mjs';

// The TUI hand-off points: the cross-repo dashboard and a single run's live view, both the raw-mode
// loop in pir-tui.mjs. They are the defaults run() calls; injected spies replace them under `npm test`, so
// the real raw-mode loop never runs in the harness.
export const openDashboard = openDashboardTui;
export const openWatch = openWatchTui;

export const USAGE =
  'usage: pir                 the dashboard\n' +
  '       pir plan ["brief"]  plan something new\n' +
  '       pir start {slug}    build a reviewed plan\n';

// Stand-in for the brief box until T13 builds it: bare `pir plan` has no brief yet, so say how to give
// one and exit as a usage error.
export function openBriefBoxStub({ stderr = process.stderr } = {}) {
  stderr.write('pir plan: write the brief as an argument for now\n');
  return 2;
}

// startPlanRun's pre-flight refusals (DESIGN §2.2), one clean line each. Nothing was created on any of
// them, so the message only has to say what to fix.
const PLAN_REFUSALS = {
  'not-a-repo': 'pir plan: not inside a git repository — run it from the repo you want to plan in\n',
  'no-main': "pir plan: this repo has no local 'main' branch — a plan is cut from main\n",
  'canonical-repo':
    'pir plan: refusing to plan inside the plan-implement-review checkout itself; use a scratch clone, ' +
    'or set PARALLEL_ALLOW_HERE=1 if this really is one that shares the name\n',
  'empty-brief': 'pir plan: the brief is empty — say what to plan, e.g. pir plan "a daily screen budget"\n',
};

// run(argv, { startRun, startPlanRun, openDashboard, openWatch, openBriefBox, stderr }) → exitCode
//
// argv is process.argv.slice(2). The collaborators default to the real engine and the TUI hand-offs
// above; the tests inject spies for all of them and a stderr sink shaped like process.stderr (a
// .write(string)). The return is the process exit code — 0 when a view is opened, 1 for a refused
// start, 2 for a usage error — so a script can tell a refused run from a running one.
export function run(
  argv,
  {
    startRun = startRunDefault,
    startPlanRun = startPlanRunDefault,
    openDashboard: openDash = openDashboard,
    openWatch: openW = openWatch,
    openBriefBox = null,
    stderr = process.stderr,
  } = {},
) {
  if (argv.length === 0) {
    openDash();
    return 0;
  }

  const [verb, ...rest] = argv;

  if (verb === 'plan') {
    if (rest.length === 0) {
      const code = openBriefBox ? openBriefBox() : openBriefBoxStub({ stderr });
      return typeof code === 'number' ? code : 0;
    }
    // Unquoted words are joined by one space: a shell splits a brief typed without quotes, and
    // refusing it would punish the most natural typing (DESIGN §2.1).
    const r = startPlanRun(rest.join(' '));
    if (r.started) {
      // Before the rename the run's record is keyed by its run id, so the live view finds it by that.
      openW(r.runId);
      return 0;
    }
    stderr.write(PLAN_REFUSALS[r.reason] ?? `pir plan: cannot start${r.reason ? `: ${r.reason}` : ''}\n`);
    return 1;
  }

  if (verb === 'start') {
    if (rest.length !== 1) {
      stderr.write(USAGE);
      return 2;
    }
    return startBuild(rest[0], { startRun, openW, stderr });
  }

  stderr.write(`pir: unknown command '${verb}'. To build a plan: pir start ${verb}\n${USAGE}`);
  return 2;
}

function startBuild(slug, { startRun, openW, stderr }) {
  const r = startRun(slug);

  // Started, or already running: either way the person wants to watch this run, so drop into its live
  // view. `alreadyRunning` is the "start or open" case — never a second coordinator for the same slug.
  if (r.started || r.alreadyRunning) {
    openW(slug);
    return 0;
  }

  if (r.reason === 'no-plan') {
    stderr.write(`no plan '${slug}' — plans/${slug}/ not found\n`);
    return 1;
  }
  if (r.reason === 'not-reviewed') {
    // A plan still on its planning branch is reviewed by resuming that run, not by hand (DESIGN §2.16).
    if (r.where === 'branch') stderr.write(`'${slug}' is not reviewed — resume its planning run in pir (Ctrl+R)\n`);
    else stderr.write(`'${slug}' is not reviewed — run /pir-review-plan ${slug}\n`);
    return 1;
  }
  if (r.reason === 'no-test-block') {
    stderr.write(testBlockRefusal(slug, r.detail));
    return 1;
  }

  // Any other refusal reason startRun grows later still surfaces rather than silently opening a view.
  stderr.write(`cannot start '${slug}'${r.reason ? `: ${r.reason}` : ''}\n`);
  return 1;
}

// The bin: dispatch, then keep the process alive for whatever async TUI was opened (T12's
// openDashboard/openWatch return promises) before exiting with the dispatch's code. On the error and
// usage paths no view opens, so `pending` stays null and the exit is immediate. Runs only when invoked
// directly — the tests import `run` and never trip this guard.
if (import.meta.url === `file://${process.argv[1]}`) {
  let pending = null;
  const code = run(process.argv.slice(2), {
    openDashboard: () => {
      pending = openDashboard();
    },
    openWatch: (slug) => {
      pending = openWatch(slug);
    },
  });
  Promise.resolve(pending)
    .then(() => process.exit(code))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
