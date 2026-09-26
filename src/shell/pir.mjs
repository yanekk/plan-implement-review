// The `pir` entry point (DESIGN §2.1 of pir-plan-command; detached-runs §2.5, §2.9): parse the three
// verbs and dispatch them.
//   pir                 → open the cross-repo dashboard.
//   pir plan ["brief"]  → start a planning run (startPlanRun) and land in the planner's conversation
//                         (openPlanner, §2.12); bare `pir plan` runs the pre-flight, then opens the brief box
//                         (§2.13) and starts the run with what it sends.
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

import { startRun as startRunDefault, startPlanRun as startPlanRunDefault, planPreflight as planPreflightDefault } from './launch.mjs';
import { testBlockRefusal } from './coordinate.mjs';
import { openDashboard as openDashboardTui, openWatch as openWatchTui, openPlanner as openPlannerTui } from './pir-tui.mjs';
import { openBriefBox as openBriefBoxTui } from './brief-box.mjs';

// The TUI hand-off points: the cross-repo dashboard and a single run's live view, both the raw-mode
// loop in pir-tui.mjs. They are the defaults run() calls; injected spies replace them under `npm test`, so
// the real raw-mode loop never runs in the harness.
export const openDashboard = openDashboardTui;
export const openWatch = openWatchTui;
export const openPlanner = openPlannerTui;
export const openBriefBox = openBriefBoxTui;

export const USAGE =
  'usage: pir                 the dashboard\n' +
  '       pir plan ["brief"]  plan something new\n' +
  '       pir start {slug}    build a reviewed plan\n';

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

// run(argv, { startRun, startPlanRun, planPreflight, openDashboard, openWatch, openPlanner, openBriefBox,
//   stderr }) → exitCode | Promise<exitCode>
//
// argv is process.argv.slice(2). The collaborators default to the real engine and the TUI hand-offs
// above; the tests inject spies for all of them and a stderr sink shaped like process.stderr (a
// .write(string)). The return is the process exit code — 0 when a view is opened (or the brief box was
// cancelled), 1 for a refused start, 2 for a usage error — so a script can tell a refused run from a
// running one. Bare `pir plan` returns it as a promise, because the code is known only once the person has
// sent or cancelled the brief; every other path returns it at once.
export function run(
  argv,
  {
    startRun = startRunDefault,
    startPlanRun = startPlanRunDefault,
    openDashboard: openDash = openDashboard,
    openWatch: openW = openWatch,
    openPlanner: openP = openPlanner,
    openBriefBox: openBox = openBriefBox,
    planPreflight = planPreflightDefault,
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
      // The pre-flight first, so the person never writes a brief that is then refused (§2.13).
      const pre = planPreflight();
      if (!pre.ok) return planRefused(pre.reason, stderr);
      let code = 0; // a cancelled box: nothing was created, and that is not a failure
      return Promise.resolve(
        openBox({
          repo: pre.repo,
          onSubmit: (brief) => {
            const r = startPlan(brief, { startPlanRun, openP, stderr });
            code = r.code;
            return r.opened;
          },
          onCancel: () => {},
        }),
      ).then(() => code);
    }
    // Unquoted words are joined by one space: a shell splits a brief typed without quotes, and
    // refusing it would punish the most natural typing (DESIGN §2.1).
    return startPlan(rest.join(' '), { startPlanRun, openP, stderr }).code;
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

function planRefused(reason, stderr) {
  stderr.write(PLAN_REFUSALS[reason] ?? `pir plan: cannot start${reason ? `: ${reason}` : ''}\n`);
  return 1;
}

// Start a planning run and land in the planner's conversation (§2.12). Before the rename the run's record
// is keyed by its run id, so the view finds it by that. `opened` is whatever openPlanner returned (the
// view's promise), for the brief box to wait on.
function startPlan(brief, { startPlanRun, openP, stderr }) {
  const r = startPlanRun(brief);
  if (r.started) return { code: 0, opened: openP(r.runId) };
  return { code: planRefused(r.reason, stderr), opened: null };
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

// The bin: dispatch, then keep the process alive for whatever async TUI was opened (openDashboard,
// openWatch and openPlanner return promises) before exiting with the dispatch's code. On the error and
// usage paths no view opens, so `pending` stays null and the exit is immediate. Bare `pir plan` hands back
// its code as a promise, settled once the brief box is sent or cancelled. Runs only when invoked
// directly — the tests import `run` and never trip this guard.
if (import.meta.url === `file://${process.argv[1]}`) {
  let pending = null;
  const result = run(process.argv.slice(2), {
    openDashboard: () => {
      pending = openDashboard();
    },
    openWatch: (slug) => {
      pending = openWatch(slug);
    },
    openPlanner: (key) => {
      pending = openPlanner(key);
      return pending;
    },
  });
  Promise.resolve(result)
    .then((code) => Promise.resolve(pending).then(() => code))
    .then((code) => process.exit(code))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
