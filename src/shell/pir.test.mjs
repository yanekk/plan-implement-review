// The `pir` dispatch (T11): argv → the right hand-off, with startRun and the TUI injected so nothing
// spawns a coordinator or enters raw mode. The exit code is asserted alongside each call because a
// refused start is a scriptable failure, not a view (DESIGN §2.5). The last test is a read-of-the-file
// smoke check on the bin/pir wrapper, in the launcher.test.mjs style.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { run } from './pir.mjs';

// A set of spies for run's collaborators: startRun returns whatever the test wants, the two TUI
// hand-offs record their calls, and stderr is a sink shaped like process.stderr.
function harness(startResult) {
  const calls = { start: [], dash: 0, watch: [] };
  const errs = [];
  const deps = {
    startRun: (slug) => {
      calls.start.push(slug);
      return startResult;
    },
    openDashboard: () => {
      calls.dash += 1;
    },
    openWatch: (slug) => {
      calls.watch.push(slug);
    },
    stderr: { write: (s) => errs.push(s) },
  };
  return { calls, errs, deps };
}

test('no args → the dashboard, exit 0', () => {
  const { calls, errs, deps } = harness();
  const code = run([], deps);
  assert.equal(code, 0);
  assert.equal(calls.dash, 1, 'openDashboard called once');
  assert.deepEqual(calls.watch, [], 'no watch opened');
  assert.deepEqual(calls.start, [], 'startRun not called with no slug');
  assert.deepEqual(errs, [], 'nothing on stderr');
});

test('[slug] that starts → its live view, exit 0', () => {
  const { calls, errs, deps } = harness({ started: true, pid: 4242, record: {} });
  const code = run(['screen-time'], deps);
  assert.equal(code, 0);
  assert.deepEqual(calls.start, ['screen-time'], 'startRun called with the slug');
  assert.deepEqual(calls.watch, ['screen-time'], 'openWatch called once with the slug');
  assert.equal(calls.dash, 0, 'the dashboard is not opened');
  assert.deepEqual(errs, [], 'no error on a clean start');
});

test('[slug] already running → open, do not start a second, exit 0', () => {
  // startRun took its alreadyRunning path (started:false, alreadyRunning:true), so no coordinator was
  // spawned; the caller opens the existing run's view instead (DESIGN §2.5).
  const { calls, errs, deps } = harness({ started: false, reason: 'already-running', alreadyRunning: true });
  const code = run(['screen-time'], deps);
  assert.equal(code, 0);
  assert.deepEqual(calls.watch, ['screen-time'], 'the live view opens on the running slug');
  assert.deepEqual(errs, [], 'already-running is not an error');
});

test('no-plan → clean message on stderr, exit 1, no watch', () => {
  const { calls, errs, deps } = harness({ started: false, reason: 'no-plan' });
  const code = run(['ghost'], deps);
  assert.equal(code, 1);
  assert.deepEqual(calls.watch, [], 'no view opens on a refused start');
  assert.equal(calls.dash, 0);
  assert.equal(errs.length, 1);
  assert.match(errs[0], /no plan 'ghost' — plans\/ghost\/ not found/);
});

test('not-reviewed → clean message on stderr, exit 1, no watch', () => {
  const { calls, errs, deps } = harness({ started: false, reason: 'not-reviewed' });
  const code = run(['screen-time'], deps);
  assert.equal(code, 1);
  assert.deepEqual(calls.watch, [], 'no view opens on a refused start');
  assert.equal(errs.length, 1);
  assert.match(errs[0], /'screen-time' is not reviewed — run \/pir-review-plan screen-time/);
});

test('two or more args → usage on stderr, exit 2', () => {
  const { calls, errs, deps } = harness();
  const code = run(['a', 'b'], deps);
  assert.equal(code, 2);
  assert.deepEqual(calls.start, [], 'startRun not called on a usage error');
  assert.deepEqual(calls.watch, []);
  assert.equal(calls.dash, 0);
  assert.equal(errs.length, 1);
  assert.match(errs[0], /usage: pir/);
});

// --- The shipped bin/pir wrapper --------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const WRAPPER = join(REPO, 'bin', 'pir');

test('bin/pir execs the engine entrypoint and forwards its arguments', () => {
  // A thin wrapper mirroring bin/pir-coordinate: exec node <engine>/src/shell/pir.mjs "$@". The engine
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
