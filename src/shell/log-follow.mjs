// Tail and follow a worker's conversation log (plans/live-workers DESIGN §2.3, §2.14; T13). The view reads
// the last 256 KB of the file, so a huge conversation opens at once, plus what its `carry` picks out of the
// lines before the cut, then follows what the coordinator appends. The coordinator writes one `write` per line (§2.3), but a read can still land between two
// appends' bytes arriving, so a partial last line is held back until its newline is there: the view never
// parses half a line and then the rest as a second one.
//
// Following is fs.watch plus a poll: a watch event reads at once, and the poll catches what a watcher
// drops (macOS coalesces events; a file that does not exist yet has nothing to watch).

import { watch as fsWatch, openSync, fstatSync, readSync, closeSync } from 'node:fs';
import { readTailBytes } from './commands.mjs';

const POLL_MS = 500;
const defaultFs = { openSync, fstatSync, readSync, closeSync };

// followLog(path, { tailBytes, onEntries, carry, pollMs, watch, fs }) → { stop(), check() }.
//   onEntries(lines) — whole lines, as strings, oldest first; first with the tail, then with each append.
//                      Never called with an empty list. Parsing is the caller's (a bad line stays `raw`).
//   carry(skipped, tail) → lines — only when the first read cut the file: the lines before the cut and the
//                      tail's, and it returns the skipped lines to put in front of the tail. A line the
//                      caller still needs from far back (a question the person has not answered) would
//                      otherwise be lost behind a busy log; the whole file is read once for it, at open.
//   check()          — read whatever has been appended since the last read, synchronously. The watcher and
//                      the poll call it; a test may call it directly to step the follower.
// A file that shrinks (it never should: the log is append-only) is re-read from its start.
export function followLog(path, { tailBytes = 262144, onEntries = () => {}, carry = null, pollMs = POLL_MS, watch = fsWatch, fs = defaultFs } = {}) {
  let offset = 0;
  let lead = null; // (tail) => the carried lines, for the first batch only
  let held = Buffer.alloc(0); // bytes of a line whose newline has not arrived yet
  let skipping = false; // the tail read began inside a line whose start it never saw: drop up to its newline
  let stopped = false;

  const emit = (input) => {
    let buf = input;
    if (skipping) {
      const cut = buf.indexOf(0x0a);
      if (cut < 0) return;
      skipping = false;
      buf = buf.subarray(cut + 1);
    }
    const all = held.length ? Buffer.concat([held, buf]) : buf;
    const nl = all.lastIndexOf(0x0a);
    if (nl < 0) {
      held = all;
      return;
    }
    held = Buffer.from(all.subarray(nl + 1));
    const lines = all.subarray(0, nl).toString('utf8').split('\n').filter((l) => l !== '');
    if (!lines.length) return;
    const carried = lead ? lead(lines) : [];
    lead = null;
    onEntries(carried.length ? [...carried, ...lines] : lines);
  };

  const first = readTailBytes(path, tailBytes, { fs });
  if (first) {
    offset = first.end;
    skipping = first.midLine;
    // The tail began right after a newline at `start`, so the bytes before it are whole lines. A tail with
    // no newline at all (one line longer than tailBytes) has no known cut, and carries nothing.
    const start = first.end - first.buf.length;
    if (carry && !first.midLine && start > 0) lead = (tail) => carry(readHead(path, start, fs), tail);
    emit(first.buf);
  }

  function check() {
    if (stopped) return;
    let fd;
    try {
      fd = fs.openSync(path, 'r');
      const size = fs.fstatSync(fd).size;
      if (size < offset) {
        offset = 0;
        held = Buffer.alloc(0);
        skipping = false;
      }
      if (size === offset) return;
      const buf = Buffer.alloc(size - offset);
      const n = fs.readSync(fd, buf, 0, buf.length, offset);
      offset += n;
      emit(buf.subarray(0, n));
    } catch {
      // Not there yet, or gone: the poll tries again.
    } finally {
      if (fd !== undefined) {
        try {
          fs.closeSync(fd);
        } catch {
          /* already closed */
        }
      }
    }
  }

  let watcher = null;
  const startWatch = () => {
    if (watcher || stopped || !watch) return;
    try {
      watcher = watch(path, { persistent: false }, () => check());
      watcher.on?.('error', () => {
        watcher?.close?.();
        watcher = null;
      });
    } catch {
      watcher = null; // no file yet: the poll reads it once it exists, and watches it then
    }
  };
  startWatch();
  const timer = setInterval(() => {
    check();
    startWatch();
  }, pollMs);
  timer.unref?.();

  return {
    check,
    stop() {
      stopped = true;
      clearInterval(timer);
      try {
        watcher?.close?.();
      } catch {
        /* already closed */
      }
      watcher = null;
    },
  };
}

// readHead(path, end, fs) → the whole lines in the file's first `end` bytes; [] when it cannot be read.
function readHead(path, end, fs) {
  let fd;
  try {
    fd = fs.openSync(path, 'r');
    const buf = Buffer.alloc(end);
    const n = fs.readSync(fd, buf, 0, end, 0);
    return buf.subarray(0, n).toString('utf8').split('\n').filter((l) => l !== '');
  } catch {
    return [];
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        /* already closed */
      }
    }
  }
}
