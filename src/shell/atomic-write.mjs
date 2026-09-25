// The one temp-then-rename writer (plans/live-workers DESIGN §3.2, user 2026-09-25 re-review). The run
// index record, the status snapshot and workers.json all land through it, so a reader always sees the
// previous whole file or the new whole file, never a torn one.
//
// The temp sits beside the target: rename(2) is atomic only within one filesystem, and a temp in /tmp
// would cross it. Its name ends in `.tmp`, so a crash between write and rename leaves a file no reader
// mistakes for an entry. By default it carries the pid and a random suffix, so two writers in one
// directory never share a temp; a single-writer caller may pass a fixed `tempPath` instead.

import * as nodeFs from 'node:fs';
import { dirname } from 'node:path';

// writeFileAtomic(path, text, { fs, tempPath }) → void. Creates the directory if it is missing.
export function writeFileAtomic(path, text, { fs = nodeFs, tempPath } = {}) {
  fs.mkdirSync(dirname(path), { recursive: true });
  const temp = tempPath ?? `${path}.${process.pid}-${Math.random().toString(36).slice(2)}.tmp`;
  fs.writeFileSync(temp, text);
  fs.renameSync(temp, path);
}

// writeJsonAtomic(path, value, { fs, tempPath }) → void. The value as JSON, newline-terminated.
export function writeJsonAtomic(path, value, opts = {}) {
  writeFileAtomic(path, JSON.stringify(value, null, 2) + '\n', opts);
}
