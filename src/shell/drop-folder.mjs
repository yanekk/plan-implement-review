// A drop folder: one JSON file per message, written temp-then-rename by another process, read and
// removed here. Two folders use it (plans/live-workers DESIGN §2.5, §3.2): `reports/`, where workers
// drop their reports, and `inbox/`, where the `pir` screen drops the person's input. The reader and the
// watcher were coordinate.mjs's createReportInbox drain and waitForReport, generalised to take the
// folder and a parser rather than copied (user 2026-09-25, plan review); coordinate.mjs still exports
// both names.

import { readdirSync, readFileSync, unlinkSync, watch } from 'node:fs';
import { join } from 'node:path';

// drainDropFolder(dir, { parse, onBad }) → the parsed value of every *.json in `dir`, in name order.
// Writers name their files with a leading timestamp, so name order is roughly send order. Each file is
// read exactly once and removed before it is parsed, so a file that will not parse is dropped, never
// re-read and never guessed into a message. `parse(raw)` throws to reject a file; `onBad(name, err)` hears
// about it. Only names ending in `.json` are touched: a writer's temp ends in `.tmp`, so a file not yet
// renamed into place is never read.
export function drainDropFolder(dir, { parse = JSON.parse, onBad = () => {} } = {}) {
  let names;
  try {
    names = readdirSync(dir).filter((n) => n.endsWith('.json')).sort();
  } catch {
    return [];
  }
  const out = [];
  for (const n of names) {
    const p = join(dir, n);
    let raw;
    try {
      raw = readFileSync(p, 'utf8');
    } catch {
      continue; // vanished under us (a concurrent drain); skip
    }
    try {
      unlinkSync(p); // consume it, so a drop is ingested exactly once
    } catch {
      /* already gone */
    }
    try {
      out.push(parse(raw));
    } catch (err) {
      try {
        onBad(n, err);
      } catch {
        /* a failing reporter must not stop the drain */
      }
    }
  }
  return out;
}

// waitForDrop(dirs, timeoutMs, { watch, signal, unref }) → resolve as soon as anything changes in any of
// `dirs` (one folder or several), or after timeoutMs, or when `signal` aborts, whichever comes first. This
// is the "react, don't poll" half: a file landing wakes the caller at once, and the timeout is only a
// backstop so a missed filesystem event is still picked up within a poll interval. fs.watch may be
// unavailable on some filesystems; then this degrades to a plain timeout, so correctness never depends on
// the watch firing.
//
// fs.watch signals a RUNTIME failure (EMFILE under fd pressure, ENOSPC, a watch that dies later) by
// emitting an 'error' event on the FSWatcher, NOT by throwing from watch(); the sync try/catch below only
// covers a watch that cannot start at all. Without an 'error' listener Node re-throws that event as an
// unhandled 'error' and the whole coordinator process exits, defeating the timeout backstop (a live run
// can always meet fd pressure). So on an 'error' the dead watcher is closed and nothing else happens: no
// finish() (resolving at once would busy-spin a caller into re-watching), so the pending timeout fires and
// that wait degrades to paced polling. Each later wait re-attempts a fresh watch(). `watch` is injectable
// so a test can emit 'error' without a real EMFILE. `unref` lets a background waiter (the person inbox)
// not hold the process open once the run's own loop has returned.
export function waitForDrop(dirs, timeoutMs, { watch: watchFn = watch, signal, unref = false } = {}) {
  const list = Array.isArray(dirs) ? dirs : [dirs];
  return new Promise((resolve) => {
    let done = false;
    const watchers = [];
    let timer = null;
    const finish = () => {
      if (done) return;
      done = true;
      for (const w of watchers) {
        try {
          w.close();
        } catch {
          /* already closed */
        }
      }
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', finish);
      resolve();
    };
    if (signal?.aborted) return finish();
    signal?.addEventListener?.('abort', finish, { once: true });
    for (const dir of list) {
      try {
        const watcher = watchFn(dir, () => finish());
        watchers.push(watcher);
        if (unref) watcher.unref?.();
        watcher.on('error', () => {
          try {
            watcher.close();
          } catch {
            /* already gone */
          }
          const i = watchers.indexOf(watcher);
          if (i >= 0) watchers.splice(i, 1);
        });
      } catch {
        /* no fs.watch on this folder: the timeout is the backstop */
      }
    }
    timer = setTimeout(finish, timeoutMs);
    if (unref) timer.unref?.();
  });
}
