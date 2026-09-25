import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { sumUsage, tokenReport } from './tokens.mjs';

// A single assistant turn's transcript event, with the usage shape a real transcript carries.
const turn = (usage) =>
  JSON.stringify({ type: 'assistant', message: { role: 'assistant', usage } });

test('sumUsage counts only assistant turns with usage, and skips blank/malformed/non-assistant lines', () => {
  const lines = [
    turn({ input_tokens: 2, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: 50, output_tokens_details: { thinking_tokens: 10 } }),
    turn({ input_tokens: 3, cache_creation_input_tokens: 200, cache_read_input_tokens: 2000, output_tokens: 60, output_tokens_details: { thinking_tokens: 20 } }),
    JSON.stringify({ type: 'user', message: { role: 'user' } }), // a user turn — no model spend
    JSON.stringify({ type: 'assistant', message: { role: 'assistant' } }), // assistant, but no usage
    '', // blank
    '{ not json', // malformed
  ];
  assert.deepEqual(sumUsage(lines), {
    turns: 2,
    input: 5,
    cacheCreate: 300,
    cacheRead: 3000,
    output: 110,
    thinking: 30,
  });
});

test('sumUsage accepts already-parsed objects as well as raw JSONL strings', () => {
  const parsed = [
    { type: 'assistant', message: { usage: { output_tokens: 7 } } },
    { type: 'assistant', message: { usage: { output_tokens: 3 } } },
  ];
  assert.equal(sumUsage(parsed).output, 10);
  assert.equal(sumUsage(parsed).turns, 2);
});

test('tokenReport rolls coordinator+workers into the run total and keeps foreign aside', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'pir-tokens-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'transcripts'), { recursive: true });

  const write = (file, usages) =>
    writeFileSync(join(dir, 'transcripts', file), usages.map((u) => turn(u)).join('\n'));
  write('coordinator.jsonl', [{ output_tokens: 100 }, { output_tokens: 100 }]); // 2 turns, out 200
  write('T01-implement.jsonl', [{ output_tokens: 50 }]); // 1 turn, out 50
  write('foreign.jsonl', [{ output_tokens: 9999 }]); // must NOT count toward the run

  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify({
      'repo · plan': { role: 'coordinator', copiedTo: 'transcripts/coordinator.jsonl' },
      'repo · plan · T01 · implement': { role: 'worker', copiedTo: 'transcripts/T01-implement.jsonl' },
      'other / thing': { role: 'foreign', copiedTo: 'transcripts/foreign.jsonl' },
      'no-transcript': { role: 'worker' }, // no copiedTo — skipped, never throws
    }),
  );

  const rep = tokenReport(dir);
  assert.equal(rep.coordinator.output, 200);
  assert.equal(rep.coordinator.turns, 2);
  assert.equal(rep.workers.output, 50);
  assert.equal(rep.run.output, 250, 'run total is coordinator + workers, foreign excluded');
  assert.equal(rep.run.turns, 3);
  assert.equal(rep.foreign.output, 9999, 'foreign is reported, but only in its own bucket');
});

// live-workers T16: a bundle now holds conversation logs, where each SDK message is wrapped as
// `{ dir: 'in', event }` beside pir's own `out`, `request` and `note` entries (DESIGN §2.3).
test('sumUsage reads the assistant turns a conversation log wraps, and nothing pir wrote', () => {
  const usage = { input_tokens: 2, cache_creation_input_tokens: 10, cache_read_input_tokens: 100, output_tokens: 5 };
  const lines = [
    JSON.stringify({ t: 1, dir: 'out', from: 'pir', kind: 'message', text: 'pir-implement T01' }),
    JSON.stringify({ t: 2, dir: 'in', event: { type: 'assistant', message: { role: 'assistant', usage } } }),
    JSON.stringify({ t: 3, dir: 'request', requestId: 'r', toolName: 'Bash', input: {} }),
    JSON.stringify({ t: 4, dir: 'in', event: { type: 'result', subtype: 'success' } }),
  ];
  assert.deepEqual(sumUsage(lines), { turns: 1, input: 2, cacheCreate: 10, cacheRead: 100, output: 5, thinking: 0 });
});
