// Exhaustive tests for the index-entry format (T02, DESIGN §2.8, §3.5, §2.10). The whole point of
// the pure boundary is that this format's validation is checkable in milliseconds without a file or
// a process, so every branch of parseRecord is exercised here: the round-trip, each missing required
// field, every wrong-type rejection, the version gate, the finalState enum, and the never-throws
// guarantee across junk input.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseRecord, serializeRecord, labelFromBrief } from './runrecord.mjs';

// A fully-populated, valid record in the canonical shape parseRecord returns — all fields present,
// the optional ones filled. Cloned per test so a mutation cannot leak between cases.
function validRecord() {
  return {
    version: 1,
    kind: 'work',
    label: null,
    go: null,
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
    kind: 'work',
    label: null,
    go: null,
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

// --- kind, label, go (plans/pir-plan-command T02, DESIGN §2.2, §2.8, §2.10, §3.5) -------------------

test('an old record with none of kind/label/go parses as kind work, label null, go null', () => {
  const old = validRecord();
  delete old.kind;
  delete old.label;
  delete old.go;
  const parsed = parseRecord(JSON.stringify(old));
  assert.equal(parsed.kind, 'work');
  assert.equal(parsed.label, null);
  assert.equal(parsed.go, null);
});

test('round trip of a plan record with a label and go declined', () => {
  const r = { ...validRecord(), kind: 'plan', label: 'a budget for screen ti…', go: 'declined' };
  assert.deepEqual(parseRecord(serializeRecord(r)), r);
});

test('serializeRecord writes kind, label and go, defaulting an absent kind to work', () => {
  const r = validRecord();
  delete r.kind;
  delete r.label;
  delete r.go;
  const data = JSON.parse(serializeRecord(r));
  assert.equal(data.kind, 'work');
  assert.ok('label' in data && data.label === null);
  assert.ok('go' in data && data.go === null);
});

test('an unknown kind is a parse error, not a silent work', () => {
  assert.equal(parseRecord(JSON.stringify({ ...validRecord(), kind: 'review' })), null);
  assert.equal(parseRecord(JSON.stringify({ ...validRecord(), kind: 7 })), null);
});

test('a label of the wrong type, or a go outside the enum, is a parse error', () => {
  assert.equal(parseRecord(JSON.stringify({ ...validRecord(), label: 12 })), null);
  assert.equal(parseRecord(JSON.stringify({ ...validRecord(), go: 'started' })), null);
  assert.equal(parseRecord(JSON.stringify({ ...validRecord(), go: true })), null);
});

test('labelFromBrief: a short brief is its own label', () => {
  assert.equal(labelFromBrief('screen time budget'), 'screen time budget');
  assert.equal(labelFromBrief('x'.repeat(24)), 'x'.repeat(24), 'exactly 24 is not cut');
});

test('labelFromBrief: a long line is cut to 24 characters ending in an ellipsis', () => {
  const label = labelFromBrief('a daily screen budget with a warning before it runs out');
  assert.equal(label, 'a daily screen budget w…');
  assert.equal([...label].length, 24);
  assert.equal(labelFromBrief('y'.repeat(25)), 'y'.repeat(23) + '…');
});

test('labelFromBrief: only the first line of a multi-line brief, trimmed', () => {
  assert.equal(labelFromBrief('  first line  \nsecond line\nthird'), 'first line');
  assert.equal(labelFromBrief('one\r\ntwo'), 'one');
});

test('labelFromBrief: leading blank lines are skipped', () => {
  assert.equal(labelFromBrief('\n   \n\t\nthe real brief\nmore'), 'the real brief');
  assert.equal(labelFromBrief('   \n\n'), '', 'a blank brief has an empty label');
});

test('labelFromBrief: an emoji at the cut is kept whole or dropped whole, never split', () => {
  // 22 letters, then two emoji straddling the cut: the 23rd grapheme is the family (a ZWJ sequence
  // of several code points), the 24th a thumbs-up, the 25th forces the cut.
  const family = '👨‍👩‍👧';
  const label = labelFromBrief('a'.repeat(22) + family + '👍' + 'b');
  assert.equal(label, 'a'.repeat(22) + family + '…');
  // A lone astral emoji at position 24 of a 25-long line is dropped whole — no lone surrogate.
  const cut = labelFromBrief('c'.repeat(23) + '🙂' + 'd');
  assert.equal(cut, 'c'.repeat(23) + '…');
  assert.ok(!/[\uD800-\uDFFF]/.test(cut.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '')), 'no lone surrogate');
});

// pir-coordinator T04 (DESIGN §2.1): only a --no-coordinator run carries the field; absent reads as on.
test('coordinator: false round-trips; absent or true writes and reads no field; a non-boolean is refused', () => {
  const off = parseRecord(serializeRecord({ ...validRecord(), coordinator: false }));
  assert.equal(off.coordinator, false);
  assert.equal('coordinator' in parseRecord(serializeRecord(validRecord())), false);
  assert.equal('coordinator' in parseRecord(serializeRecord({ ...validRecord(), coordinator: true })), false);
  assert.equal(parseRecord(JSON.stringify({ ...validRecord(), coordinator: 'no' })), null);
  assert.equal(parseRecord(JSON.stringify({ ...validRecord(), coordinator: true })).coordinator, undefined);
});

// plans/base-branch T01 (DESIGN §2.5): the run's base branch is an optional display copy.
test('baseBranch round-trips; a record without it parses unchanged; a non-string or empty one is refused', () => {
  const withBase = { ...validRecord(), baseBranch: 'dev' };
  assert.deepEqual(parseRecord(serializeRecord(withBase)), withBase);
  const without = parseRecord(serializeRecord(validRecord()));
  assert.deepEqual(without, validRecord());
  assert.equal('baseBranch' in without, false);
  assert.equal(parseRecord(JSON.stringify({ ...validRecord(), baseBranch: 7 })), null);
  assert.equal(parseRecord(JSON.stringify({ ...validRecord(), baseBranch: '' })), null);
});
