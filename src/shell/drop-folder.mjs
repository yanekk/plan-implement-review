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

// createWaker({ minGapMs, now, setTimer }) → { wake(), wait(dirs, timeoutMs, { watch, signal, unref }) }.
// The wake-up a loop waits on between passes (fast-tests DESIGN §2.1): a drop in any of `dirs`
// (waitForDrop), a wake() from anywhere that saw something the next pass would act on or show, a signal
// abort, or the backstop timeout. Moved here from plan-run.mjs so the planning loop and the build loop
// share one implementation.
//
// A wake() with no wait pending (it arrived during a pass) sets a flag so the next wait() returns at once:
// that closes the race between a pass reading state and the next wait being armed, whichever order the
// event and the wait come in. Several wakes before one return collapse into that one return.
//
// `minGapMs` spaces the returns (DESIGN §2.2): wait() never returns sooner than minGapMs after the
// previous wait() returned, so a flood of wakes (nine streaming workers) cannot drive passes back to back.
// A wake, or a drop, inside the gap is held to the gap's end, and every wake that lands while it is held
// is absorbed into that same return rather than flagged for the one after. An abort is never held.
// `now` and `setTimer` are injectable so the gap is tested without real time. `unref` is waitForDrop's:
// true lets the wait not hold the process open (the planning loop's), false (the default) keeps it alive.
export function createWaker({ minGapMs = 0, now = Date.now, setTimer = setTimeout } = {}) {
  let pending = null;
  let early = false;
  let lastReturn = null;

  const holdForGap = (signal, unref) => {
    if (!minGapMs || lastReturn === null || signal?.aborted) return null;
    const left = lastReturn + minGapMs - now();
    if (left <= 0) return null;
    return new Promise((resolve) => {
      const done = () => {
        signal?.removeEventListener?.('abort', done);
        resolve();
      };
      const timer = setTimer(done, left);
      if (unref) timer?.unref?.();
      signal?.addEventListener?.('abort', done, { once: true });
    });
  };

  return {
    wake() {
      if (pending) {
        const r = pending;
        pending = null;
        r();
      } else {
        early = true;
      }
    },
    async wait(dirs, timeoutMs, { watch, signal, unref = false } = {}) {
      if (early || signal?.aborted) {
        early = false;
      } else {
        const ac = new AbortController();
        const onAbort = () => ac.abort();
        signal?.addEventListener?.('abort', onAbort, { once: true });
        await Promise.race([
          waitForDrop(dirs, timeoutMs, { signal: ac.signal, unref, ...(watch ? { watch } : {}) }),
          new Promise((r) => (pending = r)),
        ]);
        pending = null;
        ac.abort();
        signal?.removeEventListener?.('abort', onAbort);
      }
      const hold = holdForGap(signal, unref);
      if (hold) await hold;
      // Anything that woke us up to here is served by the pass about to run.
      early = false;
      lastReturn = now();
    },
  };
}
