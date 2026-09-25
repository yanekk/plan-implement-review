// One live worker, started and held through the Agent SDK's `query()` (plans/live-workers DESIGN §2.1).
// This is the only module in src/ that imports `@anthropic-ai/claude-agent-sdk`; everything above it
// (platform, loop, inbox) talks to a Worker, never to the SDK.
//
// A Worker owns four things:
//   - its input queue: the async iterable handed to query() as `prompt`. Every message pir sends,
//     the opening instruction included, goes through it (DESIGN §2.1, §2.2).
//   - its pending requests: each `canUseTool` call is logged and parked on a promise until `answer`
//     resolves it. Deciding grants is T07's; this module only holds and resolves (DESIGN §2.6).
//   - its conversation log: every SDK message and every value pir sends, appended to the NDJSON file
//     one write per line, so a reader never sees a torn line from this single writer (DESIGN §2.3).
//   - its process: pir spawns it through `spawnClaudeCodeProcess`, so it holds the pid, reports the
//     exit, and can escalate to SIGTERM and SIGKILL itself without depending on the SDK's own
//     ~2 s stdin-EOF grace (DESIGN §2.12).
//
// Tests run the real SDK against src/shell/fake/claude-stream.mjs by passing its `fakeClaudeSpawner`
// as `spawnProcess`; nothing here knows it is a fake.

import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { readEntry, userMessage } from '../core/stream.mjs';
import { terminate } from './terminate.mjs';
import { writeJsonAtomic } from './atomic-write.mjs';

// How long an exit report waits for the SDK's message stream to drain, so the last messages the
// worker wrote are logged before its `exited` note. The SDK ends the stream on process exit; the cap
// only guards against a stream that never ends.
const DRAIN_MS = 2000;

// How much of the worker's stderr is kept for its `exited` note. The SDK does not read stderr from a
// custom spawn, so pir drains it (an unread pipe fills and blocks the child) and keeps the tail.
const STDERR_TAIL = 4096;

// workerOptions(...) → the SDK Options, exactly DESIGN §2.1. `settingSources` is left at its default so
// CLAUDE.md, skills and the auto-mode exception load as for a `--bg` worker. Passing `canUseTool` is
// what makes the SDK add `--permission-prompt-tool stdio`.
export function workerOptions({ cwd, sessionId, name, claudePath, canUseTool, spawnProcess }) {
  return {
    cwd,
    sessionId,
    permissionMode: 'auto',
    pathToClaudeCodeExecutable: claudePath,
    extraArgs: { name },
    canUseTool,
    spawnClaudeCodeProcess: spawnProcess,
  };
}

// spawnAdapter(SpawnOptions) → ChildProcess, which satisfies the SDK's SpawnedProcess. The SDK's
// forwarded `signal` is deliberately not wired to a kill: pir's own escalation in `close` owns the pid.
export function spawnAdapter({ command, args, cwd, env }) {
  return spawn(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
}

// The input queue. `close` pushes a sentinel; the iterator returns when it reaches it, after every
// message pushed before it, and never yields it to the SDK.
const CLOSE = Symbol('close');

function inputQueue() {
  const items = [];
  let wake = null;
  let closed = false;
  const poke = () => {
    const w = wake;
    wake = null;
    w?.();
  };
  return {
    get closed() {
      return closed;
    },
    push(msg) {
      if (closed) return false;
      items.push(msg);
      poke();
      return true;
    },
    close() {
      if (closed) return;
      closed = true;
      items.push(CLOSE);
      poke();
    },
    async *[Symbol.asyncIterator]() {
      for (;;) {
        if (items.length === 0) await new Promise((resolve) => (wake = resolve));
        const next = items.shift();
        if (next === CLOSE) return;
        yield next;
      }
    },
  };
}

// startWorker(...) → Worker. See the task interface (T04) for each method.
export function startWorker({
  cwd,
  sessionId,
  name,
  logPath,
  claudePath,
  query = sdkQuery,
  spawnProcess = spawnAdapter,
  now = Date.now,
}) {
  mkdirSync(dirname(logPath), { recursive: true });

  const entries = [];
  const eventFns = [];
  const exitFns = [];
  const pendingById = new Map(); // requestId → { entry, resolve }
  const queue = inputQueue();
  let child = null;
  let exitInfo = null; // set once, when the exit is reported
  let childGone = false;
  let resolveExit;
  const exited = new Promise((resolve) => (resolveExit = resolve));

  function log(entry) {
    const full = { t: now(), ...entry };
    appendFileSync(logPath, JSON.stringify(full) + '\n');
    entries.push(full);
    // A listener that throws must not stop the worker's log or its message stream.
    for (const fn of eventFns) {
      try {
        fn(full);
      } catch {
        // the listener's own failure
      }
    }
    return full;
  }

  const note = (kind, fields = {}) => log({ ...fields, dir: 'note', kind });

  function canUseTool(toolName, input, opts = {}) {
    const requestId = opts.requestId ?? opts.toolUseID;
    const entry = log({
      dir: 'request',
      requestId,
      toolName,
      input,
      suggestions: opts.suggestions ?? [],
      reason: opts.decisionReason,
      description: opts.description,
      defaultToNo: opts.defaultToNo === true,
      suppressAlwaysAllowRule: opts.suppressAlwaysAllowRule === true,
    });
    return new Promise((resolve) => {
      if (exitInfo) return resolve({ behavior: 'deny', message: 'The worker has exited.' });
      pendingById.set(requestId, { entry, resolve });
      // An interrupt aborts the SDK's signal for every open request and the turn ends with no reply
      // (T01 review probe). The request is no longer answerable, so it leaves `pending()`; the log
      // needs no entry, since workerActivity drops it at the interrupted turn's `result`.
      opts.signal?.addEventListener(
        'abort',
        () => {
          if (pendingById.get(requestId)?.entry === entry) pendingById.delete(requestId);
          resolve({ behavior: 'deny', message: 'Interrupted.' });
        },
        { once: true },
      );
    });
  }

  function reportExit(code, signal, extra = {}) {
    if (exitInfo) return;
    exitInfo = { code, signal };
    queue.close();
    for (const { resolve } of pendingById.values()) resolve({ behavior: 'deny', message: 'The worker has exited.' });
    pendingById.clear();
    note('exited', { code, signal, ...extra });
    for (const fn of exitFns.splice(0)) fn(exitInfo);
    resolveExit(exitInfo);
  }

  let stderrTail = '';
  function spawnWrapped(opts) {
    const c = spawnProcess(opts);
    child = c;
    // Writing to the stdin of a worker that just died emits EPIPE on the stream; unhandled, that
    // would crash the coordinator. The exit is reported through 'exit' instead.
    c.stdin?.on('error', () => {});
    c.stderr?.setEncoding('utf8');
    c.stderr?.on('data', (d) => (stderrTail = (stderrTail + d).slice(-STDERR_TAIL)));
    c.once('exit', (code, signal) => {
      childGone = true;
      // Let the SDK's stream drain first, so the worker's last messages precede the `exited` note.
      const cap = setTimeout(() => finish(), DRAIN_MS);
      cap.unref?.();
      const finish = () => {
        clearTimeout(cap);
        reportExit(code, signal, stderrTail ? { stderr: stderrTail } : {});
      };
      streamDone.then(finish);
    });
    c.once('error', (err) => {
      // A spawn that fails (ENOENT) never gets a pid and may never emit 'exit'.
      if (c.pid === undefined) {
        childGone = true;
        note('sdk-error', { message: `spawn failed: ${err?.message ?? err}` });
        reportExit(null, null);
      }
    });
    return c;
  }

  const q = query({
    prompt: queue,
    options: workerOptions({ cwd, sessionId, name, claudePath, canUseTool, spawnProcess: spawnWrapped }),
  });

  const startedAt = now();

  const streamDone = (async () => {
    try {
      for await (const m of q) log({ dir: 'in', event: m });
    } catch (err) {
      note('sdk-error', { message: String(err?.message ?? err) });
      // The worker is handled as exited (DESIGN §2.14): stop feeding it and make sure the process goes.
      queue.close();
      if (child && !childGone) {
        terminate(child.pid, { graceMs: 0, killMs: 5000, isAlive: () => !childGone }).catch(() => {});
      }
    }
    if (!child) reportExit(null, null);
  })();

  const undelivered = (what, fields) => note('undelivered', { what, ...fields });

  return {
    id: sessionId,
    get pid() {
      return child?.pid ?? null;
    },
    startedAt,

    send(text, { from = 'pir' } = {}) {
      if (exitInfo || queue.closed) {
        undelivered('message', { from, text });
        return false;
      }
      log({ dir: 'out', from, kind: 'message', text });
      queue.push(userMessage(text, sessionId));
      return true;
    },

    async interrupt({ from = 'person' } = {}) {
      if (exitInfo || queue.closed) {
        undelivered('interrupt', { from });
        return false;
      }
      log({ dir: 'out', from, kind: 'interrupt' });
      try {
        await q.interrupt();
        return true;
      } catch (err) {
        undelivered('interrupt', { from, message: String(err?.message ?? err) });
        return false;
      }
    },

    answer(requestId, result, { from = 'person' } = {}) {
      const p = pendingById.get(requestId);
      if (!p) {
        undelivered('reply', { from, requestId });
        return false;
      }
      pendingById.delete(requestId);
      log({ dir: 'out', from, kind: 'reply', requestId, result });
      p.resolve(result);
      return true;
    },

    pending() {
      return [...pendingById.values()].map((p) => readEntry(p.entry)[0]);
    },

    note,

    onEvent(fn) {
      eventFns.push(fn);
    },

    // Called once with { code, signal }; a listener added after the exit is called at once.
    onExit(fn) {
      if (exitInfo) fn(exitInfo);
      else exitFns.push(fn);
    },

    entries() {
      return entries.slice();
    },

    // End the input queue (the SDK then closes the worker's stdin), then escalate on the pid:
    // SIGTERM at graceMs, SIGKILL at killMs (DESIGN §2.12). Resolves once the exit is reported.
    async close({ graceMs = 5000, killMs = 10000 } = {}) {
      queue.close();
      if (child && !childGone) {
        await terminate(child.pid, { graceMs, killMs, isAlive: () => !childGone });
      }
      await exited;
    },
  };
}

// writeWorkersFile(controlDir, workers) → control/workers.json, temp then rename, so the reap never
// reads a partial list (DESIGN §2.12). Only the five recorded fields are written.
export function writeWorkersFile(controlDir, workers) {
  writeJsonAtomic(
    join(controlDir, 'workers.json'),
    workers.map(({ id, task, role, pid, startTime }) => ({ id, task, role, pid, startTime })),
  );
}
