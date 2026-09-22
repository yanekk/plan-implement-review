// Exhaustive tests for the index-entry format (T02, DESIGN §2.8, §3.5, §2.10). The whole point of
// the pure boundary is that this format's validation is checkable in milliseconds without a file or
// a process, so every branch of parseRecord is exercised here: the round-trip, each missing required
// field, every wrong-type rejection, the version gate, the finalState enum, and the never-throws
// guarantee across junk input.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseRecord, serializeRecord } from './runrecord.mjs';

// A fully-populated, valid record in the canonical shape parseRecord returns — all fields present,
// the optional ones filled. Cloned per test so a mutation cannot leak between cases.
function validRecord() {
  return {
    version: 1,
    slug: 'detached-runs',
    repo: 'plan-implement-review',
    repoPath: '/Users/someone/src/plan-implement-review',
    controlDir: '/Users/someone/src/plan-implement-review/plans/detached-runs/.parallel/control',
    pid: 4242,
    startTime: 'Tue Sep 22 08:27:37 2026',
    startedAt: '2026-09-22T08:27:37.000Z',
    branch: 'pir/detached-runs',
    finalState: null,
    updatedAt: '2026-09-22T08:30:00.000Z',
  };
}

test('round-trip: parseRecord(serializeRecord(r)) deep-equals r', () => {
  const r = validRecord();
  assert.deepEqual(parseRecord(serializeRecord(r)), r);
});

test('round-trip with a finalState set', () => {
  const r = { ...validRecord(), finalState: 'finished' };
  assert.deepEqual(parseRecord(serializeRecord(r)), r);
  const s = { ...validRecord(), finalState: 'stopped' };
  assert.deepEqual(parseRecord(serializeRecord(s)), s);
});

test('optional fields absent are filled with null on parse', () => {
  // A record that omits finalState, startedAt and updatedAt entirely still parses, with those
  // three defaulted to null — the reader always gets one predictable shape.
  const minimal = {
    version: 1,
    slug: 'detached-runs',
    repo: 'plan-implement-review',
    repoPath: '/abs/repo',
    controlDir: '/abs/repo/plans/detached-runs/.parallel/control',
    pid: 4242,
    startTime: 'Tue Sep 22 08:27:37 2026',
    branch: 'pir/detached-runs',
  };
  assert.deepEqual(parseRecord(JSON.stringify(minimal)), {
    ...minimal,
    startedAt: null,
    finalState: null,
    updatedAt: null,
  });
});

test('serialize fills absent optional fields to null, matching an explicit-null record', () => {
  const withNulls = { ...validRecord(), finalState: null, startedAt: null, updatedAt: null };
  const withoutOptionals = { ...withNulls };
  delete withoutOptionals.finalState;
  delete withoutOptionals.startedAt;
  delete withoutOptionals.updatedAt;
  assert.equal(serializeRecord(withoutOptionals), serializeRecord(withNulls));
});

test('missing any required field → null', () => {
  for (const field of ['version', 'slug', 'repo', 'repoPath', 'controlDir', 'pid', 'startTime', 'branch']) {
    const r = validRecord();
    delete r[field];
    assert.equal(parseRecord(JSON.stringify(r)), null, `omitting ${field} should parse to null`);
  }
});

test('an empty-string required field → null', () => {
  for (const field of ['slug', 'repo', 'repoPath', 'controlDir', 'startTime', 'branch']) {
    const r = { ...validRecord(), [field]: '' };
    assert.equal(parseRecord(JSON.stringify(r)), null, `empty ${field} should parse to null`);
  }
});

test('non-JSON text → null, no throw', () => {
  assert.equal(parseRecord('not json at all'), null);
  assert.equal(parseRecord('{ broken'), null);
  assert.equal(parseRecord(''), null);
});

test('JSON of the wrong top-level type → null', () => {
  assert.equal(parseRecord('[]'), null);
  assert.equal(parseRecord('[1,2,3]'), null);
  assert.equal(parseRecord('42'), null);
  assert.equal(parseRecord('"a string"'), null);
  assert.equal(parseRecord('true'), null);
  assert.equal(parseRecord('null'), null);
});

test('a wrong or absent version → null', () => {
  assert.equal(parseRecord(JSON.stringify({ ...validRecord(), version: 2 })), null);
  assert.equal(parseRecord(JSON.stringify({ ...validRecord(), version: '1' })), null);
  const noVersion = validRecord();
  delete noVersion.version;
  assert.equal(parseRecord(JSON.stringify(noVersion)), null);
});

test('finalState absent parses to null', () => {
  const r = validRecord();
  delete r.finalState;
  assert.equal(parseRecord(JSON.stringify(r)).finalState, null);
});

test('finalState explicitly null is valid', () => {
  const r = { ...validRecord(), finalState: null };
  assert.equal(parseRecord(JSON.stringify(r)).finalState, null);
});

test('a finalState outside the allowed set → null record', () => {
  for (const bad of ['running', 'crashed', 'done', '', 5, true]) {
    const r = { ...validRecord(), finalState: bad };
    assert.equal(parseRecord(JSON.stringify(r)), null, `finalState ${JSON.stringify(bad)} should invalidate the record`);
  }
});

test('pid must be a positive integer', () => {
  for (const bad of ['4242', 42.5, 0, -1, null, true]) {
    const r = { ...validRecord(), pid: bad };
    assert.equal(parseRecord(JSON.stringify(r)), null, `pid ${JSON.stringify(bad)} should parse to null`);
  }
});

test('a required string field of the wrong type → null', () => {
  for (const field of ['slug', 'repo', 'repoPath', 'controlDir', 'startTime', 'branch']) {
    const r = { ...validRecord(), [field]: 123 };
    assert.equal(parseRecord(JSON.stringify(r)), null, `numeric ${field} should parse to null`);
  }
});

test('an optional timestamp of the wrong type → null', () => {
  assert.equal(parseRecord(JSON.stringify({ ...validRecord(), startedAt: 123 })), null);
  assert.equal(parseRecord(JSON.stringify({ ...validRecord(), updatedAt: {} })), null);
});

test('extra unknown fields are ignored, not rejected', () => {
  const r = { ...validRecord(), somethingNew: 'x', another: 99 };
  const parsed = parseRecord(JSON.stringify(r));
  assert.notEqual(parsed, null);
  assert.equal(parsed.somethingNew, undefined);
  assert.equal(parsed.another, undefined);
  assert.deepEqual(parsed, validRecord());
});

test('parseRecord never throws on any string input', () => {
  const inputs = [
    '', ' ', '\n', 'null', 'undefined', '{', '}', '[', '{"version":', 'NaN', 'Infinity',
    '{"version":1}', '{"pid":NaN}', '\u0000', '🙂', '{"a":{"b":{"c":1}}}', '1e999',
  ];
  for (const input of inputs) {
    assert.doesNotThrow(() => parseRecord(input), `threw on ${JSON.stringify(input)}`);
  }
});

test('non-string input → null, no throw', () => {
  for (const input of [null, undefined, 42, {}, [], true]) {
    assert.equal(parseRecord(input), null);
  }
});
