// The shell side of the T06 settings merges (DESIGN §3.1): all the file I/O the pure
// functions in ../core/settings.mjs do not do. install.sh drives it in two modes:
//
//   node settings-merge.mjs project  <targetSettings> <shipSource>
//   node settings-merge.mjs automode <userSettings>
//
// `project` reads the framework's own permissions.allow out of <shipSource> (this repo's
// .claude/settings.json) and merges it into <targetSettings>. `automode` merges pir's
// auto-mode exception into <userSettings> (~/.claude/settings.json).
//
// It exits 0 and prints `merged`/`unchanged` on success, and non-zero with a diagnostic on
// failure — a missing file is treated as an empty object, but a file that exists and is not
// valid JSON is an error, never clobbered, so install.sh can fall back to the manual step
// instead of destroying a config it could not parse.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  PIR_AUTOMODE_RULE,
  WORKER_PERMISSIONS,
  mergeProjectPermissions,
  mergeUserAutoMode,
} from '../core/settings.mjs';

function fail(message) {
  process.stderr.write(`settings-merge: ${message}\n`);
  process.exit(1);
}

// Parse a settings file, or return {} if it does not exist. A parse error is fatal (return
// value distinguishes "absent" from "unreadable" so the caller never overwrites bad JSON).
function readSettings(path) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    fail(`cannot read ${path}: ${err.message}`);
  }
  if (text.trim() === '') return {};
  try {
    return JSON.parse(text);
  } catch (err) {
    fail(`${path} is not valid JSON (${err.message}); leaving it untouched`);
  }
}

function writeSettings(path, value) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  } catch (err) {
    fail(`cannot write ${path}: ${err.message}`);
  }
}

// Write only when the merge changed something, so re-running is quiet and idempotent.
function applyMerge(path, before, after) {
  if (JSON.stringify(before) === JSON.stringify(after)) {
    process.stdout.write(`unchanged ${path}\n`);
    return;
  }
  writeSettings(path, after);
  process.stdout.write(`merged ${path}\n`);
}

function main(argv) {
  const [mode, targetPath, shipPath] = argv;
  if (mode === 'project') {
    if (!targetPath) fail('usage: settings-merge.mjs project <targetSettings> [shipSource]');
    // The ship list is the framework's own committed permissions.allow when a source file is
    // given; otherwise the canonical constant. Either way the target keeps its own rules.
    let ship = WORKER_PERMISSIONS;
    if (shipPath) {
      const shipSettings = readSettings(shipPath);
      const shipped = shipSettings?.permissions?.allow;
      if (Array.isArray(shipped)) ship = shipped;
    }
    const before = readSettings(targetPath);
    applyMerge(targetPath, before, mergeProjectPermissions(before, ship));
    return;
  }
  if (mode === 'automode') {
    if (!targetPath) fail('usage: settings-merge.mjs automode <userSettings>');
    const before = readSettings(targetPath);
    applyMerge(targetPath, before, mergeUserAutoMode(before));
    return;
  }
  // Print the exact rule text so install.sh's manual fallback quotes the same string it would
  // have written, with no second copy to drift.
  if (mode === 'automode-rule') {
    process.stdout.write(`${PIR_AUTOMODE_RULE}\n`);
    return;
  }
  fail(`unknown mode "${mode ?? ''}"; expected "project", "automode" or "automode-rule"`);
}

main(process.argv.slice(2));
