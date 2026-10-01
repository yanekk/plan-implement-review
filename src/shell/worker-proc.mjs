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
import { readEntry, userMessage, allowResult, denyResult } from '../core/stream.mjs';
import { terminate } from './terminate.mjs';
import { writeJsonAtomic } from './atomic-write.mjs';
import { defaultUsageReporter } from './usage-report.mjs';

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
//
// `sessionId` starts a fresh session under that id; `resume` reopens that saved session instead and
// then no `sessionId` is passed, since the SDK rejects both together unless it is forking
// (plans/resume-dead-worker T02 defines the same interface). A
// resumed session keeps its id and transcript, but Claude Code keys a saved session by its project
// folder, so `cwd` must be the one it first ran in.
//
// `permissionMode`, `tools` and `disallowedTools` are the coordinator agent's (pir-coordinator DESIGN
// §3.4): a worker passes none and gets exactly the options above. `tools` is an allowlist: every other
// built-in tool is absent from the session, which T00 measured to hold where a deny list did not
// (`EnterWorktree`, `CronCreate` and `ListAgents` ran in `default` mode without reaching `canUseTool`).
//
// `env` is the session's whole environment (reliable-notifications DESIGN §2.7). The SDK's `Options.env`
// replaces `process.env` rather than merging over it, so a caller passes `{ ...process.env, X }`; absent,
// the SDK inherits `process.env` as before and the options carry no `env` key.
//
// `hooks` is the SDK's hook map, passed through unchanged (finisher DESIGN §3.3): the finisher's
// PreToolUse hook answers `ask` for every call so the settings' allow rules cannot answer before
// `canUseTool` does (T00). Absent, the options carry no `hooks` key.
export function workerOptions({ cwd, sessionId, resume, name, claudePath, canUseTool, spawnProcess, permissionMode, tools, disallowedTools, env, hooks }) {
  return {
    cwd,
    ...(resume ? { resume } : { sessionId }),
    permissionMode: permissionMode ?? 'auto',
    ...(tools ? { tools } : {}),
    ...(disallowedTools ? { disallowedTools } : {}),
    ...(env ? { env } : {}),
    ...(hooks ? { hooks } : {}),
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
//
// `decide(toolName, input) → 'allow' | 'deny' | null` is a gate in front of the parking (pir-coordinator
// DESIGN §3.4): a verdict answers the request at once, from `pir`, and logs it `decided-by-gate`; null
// parks it for an answer as before. A gate that throws denies: it exists to fence a session in, so its
// own failure must not open the fence. `denyMessage(toolName, input)` words a gate's refusal. Any other
// verdict (`null`, or the finisher's `'person'`) parks the request for the person. The gate's third
// argument is what the CLI said about the request, `{ defaultToNo, reason, suggestions }`, so a gate can
// park a request an `ask` rule matched (finisher T04).
//
// `reportUsage(message, t)` is handed every SDK message and the `t` of its log entry, and saves the
// subscription usage readings among them (plans/api-service DESIGN §2.4). It is a default, not
// something a caller passes: this is the one place every session pir holds goes through, so no caller
// has to know. The default is null outside a run started by `pir` and under the test runner.
export function startWorker({
  cwd,
  sessionId: freshId,
  resume,
  name,
  logPath,
  claudePath,
  query = sdkQuery,
  spawnProcess = spawnAdapter,
  now = Date.now,
  permissionMode,
  tools,
  disallowedTools,
  decide = null,
  denyMessage = (toolName) => `${toolName} is not allowed in this session.`,
  env = null,
  reportUsage = defaultUsageReporter(),
  hooks = null,
}) {
  mkdirSync(dirname(logPath), { recursive: true });
  // A resumed session runs under the id it was saved with; every message pir sends carries that id.
  // The log is appended to, so a resumed session continues its own conversation file.
  const sessionId = resume ?? freshId;

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
    // A failed append (the folder removed under a live worker, a full disk) must not throw: it would
    // escape send() to its caller and, from the exit path, leave the exit unreported, close() hung and
    // the coordinator with an uncaught exception. The entry still reaches memory and the listeners.
    // The folder is not recreated, so a run removed on purpose stays removed.
    try {
      appendFileSync(logPath, JSON.stringify(full) + '\n');
    } catch {
      // the entry is kept in memory only
    }
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
      toolUseId: opts.toolUseID, // ties a refusal to its step (group-commands DESIGN §2.2)
      toolName,
      input,
      suggestions: opts.suggestions ?? [],
      reason: opts.decisionReason,
      description: opts.description,
      defaultToNo: opts.defaultToNo === true,
      suppressAlwaysAllowRule: opts.suppressAlwaysAllowRule === true,
      // A helper's request names the helper (visible-helpers DESIGN §2.4): the SDK's agentID is its task_id.
      ...(typeof opts.agentID === 'string' ? { agentId: opts.agentID } : {}),
    });
    if (decide) {
      let verdict;
      try {
        verdict = decide(toolName, input, { defaultToNo: opts.defaultToNo === true, reason: opts.decisionReason, suggestions: opts.suggestions ?? [] });
      } catch {
        verdict = 'deny';
      }
      if (verdict === 'allow' || verdict === 'deny') {
        const request = { toolName, input };
        const result = verdict === 'allow' ? allowResult(request) : denyResult(request, denyMessage(toolName, input));
        // Logged as a reply so the activity fold never shows it pending, then noted for whoever audits.
        log({ dir: 'out', from: 'pir', kind: 'reply', requestId, result });
        note('decided-by-gate', { requestId, toolName, verdict });
        return Promise.resolve(result);
      }
    }
    return new Promise((resolve) => {
      if (exitInfo) return resolve({ behavior: 'deny', message: 'The worker has exited.' });
      const p = { entry, resolve, interrupted: false };
      pendingById.set(requestId, p);
      // The CLI aborts the SDK's signal when the request stops being answerable here. Two causes:
      // - pir's interrupt: the turn ends with no reply (T01 review probe); workerActivity drops the
      //   request at that turn's `result`, so the log needs no entry.
      // - an answer given over Remote Control (claude.ai or the phone): the CLI takes the answer from
      //   there, cancels this request and the turn carries on, the answer arriving only as the tool's
      //   result (probed 2026-09-26). No `result` follows soon, so it is logged `answered-remotely`,
      //   which workerActivity reads as the request's answer.
      opts.signal?.addEventListener(
        'abort',
        () => {
          if (pendingById.get(requestId) === p) {
            pendingById.delete(requestId);
            if (!p.interrupted) note('answered-remotely', { requestId, toolName });
          }
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
    options: workerOptions({ cwd, sessionId, resume, name, claudePath, canUseTool, spawnProcess: spawnWrapped, permissionMode, tools, disallowedTools, env, hooks }),
  });

  const startedAt = now();

  const streamDone = (async () => {
    try {
      for await (const m of q) {
        const entry = log({ dir: 'in', event: m });
        // After the log, so a reading's `observed_at` is this entry's `t` and the API's value can be
        // matched against the log exactly. The default reporter never throws; an injected one might,
        // and a throw here would land in the catch below and end the worker as an SDK error.
        if (reportUsage) {
          try {
            reportUsage(m, entry.t);
          } catch {
            // the reporter's own failure
          }
        }
      }
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

  // Remote Control: the worker's session reachable from claude.ai and the Claude app while it waits on
  // the person. The SDK's `enableRemoteControl` is undocumented (absent from sdk.d.ts, probed on
  // 0.3.282): the CLI's own `--remote-control` flag, `remoteControlAtStartup` and `/remote-control` are
  // all refused in headless mode. Only the latest wish is applied, one call at a time. A refusal (a
  // managed `disableRemoteControl`, no claude.ai login, an SDK without the method) is noted once and
  // not retried for this worker: the coordinator asks every pass and would otherwise fill the log.
  let remoteOn = false;
  let remoteWant = false;
  let remoteRefused = false;
  // The session_url of the last successful switch-on, for the phone alert's tap (reliable-notifications
  // DESIGN §2.2); null while off, and cleared by any switch-off, even a failed one, since the session is
  // going regardless.
  let remoteUrl = null;
  let remoteSync = null;
  function syncRemote() {
    remoteSync ??= (async () => {
      try {
        while (remoteOn !== remoteWant && !remoteRefused && !exitInfo) {
          const on = remoteWant;
          try {
            if (typeof q.enableRemoteControl !== 'function') throw new Error('this SDK has no enableRemoteControl');
            const r = await q.enableRemoteControl(on, on ? name : undefined);
            remoteOn = on;
            remoteUrl = on ? r?.session_url ?? null : null;
            note('remote-control', on ? { on, url: r?.session_url ?? null } : { on });
          } catch (err) {
            if (on) remoteRefused = true;
            else {
              remoteOn = false; // the session is going regardless; nothing to retry
              remoteUrl = null;
            }
            note('remote-control-failed', { on, message: String(err?.message ?? err) });
          }
        }
      } finally {
        remoteSync = null;
      }
    })();
    return remoteSync;
  }

  return {
    id: sessionId,
    get pid() {
      return child?.pid ?? null;
    },
    startedAt,

    // `preface` is pir's note naming the helpers an interrupt stopped (visible-helpers DESIGN §2.6): the model
    // reads it first, a blank line, then the person's text, in one user message. The log keeps `text` as the
    // person typed it and the note beside it, so the conversation draws both and never repeats a helper.
    send(text, { from = 'pir', preface, helpersStopped } = {}) {
      if (exitInfo || queue.closed) {
        undelivered('message', { from, text });
        return false;
      }
      const extra = {};
      if (typeof preface === 'string' && preface) extra.preface = preface;
      if (Array.isArray(helpersStopped)) extra.helpersStopped = helpersStopped;
      log({ dir: 'out', from, kind: 'message', text, ...extra });
      queue.push(userMessage(extra.preface ? `${extra.preface}\n\n${text}` : text, sessionId));
      return true;
    },

    async interrupt({ from = 'person' } = {}) {
      if (exitInfo || queue.closed) {
        undelivered('interrupt', { from });
        return false;
      }
      log({ dir: 'out', from, kind: 'interrupt' });
      // Every request open now is cancelled by this interrupt, not answered elsewhere.
      for (const p of pendingById.values()) p.interrupted = true;
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

    // remoteControl(on) → a promise settled once the wish is applied (or refused). Idempotent: asking
    // for the state already in force sends nothing. Each change is logged `remote-control` or
    // `remote-control-failed`.
    remoteControl(on) {
      if (!!on === remoteWant && !remoteSync) return Promise.resolve();
      remoteWant = !!on;
      return syncRemote();
    },

    get remote() {
      return remoteOn;
    },

    // The worker's Remote Control link (`https://claude.ai/code/session_…`) while it is on; null before the
    // first switch-on settles and once it is switched off.
    get remoteUrl() {
      return remoteUrl;
    },

    // Remote Control was refused for this worker and will not be retried (see syncRemote).
    get remoteRefused() {
      return remoteRefused;
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
      // A request open now is cancelled by the close, not answered elsewhere: switching Remote Control off
      // or ending the process aborts its signal, which would otherwise log `answered-remotely` and show
      // "answered on claude.ai" for a question nobody answered (seen stopping a planner mid-question, T14).
      for (const p of pendingById.values()) p.interrupted = true;
      // Switched off first, so the web session ends at once rather than lingering after the process
      // goes (probed 2026-09-26: switching off ends it with no further message). Capped: a close must
      // not hang on the network.
      if (remoteOn || remoteSync) {
        remoteWant = false;
        await Promise.race([syncRemote(), new Promise((r) => setTimeout(r, Math.min(graceMs, 3000)).unref?.())]);
      }
      queue.close();
      if (child && !childGone) {
        await terminate(child.pid, { graceMs, killMs, isAlive: () => !childGone });
      }
      await exited;
    },
  };
}

// writeWorkersFile(controlDir, workers) → control/workers.json, temp then rename, so the reap never
// reads a partial list (DESIGN §2.12). Only the recorded fields are written; cwd is the worktree the
// worker was spawned in, for a reader that follows the worker's folder (the dashboard state file).
export function writeWorkersFile(controlDir, workers) {
  writeJsonAtomic(
    join(controlDir, 'workers.json'),
    workers.map(({ id, task, role, pid, startTime, cwd }) => ({ id, task, role, pid, startTime, cwd: cwd ?? null })),
  );
}
