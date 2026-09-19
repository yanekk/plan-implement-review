// The down-channel is gone (DESIGN §2.2, T03). This scans the three files this task owns and fails if
// any of the removed relay machinery is left behind: the agent bridge, the outbox / answers / surfaced
// feeds, the send-failed retry path, or a down-channel send. It is scoped to these three files on
// purpose — the harness and fake-platform copies of this vocabulary are removed with the harness rework
// in T05 (task doc), so the scan must not reach them yet.
//
// It forbids the removed CODE (the feed identifiers and the send call), not the English words: a worker
// report is still RECORDED as a `surface` action for the live display (loop.mjs), and the person still
// ANSWERS a blocked worker — those words legitimately remain. Only the routing machinery is gone.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SHELL_DIR = dirname(fileURLToPath(import.meta.url));
const OWNED = ['coordinate.mjs', 'loop.mjs', 'platform.mjs'];

// Each entry is a token of the removed down-channel machinery. `outbox` is a bare word because it only
// ever named the down-channel feed; the others are identifiers or the distinctive send-failed tag.
const FORBIDDEN = [
  { label: 'createAgentBridge', pattern: /createAgentBridge/ },
  { label: 'the outbox feed', pattern: /\boutbox\b/ },
  { label: 'the answers feed (answersPath/drainAnswers)', pattern: /answersPath|drainAnswers/ },
  { label: 'the surfaced feed (surfacedPath/recordSurface)', pattern: /surfacedPath|recordSurface/ },
  { label: 'the send-failed retry path', pattern: /send-failed/ },
  { label: 'a down-channel send (.send(…))', pattern: /\.send\(/ },
];

for (const file of OWNED) {
  test(`${file} carries none of the removed down-channel machinery (DESIGN §2.2, T03)`, () => {
    const source = readFileSync(join(SHELL_DIR, file), 'utf8');
    for (const { label, pattern } of FORBIDDEN) {
      assert.ok(
        !pattern.test(source),
        `src/shell/${file} still contains ${label}, which was removed with the down-channel (DESIGN §2.2). ` +
          `The person answers a blocked worker directly; nothing is routed.`,
      );
    }
  });
}
