// Shell-level checks for the T06 settings work (DESIGN §7): the project file the framework
// ships, the merge CLI install.sh drives, and install.sh's own wiring and manual fallback.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { WORKER_PERMISSIONS } from '../core/settings.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const MERGE = join(HERE, 'settings-merge.mjs');

function run(args, opts = {}) {
  return execFileSync('node', [MERGE, ...args], { encoding: 'utf8', ...opts });
}

// --- The project file the framework ships -----------------------------------------------

test('project .claude/settings.json ships the worker permissions and nothing shared', () => {
  const raw = readFileSync(join(REPO, '.claude', 'settings.json'), 'utf8');
  const settings = JSON.parse(raw); // throws if not valid JSON — that is the assertion
  const allow = settings.permissions.allow;
  for (const rule of WORKER_PERMISSIONS) {
    assert.ok(allow.includes(rule), `project settings is missing ${rule}`);
  }
  assert.ok(!allow.includes('SendMessage'), 'the coordinator down-channel is gone (§2.2)');
  assert.ok(
    !allow.includes('Bash(git merge:*)'),
    'a worker never merges a peer branch; the engine does merges via child-process git',
  );
});

// --- The merge CLI, end to end ----------------------------------------------------------

test('CLI project mode: merges the ship list without clobbering an existing allow', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pir-settings-'));
  try {
    const target = join(dir, 'settings.json');
    const ship = join(dir, 'ship.json');
    writeFileSync(target, JSON.stringify({ permissions: { allow: ['Bash(custom:*)'] } }));
    writeFileSync(ship, JSON.stringify({ permissions: { allow: ['Bash(git add:*)'] } }));

    run(['project', target, ship]);
    let allow = JSON.parse(readFileSync(target, 'utf8')).permissions.allow;
    assert.deepEqual(allow, ['Bash(custom:*)', 'Bash(git add:*)']);

    // Re-running is idempotent.
    const second = run(['project', target, ship]);
    assert.match(second, /unchanged/);
    allow = JSON.parse(readFileSync(target, 'utf8')).permissions.allow;
    assert.deepEqual(allow, ['Bash(custom:*)', 'Bash(git add:*)']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI project mode: a missing target is created from the ship list', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pir-settings-'));
  try {
    const target = join(dir, 'nested', 'settings.json');
    const ship = join(REPO, '.claude', 'settings.json');
    run(['project', target, ship]);
    const allow = JSON.parse(readFileSync(target, 'utf8')).permissions.allow;
    for (const rule of WORKER_PERMISSIONS) assert.ok(allow.includes(rule));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI automode mode: adds $defaults + the pir rule, preserves an existing rule, idempotent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pir-settings-'));
  try {
    const user = join(dir, 'settings.json');
    writeFileSync(user, JSON.stringify({ autoMode: { allow: ['my rule'] } }));

    run(['automode', user]);
    let allow = JSON.parse(readFileSync(user, 'utf8')).autoMode.allow;
    assert.equal(allow[0], '$defaults');
    assert.ok(allow.includes('my rule'));
    assert.ok(allow.some((r) => r.includes('not Modify Shared Resources')));
    const afterFirst = allow.length;

    const second = run(['automode', user]);
    assert.match(second, /unchanged/);
    allow = JSON.parse(readFileSync(user, 'utf8')).autoMode.allow;
    assert.equal(allow.length, afterFirst, 're-running must not duplicate the rule');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI: an existing but unparseable settings file is an error, never clobbered', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pir-settings-'));
  try {
    const target = join(dir, 'settings.json');
    writeFileSync(target, '{ this is not json');
    assert.throws(() => run(['project', target], { stdio: 'pipe' }));
    // The bad file is left exactly as it was, not overwritten with a merge.
    assert.equal(readFileSync(target, 'utf8'), '{ this is not json');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI automode-rule prints the exact rule install.sh quotes in its fallback', () => {
  const out = run(['automode-rule']).trim();
  assert.match(out, /pir worker running git/);
  assert.match(out, /not Modify Shared Resources/);
});

// --- install.sh wiring and fallback -----------------------------------------------------

test('install.sh drives the merge for both the project and the user-global settings', () => {
  const sh = readFileSync(join(REPO, 'install.sh'), 'utf8');
  assert.match(sh, /settings-merge\.mjs/, 'must drive the merge tool');
  assert.match(sh, /"\$MERGE" project/, 'must merge project permissions');
  assert.match(sh, /"\$MERGE" automode/, 'must merge the user autoMode rule');
  // The autoMode rule is applied in the global path too, not only when a project is given.
  assert.match(sh, /apply_automode_rule/);
});

test('install.sh prints the exact manual fallback and how to confirm it', () => {
  const sh = readFileSync(join(REPO, 'install.sh'), 'utf8');
  assert.match(sh, /print_automode_manual_step/);
  assert.match(sh, /\/permissions/, 'the manual step names the /permissions surface');
  assert.match(sh, /claude auto-mode config/, 'the guidance says how to confirm');
});
