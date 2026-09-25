// wrapLine (moved from shell/pir-tui.mjs for T02, so the conversation model wraps worker text with it).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { wrapLine, clipText } from './text.mjs';

test('wrapLine breaks at spaces and hard-breaks a long token, keeping every segment within the width', () => {
  assert.deepEqual(wrapLine('short', 20), ['short'], 'text within the width is one line');
  const wrapped = wrapLine('the quick brown fox jumps', 10);
  for (const seg of wrapped) assert.ok([...seg].length <= 10, `each segment fits: ${JSON.stringify(seg)}`);
  assert.ok(wrapped.length > 1, 'a long sentence wraps to several lines');
  assert.equal(wrapped.join(' '), 'the quick brown fox jumps', 'word-wrap loses no words');

  // A path has no spaces, so it must HARD-break — the fix for "the run.log path doesn't fit".
  const path = '/Users/x/very/deep/project/plans/some-slug/.parallel/control/run.log';
  const segs = wrapLine(path, 24);
  for (const seg of segs) assert.ok([...seg].length <= 24, `each path segment fits: ${JSON.stringify(seg)}`);
  assert.equal(segs.join(''), path, 'the path is fully reconstructable from its wrapped segments');
});

test('clipText cuts to the width by code point with an ellipsis, and never splits a surrogate pair', () => {
  assert.equal(clipText('short', 10), 'short');
  assert.equal(clipText('abcdefghij', 5), 'abcd…');
  assert.equal(clipText('abc', 0), '');
  const clipped = clipText('😀😀😀😀', 3);
  assert.equal(clipped, '😀😀…');
  assert.equal([...clipped].length, 3);
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(clipped), 'no lone high surrogate');
});
