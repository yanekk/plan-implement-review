// The fake `claude` as an executable on PATH (pir-plan-command DESIGN §5 End to end, §5.2).
//
// `fakeClaudeSpawner` swaps the process only for code that takes a `spawnProcess`. A planning run, and
// a build it starts, are detached programs that resolve Claude themselves: `resolveClaudePath` is
// `command -v claude`. So an end-to-end test puts a directory holding this shim first on `PATH`, and
// every session any program of the run starts is the fake, with no code change to the programs.
//
// The shim bakes in the absolute node, the absolute claude-stream.mjs and the environment variables,
// because a detached program may not pass its parent's environment through, and the SDK scrubs some
// of it (it deletes NODE_OPTIONS). It is POSIX sh so the SDK runs it directly as a native executable.

import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const STREAM = fileURLToPath(new URL('./claude-stream.mjs', import.meta.url));

// Single-quote a string for /bin/sh: close the quote, emit an escaped quote, reopen.
const q = (s) => `'${String(s).replaceAll("'", `'\\''`)}'`;

// writeClaudeShim(dir, { scriptsFile, received }) → shimPath (dir/claude, mode 755). `scriptsFile` is a
// PIR_FAKE_CLAUDE_SCRIPTS file (claude-stream.mjs); `received` is the optional NDJSON record that every
// session started through the shim appends to.
export function writeClaudeShim(dir, { scriptsFile, received } = {}) {
  if (!scriptsFile) throw new Error('writeClaudeShim: scriptsFile is required');
  mkdirSync(dir, { recursive: true });
  const lines = ['#!/bin/sh', '# pir fake claude (src/shell/fake/claude-shim.mjs): never a model.'];
  lines.push(`PIR_FAKE_CLAUDE_SCRIPTS=${q(scriptsFile)}; export PIR_FAKE_CLAUDE_SCRIPTS`);
  // A single-script variable inherited from a test's own environment must not win over the scripts file.
  lines.push('unset PIR_FAKE_CLAUDE_SCRIPT');
  if (received) lines.push(`PIR_FAKE_CLAUDE_RECEIVED=${q(received)}; export PIR_FAKE_CLAUDE_RECEIVED`);
  lines.push(`exec ${q(process.execPath)} ${q(STREAM)} "$@"`);
  const path = join(dir, 'claude');
  writeFileSync(path, lines.join('\n') + '\n');
  chmodSync(path, 0o755);
  return path;
}
