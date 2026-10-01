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

// The ceiling for a wait on a spawned program (a planning run, a single run or a build, and the fake sessions
// they hold) to start or answer. Alone they take a second or two; on a machine busy with the other test files,
// 20 or 30 s was seen to run out, so a wait that is on one of them gets a minute.
export const SPAWNED_MS = 60000;

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
    await rig.settle();
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
    await rig.settle();
    rig.cleanup();
  });
  return rig;
}

export const CTRL_S = '\x13';

// selectRow(screen, name) → moves a run view's cursor (▎) onto the row of `name` (a task id, `coordinator`, a
// helper's name), one key at a time, each waited for until the cursor has left the row it was on. A walk that
// reads the next quiet frame after each key reads, on a loaded machine, a frame from before the key, and so
// steps past the row or never sees it reached. Throws, with the screen, if the row never comes under the cursor.
export async function selectRow(screen, name) {
  const lines = (text) => text.split('\n');
  const isRow = (l) => new RegExp(`^[▎ ] . ${esc(name)} `).test(l);
  const selected = (ls) => /^▎ . (\S+)/.exec(ls.find((l) => l.startsWith('▎')) ?? '')?.[1] ?? null;
  await screen.waitFor((s) => lines(s).some(isRow) && selected(lines(s)) !== null);
  for (let step = 0; step < 12; step++) {
    const ls = lines(screen.text());
    const at = ls.findIndex(isRow);
    const cursor = ls.findIndex((l) => l.startsWith('▎'));
    if (at >= 0 && at === cursor) return;
    if (at < 0 || cursor < 0) break;
    const was = selected(ls);
    screen.send(at > cursor ? DOWN : UP);
    await screen.waitFor((s) => selected(lines(s)) !== was);
  }
  throw new Error(`could not select ${name}:\n${screen.text()}`);
}

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

// How long typeSettled waits for a key to show on screen before it settles for a quiet one: pir under a pty
// on a machine busy with the other test files can take seconds to read a key.
const KEY_SHOWN_MS = 10000;

// Type text one stretch at a time, letting the screen settle between, as a person does: the @ pop-up is
// asynchronous, and an Enter sent in the same breath as the text can reach a pop-up that is about to close.
// A bare waitFor() returns once output has been quiet for its settle time, which on a loaded machine comes
// before pir has even read the key, so the caller would read (or act on) the frame from before it. Every key
// typed through here changes the screen, so the frame is waited for until it differs; a key that changes
// nothing falls back to the quiet frame after KEY_SHOWN_MS rather than failing.
export async function typeSettled(screen, ...parts) {
  for (const p of parts) {
    const before = screen.text();
    screen.send(p);
    await screen.waitFor((s) => s !== before, KEY_SHOWN_MS).catch(() => screen.waitFor());
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
    await rig.settle();
    rig.cleanup();
  });
  return { rig, dir };
}

export const headOf = (rows) => rows.find((l) => l.startsWith('new  '));

export const showsPopup = (rows) => rows.some((l) => l.startsWith('→ '));

export const boxText = (rows) => rows[rows.findIndex((l) => l.startsWith('new  ')) + 2].trimEnd();

export const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// The box and everything under it (head, text, pop-up, hint): what an Esc on the box changes. The run rows
// above are left out, so a running run's clock or counts never read as the Esc having landed.
const boxRegion = (rows) => rows.slice(Math.max(0, rows.findIndex((l) => l.startsWith('new  ')))).join('\n');

// Esc once closes an open pop-up (text kept), and once more resets to `@`; on a text with no pop-up one Esc resets.
// One Esc at a time, each waited for until the box shows it: an Esc on the bare box quits pir, so a second Esc
// sent because a loaded machine had not yet drawn the first one's frame would end the screen mid-test.
export async function clearBox(screen) {
  let rows = await screen.waitFor();
  while (!/^new {2}start with @repo$/m.test(rows.join('\n')) || boxText(rows) !== '@') {
    const before = boxRegion(rows);
    screen.send('\x1b');
    rows = await screen.waitFor((s) => boxRegion(s.split('\n')) !== before);
  }
}
