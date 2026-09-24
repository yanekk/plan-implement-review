import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatSetupNote } from './setupnote.mjs';

const failed = {
  ok: false,
  line: 'cd server && npm ci',
  status: 1,
  reason: '`cd server && npm ci` exited 1',
  tail: '$ cd server && npm ci\nnpm ERR! missing lockfile\n',
  logPath: '/repo/plans/p/.parallel/control/setup/T07.log',
};

test('formatSetupNote names the reason, indents the tail, gives the log path and the DESIGN pointer', () => {
  assert.equal(
    formatSetupNote(failed, { slug: 'p' }),
    [
      "The plan's setup step failed in this worktree before you started: `cd server && npm ci` exited 1.",
      'Last lines of its output:',
      '  $ cd server && npm ci',
      '  npm ERR! missing lockfile',
      'Full output: /repo/plans/p/.parallel/control/setup/T07.log',
      'Get this worktree ready (the setup lines are at the top of plans/p/DESIGN.md), then carry on with your task.',
    ].join('\n'),
  );
});

test('formatSetupNote with an empty tail omits the "Last lines" part', () => {
  for (const tail of ['', '\n', undefined]) {
    const note = formatSetupNote({ ...failed, tail }, { slug: 'p' });
    assert.doesNotMatch(note, /Last lines/);
    assert.match(note, /exited 1\.\nFull output: /);
  }
});
