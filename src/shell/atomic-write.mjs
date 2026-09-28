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

// writeFileAtomic(path, text, { fs, tempPath, mode }) → void. Creates the directory if it is missing.
// `mode` is set on the temp file before the rename, so the target never exists, even for an instant,
// with wider permissions (the ntfy config is 0600: its topic is the only secret, reliable-notifications
// DESIGN §2.6). writeFileSync's own `mode` applies only on creation and through the umask, so an
// explicit chmod follows it.
export function writeFileAtomic(path, text, { fs = nodeFs, tempPath, mode } = {}) {
  fs.mkdirSync(dirname(path), { recursive: true });
  const temp = tempPath ?? `${path}.${process.pid}-${Math.random().toString(36).slice(2)}.tmp`;
  if (mode === undefined) {
    fs.writeFileSync(temp, text);
  } else {
    fs.writeFileSync(temp, text, { mode });
    fs.chmodSync(temp, mode);
  }
  fs.renameSync(temp, path);
}

// writeJsonAtomic(path, value, { fs, tempPath, mode }) → void. The value as JSON, newline-terminated.
export function writeJsonAtomic(path, value, opts = {}) {
  writeFileAtomic(path, JSON.stringify(value, null, 2) + '\n', opts);
}
