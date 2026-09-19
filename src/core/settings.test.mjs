// Unit tests for the pure settings merges (T06, DESIGN §3.1, §7). These pin the three
// properties install.sh depends on: order-preserving, non-clobbering, idempotent.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTO_MODE_DEFAULTS,
  PIR_AUTOMODE_RULE,
  WORKER_PERMISSIONS,
  mergeProjectPermissions,
  mergeUserAutoMode,
} from './settings.mjs';

test('project permissions: the ship list is what a worker needs and nothing shared', () => {
  // The list is the source of truth the project .claude/settings.json and install.sh both use;
  // the two exclusions are load-bearing (task interface, §2.2).
  assert.ok(WORKER_PERMISSIONS.includes('Bash(git add:*)'));
  assert.ok(WORKER_PERMISSIONS.includes('Bash(git commit:*)'));
  assert.ok(WORKER_PERMISSIONS.includes('Bash(npm test:*)'));
  assert.ok(!WORKER_PERMISSIONS.includes('SendMessage'), 'the down-channel is gone');
  assert.ok(
    !WORKER_PERMISSIONS.includes('Bash(git merge:*)'),
    'the engine merges via child-process git; a worker never merges a peer branch',
  );
  // merge-base is a read, not a merge — it must survive the exclusion above.
  assert.ok(WORKER_PERMISSIONS.includes('Bash(git merge-base:*)'));
});

test('project permissions: an empty target gets exactly the ship list', () => {
  const merged = mergeProjectPermissions({});
  assert.deepEqual(merged.permissions.allow, WORKER_PERMISSIONS);
});

test('project permissions: an existing allow is kept and only new rules appended', () => {
  const before = { permissions: { allow: ['Bash(npm test:*)', 'Bash(custom:*)'] } };
  const merged = mergeProjectPermissions(before, ['Bash(npm test:*)', 'Bash(git add:*)']);
  // The custom rule survives, its position is unchanged, npm test is not duplicated, git add
  // is appended.
  assert.deepEqual(merged.permissions.allow, [
    'Bash(npm test:*)',
    'Bash(custom:*)',
    'Bash(git add:*)',
  ]);
});

test('project permissions: other settings keys are untouched', () => {
  const before = { worktree: { bgIsolation: 'none' }, permissions: { deny: ['Bash(rm:*)'] } };
  const merged = mergeProjectPermissions(before, ['Bash(git add:*)']);
  assert.deepEqual(merged.worktree, { bgIsolation: 'none' });
  assert.deepEqual(merged.permissions.deny, ['Bash(rm:*)']);
  assert.deepEqual(merged.permissions.allow, ['Bash(git add:*)']);
});

test('project permissions: merging twice is a no-op', () => {
  const once = mergeProjectPermissions({});
  const twice = mergeProjectPermissions(once);
  assert.deepEqual(twice, once);
});

test('automode: an empty target gets $defaults then the pir rule', () => {
  const merged = mergeUserAutoMode({});
  assert.deepEqual(merged.autoMode.allow, [AUTO_MODE_DEFAULTS, PIR_AUTOMODE_RULE]);
});

test('automode: an existing rule is preserved and $defaults restored to the front', () => {
  // A list that somehow lost $defaults gets it back at the front, the user's own rule is kept,
  // the pir rule is appended.
  const before = { autoMode: { allow: ['some user rule'] } };
  const merged = mergeUserAutoMode(before);
  assert.deepEqual(merged.autoMode.allow, [
    AUTO_MODE_DEFAULTS,
    'some user rule',
    PIR_AUTOMODE_RULE,
  ]);
});

test('automode: $defaults already present is not duplicated', () => {
  const before = { autoMode: { allow: [AUTO_MODE_DEFAULTS, 'x'] } };
  const merged = mergeUserAutoMode(before);
  assert.deepEqual(merged.autoMode.allow, [AUTO_MODE_DEFAULTS, 'x', PIR_AUTOMODE_RULE]);
});

test('automode: other settings keys are untouched', () => {
  const before = { worktree: { bgIsolation: 'none' }, autoMode: { deny: ['nope'] } };
  const merged = mergeUserAutoMode(before);
  assert.deepEqual(merged.worktree, { bgIsolation: 'none' });
  assert.deepEqual(merged.autoMode.deny, ['nope']);
});

test('automode: merging twice is a no-op', () => {
  const once = mergeUserAutoMode({});
  const twice = mergeUserAutoMode(once);
  assert.deepEqual(twice, once);
});
