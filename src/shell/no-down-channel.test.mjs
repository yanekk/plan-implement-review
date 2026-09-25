// Narrowed by live-workers T05 (DESIGN §1 Stance): pir talks to workers again, over a direct line that
// is recorded and passes through no model, so a `.send(` is allowed. What stays forbidden is the removed
// RELAY machinery of the agentic coordinator (T03): the agent bridge, the outbox / answers / surfaced
// feeds and the send-failed retry path. None of it may come back in the three files that carried it.
// The file keeps its name: it still guards the relay-style down-channel that was removed.
//
// It forbids the removed CODE (the feed identifiers), not the English words: a worker report is still
// RECORDED as a `surface` action for the live display (loop.mjs), and the person still ANSWERS a worker.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SHELL_DIR = dirname(fileURLToPath(import.meta.url));
const OWNED = ['coordinate.mjs', 'loop.mjs', 'platform.mjs'];

// Each entry is a token of the removed relay machinery. `outbox` is a bare word because it only ever
// named the relay's feed; the others are identifiers or the distinctive send-failed tag.
export const FORBIDDEN = [
  { label: 'createAgentBridge', pattern: /createAgentBridge/ },
  { label: 'the outbox feed', pattern: /\boutbox\b/ },
  { label: 'the answers feed (answersPath/drainAnswers)', pattern: /answersPath|drainAnswers/ },
  { label: 'the surfaced feed (surfacedPath/recordSurface)', pattern: /surfacedPath|recordSurface/ },
  { label: 'the send-failed retry path', pattern: /send-failed/ },
];

// violations(source) → the labels of every forbidden token in `source`.
export function violations(source) {
  return FORBIDDEN.filter(({ pattern }) => pattern.test(source)).map(({ label }) => label);
}

for (const file of OWNED) {
  test(`${file} carries none of the removed relay machinery (DESIGN §1 Stance, T03, live-workers T05)`, () => {
    const found = violations(readFileSync(join(SHELL_DIR, file), 'utf8'));
    assert.deepEqual(
      found,
      [],
      `src/shell/${file} still contains ${found.join(', ')}, removed with the agentic relay. The line to a ` +
        `worker is platform.send, direct and recorded; nothing is relayed through a model.`,
    );
  });
}

test('the scan still catches `outbox` or `createAgentBridge` if either reappears; a direct send passes', () => {
  assert.deepEqual(violations('const outbox = [];'), ['the outbox feed']);
  assert.deepEqual(violations('import { createAgentBridge } from "./bridge.mjs";'), ['createAgentBridge']);
  assert.deepEqual(violations('platform.send(id, text, { from: "pir" });'), []);
});
