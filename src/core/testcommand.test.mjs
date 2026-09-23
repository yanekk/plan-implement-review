import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testCommandFrom } from './testcommand.mjs';

// The samples are the phrasings real plans used, trimmed: the template's own heading, a free-prose
// mention, a plural heading with one line per suite, and a comment-annotated single line.

test('the template form: bold heading, then a one-line fence', () => {
  const design = '## 5. Environment\n\n**The test command.**\n\n```\nnpm test\n```\n\nIt is the only evidence.\n';
  assert.deepEqual(testCommandFrom(design), ['npm test']);
});

test('a free-prose mention with several lines keeps every line, trailing comments included', () => {
  const design = [
    'Xcode). The test command is unchanged:',
    '',
    '```',
    'sh scripts/test.sh          # quiet on green, full detail on fail',
    '```',
  ].join('\n');
  assert.deepEqual(testCommandFrom(design), ['sh scripts/test.sh          # quiet on green, full detail on fail']);
});

test('the plural heading with one command per suite', () => {
  const design = [
    '**The test commands.**',
    '',
    '```',
    'make test          # the Mac app',
    '',
    '# the backend',
    'make server-test',
    '```',
  ].join('\n');
  assert.deepEqual(testCommandFrom(design), ['make test          # the Mac app', 'make server-test']);
});

test('a mention with no fence before the next heading is skipped, and the next mention is used', () => {
  const design = [
    'Every task leaves the test command green.',
    '',
    '## 5. Environment',
    '',
    '**The test command.** One suite per spike:',
    '',
    '```',
    'bash spikes/a/run.sh',
    '```',
    '',
    '### 5.1 What the test command cannot reach',
  ].join('\n');
  assert.deepEqual(testCommandFrom(design), ['bash spikes/a/run.sh']);
});

test('a mention inside an unrelated fenced block does not count', () => {
  const design = ['```', 'the test command lives below', '```', '', '**The test command.**', '```', 'make test', '```'].join('\n');
  assert.deepEqual(testCommandFrom(design), ['make test']);
});

test('no test command anywhere → null, never a guessed default', () => {
  assert.equal(testCommandFrom('# Design\n\nNothing about testing here.\n'), null);
  assert.equal(testCommandFrom('### 5.1 What the test command cannot reach\n\n| a | b |\n'), null);
  assert.equal(testCommandFrom(''), null);
  assert.equal(testCommandFrom(undefined), null);
});
