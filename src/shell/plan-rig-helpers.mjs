// Helpers shared by the plan-rig-*.test.mjs files, split out of plan-rig.test.mjs by section (fast-tests T04)
// so node runs the sections side by side. Not a test file, and not the rig itself, which is plan-rig.mjs.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { startPlanRig } from './plan-rig.mjs';
import { indexDir, listRecords, writeRecord } from './index-store.mjs';
import { startPlanRun } from './launch.mjs';
import { stopRun } from './control-run.mjs';

export const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();

export const BRIEF = 'Add dark mode to the blog please';

export const LABEL = 'Add dark mode to the bl…';

export const SIZES = [[80, 24], [120, 40]];

export const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function until(fn, what, ms = 20000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

export const ndjson = (path) => (existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

// A planning run started as `pir plan` starts it, in the rig, with the planner parked on its question.
// The test's teardown stops every run the rig's index still shows live, then removes the rig.
export async function startRigPlan(t) {
  const rig = startPlanRig();
  const dir = indexDir({ env: rig.env });
  t.after(async () => {
    for (const record of listRecords({ dir })) {
      if (record.finalState === null) await stopRun(record).catch(() => {});
    }
    rig.cleanup();
  });
  const started = startPlanRun(BRIEF, { cwd: rig.repoDir, env: rig.env });
  assert.equal(started.started, true, JSON.stringify(started));
  const request = await until(() => ndjson(join(started.controlDir, 'conversations', 'plan-1.ndjson')).find((e) => e.dir === 'request'), 'the planner question');
  return { rig, dir, started, request };
}

export const RIGHT = '\x1b[C';

export const UP = '\x1b[A';

export const LEFT = '\x1b[D';

export const ENTER = '\r';

// Stop every run the rig's index still shows live, then remove the rig.
export function rigWithTeardown(t, opts) {
  const rig = startPlanRig(opts);
  t.after(async () => {
    for (const record of listRecords({ dir: indexDir({ env: rig.env }) })) {
      if (record.finalState === null) await stopRun(record).catch(() => {});
    }
    rig.cleanup();
  });
  return rig;
}

export const CTRL_S = '\x13';

export const TAB = '\t';

export const DOWN = '\x1b[B';

export const BS = '\x7f';

export const TYPED = '↵ start planning · shift+↵ new line · esc clear';

// Finished runs rig-run-0…n-1, written into the rig's index.
export function seedRuns(rig, n) {
  const dir = indexDir({ env: rig.env });
  for (let i = 0; i < n; i++) {
    const slug = `rig-run-${i}`;
    writeRecord(
      { version: 1, slug, repo: 'repo', repoPath: rig.repoDir, controlDir: join(rig.root, `control-${slug}`), pid: 2147483646,
        startTime: 'Sat Sep 26 12:00:00 2026', startedAt: null, branch: `pir/${slug}`, finalState: 'finished', updatedAt: null },
      { dir },
    );
  }
}

// Type text one stretch at a time, letting the screen settle between, as a person does: the @ pop-up is
// asynchronous, and an Enter sent in the same breath as the text can reach a pop-up that is about to close.
export async function typeSettled(screen, ...parts) {
  for (const p of parts) {
    screen.send(p);
    await screen.waitFor();
  }
}

export const lastLine = (rows) => rows.filter((l) => l !== '').at(-1);

export function buildRig(t, scripts = 'coordinator-drill') {
  const rig = startPlanRig({ scripts });
  const dir = indexDir({ env: rig.env });
  t.after(async () => {
    for (const record of listRecords({ dir })) {
      if (record.finalState === null) await stopRun(record).catch(() => {});
    }
    rig.cleanup();
  });
  return { rig, dir };
}

export const headOf = (rows) => rows.find((l) => l.startsWith('new  '));

export const showsPopup = (rows) => rows.some((l) => l.startsWith('→ '));

export const boxText = (rows) => rows[rows.findIndex((l) => l.startsWith('new  ')) + 2].trimEnd();

export const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// Esc once closes an open pop-up (text kept), and once more resets to `@`; on a text with no pop-up one Esc resets.
export async function clearBox(screen) {
  let rows = await screen.waitFor();
  while (!/^new {2}start with @repo$/m.test(rows.join('\n')) || boxText(rows) !== '@') {
    screen.send('\x1b');
    rows = await screen.waitFor();
  }
}
