// Shell-level checks for the shipped launcher wrapper and the install.sh wiring that puts it on PATH,
// removes the orphan skills and the retired launcher, and names it in the closing message. One launcher
// ships: `pir` (detached front-end, T13). The foreground `pir-coordinate` was sunset (live-workers
// T15, DESIGN §2.13). Read-of-the-file checks in the T06 settings.test.mjs style — the launcher spawns
// real, paid workers, so nothing here executes a run; the live launch is a hand-check.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const INSTALL = join(REPO, 'install.sh');
const install = readFileSync(INSTALL, 'utf8');

// Each launcher and the engine entrypoint it must exec: a logic-free wrapper that execs node against
// the install-time __PIR_ENGINE__ placeholder and forwards "$@" unchanged.
const LAUNCHERS = [
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

test('install.sh installs pir alone onto a PATH dir with the fallback printed', () => {
  assert.match(install, /install_launcher/, 'the launcher install runs');
  // The launcher list install.sh iterates names pir only; pir-coordinate is retired (§2.13).
  const m = install.match(/(?:^|\n)LAUNCHERS=\(([^)]*)\)/);
  assert.ok(m, 'install.sh must declare LAUNCHERS');
  const named = m[1].trim().split(/\s+/).sort();
  assert.deepEqual(named, ['pir'], 'pir is the only launcher installed');
  assert.ok(!existsSync(join(REPO, 'bin', 'pir-coordinate')), 'bin/pir-coordinate is deleted');
  assert.match(install, /\.local\/bin/, 'prefers ~/.local/bin');
  assert.match(install, /\.claude\/bin/, 'falls back to ~/.claude/bin');
  assert.match(install, /__PIR_ENGINE__/, 'bakes the engine path into the placeholder');
  assert.match(install, /for name in "\$\{LAUNCHERS\[@\]\}"/, 'installs each named launcher in turn');
  assert.match(install, /chmod \+x "\$bindir\/\$name"/, 'and makes each executable');
  assert.match(install, /export PATH=/, 'prints the exact export PATH step when the dir is off PATH');
});

test('install.sh removes a stale pir-coordinate launcher from both bin dirs it may have used', () => {
  const m = install.match(/STALE_LAUNCHERS=\(([^)]*)\)/);
  assert.ok(m, 'install.sh must declare STALE_LAUNCHERS');
  assert.deepEqual(m[1].trim().split(/\s+/), ['pir-coordinate']);
  assert.match(install, /for name in "\$\{STALE_LAUNCHERS\[@\]\}"/, 'each stale launcher is visited');
  // install_launcher may have picked either dir on an earlier install, so both are swept.
  assert.match(install, /for dir in "\$HOME\/\.local\/bin" "\$HOME\/\.claude\/bin"/);
  // Only our own wrapper is removed: it execs the installed engine.
  assert.match(install, /grep -q "pir-engine\/src\/shell\/" "\$dir\/\$name"/);
  assert.match(install, /rm -f "\$dir\/\$name"/);
});

test('install.sh closing messages name pir {slug} and never tell anyone to run pir-coordinate', () => {
  const detached = install.match(/pir \{slug\}/g) ?? [];
  assert.ok(detached.length >= 2, 'both closing messages name the detached pir {slug}');
  assert.doesNotMatch(install, /pir-coordinate \{slug\}/, 'no message names the retired launcher');
  // Every remaining mention sits in a comment or a removal list, never in printed text.
  const printed = install.split('\n').filter((l) => l.includes('pir-coordinate') && !/^\s*#/.test(l));
  assert.deepEqual(
    printed.map((l) => l.trim()).sort(),
    ['ORPHAN_SKILLS=(pir-coordinate pir-verify pir-parallelize-plan)', 'STALE_LAUNCHERS=(pir-coordinate)'],
  );
});

// Every non-comment line of the shipped engine; a message a person reads is a string on one of these.
function codeLines(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...codeLines(p));
    else if (e.name.endsWith('.mjs') && !e.name.endsWith('.test.mjs')) {
      readFileSync(p, 'utf8').split('\n').forEach((l, i) => {
        if (!/^\s*(\/\/|\*|\/\*)/.test(l)) out.push(`${p}:${i + 1}: ${l}`);
      });
    }
  }
  return out;
}

test('no user-facing message in src/ tells the person to run pir-coordinate', () => {
  const hits = codeLines(join(REPO, 'src')).filter((l) => l.includes('pir-coordinate'));
  assert.deepEqual(hits, []);
});

test('install.sh puts the engine runtime packages beside the installed src/', () => {
  // The three package files land in the engine dir, then npm ci runs there (live-workers T10).
  assert.match(
    install,
    /cp "\$SRC\/package\.json" "\$SRC\/package-lock\.json" "\$SRC\/\.npmrc" "\$ENGINE_DEST\/"/,
    'copies package.json, package-lock.json and .npmrc into the engine',
  );
  const ci = install.match(/\(cd "\$ENGINE_DEST" && (npm ci[^)>]*)/);
  assert.ok(ci, 'runs npm ci with the engine dir as its cwd');
  // A CLI --omit replaces .npmrc's omit list, so peer and optional must be repeated beside dev.
  for (const kind of ['dev', 'peer', 'optional']) {
    assert.match(ci[1], new RegExp(`--omit=${kind}\\b`), `npm ci omits ${kind}`);
  }
  assert.match(install, /\n    install_engine_deps\n/, 'install_engine calls the package install');
  assert.match(install, /report_engine_deps\n\s*exit 0/, 'the --global closing reports a failed install');
  assert.match(install, /MSG\nreport_engine_deps\n?$/, 'the project closing reports it too');
});
