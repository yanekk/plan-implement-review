// Shell-level checks for the shipped launcher wrappers and the install.sh wiring that puts them on
// PATH, removes the orphan skills, and names them in the closing message. Two launchers ship:
// `pir-coordinate` (foreground engine, T18) and `pir` (detached front-end, T13), installed the same
// way. Read-of-the-file checks in the T06 settings.test.mjs style — the launchers spawn real, paid
// workers, so nothing here executes a run; the live launch is a hand-check (T18/T12 Done-when).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const INSTALL = join(REPO, 'install.sh');
const install = readFileSync(INSTALL, 'utf8');

// Each launcher and the engine entrypoint it must exec. Both are logic-free wrappers that exec node
// against the install-time __PIR_ENGINE__ placeholder and forward "$@" unchanged.
const LAUNCHERS = [
  { name: 'pir-coordinate', entry: 'src/shell/coordinate.mjs' },
  { name: 'pir', entry: 'src/shell/pir.mjs' },
];

// --- The shipped launcher scripts -------------------------------------------------------

for (const { name, entry } of LAUNCHERS) {
  const path = join(REPO, 'bin', name);
  const script = readFileSync(path, 'utf8');
  const entryRe = new RegExp(entry.replace(/[.\/]/g, (c) => `\\${c}`));

  test(`${name}: targets its engine entrypoint and forwards its arguments`, () => {
    // A thin wrapper: exec node <engine>/<entry> "$@". The engine dir is a placeholder install.sh
    // bakes in, so the file itself names the entrypoint relative to it.
    assert.match(script, entryRe, `must target ${entry}`);
    assert.match(script, /"\$@"/, 'must forward every argument to the engine');
    assert.match(script, /__PIR_ENGINE__/, 'engine path is an install-time placeholder, not the cwd');
  });

  test(`${name}: hard-codes no argument beyond "$@" and never forces PARALLEL_LIVE`, () => {
    // Its whole point is to change nothing about the engine's contract: dry stays the default, and
    // the argument comes from the caller. A forced PARALLEL_LIVE here would spawn paid workers
    // silently. Assert on the CODE only — the header comment may name the variable to explain it.
    const code = script.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    assert.doesNotMatch(code, /PARALLEL_LIVE/, 'no runnable line may set PARALLEL_LIVE itself');
    assert.match(code, new RegExp(`${entry.replace(/[.\/]/g, (c) => `\\${c}`)}"\\s+"\\$@"`),
      'the only argument is "$@", no baked-in slug');
  });

  test(`${name}: is marked executable`, () => {
    assert.ok(statSync(path).mode & 0o111, `bin/${name} must be executable so it runs once on PATH`);
  });
}

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

test('install.sh installs both launchers onto a PATH dir with the fallback printed', () => {
  assert.match(install, /install_launcher/, 'the launcher install runs');
  // The launcher list install.sh iterates must name both wrappers, so each lands on PATH.
  const m = install.match(/LAUNCHERS=\(([^)]*)\)/);
  assert.ok(m, 'install.sh must declare LAUNCHERS');
  const named = m[1].trim().split(/\s+/).sort();
  assert.deepEqual(named, ['pir', 'pir-coordinate'], 'both wrappers are installed');
  assert.match(install, /\.local\/bin/, 'prefers ~/.local/bin');
  assert.match(install, /\.claude\/bin/, 'falls back to ~/.claude/bin');
  assert.match(install, /__PIR_ENGINE__/, 'bakes the engine path into the placeholder');
  assert.match(install, /for name in "\$\{LAUNCHERS\[@\]\}"/, 'installs each named launcher in turn');
  assert.match(install, /chmod \+x "\$bindir\/\$name"/, 'and makes each executable');
  assert.match(install, /export PATH=/, 'prints the exact export PATH step when the dir is off PATH');
});

test('install.sh names both launchers in its closing messages', () => {
  const coord = install.match(/pir-coordinate \{slug\}/g) ?? [];
  assert.ok(coord.length >= 2, 'both the global and the project closing messages name pir-coordinate {slug}');
  const detached = install.match(/pir \{slug\}/g) ?? [];
  assert.ok(detached.length >= 2, 'both closing messages name the detached pir {slug} too');
});
