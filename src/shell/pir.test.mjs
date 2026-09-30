// The `pir` dispatch (detached-runs T11, pir-plan-command T09): argv → the right hand-off, with startRun and the TUI injected so nothing
// spawns a coordinator or enters raw mode. The exit code is asserted alongside each call because a
// refused start is a scriptable failure, not a view (DESIGN §2.5). The last test is a read-of-the-file
// smoke check on the bin/pir wrapper, in the launcher.test.mjs style.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync, mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, realpathSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { run, USAGE } from './pir.mjs';
import { readNotifyConfig, notifyPaths, DEFAULT_ICON } from './notify-config.mjs';

// A set of spies for run's collaborators: startRun and startPlanRun return whatever the test wants, the
// TUI hand-offs record their calls, and stderr is a sink shaped like process.stderr.
//
// The brief box spy acts as the person would: `box` is 'cancel' or the text they send, and the spy records
// the order of events so a test can see the pre-flight ran before the box opened.
function harness(startResult, planResult, { box = 'cancel', preflight = { ok: true, root: '/r', repo: 'shop' } } = {}) {
  const calls = { start: [], plan: [], dash: 0, watch: [], planner: [], brief: [], order: [] };
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
    openPlanner: (key) => {
      calls.planner.push(key);
      calls.order.push('planner');
      return Promise.resolve();
    },
    planPreflight: () => {
      calls.order.push('preflight');
      return preflight;
    },
    openBriefBox: async ({ repo, onSubmit, onCancel }) => {
      calls.brief.push(repo);
      calls.order.push('box');
      if (box === 'cancel') return onCancel();
      return onSubmit(box);
    },
    stderr: { write: (s) => errs.push(s) },
  };
  return { calls, errs, deps };
}

const USAGE_TEXT =
  'usage: pir                    the dashboard\n' +
  '       pir plan ["brief"]     plan something new\n' +
  '       pir start {slug}       build a reviewed plan\n' +
  '       pir notify [test|off]  phone alerts: set up, test, turn off\n' +
  '       pir service [on|off]   the local API service: state, start, stop\n';

test('the usage text is exactly the five verbs', () => {
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

test('[plan] → pre-flight, then the brief box on the repo; cancel → exit 0 with nothing started', async () => {
  const { calls, errs, deps } = harness(undefined, { started: true, runId: 'plan-3f2a' });
  const code = await run(['plan'], deps);
  assert.equal(code, 0);
  assert.deepEqual(calls.order, ['preflight', 'box']);
  assert.deepEqual(calls.brief, ['shop']);
  assert.deepEqual(calls.plan, [], 'startPlanRun never called on a cancel');
  assert.deepEqual(calls.planner, []);
  assert.deepEqual(errs, []);
});

test('[plan] → a multi-line brief sent from the box reaches startPlanRun with its newlines, then the planner opens', async () => {
  const brief = 'Export orders as CSV.\nFilters apply to the export.';
  const { calls, errs, deps } = harness(undefined, { started: true, runId: 'plan-3f2a' }, { box: brief });
  assert.equal(await run(['plan'], deps), 0);
  assert.deepEqual(calls.plan, [brief]);
  assert.deepEqual(calls.planner, ['plan-3f2a']);
  assert.deepEqual(calls.watch, [], 'the planner view, not the bare watch view');
  assert.deepEqual(errs, []);
});

test('[plan] → a pre-flight refusal prints before any box opens, exit 1', () => {
  const message = 'pir: no base branch is set for shop. Add …';
  const { calls, errs, deps } = harness(undefined, undefined, { preflight: { ok: false, reason: 'no-base-setting', message } });
  assert.equal(run(['plan'], deps), 1, 'refused at once, not as a promise');
  assert.deepEqual(errs, [`${message}\n`], 'the §2.9 text, as the pre-flight worded it');
  assert.deepEqual(calls.order, ['preflight']);
  assert.deepEqual(calls.plan, []);
});

test('[plan] → a start refused after the box closes prints its line and exits 1', async () => {
  const message = 'pir: could not fetch dev from origin: fatal: nope. Nothing was created; try again when origin is reachable.';
  const { calls, errs, deps } = harness(undefined, { started: false, reason: 'fetch-failed', message }, { box: 'a brief' });
  assert.equal(await run(['plan'], deps), 1);
  assert.deepEqual(errs, [`${message}\n`]);
  assert.deepEqual(calls.planner, []);
});

test('[plan, words…] → startPlanRun with the words joined by one space, then the planner opened on the run id, exit 0', () => {
  const { calls, errs, deps } = harness(undefined, { started: true, runId: 'plan-3f2a', pid: 1, record: {} });
  assert.equal(run(['plan', 'a', 'daily', 'screen budget'], deps), 0);
  assert.deepEqual(calls.plan, ['a daily screen budget']);
  assert.deepEqual(calls.planner, ['plan-3f2a'], "the planner's conversation opens on the run id, the record key before the rename");
  assert.deepEqual(calls.watch, []);
  assert.deepEqual(calls.brief, [], 'no box when the brief is given');
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
  ['empty-brief', 'pir plan: the brief is empty — say what to plan, e.g. pir plan "a daily screen budget"\n'],
  ['something-new', 'pir plan: cannot start: something-new\n'],
  // The canonical-repo refusal is gone (dashboard-plan-box DESIGN §2.8): no dedicated message is left.
  ['canonical-repo', 'pir plan: cannot start: canonical-repo\n'],
]) {
  test(`[plan] refused ${reason} → one clean line on stderr, exit 1, no view`, () => {
    const { calls, errs, deps } = harness(undefined, { started: false, reason });
    assert.equal(run(['plan', '  '], deps), 1);
    assert.deepEqual(errs, [message]);
    assert.deepEqual(calls.watch, []);
    assert.deepEqual(calls.planner, []);
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

test('[start] a base-branch refusal → its §2.9 text on stderr, exit 1, no watch (base-branch T06)', () => {
  const message = 'pir: no base branch is set for shop. Add .pir/settings.json with {"baseBranch": "<branch>"} (committed, for everyone), or ~/.pir/shop/settings.json (this machine only).';
  const { calls, errs, deps } = harness({ started: false, reason: 'no-base-setting', message });
  const code = run(['start', 'screen-time'], deps);
  assert.equal(code, 1);
  assert.deepEqual(calls.watch, []);
  assert.deepEqual(errs, [`${message}\n`]);
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

// --- pir start {slug} --no-coordinator (pir-coordinator T04, DESIGN §2.1) ------------------------

test('[start, slug, --no-coordinator] → startRun with coordinator: false, in either order; plain start passes no option', () => {
  const seen = [];
  const deps = (r) => ({ startRun: (slug, opts) => { seen.push({ slug, opts }); return r; }, openWatch: () => {}, stderr: { write: () => {} } });
  const ok = { started: true, pid: 1, record: {} };
  assert.equal(run(['start', 'screen-time', '--no-coordinator'], deps(ok)), 0);
  assert.equal(run(['start', '--no-coordinator', 'screen-time'], deps(ok)), 0);
  assert.equal(run(['start', 'screen-time'], deps(ok)), 0);
  assert.deepEqual(seen, [
    { slug: 'screen-time', opts: { coordinator: false } },
    { slug: 'screen-time', opts: { coordinator: false } },
    { slug: 'screen-time', opts: undefined },
  ]);
});

test('[start] an unknown flag, or a flag with no slug → usage, exit 2, nothing started', () => {
  for (const argv of [['start', 'x', '--no-coordinatr'], ['start', 'x', '-n'], ['start', '--no-coordinator'], ['start', 'x', 'y', '--no-coordinator']]) {
    const { calls, errs, deps } = harness({ started: true });
    assert.equal(run(argv, deps), 2, argv.join(' '));
    assert.deepEqual(calls.start, [], argv.join(' '));
    assert.deepEqual(errs, [USAGE], argv.join(' '));
  }
});

// --- pir notify (reliable-notifications T06, DESIGN §2.6, §2.8) ------------------------------------
// The real config functions on a scratch PIR_HOME; publish, the topic and the QR are injected, so no test
// reaches ntfy.sh or depends on randomness.

function notifyHarness(t, { results = [{ ok: true, status: 200 }], topics = ['pir-first', 'pir-second'], env: extra = {} } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'pir-notify-cmd-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const env = { PIR_HOME: home, ...extra };
  const sent = [];
  const out = [];
  const errs = [];
  let topicIx = 0;
  const deps = {
    env,
    stdout: { write: (s) => out.push(s) },
    stderr: { write: (s) => errs.push(s) },
    publish: async (fields, opts) => {
      sent.push({ fields, opts });
      return results[Math.min(sent.length - 1, results.length - 1)];
    },
    newTopic: () => topics[topicIx++],
    qr: (url) => `[QR ${url}]`,
  };
  return { env, sent, out, errs, deps, text: () => out.join(''), errText: () => errs.join('') };
}

test('[notify] first run: saves the injected topic, prints topic, QR and steps, sends one test alert with the icon', async (t) => {
  const h = notifyHarness(t);
  const code = await run(['notify'], h.deps);
  assert.equal(code, 0);
  assert.deepEqual(readNotifyConfig(h.env), { server: 'https://ntfy.sh', topic: 'pir-first' });
  assert.equal(statSync(notifyPaths(h.env).config).mode & 0o777, 0o600);
  const text = h.text();
  assert.match(text, /pir-first/);
  assert.match(text, /\[QR https:\/\/ntfy\.sh\/pir-first\]/);
  assert.match(text, /Install the ntfy app/);
  assert.match(text, /Subscribe to topic/);
  assert.match(text, /Sent a test alert/);
  assert.equal(h.sent.length, 1);
  assert.deepEqual(h.sent[0].fields, {
    server: 'https://ntfy.sh', topic: 'pir-first', title: 'pir', message: 'pir test alert', icon: DEFAULT_ICON,
  });
  assert.deepEqual(h.sent[0].opts, { delays: [] }, 'no retry back-off while the person waits at the terminal');
  assert.equal(h.errText(), '');
});

test('[notify] PIR_NOTIFY_ICON reaches the test alert', async (t) => {
  const h = notifyHarness(t, { env: { PIR_NOTIFY_ICON: 'https://e.test/i.png' } });
  assert.equal(await run(['notify'], h.deps), 0);
  assert.equal(h.sent[0].fields.icon, 'https://e.test/i.png');
});

test('[notify] first run with a failing publish: config kept, topic and QR printed, error and `pir notify test` named, exit 1', async (t) => {
  const h = notifyHarness(t, { results: [{ ok: false, status: null, error: 'fetch failed: ENOTFOUND ntfy.sh' }] });
  const code = await run(['notify'], h.deps);
  assert.equal(code, 1);
  assert.equal(readNotifyConfig(h.env).topic, 'pir-first');
  assert.match(h.text(), /pir-first/);
  assert.match(h.text(), /\[QR https:\/\/ntfy\.sh\/pir-first\]/);
  assert.match(h.errText(), /fetch failed: ENOTFOUND ntfy\.sh/);
  assert.match(h.errText(), /pir notify test/);
});

test('[notify] a publish that throws is still a failure with the message, not a crash', async (t) => {
  const h = notifyHarness(t);
  h.deps.publish = async () => { throw new Error('boom'); };
  assert.equal(await run(['notify'], h.deps), 1);
  assert.match(h.errText(), /boom/);
});

test('[notify] second run: the same topic printed, no write, no publish', async (t) => {
  const h = notifyHarness(t);
  assert.equal(await run(['notify'], h.deps), 0);
  const before = readFileSync(notifyPaths(h.env).config, 'utf8');
  h.out.length = 0;
  let wrote = 0;
  const code = await run(['notify'], { ...h.deps, writeNotifyConfig: () => { wrote += 1; } });
  assert.equal(code, 0);
  assert.equal(wrote, 0);
  assert.equal(h.sent.length, 1, 'only the first run published');
  assert.equal(readFileSync(notifyPaths(h.env).config, 'utf8'), before);
  assert.match(h.text(), /pir-first/);
  assert.match(h.text(), /\[QR https:\/\/ntfy\.sh\/pir-first\]/);
  assert.match(h.text(), /Alerts are on/);
});

test('[notify test] no config: exit 1, a line naming `pir notify`, nothing sent', async (t) => {
  const h = notifyHarness(t);
  assert.equal(await run(['notify', 'test'], h.deps), 1);
  assert.equal(h.sent.length, 0);
  assert.match(h.errText(), /pir notify/);
});

test('[notify test] with config: sends the test alert with the icon; ok → exit 0 with the HTTP status', async (t) => {
  const h = notifyHarness(t);
  await run(['notify'], h.deps);
  h.out.length = 0;
  assert.equal(await run(['notify', 'test'], h.deps), 0);
  assert.equal(h.sent.length, 2);
  assert.deepEqual(h.sent[1].fields, h.sent[0].fields);
  assert.match(h.text(), /HTTP 200/);
});

test('[notify test] with config and a failing publish: exit 1 with the error', async (t) => {
  const h = notifyHarness(t, { results: [{ ok: true, status: 200 }, { ok: false, status: 503, error: 'HTTP 503' }] });
  await run(['notify'], h.deps);
  assert.equal(await run(['notify', 'test'], h.deps), 1);
  assert.match(h.errText(), /HTTP 503/);
});

test('[notify off] removes config and marker, says alerts are off; a later notify makes a new topic', async (t) => {
  const h = notifyHarness(t);
  await run(['notify'], h.deps);
  writeFileSync(notifyPaths(h.env).presence, '');
  h.out.length = 0;
  assert.equal(run(['notify', 'off'], h.deps), 0);
  assert.match(h.text(), /Alerts are off/);
  assert.equal(readNotifyConfig(h.env), null);
  assert.equal(existsSync(notifyPaths(h.env).presence), false);
  assert.equal(await run(['notify'], h.deps), 0);
  assert.equal(readNotifyConfig(h.env).topic, 'pir-second');
  assert.equal(h.sent.at(-1).fields.topic, 'pir-second');
});

test('[notify off] with nothing set up still succeeds', async (t) => {
  const h = notifyHarness(t);
  assert.equal(run(['notify', 'off'], h.deps), 0);
});

test('[notify] corrupt config: says so, names `pir notify off`, exit 1, nothing overwritten or sent', async (t) => {
  const h = notifyHarness(t);
  const { dir, config } = notifyPaths(h.env);
  mkdirSync(dir, { recursive: true });
  writeFileSync(config, '{not json');
  assert.equal(await run(['notify'], h.deps), 1);
  assert.equal(readFileSync(config, 'utf8'), '{not json');
  assert.equal(h.sent.length, 0);
  assert.match(h.errText(), /pir notify off/);
  // `test` on a corrupt config says the same rather than "not set up".
  h.errs.length = 0;
  assert.equal(await run(['notify', 'test'], h.deps), 1);
  assert.equal(h.sent.length, 0);
  assert.match(h.errText(), /pir notify off/);
  // And `off` is the way out.
  assert.equal(run(['notify', 'off'], h.deps), 0);
  assert.equal(readNotifyConfig(h.env), null);
});

test('[notify] an unknown or extra argument → usage, exit 2, nothing touched', async (t) => {
  for (const argv of [['notify', 'foo'], ['notify', 'test', 'x'], ['notify', 'off', 'now'], ['notify', '--test']]) {
    const h = notifyHarness(t);
    assert.equal(run(argv, h.deps), 2, argv.join(' '));
    assert.deepEqual(h.errs, [USAGE], argv.join(' '));
    assert.equal(h.sent.length, 0);
    assert.equal(readNotifyConfig(h.env), null);
  }
});

test('[notify] the default QR renders the ntfy URL with uqr', async (t) => {
  const h = notifyHarness(t);
  delete h.deps.qr;
  assert.equal(await run(['notify'], h.deps), 0);
  assert.match(h.text(), /[█▀▄]{10}/, 'a block-character QR is drawn');
});

// --- pir service (api-service T07, DESIGN §2.7) ------------------------------------------------------
// The three collaborators are spies: what they return is printed and becomes the exit code. Nothing here
// reaches launchctl, the port or a login item.

function serviceHarness({ results = {}, env = { PIR_HOME: '/scratch/home' } } = {}) {
  const calls = [];
  const out = [];
  const errs = [];
  const spy = (name) => async (opts) => {
    calls.push({ name, opts });
    const r = results[name] ?? { text: `${name} text`, code: 0 };
    if (r instanceof Error) throw r;
    return r;
  };
  const deps = {
    env,
    stdout: { write: (s) => out.push(s) },
    stderr: { write: (s) => errs.push(s) },
    serviceOn: spy('on'),
    serviceOff: spy('off'),
    serviceStatus: spy('status'),
    openDashboard: () => calls.push({ name: 'dashboard' }),
  };
  return { env, calls, out, errs, deps };
}

test('[service] → serviceStatus; its text and a newline on stdout, its code returned', async () => {
  const running = 'pir service: running at http://127.0.0.1:47717 (pid 4711)\nlast usage reading 2 min ago: 5-hour 97%, weekly 77%';
  const h = serviceHarness({ results: { status: { text: running, code: 0 } } });
  const result = run(['service'], h.deps);
  assert.ok(result instanceof Promise, 'the code comes back as a promise');
  assert.equal(await result, 0);
  assert.deepEqual(h.out, [`${running}\n`]);
  assert.deepEqual(h.errs, []);
  assert.deepEqual(h.calls, [{ name: 'status', opts: { env: h.env } }], 'only the status check ran, with run\'s env');
});

test('[service] a state other than running → its code, the text still on stdout', async () => {
  const off = 'pir service: off\nturn it on with: pir service on';
  const h = serviceHarness({ results: { status: { text: off, code: 1 } } });
  assert.equal(await run(['service'], h.deps), 1);
  assert.deepEqual(h.out, [`${off}\n`]);
  assert.deepEqual(h.errs, []);
});

test('[service on] and [service off] → the matching collaborator, text printed, code returned', async () => {
  const results = {
    on: { text: 'pir service: macOS would not register it: Bootstrap failed: 5: Input/output error\ntry: pir service off, then pir service on', code: 1 },
    off: { text: 'pir service: off', code: 0 },
  };
  for (const word of ['on', 'off']) {
    const h = serviceHarness({ results });
    assert.equal(await run(['service', word], h.deps), results[word].code, word);
    assert.deepEqual(h.out, [`${results[word].text}\n`], word);
    assert.deepEqual(h.errs, [], word);
    assert.deepEqual(h.calls, [{ name: word, opts: { env: h.env } }], word);
  }
});

test('[service] an unknown or extra argument → usage on stderr, exit 2, no collaborator called', () => {
  for (const argv of [['service', 'restart'], ['service', 'on', 'extra'], ['service', 'off', 'now'], ['service', 'status'], ['service', 'refresh'], ['service', '--on']]) {
    const h = serviceHarness();
    assert.equal(run(argv, h.deps), 2, argv.join(' '));
    assert.deepEqual(h.errs, [USAGE], argv.join(' '));
    assert.deepEqual(h.out, [], argv.join(' '));
    assert.deepEqual(h.calls, [], argv.join(' '));
  }
});

// serviceOn and serviceOff reject when a write fails (FINDINGS 2026-09-30, T06 review). The person gets
// the line `node service-ctl.mjs` prints for the same failure, not a stack trace.
test('[service] a collaborator that rejects, or throws → one line on stderr, exit 1', async () => {
  const denied = new Error("EACCES: permission denied, open '/Users/me/Library/LaunchAgents/com.pir.api-service.plist.tmp'");
  for (const word of ['on', 'off']) {
    const h = serviceHarness({ results: { [word]: denied } });
    assert.equal(await run(['service', word], h.deps), 1, word);
    assert.deepEqual(h.errs, [`pir service: ${denied.message}\n`], word);
    assert.deepEqual(h.out, [], word);
  }
  const h = serviceHarness();
  h.deps.serviceStatus = () => {
    throw new Error('a scratch item needs its own label and plistPath');
  };
  assert.equal(await run(['service'], h.deps), 1);
  assert.deepEqual(h.errs, ['pir service: a scratch item needs its own label and plistPath\n']);
});

test('the usage text names pir service [on|off]', () => {
  assert.match(USAGE, /^ {7}pir service \[on\|off\] {3}the local API service: state, start, stop$/m);
});

// The real verb against the real service-ctl, on a scratch home: the home rule (DESIGN §2.8) keeps it
// from launchctl, the fixed port and the login item, so this is safe under the test runner. Off macOS
// every form prints the one needs-macOS line instead.
test('pir service on a scratch home prints a §2.7 text; on is skipped and changes nothing', (t) => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'pir-service-cmd-')));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const pirPath = fileURLToPath(new URL('./pir.mjs', import.meta.url));
  const pir = (...args) =>
    spawnSync('node', [pirPath, 'service', ...args], {
      encoding: 'utf8',
      env: { ...process.env, HOME: home, PIR_HOME: home },
      timeout: 20000,
    });
  const mac = process.platform === 'darwin';
  const needsMac = 'pir service needs macOS (launchd)\n';

  const status = pir();
  assert.equal(status.stderr, '');
  assert.equal(status.stdout, mac ? 'pir service: registered but not answering\ntry: pir service off, then pir service on\n' : needsMac);
  assert.equal(status.status, 1);

  const on = pir('on');
  assert.equal(on.stderr, '');
  assert.equal(on.stdout, mac ? 'skipped the API service (not the real home)\n' : needsMac);
  // A skip is not a failure (0); off macOS `on` is refused (1).
  assert.equal(on.status, mac ? 0 : 1);
  assert.equal(existsSync(join(home, 'Library')), false, 'no plist written');
  assert.equal(existsSync(join(home, '.pir')), false, 'no marker, no discovery file');

  const bad = pir('restart');
  assert.equal(bad.status, 2);
  assert.equal(bad.stdout, '');
  assert.equal(bad.stderr, USAGE);
});

// The real `pir plan` against the real engine, in a scratch repo with no .pir/settings.json (base-branch
// T05): the §2.9 text on stderr, a non-zero exit, and the repo left exactly as it was. HOME and PIR_HOME
// point at the scratch folder, so neither the person's real settings nor their run index is read.
test('pir plan in a repo without settings prints the §2.9 refusal and exits 1, creating nothing', (t) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'pir-nosettings-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const root = join(dir, 'shop');
  mkdirSync(root);
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-q', '-b', 'main');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', 'init');
  const pirPath = fileURLToPath(new URL('./pir.mjs', import.meta.url));
  const r = spawnSync('node', [pirPath, 'plan', 'a brief'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, HOME: dir, PIR_HOME: dir },
    timeout: 20000,
  });
  assert.equal(r.status, 1, r.stderr);
  assert.equal(r.stderr, 'pir: no base branch is set for shop. Add .pir/settings.json with {\"baseBranch\": \"<branch>\"} (committed, for everyone), or ~/.pir/shop/settings.json (this machine only).\n');
  assert.equal(git('for-each-ref', '--format=%(refname)', 'refs/heads').trim(), 'refs/heads/main', 'no branch cut');
  assert.equal(existsSync(join(root, 'plans')), false, 'no control folder');
  assert.equal(existsSync(join(dir, '.pir', 'runs')), false, 'no index record');
});
