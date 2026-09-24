import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTestBlock } from './testblock.mjs';

const block = (...lines) => lines.join('\n') + '\n\n# Some plan — Design\n';
const reason = (text) => parseTestBlock(text).reason;
const LINE = (n) => `line ${n}: expected "  - <command>"`;

test('the DESIGN §2.1 example', () => {
  const design = block('---', 'setup:', '  - cd server && npm ci', 'test:', '  - make test', '  - make server-test', '---');
  assert.deepEqual(parseTestBlock(design), {
    ok: true,
    setup: ['cd server && npm ci'],
    test: ['make test', 'make server-test'],
  });
});

test('setup: none is the empty setup; an empty setup list is rejected', () => {
  assert.deepEqual(parseTestBlock(block('---', 'setup: none', 'test:', '  - npm test', '---')), {
    ok: true,
    setup: [],
    test: ['npm test'],
  });
  assert.equal(reason(block('---', 'setup:', 'test:', '  - npm test', '---')), 'setup: expected none or a list');
});

test('setup in the single-string form is rejected', () => {
  assert.equal(reason(block('---', 'setup: npm ci', 'test:', '  - npm test', '---')), 'setup: expected none or a list');
});

test('test: none, a string, or no items gives the test reason', () => {
  const expected = 'test: expected a list of commands';
  assert.equal(reason(block('---', 'setup: none', 'test: none', '---')), expected);
  assert.equal(reason(block('---', 'setup: none', 'test: make test', '---')), expected);
  assert.equal(reason(block('---', 'setup: none', 'test:', '---')), expected);
  assert.equal(reason(block('---', 'test:', 'setup: none', '---')), expected);
});

test('a missing key names itself', () => {
  assert.equal(reason(block('---', 'test:', '  - npm test', '---')), 'no setup key');
  assert.equal(reason(block('---', 'setup: none', '---')), 'no test key');
  assert.equal(reason(block('---', '---')), 'no setup key');
});

test('no block, a block not on line 1, an unclosed block', () => {
  const r = 'no front-matter block';
  assert.equal(reason('# Plan — Design\n\nnpm test\n'), r);
  assert.equal(reason('\n---\nsetup: none\ntest:\n  - npm test\n---\n'), r);
  assert.equal(reason('# Title\n---\nsetup: none\ntest:\n  - npm test\n---\n'), r);
  assert.equal(reason('---\nsetup: none\ntest:\n  - npm test\n\n# Plan\n'), r);
  assert.equal(reason(' ---\nsetup: none\ntest:\n  - npm test\n---\n'), r);
});

test('null, undefined and empty input', () => {
  for (const input of [null, undefined, '']) assert.equal(reason(input), 'no front-matter block');
});

test('blank lines and whole-line comments are skipped anywhere in the block', () => {
  const design = block(
    '---',
    '# the commands the engine runs',
    '',
    'setup:',
    '  # install first',
    '',
    '  - npm ci',
    '#',
    'test:',
    '',
    '    # indented comment',
    '  - make test  # quiet',
    '---',
  );
  assert.deepEqual(parseTestBlock(design), { ok: true, setup: ['npm ci'], test: ['make test  # quiet'] });
});

test('a key line takes no comment', () => {
  assert.equal(reason(block('---', 'setup: none  # note', 'test:', '  - npm test', '---')), 'setup: expected none or a list');
  assert.equal(reason(block('---', 'setup: none', 'test:  # note', '  - npm test', '---')), 'test: expected a list of commands');
});

test('quotes, colons and && survive verbatim', () => {
  const line = `cd "my dir" && FOO='a:b' make test ARGS="x: y" || echo 'fail: $?'`;
  const r = parseTestBlock(block('---', 'setup: none', 'test:', `  - ${line}   `, '---'));
  assert.deepEqual(r.test, [line]);
});

test('an item can be indented further and uses any spacing after the dash', () => {
  const r = parseTestBlock(block('---', 'setup: none', 'test:', '    -   make test', '\t- npm test', '---'));
  assert.deepEqual(r.test, ['make test', 'npm test']);
});

test('unknown keys are ignored, with or without their own lists or nested maps', () => {
  const design = block(
    '---',
    'title: Some plan',
    'setup: none',
    'owners:',
    '  - someone',
    '  - someone else',
    'nested:',
    '  inner: value',
    '    deeper: yes',
    'test:',
    '  - npm test',
    'later-key: 3',
    '---',
  );
  assert.deepEqual(parseTestBlock(design), { ok: true, setup: [], test: ['npm test'] });
});

test('a stray non-item line inside a list names its 1-based file line', () => {
  assert.equal(reason(block('---', 'setup:', '  - npm ci', '  npm run build', 'test:', '  - npm test', '---')), LINE(4));
  assert.equal(reason(block('---', 'setup: none', 'test:', '  - npm test', 'make test', '---')), LINE(5));
  assert.equal(reason(block('---', 'setup: none', 'test:', '  -', '---')), LINE(4));
  assert.equal(reason(block('---', 'setup: none', 'test:', '  -make test', '---')), LINE(4));
});

test('an item with no list open is a line error', () => {
  assert.equal(reason(block('---', '  - npm ci', 'setup: none', 'test:', '  - npm test', '---')), LINE(2));
  assert.equal(reason(block('---', 'setup: none', '  - npm ci', 'test:', '  - npm test', '---')), LINE(3));
  assert.equal(reason(block('---', '- npm ci', 'setup: none', 'test:', '  - npm test', '---')), LINE(2));
});

test('CRLF line endings parse the same as LF', () => {
  const lf = block('---', 'setup:', '  - cd server && npm ci', 'test:', '  - make test  # quiet', '---');
  assert.deepEqual(parseTestBlock(lf.replace(/\n/g, '\r\n')), parseTestBlock(lf));
  const bad = block('---', 'setup: none', 'test:', '  - npm test', 'oops', '---');
  assert.equal(reason(bad.replace(/\n/g, '\r\n')), LINE(5));
});

test('the block ends at the first closing ---; later ones are prose', () => {
  const design = '---\nsetup: none\ntest:\n  - npm test\n---\n\n# Plan\n\n---\n\nmore\n';
  assert.deepEqual(parseTestBlock(design), { ok: true, setup: [], test: ['npm test'] });
});
