// The `pir` dispatch (detached-runs T11, pir-plan-command T09): argv → the right hand-off, with startRun and the TUI injected so nothing
// spawns a coordinator or enters raw mode. The exit code is asserted alongside each call because a
// refused start is a scriptable failure, not a view (DESIGN §2.5). The last test is a read-of-the-file
// smoke check on the bin/pir wrapper, in the launcher.test.mjs style.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { run, USAGE, openBriefBoxStub } from './pir.mjs';

// A set of spies for run's collaborators: startRun and startPlanRun return whatever the test wants, the
// TUI hand-offs record their calls, and stderr is a sink shaped like process.stderr.
function harness(startResult, planResult, briefBoxResult) {
  const calls = { start: [], plan: [], dash: 0, watch: [], brief: 0 };
  const errs = [];
  const deps = {
    startRun: (slug) => {
      calls.start.push(slug);
      return startResult;
    },
    startPlanRun: (brief) => {
      calls.plan.push(brief);
      return planResult;
    },
    openDashboard: () => {
      calls.dash += 1;
    },
    openWatch: (slug) => {
      calls.watch.push(slug);
    },
    openBriefBox: () => {
      calls.brief += 1;
      return briefBoxResult;
    },
    stderr: { write: (s) => errs.push(s) },
  };
  return { calls, errs, deps };
}

const USAGE_TEXT =
  'usage: pir                 the dashboard\n' +
  '       pir plan ["brief"]  plan something new\n' +
  '       pir start {slug}    build a reviewed plan\n';

test('the usage text is exactly the three verbs', () => {
  assert.equal(USAGE, USAGE_TEXT);
});

test('no args → the dashboard, exit 0', () => {
  const { calls, errs, deps } = harness();
  const code = run([], deps);
  assert.equal(code, 0);
  assert.equal(calls.dash, 1, 'openDashboard called once');
  assert.deepEqual(calls.watch, [], 'no watch opened');
  assert.deepEqual(calls.start, [], 'startRun not called with no slug');
  assert.deepEqual(calls.plan, []);
  assert.deepEqual(errs, [], 'nothing on stderr');
});

// --- pir plan ---------------------------------------------------------------------------

test('[plan] → the brief box, its code returned', () => {
  const { calls, errs, deps } = harness(undefined, undefined, 0);
  assert.equal(run(['plan'], deps), 0);
  assert.equal(calls.brief, 1, 'openBriefBox called once');
  assert.deepEqual(calls.plan, [], 'no planning run without a brief');
  assert.deepEqual(errs, []);
});

test('[plan] with no brief box injected → the stand-in prints how to give the brief, exit 2', () => {
  const { calls, errs, deps } = harness();
  delete deps.openBriefBox;
  assert.equal(run(['plan'], deps), 2);
  assert.deepEqual(errs, ['pir plan: write the brief as an argument for now\n']);
  assert.deepEqual(calls.plan, []);
  assert.deepEqual(calls.watch, []);
});

test('openBriefBoxStub prints the stand-in line and returns 2', () => {
  const errs = [];
  assert.equal(openBriefBoxStub({ stderr: { write: (s) => errs.push(s) } }), 2);
  assert.deepEqual(errs, ['pir plan: write the brief as an argument for now\n']);
});

test('[plan, words…] → startPlanRun with the words joined by one space, then the run id watched, exit 0', () => {
  const { calls, errs, deps } = harness(undefined, { started: true, runId: 'plan-3f2a', pid: 1, record: {} });
  assert.equal(run(['plan', 'a', 'daily', 'screen budget'], deps), 0);
  assert.deepEqual(calls.plan, ['a daily screen budget']);
  assert.deepEqual(calls.watch, ['plan-3f2a'], 'the live view opens on the run id, the record key before the rename');
  assert.deepEqual(calls.start, [], 'no build is started');
  assert.equal(calls.dash, 0);
  assert.deepEqual(errs, []);
});

test('[plan, "quoted brief"] → the brief passed as it is', () => {
  const { calls, deps } = harness(undefined, { started: true, runId: 'plan-0001' });
  assert.equal(run(['plan', 'a daily screen budget'], deps), 0);
  assert.deepEqual(calls.plan, ['a daily screen budget']);
});

for (const [reason, message] of [
  ['not-a-repo', 'pir plan: not inside a git repository — run it from the repo you want to plan in\n'],
  ['no-main', "pir plan: this repo has no local 'main' branch — a plan is cut from main\n"],
  [
    'canonical-repo',
    'pir plan: refusing to plan inside the plan-implement-review checkout itself; use a scratch clone, ' +
      'or set PARALLEL_ALLOW_HERE=1 if this really is one that shares the name\n',
  ],
  ['empty-brief', 'pir plan: the brief is empty — say what to plan, e.g. pir plan "a daily screen budget"\n'],
  ['something-new', 'pir plan: cannot start: something-new\n'],
]) {
  test(`[plan] refused ${reason} → one clean line on stderr, exit 1, no view`, () => {
    const { calls, errs, deps } = harness(undefined, { started: false, reason });
    assert.equal(run(['plan', '  '], deps), 1);
    assert.deepEqual(errs, [message]);
    assert.deepEqual(calls.watch, []);
    assert.equal(calls.dash, 0);
  });
}

// --- pir start {slug} -------------------------------------------------------------------

test('[start, slug] that starts → its live view, exit 0', () => {
  const { calls, errs, deps } = harness({ started: true, pid: 4242, record: {} });
  const code = run(['start', 'screen-time'], deps);
  assert.equal(code, 0);
  assert.deepEqual(calls.start, ['screen-time'], 'startRun called with the slug');
  assert.deepEqual(calls.watch, ['screen-time'], 'openWatch called once with the slug');
  assert.equal(calls.dash, 0, 'the dashboard is not opened');
  assert.deepEqual(calls.plan, []);
  assert.deepEqual(errs, [], 'no error on a clean start');
});

test('[start, slug] already running → open, do not start a second, exit 0', () => {
  // startRun took its alreadyRunning path (started:false, alreadyRunning:true), so no coordinator was
  // spawned; the caller opens the existing run's view instead (DESIGN §2.5).
  const { calls, errs, deps } = harness({ started: false, reason: 'already-running', alreadyRunning: true });
  const code = run(['start', 'screen-time'], deps);
  assert.equal(code, 0);
  assert.deepEqual(calls.watch, ['screen-time'], 'the live view opens on the running slug');
  assert.deepEqual(errs, [], 'already-running is not an error');
});

test('[start] no-plan → clean message on stderr, exit 1, no watch', () => {
  const { calls, errs, deps } = harness({ started: false, reason: 'no-plan' });
  const code = run(['start', 'ghost'], deps);
  assert.equal(code, 1);
  assert.deepEqual(calls.watch, [], 'no view opens on a refused start');
  assert.equal(calls.dash, 0);
  assert.deepEqual(errs, ["no plan 'ghost' — plans/ghost/ not found\n"]);
});

test('[start] not-reviewed on main → names /pir-review-plan, exit 1, no watch', () => {
  const { calls, errs, deps } = harness({ started: false, reason: 'not-reviewed' });
  const code = run(['start', 'screen-time'], deps);
  assert.equal(code, 1);
  assert.deepEqual(calls.watch, [], 'no view opens on a refused start');
  assert.deepEqual(errs, ["'screen-time' is not reviewed — run /pir-review-plan screen-time\n"]);
});

test('[start] not-reviewed on its planning branch → names resuming the planning run (DESIGN §2.16), exit 1', () => {
  const { calls, errs, deps } = harness({ started: false, reason: 'not-reviewed', where: 'branch' });
  const code = run(['start', 'screen-time'], deps);
  assert.equal(code, 1);
  assert.deepEqual(calls.watch, []);
  assert.deepEqual(errs, ["'screen-time' is not reviewed — resume its planning run in pir (Ctrl+R)\n"]);
});

test('[start] no-test-block → the refusal naming the parser reason and /pir-review-plan, exit 1, no watch', () => {
  const { calls, errs, deps } = harness({ started: false, reason: 'no-test-block', detail: 'no test key' });
  const code = run(['start', 'screen-time'], deps);
  assert.equal(code, 1);
  assert.deepEqual(calls.watch, [], 'no view opens on a refused start');
  assert.deepEqual(errs, [
    "cannot start 'screen-time': plans/screen-time/DESIGN.md has no valid setup/test block (no test key).\n" +
      'A plan without one counts as not reviewed. Run /pir-review-plan screen-time to add it.\n',
  ]);
});

for (const argv of [['start'], ['start', 'a', 'b']]) {
  test(`${JSON.stringify(argv)} → usage on stderr, exit 2`, () => {
    const { calls, errs, deps } = harness();
    assert.equal(run(argv, deps), 2);
    assert.deepEqual(calls.start, [], 'startRun not called on a usage error');
    assert.deepEqual(calls.watch, []);
    assert.equal(calls.dash, 0);
    assert.deepEqual(errs, [USAGE_TEXT]);
  });
}

// --- anything else ----------------------------------------------------------------------

for (const argv of [['screen-time'], ['screen-time', 'extra']]) {
  test(`${JSON.stringify(argv)} → unknown command pointing at pir start, plus usage, exit 2`, () => {
    const { calls, errs, deps } = harness({ started: true });
    assert.equal(run(argv, deps), 2);
    assert.deepEqual(calls.start, [], 'the old bare-slug form starts nothing');
    assert.deepEqual(calls.plan, []);
    assert.deepEqual(calls.watch, []);
    assert.equal(calls.dash, 0);
    assert.deepEqual(errs, ["pir: unknown command 'screen-time'. To build a plan: pir start screen-time\n" + USAGE_TEXT]);
  });
}

// --- The shipped bin/pir wrapper --------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const WRAPPER = join(REPO, 'bin', 'pir');

test('bin/pir execs the engine entrypoint and forwards its arguments', () => {
  // A thin wrapper: exec node <engine>/src/shell/pir.mjs "$@". The engine
  // dir is a placeholder install.sh bakes in (T13), so the file names the entrypoint relative to it.
  const wrapper = readFileSync(WRAPPER, 'utf8');
  assert.match(wrapper, /src\/shell\/pir\.mjs/, 'entrypoint is src/shell/pir.mjs');
  assert.match(wrapper, /__PIR_ENGINE__/, 'engine path is an install-time placeholder, not the cwd');
  assert.match(wrapper, /"\$@"/, 'forwards every argument to the engine');
});

test('bin/pir is marked executable', () => {
  const mode = statSync(WRAPPER).mode;
  assert.ok(mode & 0o111, 'bin/pir must be executable so it runs once on PATH');
});
