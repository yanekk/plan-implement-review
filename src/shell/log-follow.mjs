// Tail and follow a worker's conversation log (plans/live-workers DESIGN §2.3, §2.14; T13). The view reads
// the last 256 KB of the file, so a huge conversation opens at once, then follows what the coordinator
// appends. The coordinator writes one `write` per line (§2.3), but a read can still land between two
// appends' bytes arriving, so a partial last line is held back until its newline is there: the view never
// parses half a line and then the rest as a second one.
//
// Following is fs.watch plus a poll: a watch event reads at once, and the poll catches what a watcher
// drops (macOS coalesces events; a file that does not exist yet has nothing to watch).

import { watch as fsWatch, openSync, fstatSync, readSync, closeSync } from 'node:fs';
import { readTailBytes } from './commands.mjs';

const POLL_MS = 500;
const defaultFs = { openSync, fstatSync, readSync, closeSync };

// followLog(path, { tailBytes, onEntries, pollMs, watch, fs }) → { stop(), check() }.
//   onEntries(lines) — whole lines, as strings, oldest first; first with the tail, then with each append.
//                      Never called with an empty list. Parsing is the caller's (a bad line stays `raw`).
//   check()          — read whatever has been appended since the last read, synchronously. The watcher and
//                      the poll call it; a test may call it directly to step the follower.
// A file that shrinks (it never should: the log is append-only) is re-read from its start.
export function followLog(path, { tailBytes = 262144, onEntries = () => {}, pollMs = POLL_MS, watch = fsWatch, fs = defaultFs } = {}) {
  let offset = 0;
  let held = Buffer.alloc(0); // bytes of a line whose newline has not arrived yet
  let stopped = false;

  const emit = (buf) => {
    const all = held.length ? Buffer.concat([held, buf]) : buf;
    const nl = all.lastIndexOf(0x0a);
    if (nl < 0) {
      held = all;
      return;
    }
    held = Buffer.from(all.subarray(nl + 1));
    const lines = all.subarray(0, nl).toString('utf8').split('\n').filter((l) => l !== '');
    if (lines.length) onEntries(lines);
  };

  const first = readTailBytes(path, tailBytes, { fs });
  if (first) {
    offset = first.end;
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
