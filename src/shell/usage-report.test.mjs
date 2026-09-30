// api-service T04 — the run-side writer of usage readings (DESIGN §2.4, §2.8, §3.4). Real filesystem,
// always under a temp folder: every test passes its own `env` and `osHome`, so nothing here can reach
// the real ~/.pir/usage.json whatever the test process's own environment holds.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { usageReporterFromEnv, defaultUsageReporter } from './usage-report.mjs';
import { parseReading } from '../core/usage.mjs';

// Stands in for os.userInfo().homedir: a home no scratch folder below is ever equal to.
const OS_HOME = '/Users/somebody';

const usageEvent = (five = 0.97, seven = 0.77) => ({
  type: 'rate_limit_event',
  rate_limit_info: {
    status: 'allowed',
    unifiedWindows: {
      five_hour: { utilization: five, resetsAt: 1790673000 },
      seven_day: { utilization: seven, resetsAt: 1790830800 },
    },
  },
});

function scratch(t) {
  const home = mkdtempSync(join(tmpdir(), 'pir-usage-report-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  return { home, pirDir: join(home, '.pir'), file: join(home, '.pir', 'usage.json') };
}

const T1 = 1790669288699;
const T2 = T1 + 5000;

test('PIR_RUN unset or anything but "1" → null; PIR_RUN=1 with a scratch PIR_HOME → a function', (t) => {
  const { home } = scratch(t);
  assert.equal(usageReporterFromEnv({ PIR_HOME: home }, { osHome: OS_HOME }), null);
  assert.equal(usageReporterFromEnv({ PIR_RUN: '', PIR_HOME: home }, { osHome: OS_HOME }), null);
  assert.equal(usageReporterFromEnv({ PIR_RUN: 'true', PIR_HOME: home }, { osHome: OS_HOME }), null);
  assert.equal(typeof usageReporterFromEnv({ PIR_RUN: '1', PIR_HOME: home }, { osHome: OS_HOME }), 'function');
  assert.equal(typeof usageReporterFromEnv({ PIR_RUN: '1', HOME: home }, { osHome: OS_HOME }), 'function');
  assert.equal(existsSync(join(home, '.pir')), false, 'building a reporter writes nothing');
});

test('PIR_RUN=1 on the real home under the test runner → null; with no home at all → null', () => {
  assert.equal(usageReporterFromEnv({ PIR_RUN: '1', HOME: OS_HOME, NODE_TEST_CONTEXT: 'child-v8' }, { osHome: OS_HOME }), null);
  assert.equal(usageReporterFromEnv({ PIR_RUN: '1', PIR_HOME: OS_HOME, HOME: '/elsewhere', NODE_TEST_CONTEXT: 'child-v8' }, { osHome: OS_HOME }), null);
  assert.equal(usageReporterFromEnv({ PIR_RUN: '1' }, { osHome: OS_HOME }), null);
  // An OS home nobody could name is refused rather than read as scratch. null, not undefined: an
  // undefined option takes the default, which is the account's real home.
  assert.equal(usageReporterFromEnv({ PIR_RUN: '1', HOME: OS_HOME }, { osHome: null, write: () => {} }), null);
});

test('PIR_RUN=1 on the real home outside the test runner → a reporter writing that home\'s usage.json', (t) => {
  // The "real" home is a temp folder here, named as the OS home: the rule is a string comparison.
  const { home, file } = scratch(t);
  const writes = [];
  const report = usageReporterFromEnv({ PIR_RUN: '1', HOME: home }, { osHome: home, write: (path, text) => writes.push({ path, text }) });
  report(usageEvent(), T1);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, file);
});

test('the reporter writes {PIR_HOME}/.pir/usage.json, creating .pir, and parseReading reads it back', (t) => {
  const { home, pirDir, file } = scratch(t);
  // PIR_HOME wins over HOME, the same precedence as indexDir.
  const report = usageReporterFromEnv({ PIR_RUN: '1', PIR_HOME: home, HOME: '/elsewhere' }, { osHome: OS_HOME });
  assert.equal(existsSync(pirDir), false);
  assert.equal(report(usageEvent(), T1), undefined);
  assert.deepEqual(parseReading(readFileSync(file, 'utf8'), T1), {
    observedAt: T1,
    fiveHour: { utilization: 0.97, resetsAt: 1790673000 },
    sevenDay: { utilization: 0.77, resetsAt: 1790830800 },
  });
  // The file is exactly DESIGN §2.4.
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), {
    version: 1,
    observed_at: T1,
    five_hour: { utilization: 0.97, resets_at: 1790673000 },
    seven_day: { utilization: 0.77, resets_at: 1790830800 },
  });
});

test('a second event overwrites the first, even with unchanged numbers; one with no unifiedWindows leaves the file untouched', (t) => {
  const { home, file } = scratch(t);
  const report = usageReporterFromEnv({ PIR_RUN: '1', PIR_HOME: home }, { osHome: OS_HOME });
  report(usageEvent(0.5, 0.6), T1);
  report(usageEvent(0.5, 0.6), T2);
  assert.equal(parseReading(readFileSync(file, 'utf8'), T2).observedAt, T2, 'observed_at moves although the numbers did not');
  report(usageEvent(0.9, 0.8), T2 + 1);
  const after = readFileSync(file, 'utf8');
  assert.equal(parseReading(after, T2 + 1).fiveHour.utilization, 0.9);

  // The documented single-window fields are not a fallback (§2.3): the two-window reading stands.
  report({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', resetsAt: 1790673000, rateLimitType: 'five_hour' } }, T2 + 2);
  report({ type: 'rate_limit_event', rate_limit_info: { unifiedWindows: { five_hour: { utilization: 'x', resetsAt: 1 }, seven_day: null } } }, T2 + 3);
  report(usageEvent(), undefined);
  assert.equal(readFileSync(file, 'utf8'), after);
});

test('a non-usage message writes nothing', (t) => {
  const { home, pirDir } = scratch(t);
  const report = usageReporterFromEnv({ PIR_RUN: '1', PIR_HOME: home }, { osHome: OS_HOME });
  for (const m of [{ type: 'assistant', message: { content: [] } }, { type: 'result', subtype: 'success' }, { type: 'system', subtype: 'init' }, null, undefined, 'text', 7]) {
    assert.equal(report(m, T1), undefined);
  }
  assert.equal(existsSync(pirDir), false, '.pir is not even created');
});

test('a write that throws, and a PIR_HOME that is a file, never throw', (t) => {
  const { home, file } = scratch(t);
  let calls = 0;
  const failing = usageReporterFromEnv({ PIR_RUN: '1', PIR_HOME: home }, {
    osHome: OS_HOME,
    write: () => {
      calls += 1;
      throw new Error('disk full');
    },
  });
  assert.doesNotThrow(() => failing(usageEvent(), T1));
  assert.equal(calls, 1, 'the write was attempted');
  assert.equal(existsSync(file), false);

  // The real writer against a home that is a file: mkdir fails (ENOTDIR or EEXIST) and is swallowed.
  const notAFolder = join(home, 'a-file');
  writeFileSync(notAFolder, 'x');
  const report = usageReporterFromEnv({ PIR_RUN: '1', PIR_HOME: notAFolder }, { osHome: OS_HOME });
  assert.doesNotThrow(() => report(usageEvent(), T1));
  assert.equal(readFileSync(notAFolder, 'utf8'), 'x', 'the file in the way is left alone');
});

test('no .tmp file is left behind after a write', (t) => {
  const { home, pirDir } = scratch(t);
  const report = usageReporterFromEnv({ PIR_RUN: '1', PIR_HOME: home }, { osHome: OS_HOME });
  report(usageEvent(), T1);
  report(usageEvent(), T2);
  assert.deepEqual(readdirSync(pirDir), ['usage.json']);
});

test('defaultUsageReporter is null in this test process, and the same answer every call', () => {
  // This process is under `node --test` (NODE_TEST_CONTEXT is set) with no scratch home of its own, so
  // whatever PIR_RUN is here the default must be off: a test that forgot its scratch home fails closed.
  assert.equal(defaultUsageReporter(), null);
  assert.equal(defaultUsageReporter(), null);
});

test('defaultUsageReporter reads process.env: a PIR_RUN=1 process on a scratch home writes there', (t) => {
  const { home, file } = scratch(t);
  const moduleUrl = new URL('./usage-report.mjs', import.meta.url).href;
  const code = `
    const { defaultUsageReporter } = await import(${JSON.stringify(moduleUrl)});
    const report = defaultUsageReporter();
    if (report !== defaultUsageReporter()) throw new Error('not computed once');
    report(${JSON.stringify(usageEvent())}, ${T1});
  `;
  execFileSync(process.execPath, ['--input-type=module', '-e', code], {
    cwd: dirname(fileURLToPath(import.meta.url)),
    env: { ...process.env, PIR_RUN: '1', PIR_HOME: home },
    timeout: 30_000,
  });
  assert.equal(parseReading(readFileSync(file, 'utf8'), T1).observedAt, T1);
});
