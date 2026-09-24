// The `pir` entry point (DESIGN §2.1, §2.5, §2.9): parse the two invocations and dispatch them.
//   pir {slug}  → start a detached run (T08's startRun); if one is already running, open its live
//                 view instead of starting a second — "start or open" (§2.5).
//   pir         → open the cross-repo dashboard (§2.3).
// This task owns the argv handling and the hand-off; the TUI painting — openDashboard and openWatch —
// is the raw-mode loop in pir-tui.mjs (T12), re-exported here so the dispatch and the bin call it as the
// default while the tests inject spies in its place.
//
// The dispatch is a pure function with its collaborators injected, so it is tested without spawning a
// coordinator or entering raw mode. A refused start (no such plan, not reviewed) is a scriptable
// failure — it prints to stderr and exits non-zero — not a dashboard state (§2.5).

import { startRun as startRunDefault } from './launch.mjs';
import { testBlockRefusal } from './coordinate.mjs';
import { openDashboard as openDashboardTui, openWatch as openWatchTui } from './pir-tui.mjs';

// The TUI hand-off points (T12): the cross-repo dashboard and a single run's live view, both the raw-mode
// loop in pir-tui.mjs. They are the defaults run() calls; injected spies replace them under `npm test`, so
// the real raw-mode loop never runs in the harness.
export const openDashboard = openDashboardTui;
export const openWatch = openWatchTui;

// run(argv, { startRun, openDashboard, openWatch, stderr }) → exitCode
//
// argv is process.argv.slice(2). The collaborators default to the real engine (startRun) and the TUI
// hand-offs above; the tests inject spies for all of them and a stderr sink shaped like process.stderr
// (a .write(string)). The return is the process exit code — 0 when a view is opened, 1 for a refused
// start, 2 for a usage error — so a script can tell a refused run from a running one.
export function run(
  argv,
  { startRun = startRunDefault, openDashboard: openDash = openDashboard, openWatch: openW = openWatch, stderr = process.stderr } = {},
) {
  // No argument: the dashboard.
  if (argv.length === 0) {
    openDash();
    return 0;
  }

  // More than one argument is not a shape `pir` has — a slug with spaces is not a thing, so this is a
  // mistake, answered with usage rather than a guess.
  if (argv.length > 1) {
    stderr.write('usage: pir [slug]\n');
    return 2;
  }

  const slug = argv[0];
  const r = startRun(slug);

  // Started, or already running: either way the person wants to watch this run, so drop into its live
  // view. `alreadyRunning` is the "start or open" case — never a second coordinator for the same slug.
  if (r.started || r.alreadyRunning) {
    openW(slug);
    return 0;
  }

  // Pre-flight refusals: a clean message and a non-zero exit, so the failure is scriptable and no view
  // opens on top of it.
  if (r.reason === 'no-plan') {
    stderr.write(`no plan '${slug}' — plans/${slug}/ not found\n`);
    return 1;
  }
  if (r.reason === 'not-reviewed') {
    stderr.write(`'${slug}' is not reviewed — run /pir-review-plan ${slug}\n`);
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
