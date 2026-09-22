// The filesystem side of the live snapshot (DESIGN §2.4, §2.10, §3.5). The coordinator writes
// status.json into a run's control folder each pass (T10) and the dashboard reads it back (T12).
// This module owns only the atomic write and the tolerant read; the format — what a snapshot is
// and how it serializes and parses — is T03's (src/core/snapshot.mjs), which this imports.
//
// Two rules from the design shape everything here:
//
//   - Write is temp-then-rename *within the control folder* (§2.10, §3.5). rename(2) is atomic on
//     a single filesystem, so a concurrent reader gets either the previous complete status.json or
//     the new one, never a torn one. The temp file must sit in the same directory as the target,
//     or the rename would cross filesystems and lose its atomicity. There is exactly one writer
//     (the coordinator, §3.5), so a fixed temp name is safe; a crash between write and rename
//     leaves that temp behind, and the next write simply overwrites it.
//   - Read never throws (§2.10). An absent file (a run that has not written a snapshot yet), a
//     torn file caught mid-rename, or a malformed one all read as null, so the dashboard shows the
//     run without a live block rather than crashing on one bad file.

import * as nodeFs from 'node:fs';
import { join } from 'node:path';
import { serializeSnapshot, parseSnapshot } from '../core/snapshot.mjs';

const SNAPSHOT_FILE = 'status.json';
// The temp file the write renames from. Same directory as status.json (so the rename stays on one
// filesystem and stays atomic), hidden with a leading dot so a stray one after a crash does not
// clutter a `ls` of the control folder. Fixed rather than unique because §3.5 guarantees a single
// writer.
const TEMP_FILE = '.status.json.tmp';

// snapshotPath(controlDir) → the run's status.json path. The single source of truth for where the
// snapshot lives; both the writer and the reader here, and the dashboard elsewhere, go through it.
export function snapshotPath(controlDir) {
  return join(controlDir, SNAPSHOT_FILE);
}

// writeSnapshot(controlDir, snap, { fs }) → void. Serializes via T03 and lands it atomically:
// write the whole file to a temp beside the target, then rename over the target. A reader is never
// exposed to a partial file. Creates the control folder if it is missing so the first pass of a
// fresh run cannot fail on an absent directory. `fs` is injectable for the tests; it defaults to
// node:fs.
export function writeSnapshot(controlDir, snap, { fs = nodeFs } = {}) {
  fs.mkdirSync(controlDir, { recursive: true });
  const tempPath = join(controlDir, TEMP_FILE);
  fs.writeFileSync(tempPath, serializeSnapshot(snap));
  fs.renameSync(tempPath, snapshotPath(controlDir));
}

// readSnapshot(controlDir, { fs }) → snap | null. Reads status.json and parses it through T03.
// Returns null for an absent file and for any unreadable or malformed one, never throwing: the
// dashboard prefers a run shown without a live block over a crash on one bad file (§2.10). A read
// error (the file vanished mid-read, a torn rename, a permission problem) is treated the same as
// "no readable snapshot", and parseSnapshot already returns null on any malformed content.
export function readSnapshot(controlDir, { fs = nodeFs } = {}) {
  let text;
  try {
    text = fs.readFileSync(snapshotPath(controlDir), 'utf8');
  } catch {
    return null; // absent, or otherwise unreadable — no snapshot to show.
  }
  return parseSnapshot(text);
}
