// Tests for the pure base-branch rules (plans/base-branch T01, DESIGN §2.1–§2.3, §2.9): every §2.2
// rule has a rejecting case, every §2.3 table row a decision, every refusal its §2.9 wording.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseSettings, effectiveBase, effectiveCommands, commandsRefusalText, validBranchName, decideBase, refusalText, holdText,
} from './basebranch.mjs';

const REPO_FILE = '/r/app/.pir/settings.json';
const USER_FILE = '/home/me/.pir/app/settings.json';

// ── parseSettings ──────────────────────────────────────────────────────────────────────────────

test('parseSettings: an absent file is fine and sets nothing', () => {
  assert.deepEqual(parseSettings(null, REPO_FILE), { ok: true, settings: {} });
});

test('parseSettings: {} is fine; baseBranch kept, unknown keys ignored', () => {
  assert.deepEqual(parseSettings('{}', REPO_FILE), { ok: true, settings: {} });
  assert.deepEqual(parseSettings('{"baseBranch":"dev","x":1}', REPO_FILE), { ok: true, settings: { baseBranch: 'dev' } });
});

test('parseSettings: every broken shape is bad-settings naming the file', () => {
  const cases = {
    'not json': 'not valid JSON',
    '[]': 'not a JSON object',
    '"dev"': 'not a JSON object',
    'null': 'not a JSON object',
    '{"baseBranch":3}': 'must be a string',
    '{"baseBranch":""}': 'is empty',
    '{"baseBranch":"a..b"}': 'not a valid branch name',
    '{"baseBranch":"pir/x"}': 'not a valid branch name',
  };
  for (const [text, why] of Object.entries(cases)) {
    const r = parseSettings(text, REPO_FILE);
    assert.equal(r.ok, false, text);
    assert.equal(r.reason, 'bad-settings', text);
    assert.equal(r.file, REPO_FILE, text);
    assert.match(r.why, new RegExp(why), text);
  }
});

// ── effectiveBase ──────────────────────────────────────────────────────────────────────────────

const set = (b) => ({ ok: true, settings: b === undefined ? {} : { baseBranch: b } });
const files = { repoFile: REPO_FILE, userFile: USER_FILE };

test('effectiveBase: user overrides repo, else repo, else user, else no-base-setting', () => {
  assert.deepEqual(effectiveBase({ repo: set('dev'), user: set('stage'), ...files }), { ok: true, base: 'stage', file: USER_FILE });
  assert.deepEqual(effectiveBase({ repo: set('dev'), user: set(), ...files }), { ok: true, base: 'dev', file: REPO_FILE });
  assert.deepEqual(effectiveBase({ repo: set(), user: set('dev'), ...files }), { ok: true, base: 'dev', file: USER_FILE });
  assert.deepEqual(effectiveBase({ repo: set(), user: set(), ...files }), { ok: false, reason: 'no-base-setting' });
});

test('effectiveBase: a broken file refuses even when the other is good; repo checked first', () => {
  const badRepo = parseSettings('[', REPO_FILE);
  const badUser = parseSettings('[', USER_FILE);
  assert.deepEqual(effectiveBase({ repo: badRepo, user: set('dev'), ...files }), badRepo);
  assert.deepEqual(effectiveBase({ repo: set('dev'), user: badUser, ...files }), badUser);
  assert.equal(effectiveBase({ repo: badRepo, user: badUser, ...files }).file, REPO_FILE);
});

// ── parseSettings: setup / test (single-runs T01, DESIGN §2.2) ──────────────────────────────────

test('parseSettings: setup may be empty or a list of lines', () => {
  assert.deepEqual(parseSettings('{"setup":[]}', REPO_FILE), { ok: true, settings: { setup: [] } });
  assert.deepEqual(parseSettings('{"setup":["a","b"]}', REPO_FILE), { ok: true, settings: { setup: ['a', 'b'] } });
});

test('parseSettings: a setup of the wrong shape is bad-settings with its why', () => {
  for (const value of ['"npm ci"', '3', '[""]', '["  "]', '[1]', '["a",null]', '{}', 'null']) {
    const text = `{"baseBranch":"dev","setup":${value}}`;
    assert.deepEqual(
      parseSettings(text, REPO_FILE),
      { ok: false, reason: 'bad-settings', file: REPO_FILE, why: '"setup" must be a list of commands' },
      text,
    );
  }
});

test('parseSettings: test must be a non-empty list of lines', () => {
  assert.deepEqual(parseSettings('{"test":["npm test"]}', REPO_FILE), { ok: true, settings: { test: ['npm test'] } });
  for (const value of ['[]', '"npm test"', '[""]', '[7]', 'null']) {
    const text = `{"setup":[],"test":${value}}`;
    assert.deepEqual(
      parseSettings(text, USER_FILE),
      { ok: false, reason: 'bad-settings', file: USER_FILE, why: '"test" must be a non-empty list of commands' },
      text,
    );
  }
});

test('parseSettings: all three keys together; unknown keys still ignored; absent keys stay absent', () => {
  assert.deepEqual(
    parseSettings('{"baseBranch":"main","setup":["npm ci"],"test":["npm test"],"later":{"x":1}}', REPO_FILE),
    { ok: true, settings: { baseBranch: 'main', setup: ['npm ci'], test: ['npm test'] } },
  );
  assert.deepEqual(parseSettings('{"baseBranch":"main"}', REPO_FILE), { ok: true, settings: { baseBranch: 'main' } });
});

test('parseSettings: a bad baseBranch is reported before a bad setup', () => {
  assert.match(parseSettings('{"baseBranch":3,"setup":"x"}', REPO_FILE).why, /baseBranch must be a string/);
});

// ── effectiveCommands ──────────────────────────────────────────────────────────────────────────

const cmds = (settings = {}) => ({ ok: true, settings });

test('effectiveCommands: repo only; user only', () => {
  assert.deepEqual(
    effectiveCommands({ repo: cmds({ setup: ['npm ci'], test: ['npm test'] }), user: cmds(), ...files }),
    { ok: true, setup: ['npm ci'], test: ['npm test'] },
  );
  assert.deepEqual(
    effectiveCommands({ repo: cmds(), user: cmds({ setup: [], test: ['make check'] }), ...files }),
    { ok: true, setup: [], test: ['make check'] },
  );
});

test('effectiveCommands: the user file overrides key by key, setup and test independently', () => {
  const repo = cmds({ baseBranch: 'main', setup: ['npm ci'], test: ['npm test'] });
  assert.deepEqual(
    effectiveCommands({ repo, user: cmds({ test: ['npm run quick'] }), ...files }),
    { ok: true, setup: ['npm ci'], test: ['npm run quick'] },
  );
  // An empty setup in the user file is a value ("no setup"), so it wins over the repo's.
  assert.deepEqual(
    effectiveCommands({ repo, user: cmds({ setup: [] }), ...files }),
    { ok: true, setup: [], test: ['npm test'] },
  );
  // Each key may come from a different file.
  assert.deepEqual(
    effectiveCommands({ repo: cmds({ setup: ['npm ci'] }), user: cmds({ test: ['npm test'] }), ...files }),
    { ok: true, setup: ['npm ci'], test: ['npm test'] },
  );
});

test('effectiveCommands: a key missing after the merge → no-commands naming what is missing', () => {
  assert.deepEqual(effectiveCommands({ repo: cmds(), user: cmds(), ...files }), { ok: false, reason: 'no-commands', missing: ['setup', 'test'] });
  assert.deepEqual(
    effectiveCommands({ repo: cmds({ baseBranch: 'main' }), user: cmds({ baseBranch: 'dev' }), ...files }),
    { ok: false, reason: 'no-commands', missing: ['setup', 'test'] },
  );
  assert.deepEqual(
    effectiveCommands({ repo: cmds({ setup: [] }), user: cmds({ setup: ['npm ci'] }), ...files }),
    { ok: false, reason: 'no-commands', missing: ['test'] },
  );
  assert.deepEqual(
    effectiveCommands({ repo: cmds({ test: ['npm test'] }), user: cmds(), ...files }),
    { ok: false, reason: 'no-commands', missing: ['setup'] },
  );
});

test('effectiveCommands: a broken file refuses even when the other is good; repo checked first', () => {
  const good = cmds({ setup: [], test: ['npm test'] });
  const badRepo = parseSettings('{"test":[]}', REPO_FILE);
  const badUser = parseSettings('{oops', USER_FILE);
  assert.deepEqual(effectiveCommands({ repo: badRepo, user: good, ...files }), badRepo);
  assert.equal(effectiveCommands({ repo: badRepo, user: good, ...files }).file, REPO_FILE);
  assert.deepEqual(effectiveCommands({ repo: good, user: badUser, ...files }), badUser);
  assert.equal(effectiveCommands({ repo: badRepo, user: badUser, ...files }).file, REPO_FILE);
});

// ── commandsRefusalText ────────────────────────────────────────────────────────────────────────

const refusalCtx = { repo: 'app', repoFile: '.pir/settings.json', userFile: USER_FILE };

test('commandsRefusalText: no-commands names both files and the line to add', () => {
  assert.equal(
    commandsRefusalText({ ok: false, reason: 'no-commands', missing: ['setup', 'test'] }, refusalCtx),
    'app has no setup/test commands for a single run. Add to .pir/settings.json (or /home/me/.pir/app/settings.json): "setup": ["<install command>"], "test": ["<test command>"]',
  );
});

test('commandsRefusalText: no-commands names only the missing keys', () => {
  assert.equal(
    commandsRefusalText({ ok: false, reason: 'no-commands', missing: ['test'] }, refusalCtx),
    'app has no test commands for a single run. Add to .pir/settings.json (or /home/me/.pir/app/settings.json): "test": ["<test command>"]',
  );
  assert.equal(
    commandsRefusalText({ ok: false, reason: 'no-commands', missing: ['setup'] }, refusalCtx),
    'app has no setup commands for a single run. Add to .pir/settings.json (or /home/me/.pir/app/settings.json): "setup": ["<install command>"]',
  );
});

test('commandsRefusalText: bad-settings is the file and what is wrong', () => {
  assert.equal(
    commandsRefusalText(parseSettings('{"setup":"npm ci"}', USER_FILE), refusalCtx),
    '/home/me/.pir/app/settings.json: "setup" must be a list of commands',
  );
});

// ── validBranchName ────────────────────────────────────────────────────────────────────────────

test('validBranchName: ordinary names accepted', () => {
  for (const n of ['dev', 'main', 'release/2026-09', 'a@b', 'feature/x.y', 'pirate']) assert.equal(validBranchName(n), true, n);
});

test('validBranchName: each §2.2 rule has a rejecting case', () => {
  const rejects = [
    '', // empty
    '-dev', // leading -
    'de v', 'de\tv', 'de\nv', 'de\x01v', 'de\x7fv', // whitespace, control, DEL
    'a~b', 'a^b', 'a:b', 'a?b', 'a*b', 'a[b', 'a\\b', // forbidden characters
    'a..b', // ..
    'a@{b', // @{
    'a//b', // //
    'dev/', // ends in /
    'dev.', // ends in .
    'dev.lock', 'a.lock/b', // .lock at the end of a component
    '.dev', 'a/.b', // component starting with .
    '/dev', // leading / (an empty component)
    'pir/x', 'pir/base-branch', // pir's own namespace
    '@', 'HEAD', // shorthands for the current branch
  ];
  for (const n of rejects) assert.equal(validBranchName(n), false, JSON.stringify(n));
  assert.equal(validBranchName(undefined), false);
  assert.equal(validBranchName(3), false);
});

// ── decideBase: the §2.3 table ─────────────────────────────────────────────────────────────────

const L = 'aaaa111';
const R = 'bbbb222';
function facts(over) {
  return {
    remote: 'origin', reached: true, remoteHas: true, fetchError: null,
    local: L, tracking: R, localInTracking: false, trackingInLocal: false,
    checkout: null, aheadBehind: null,
    ...over,
  };
}

test('decideBase: local missing, remote missing → no-base-branch', () => {
  assert.deepEqual(decideBase(facts({ local: null, remoteHas: false, tracking: null })), { ok: false, reason: 'no-base-branch', remote: 'origin' });
});

test('decideBase: local present, missing on the remote → use L, keep', () => {
  assert.deepEqual(decideBase(facts({ remoteHas: false, tracking: null })), { ok: true, use: L, local: 'keep' });
});

test('decideBase: local missing, remote present → use R, create', () => {
  assert.deepEqual(decideBase(facts({ local: null })), { ok: true, use: R, local: 'create' });
});

test('decideBase: equal → use R, keep', () => {
  assert.deepEqual(decideBase(facts({ local: R })), { ok: true, use: R, local: 'keep' });
  assert.deepEqual(decideBase(facts({ localInTracking: true, trackingInLocal: true })), { ok: true, use: R, local: 'keep' });
});

test('decideBase: behind, not checked out → use R, ff', () => {
  assert.deepEqual(decideBase(facts({ localInTracking: true })), { ok: true, use: R, local: 'ff' });
});

test('decideBase: behind, checked out clean → use R, ff', () => {
  assert.deepEqual(decideBase(facts({ localInTracking: true, checkout: { path: '/r/app', clean: true } })), { ok: true, use: R, local: 'ff' });
});

test('decideBase: behind, checked out dirty → still uses R, keeps the local branch', () => {
  assert.deepEqual(decideBase(facts({ localInTracking: true, checkout: { path: '/r/app', clean: false } })), { ok: true, use: R, local: 'keep' });
});

test('decideBase: ahead → use L, keep', () => {
  assert.deepEqual(decideBase(facts({ trackingInLocal: true })), { ok: true, use: L, local: 'keep' });
});

test('decideBase: split → diverged with the counts', () => {
  assert.deepEqual(decideBase(facts({ aheadBehind: { local: 2, remote: 3 } })), { ok: false, reason: 'diverged', remote: 'origin', ahead: 2, behind: 3 });
});

test('decideBase: no remote, with and without a local branch', () => {
  const none = { remote: null, reached: false, remoteHas: false, fetchError: null, tracking: null, localInTracking: false, trackingInLocal: false, checkout: null, aheadBehind: null };
  assert.deepEqual(decideBase({ ...none, local: L }), { ok: true, use: L, local: 'keep' });
  assert.deepEqual(decideBase({ ...none, local: null }), { ok: false, reason: 'no-base-branch', remote: null });
});

test('decideBase: remote unreachable, or reached but the fetch failed → fetch-failed', () => {
  assert.deepEqual(decideBase(facts({ reached: false, remoteHas: false, tracking: null, fetchError: 'fatal: unable to access' })), { ok: false, reason: 'fetch-failed', remote: 'origin', error: 'fatal: unable to access' });
  // Unreachable refuses even with a local branch: start refuses rather than carrying on locally (§7).
  assert.equal(decideBase(facts({ reached: false, remoteHas: false })).reason, 'fetch-failed');
  assert.deepEqual(decideBase(facts({ fetchError: 'error: timed out' })), { ok: false, reason: 'fetch-failed', remote: 'origin', error: 'error: timed out' });
});

// ── refusalText / holdText ─────────────────────────────────────────────────────────────────────

test('refusalText: no-base-setting names both files and the exact line', () => {
  assert.equal(
    refusalText({ ok: false, reason: 'no-base-setting' }, { repo: 'app' }),
    'pir: no base branch is set for app. Add .pir/settings.json with {"baseBranch": "<branch>"} (committed, for everyone), or ~/.pir/app/settings.json (this machine only).',
  );
});

test('refusalText: bad-settings names the file and what is wrong', () => {
  assert.equal(refusalText(parseSettings('[]', REPO_FILE)), `pir: ${REPO_FILE} is not usable: it is not a JSON object.`);
});

test('refusalText: no-base-branch names the base, the file and the remote; no-remote variant', () => {
  assert.equal(
    refusalText({ ok: false, reason: 'no-base-branch', remote: 'origin' }, { base: 'dev', file: REPO_FILE }),
    `pir: the base branch dev (set in ${REPO_FILE}) exists neither locally nor on origin.`,
  );
  assert.equal(
    refusalText({ ok: false, reason: 'no-base-branch', remote: null }, { base: 'dev', file: REPO_FILE }),
    `pir: the base branch dev (set in ${REPO_FILE}) does not exist locally, and this repo has no remote.`,
  );
});

test("refusalText: fetch-failed quotes git's last line", () => {
  assert.equal(
    refusalText({ ok: false, reason: 'fetch-failed', remote: 'origin', error: 'remote: noise\nfatal: could not read Username.\n' }, { base: 'dev' }),
    'pir: could not fetch dev from origin: fatal: could not read Username. Nothing was created; try again when origin is reachable.',
  );
});

test('refusalText: diverged gives both counts', () => {
  assert.equal(
    refusalText({ ok: false, reason: 'diverged', remote: 'origin', ahead: 2, behind: 3 }, { base: 'dev' }),
    'pir: your dev and origin/dev have split apart (2 local, 3 remote commits not in the other). Pull or push to reconcile them, then try again.',
  );
});

test('holdText: the short §2.8 reasons', () => {
  assert.equal(holdText({ reason: 'fetch-failed', remote: 'origin' }, { base: 'dev' }), "can't reach origin, retrying");
  assert.equal(holdText({ reason: 'diverged', remote: 'origin' }, { base: 'dev' }), 'your dev and origin/dev have split apart');
  assert.equal(holdText({ reason: 'no-base-branch', remote: 'origin' }, { base: 'dev' }), 'dev exists neither locally nor on origin');
});
