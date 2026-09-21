// Shell-level checks for the T18 launcher work: the shipped `pir-coordinate` wrapper and the
// install.sh wiring that puts it on PATH, removes the orphan skills, and names it in the closing
// message. Read-of-the-file checks in the T06 settings.test.mjs style — the launcher spawns real,
// paid workers, so nothing here executes a run; the live launch is a hand-check (T18 Done-when).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const LAUNCHER = join(REPO, 'bin', 'pir-coordinate');
const INSTALL = join(REPO, 'install.sh');

const launcher = readFileSync(LAUNCHER, 'utf8');
const install = readFileSync(INSTALL, 'utf8');

// --- The shipped launcher script --------------------------------------------------------

test('launcher targets the engine entrypoint and forwards its arguments', () => {
  // A thin wrapper: exec node <engine>/src/shell/coordinate.mjs "$@". The engine dir is a
  // placeholder install.sh bakes in, so the file itself names the entrypoint relative to it.
  assert.match(launcher, /coordinate\.mjs/, 'must target the coordinator entrypoint');
  assert.match(launcher, /src\/shell\/coordinate\.mjs/, 'entrypoint is src/shell/coordinate.mjs');
  assert.match(launcher, /"\$@"/, 'must forward every argument to the engine');
  assert.match(launcher, /__PIR_ENGINE__/, 'engine path is an install-time placeholder, not the cwd');
});

test('launcher hard-codes no slug and never forces PARALLEL_LIVE', () => {
  // Its whole point is to change nothing about the engine's contract: dry stays the default, and
  // the slug comes from the caller. A forced PARALLEL_LIVE here would spawn paid workers silently.
  // Assert on the CODE only — the header comment names the variable to explain the engine's rule.
  const code = launcher.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  assert.doesNotMatch(code, /PARALLEL_LIVE/, 'no runnable line may set PARALLEL_LIVE itself');
  // The exec line passes only "$@" as arguments — no literal plan slug wedged in.
  assert.match(code, /coordinate\.mjs"\s+"\$@"/, 'the only argument is "$@", no baked-in slug');
});

test('launcher is marked executable', () => {
  const mode = statSync(LAUNCHER).mode;
  assert.ok(mode & 0o111, 'bin/pir-coordinate must be executable so it runs once on PATH');
});

// --- install.sh wiring ------------------------------------------------------------------

test('install.sh removes exactly the three orphan skills, and no live skill', () => {
  const live = ['pir-plan', 'pir-review-plan', 'pir-work', 'pir-implement', 'pir-review', 'pir-install', 'pir-worker'];
  const orphans = ['pir-coordinate', 'pir-verify', 'pir-parallelize-plan'];
  const m = install.match(/ORPHAN_SKILLS=\(([^)]*)\)/);
  assert.ok(m, 'install.sh must declare ORPHAN_SKILLS');
  const named = m[1].trim().split(/\s+/).sort();
  assert.deepEqual(named, [...orphans].sort(), 'the removal list is exactly the three orphans');
  for (const s of live) assert.ok(!named.includes(s), `${s} is a live skill and must not be removed`);
  assert.match(install, /remove_orphan_skills/, 'and the removal function is actually called');
});

test('install.sh installs the launcher onto a PATH dir with the fallback printed', () => {
  assert.match(install, /install_launcher/, 'the launcher install runs');
  assert.match(install, /\.local\/bin/, 'prefers ~/.local/bin');
  assert.match(install, /\.claude\/bin/, 'falls back to ~/.claude/bin');
  assert.match(install, /__PIR_ENGINE__/, 'bakes the engine path into the placeholder');
  assert.match(install, /chmod \+x "\$bindir\/pir-coordinate"/, 'and makes it executable');
  assert.match(install, /export PATH=/, 'prints the exact export PATH step when the dir is off PATH');
});

test('install.sh names pir-coordinate in its closing messages', () => {
  const hits = install.match(/pir-coordinate \{slug\}/g) ?? [];
  assert.ok(hits.length >= 2, 'both the global and the project closing messages name pir-coordinate {slug}');
});
