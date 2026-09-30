import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SERVICE_LABEL, ageText, plistText, servicePlan, statusText } from './service.mjs';

const MAC = process.platform === 'darwin';
const NODE = '/opt/homebrew/bin/node';
const SCRIPT = '/Users/someone/.claude/pir-engine/src/shell/api-service.mjs';

// Write the plist to a temp file, lint it with the OS's own parser and hand back what it parsed.
function parsed(text) {
  const dir = mkdtempSync(join(tmpdir(), 'pir-plist-'));
  try {
    const file = join(dir, 'agent.plist');
    writeFileSync(file, text);
    execFileSync('/usr/bin/plutil', ['-lint', file], { stdio: 'pipe' });
    const json = join(dir, 'agent.json');
    execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', json, file], { stdio: 'pipe' });
    return JSON.parse(readFileSync(json, 'utf8'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- plistText ---------------------------------------------------------------------------------

test('plistText: the real label parses as a plist with the keys launchd reads', { skip: !MAC }, () => {
  const plist = parsed(plistText({ label: SERVICE_LABEL, node: NODE, script: SCRIPT }));
  assert.deepEqual(plist, {
    Label: 'com.pir.api-service',
    ProgramArguments: [NODE, SCRIPT],
    RunAtLoad: true,
    KeepAlive: true,
    ProcessType: 'Background',
  });
});

test('plistText: a path with &, < and a space is escaped in the text', () => {
  const text = plistText({ label: SERVICE_LABEL, node: NODE, script: '/Users/a & b/<x>/it\'s "q".mjs' });
  assert.ok(text.includes('<string>/Users/a &amp; b/&lt;x&gt;/it&apos;s &quot;q&quot;.mjs</string>'), text);
  assert.ok(!text.includes('a & b'));
});

test('plistText: a path with &, < and a space survives plutil -convert json', { skip: !MAC }, () => {
  const script = '/Users/a & b/<x>/it\'s "q".mjs';
  const node = '/opt/my <node> & co/bin/node';
  const plist = parsed(plistText({ label: 'a&b<c>', node, script }));
  assert.deepEqual(plist.ProgramArguments, [node, script]);
  assert.equal(plist.Label, 'a&b<c>');
});

test('plistText: no env → no EnvironmentVariables key', () => {
  const text = plistText({ label: SERVICE_LABEL, node: NODE, script: SCRIPT });
  assert.ok(!text.includes('EnvironmentVariables'));
  assert.ok(text.endsWith('</plist>\n'));
});

test('plistText: env → EnvironmentVariables with each pair, escaped', () => {
  const text = plistText({
    label: SERVICE_LABEL,
    node: NODE,
    script: SCRIPT,
    env: { PIR_HOME: '/tmp/a & b', 'K<1>': 'v' },
  });
  assert.ok(
    text.includes(
      [
        '\t<key>EnvironmentVariables</key>',
        '\t<dict>',
        '\t\t<key>PIR_HOME</key>',
        '\t\t<string>/tmp/a &amp; b</string>',
        '\t\t<key>K&lt;1&gt;</key>',
        '\t\t<string>v</string>',
        '\t</dict>',
      ].join('\n'),
    ),
    text,
  );
});

test('plistText: env parses back as the pairs given', { skip: !MAC }, () => {
  const env = { PIR_HOME: '/tmp/a & b', 'K<1>': 'v' };
  const plist = parsed(plistText({ label: SERVICE_LABEL, node: NODE, script: SCRIPT, env }));
  assert.deepEqual(plist.EnvironmentVariables, env);
  assert.deepEqual(Object.keys(plist).sort(), [
    'EnvironmentVariables',
    'KeepAlive',
    'Label',
    'ProcessType',
    'ProgramArguments',
    'RunAtLoad',
  ]);
});

// --- servicePlan -------------------------------------------------------------------------------

const REAL = { kind: 'real', platform: 'darwin', installedEngine: true, off: false, loaded: false };
const names = (plan) => plan.steps.map((s) => s.do);
const NEEDS_MACOS = 'pir service needs macOS (launchd)';
const SKIPPED = 'skipped the API service (not the real home)';
const RUN_INSTALLED = 'pir service: run the installed pir (./install.sh first)';
const IS_OFF = 'the API service is off (pir service on turns it on)';

test('servicePlan: off macOS → the macOS message, no steps; code 0 for refresh, 1 for on and off', () => {
  for (const [action, code] of [['refresh', 0], ['on', 1], ['off', 1]]) {
    assert.deepEqual(
      servicePlan(action, { ...REAL, platform: 'linux' }),
      { steps: [], message: NEEDS_MACOS, code },
      action,
    );
  }
});

test('servicePlan: the platform rule comes before the home rule', () => {
  const plan = servicePlan('on', { ...REAL, platform: 'linux', kind: 'scratch' });
  assert.deepEqual(plan, { steps: [], message: NEEDS_MACOS, code: 1 });
});

test('servicePlan: a scratch home and test-real → skipped, no steps, code 0, for every action', () => {
  for (const kind of ['scratch', 'test-real']) {
    for (const action of ['on', 'off', 'refresh']) {
      assert.deepEqual(
        servicePlan(action, { ...REAL, kind, loaded: true }),
        { steps: [], message: SKIPPED, code: 0 },
        `${action} on ${kind}`,
      );
    }
  }
});

test('servicePlan: the home rule comes before the installed-engine rule', () => {
  const plan = servicePlan('refresh', { ...REAL, kind: 'scratch', installedEngine: false });
  assert.deepEqual(plan, { steps: [], message: SKIPPED, code: 0 });
});

test('servicePlan: on and refresh from a copy that is not the installed engine → refused, code 1', () => {
  for (const action of ['on', 'refresh']) {
    assert.deepEqual(
      servicePlan(action, { ...REAL, installedEngine: false, loaded: true }),
      { steps: [], message: RUN_INSTALLED, code: 1 },
      action,
    );
  }
});

test('servicePlan: the installed-engine rule comes before the off marker', () => {
  const plan = servicePlan('refresh', { ...REAL, installedEngine: false, off: true });
  assert.deepEqual(plan, { steps: [], message: RUN_INSTALLED, code: 1 });
});

test('servicePlan: off works from a copy that is not the installed engine', () => {
  const plan = servicePlan('off', { ...REAL, installedEngine: false, loaded: true });
  assert.deepEqual(names(plan), ['bootout', 'remove-plist', 'remove-stale-discovery', 'write-off']);
});

test('servicePlan: refresh with the off marker → the is-off message, no steps, code 0', () => {
  const plan = servicePlan('refresh', { ...REAL, off: true, loaded: true });
  assert.deepEqual(plan, { steps: [], message: IS_OFF, code: 0 });
});

test('servicePlan: on, not loaded', () => {
  const plan = servicePlan('on', REAL);
  assert.deepEqual(names(plan), ['remove-off', 'write-plist', 'bootstrap', 'await-answer']);
  assert.equal(plan.message, null);
});

test('servicePlan: on, already loaded → bootout before bootstrap', () => {
  const plan = servicePlan('on', { ...REAL, loaded: true });
  assert.deepEqual(names(plan), ['remove-off', 'write-plist', 'bootout', 'bootstrap', 'await-answer']);
});

test('servicePlan: on with the off marker present removes it and starts', () => {
  const plan = servicePlan('on', { ...REAL, off: true });
  assert.deepEqual(names(plan), ['remove-off', 'write-plist', 'bootstrap', 'await-answer']);
});

test('servicePlan: refresh, not loaded and loaded', () => {
  assert.deepEqual(names(servicePlan('refresh', REAL)), ['write-plist', 'bootstrap', 'await-answer']);
  const loaded = servicePlan('refresh', { ...REAL, loaded: true });
  assert.deepEqual(names(loaded), ['write-plist', 'bootout', 'bootstrap', 'await-answer']);
  assert.equal(loaded.message, null);
});

test('servicePlan: off, loaded and not loaded', () => {
  const loaded = servicePlan('off', { ...REAL, loaded: true });
  assert.deepEqual(names(loaded), ['bootout', 'remove-plist', 'remove-stale-discovery', 'write-off']);
  assert.equal(loaded.message, null);
  assert.deepEqual(names(servicePlan('off', REAL)), ['remove-plist', 'remove-stale-discovery', 'write-off']);
});

test('servicePlan: off when already off still runs its steps', () => {
  const plan = servicePlan('off', { ...REAL, off: true });
  assert.deepEqual(names(plan), ['remove-plist', 'remove-stale-discovery', 'write-off']);
});

test('servicePlan: an unknown action throws rather than planning a refresh', () => {
  for (const action of ['restart', '', undefined]) {
    // Off macOS too: the check comes before every refusal, so a typo never reads as a clean no-op.
    for (const facts of [{ ...REAL, loaded: true }, { ...REAL, platform: 'linux' }]) {
      assert.throws(() => servicePlan(action, facts), /servicePlan: unknown action/, String(action));
    }
  }
});

// --- statusText --------------------------------------------------------------------------------

const NOW = 1_790_669_408_699;
const URL_ = 'http://127.0.0.1:47717';
const usageBody = (rate_limits, observed_at = NOW - 120_000) => ({ version: 1, observed_at, rate_limits });
const BOTH = {
  five_hour: { used_percentage: 97, resets_at: 1_790_673_000 },
  seven_day: { used_percentage: 77, resets_at: 1_790_830_800 },
};
const running = (usage) => statusText({ state: 'running', url: URL_, pid: 4711, usage, lastExit: null }, NOW);

test('statusText: running with a reading', () => {
  assert.deepEqual(running(usageBody(BOTH)), {
    text:
      'pir service: running at http://127.0.0.1:47717 (pid 4711)\n' +
      'last usage reading 2 min ago: 5-hour 97%, weekly 77%',
    code: 0,
  });
});

test('statusText: running with no reading — usage null, rate_limits null, observed_at null', () => {
  const expected = {
    text:
      'pir service: running at http://127.0.0.1:47717 (pid 4711)\n' +
      'no usage reading yet: it arrives with the first pir run on a Claude subscription',
    code: 0,
  };
  assert.deepEqual(running(null), expected);
  assert.deepEqual(running({ version: 1, observed_at: null, rate_limits: null }), expected);
  assert.deepEqual(running(usageBody(null)), expected);
  assert.deepEqual(running(usageBody(BOTH, null)), expected);
});

test('statusText: running on a scratch url names that url and pid', () => {
  const out = statusText({ state: 'running', url: 'http://127.0.0.1:51234', pid: 9, usage: null }, NOW);
  assert.equal(out.text.split('\n')[0], 'pir service: running at http://127.0.0.1:51234 (pid 9)');
});

test('statusText: off', () => {
  assert.deepEqual(statusText({ state: 'off' }, NOW), {
    text: 'pir service: off\nturn it on with: pir service on',
    code: 1,
  });
});

test('statusText: not installed', () => {
  assert.deepEqual(statusText({ state: 'not-installed' }, NOW), {
    text: 'pir service: not installed\nrun ./install.sh, or: pir service on',
    code: 1,
  });
});

test('statusText: port held', () => {
  const expected = {
    text:
      'pir service: not answering: port 47717 is held by another program\n' +
      'it retries every 10 seconds and comes up once the port is free',
    code: 1,
  };
  assert.deepEqual(statusText({ state: 'port-held', url: URL_, lastExit: 47 }, NOW), expected);
  assert.deepEqual(statusText({ state: 'port-held', url: null, lastExit: 47 }, NOW), expected);
});

test('statusText: port held names the port of the url it was given', () => {
  const out = statusText({ state: 'port-held', url: 'http://127.0.0.1:51234' }, NOW);
  assert.equal(out.text.split('\n')[0], 'pir service: not answering: port 51234 is held by another program');
});

test('statusText: registered but not answering, with an exit code', () => {
  assert.deepEqual(statusText({ state: 'not-answering', url: URL_, lastExit: 1 }, NOW), {
    text: 'pir service: registered but not answering (last exit code 1)\ntry: pir service off, then pir service on',
    code: 1,
  });
  const launchd = statusText({ state: 'not-answering', url: URL_, lastExit: 78 }, NOW);
  assert.equal(launchd.text.split('\n')[0], 'pir service: registered but not answering (last exit code 78)');
  // 0 is a real exit code, not an absent one.
  const zero = statusText({ state: 'not-answering', url: URL_, lastExit: 0 }, NOW);
  assert.equal(zero.text.split('\n')[0], 'pir service: registered but not answering (last exit code 0)');
});

test('statusText: registered but not answering, no exit code → no bracket', () => {
  const expected = {
    text: 'pir service: registered but not answering\ntry: pir service off, then pir service on',
    code: 1,
  };
  assert.deepEqual(statusText({ state: 'not-answering', url: URL_, lastExit: null }, NOW), expected);
  assert.deepEqual(statusText({ state: 'not-answering', url: URL_ }, NOW), expected);
});

test('statusText: macOS would not register it, with launchctl’s message', () => {
  const detail = 'Bootstrap failed: 5: Input/output error\n';
  assert.deepEqual(statusText({ state: 'register-failed', detail }, NOW), {
    text:
      'pir service: macOS would not register it: Bootstrap failed: 5: Input/output error\n' +
      'try: pir service off, then pir service on',
    code: 1,
  });
});

test('statusText: macOS would not register it shows only the first line launchctl printed', () => {
  const expected = {
    text:
      'pir service: macOS would not register it: Bootstrap failed: 5: Input/output error\n' +
      'try: pir service off, then pir service on',
    code: 1,
  };
  // What launchctl really prints: its second line sends the person to root, the wrong domain for an agent.
  const real = 'Bootstrap failed: 5: Input/output error\nTry re-running the command as root for richer errors.\n';
  assert.deepEqual(statusText({ state: 'register-failed', detail: real }, NOW), expected);
  const padded = '\n  Bootstrap failed: 5: Input/output error  \r\nmore\n';
  assert.deepEqual(statusText({ state: 'register-failed', detail: padded }, NOW), expected);
});

test('statusText: needs macOS', () => {
  assert.deepEqual(statusText({ state: 'needs-macos' }, NOW), {
    text: 'pir service needs macOS (launchd)',
    code: 1,
  });
});

test('statusText: an unknown state throws rather than printing nothing', () => {
  assert.throws(() => statusText({ state: 'bogus' }, NOW), /unknown state "bogus"/);
});

test('statusText: a percentage is rounded to a whole number', () => {
  const line = (pct) =>
    running(usageBody({ five_hour: { used_percentage: pct, resets_at: 1 }, seven_day: BOTH.seven_day })).text.split(
      '\n',
    )[1];
  assert.equal(line(96.53), 'last usage reading 2 min ago: 5-hour 97%, weekly 77%');
  assert.equal(line(0.4), 'last usage reading 2 min ago: 5-hour 0%, weekly 77%');
  assert.equal(line(100), 'last usage reading 2 min ago: 5-hour 100%, weekly 77%');
});

test('statusText: a null window reads unknown', () => {
  const line = (limits) => running(usageBody(limits)).text.split('\n')[1];
  assert.equal(
    line({ five_hour: null, seven_day: BOTH.seven_day }),
    'last usage reading 2 min ago: 5-hour unknown, weekly 77%',
  );
  assert.equal(
    line({ five_hour: BOTH.five_hour, seven_day: null }),
    'last usage reading 2 min ago: 5-hour 97%, weekly unknown',
  );
});

test('statusText: both windows null under a reading → both unknown', () => {
  assert.equal(
    running(usageBody({ five_hour: null, seven_day: null })).text.split('\n')[1],
    'last usage reading 2 min ago: 5-hour unknown, weekly unknown',
  );
});

test('statusText: the age comes from now minus observed_at', () => {
  const line = (observedAt) => running(usageBody(BOTH, observedAt)).text.split('\n')[1];
  assert.equal(line(NOW - 5_000), 'last usage reading just now: 5-hour 97%, weekly 77%');
  assert.equal(line(NOW - 3 * 3_600_000), 'last usage reading 3 h ago: 5-hour 97%, weekly 77%');
  assert.equal(line(NOW + 30_000), 'last usage reading just now: 5-hour 97%, weekly 77%');
});

// --- ageText -----------------------------------------------------------------------------------

test('ageText: each unit and its edges', () => {
  const MIN = 60_000;
  const H = 60 * MIN;
  const cases = [
    [0, 'just now'],
    [59_999, 'just now'],
    [60_000, '1 min ago'],
    [119_999, '1 min ago'],
    [59 * MIN, '59 min ago'],
    [60 * MIN - 1, '59 min ago'],
    [60 * MIN, '1 h ago'],
    [23 * H, '23 h ago'],
    [24 * H - 1, '23 h ago'],
    [24 * H, '1 day ago'],
    [47 * H, '1 day ago'],
    [48 * H, '2 days ago'],
    [30 * 24 * H, '30 days ago'],
  ];
  for (const [ms, text] of cases) assert.equal(ageText(ms), text, String(ms));
});

test('ageText: a negative age (clock moved back) → just now', () => {
  assert.equal(ageText(-1), 'just now');
  assert.equal(ageText(-5 * 3_600_000), 'just now');
});

// --- docs/api-service.md (api-service T11) --------------------------------------------------------
// The page quotes every text the person can be shown. It reads the real file, so a wording changed
// here or there fails until the two agree. Convention: a fence marked `text` in the page holds one
// printed text, whole, and nothing else uses that mark.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DOC = readFileSync(join(ROOT, 'docs/api-service.md'), 'utf8');
const README = readFileSync(join(ROOT, 'README.md'), 'utf8');

function fenced(text, mark) {
  return [...text.matchAll(new RegExp(`^\`\`\`${mark}\\n([\\s\\S]*?)\\n\`\`\`$`, 'gm'))].map((m) => m[1]);
}

// The usage answer the page shows is the one its `running` text is worded from.
const DOC_USAGE = fenced(DOC, 'json')
  .map((block) => JSON.parse(block))
  .find((body) => body.rate_limits);
const DOC_NOW = DOC_USAGE.observed_at + 2 * 60_000;
const DOC_URL = 'http://127.0.0.1:47717';

function printedTexts() {
  const status = (facts) => statusText(facts, DOC_NOW).text;
  const real = { kind: 'real', platform: 'darwin', installedEngine: true, off: false, loaded: false };
  return [
    status({ state: 'running', url: DOC_URL, pid: 4711, usage: DOC_USAGE }),
    status({ state: 'running', url: DOC_URL, pid: 4711, usage: null }),
    status({ state: 'off' }),
    status({ state: 'not-installed' }),
    status({ state: 'port-held', url: DOC_URL }),
    status({ state: 'not-answering', lastExit: 78 }),
    status({ state: 'not-answering', lastExit: null }),
    status({ state: 'register-failed', detail: 'Bootstrap failed: 5: Input/output error\nTry re-running the command as root for richer errors.\n' }),
    status({ state: 'needs-macos' }),
    // What `pir service off` prints is the first line of the `off` state (service-ctl.mjs).
    status({ state: 'off' }).split('\n')[0],
    servicePlan('refresh', { ...real, kind: 'scratch' }).message,
    servicePlan('refresh', { ...real, off: true }).message,
    servicePlan('on', { ...real, installedEngine: false }).message,
  ];
}

test('docs/api-service.md: every printed text it quotes is one the code prints, and none is missing', () => {
  const quoted = fenced(DOC, 'text');
  const printed = printedTexts();
  for (const block of quoted) assert.ok(printed.includes(block), `the page quotes a text the code does not print:\n${block}`);
  for (const text of printed) assert.ok(quoted.includes(text), `the page does not quote:\n${text}`);
  assert.equal(quoted.length, printed.length, 'a text is quoted twice');
});

test('docs/api-service.md: the ages and the unknown windows read as the code words them', () => {
  const minute = 60_000;
  // A quoted phrase may wrap across two lines of the page.
  const flat = DOC.replace(/\s+/g, ' ');
  for (const ms of [0, 12 * minute, 3 * 60 * minute, 24 * 60 * minute, 4 * 24 * 60 * minute]) {
    assert.ok(flat.includes(`\`${ageText(ms)}\``), `the page does not give the age ${ageText(ms)}`);
  }
  const unknown = statusText(
    { state: 'running', url: DOC_URL, pid: 1, usage: { observed_at: 1, rate_limits: { five_hour: null, seven_day: null } } },
    1,
  ).text;
  assert.ok(unknown.endsWith('5-hour unknown, weekly unknown'));
  assert.ok(DOC.includes('`5-hour unknown`') && DOC.includes('`weekly unknown`'));
});

test('docs/api-service.md: the line the installer adds is the one install.sh prints', () => {
  const line = 'could not start the API service (see: pir service)';
  assert.ok(readFileSync(join(ROOT, 'install.sh'), 'utf8').includes(`echo "  ${line}"`));
  assert.ok(DOC.replace(/\s+/g, ' ').includes(line));
});

test('README.md: the pir service text it shows is the running text', () => {
  assert.ok(README.includes(statusText({ state: 'running', url: DOC_URL, pid: 4711, usage: DOC_USAGE }, DOC_NOW).text));
});
