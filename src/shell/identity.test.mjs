import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAlive, startTimeOf, resolveLiveness } from './identity.mjs';
import { classifyRun } from '../core/runstate.mjs';

// The shape `ps -o lstart` returns (FINDINGS 2026-09-22). The exact value never matters — only
// equality against a recorded time — so one constant stands in throughout.
const LSTART = 'Tue Sep 22 08:27:37 2026';

// A fake `kill` that throws the given errno, the way process.kill(pid, 0) does.
function killThrowing(code) {
  return () => {
    const e = new Error(`kill: ${code}`);
    e.code = code;
    throw e;
  };
}

test('isAlive — true when the injected kill returns without throwing', () => {
  assert.equal(isAlive(4242, { kill: () => {} }), true);
});

test('isAlive — false when kill throws ESRCH (no such process)', () => {
  assert.equal(isAlive(4242, { kill: killThrowing('ESRCH') }), false);
});

test('isAlive — true when kill throws EPERM (exists but not ours)', () => {
  assert.equal(isAlive(4242, { kill: killThrowing('EPERM') }), true);
});

test('isAlive — false on any other unexpected errno', () => {
  // The safe default: do not claim alive on an error we did not anticipate.
  assert.equal(isAlive(4242, { kill: killThrowing('EINVAL') }), false);
});

test('startTimeOf — returns the trimmed lstart from a faked ps', () => {
  const exec = () => ({ ok: true, stdout: `  ${LSTART}\n` });
  assert.equal(startTimeOf(4242, { exec }), LSTART);
});

test('startTimeOf — null when ps exits non-zero', () => {
  const exec = () => ({ ok: false, stdout: '' });
  assert.equal(startTimeOf(4242, { exec }), null);
});

test('startTimeOf — null when ps prints nothing', () => {
  const exec = () => ({ ok: true, stdout: '\n' });
  assert.equal(startTimeOf(4242, { exec }), null);
});

test('resolveLiveness — composes isAlive and startTimeOf', () => {
  const exec = () => ({ ok: true, stdout: `${LSTART}\n` });
  assert.deepEqual(
    resolveLiveness(4242, { kill: () => {}, exec }),
    { alive: true, liveStartTime: LSTART },
  );
});

test('resolveLiveness — a dead process reports alive:false and no launch time, and never runs ps', () => {
  let execCalled = false;
  const exec = () => {
    execCalled = true;
    return { ok: true, stdout: `${LSTART}\n` };
  };
  assert.deepEqual(
    resolveLiveness(4242, { kill: killThrowing('ESRCH'), exec }),
    { alive: false, liveStartTime: null },
  );
  assert.equal(execCalled, false, 'ps must not be read for a number already known gone');
});

test('resolveLiveness output plugs straight into classifyRun — matching time → running', () => {
  const exec = () => ({ ok: true, stdout: `${LSTART}\n` });
  const { alive, liveStartTime } = resolveLiveness(4242, { kill: () => {}, exec });
  assert.equal(
    classifyRun({ recordedStartTime: LSTART, finalState: null, alive, liveStartTime }),
    'running',
  );
});

test('resolveLiveness output plugs straight into classifyRun — mismatching time → crashed (reused number)', () => {
  const exec = () => ({ ok: true, stdout: 'Tue Sep 22 09:14:02 2026\n' });
  const { alive, liveStartTime } = resolveLiveness(4242, { kill: () => {}, exec });
  assert.equal(
    classifyRun({ recordedStartTime: LSTART, finalState: null, alive, liveStartTime }),
    'crashed',
  );
});

test('smoke — real ps/kill against this very process reports it alive with a launch time', () => {
  // No injection: exercise the real defaultExec and process.kill against process.pid, which is by
  // definition alive and ours. This is the one place the module touches a real process.
  const { alive, liveStartTime } = resolveLiveness(process.pid);
  assert.equal(alive, true);
  assert.equal(typeof liveStartTime, 'string');
  assert.ok(liveStartTime.length > 0, 'a live process must have a non-empty launch time');
});
