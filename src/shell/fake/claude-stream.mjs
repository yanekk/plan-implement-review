#!/usr/bin/env node
// A scripted stand-in for the `claude` executable, speaking the stream-json protocol the Agent SDK
// speaks to the real one (DESIGN §2.1, §4). worker-proc's tests, and T05–T08 after them, run the real
// SDK `query()` against this script, so no test ever spawns the real `claude` or pays for a model.
// Every wire shape here is copied from T01's recording of the SDK talking to Claude Code 2.1.282,
// src/shell/fake/fixtures/wire-sample.ndjson.
//
// How it is launched. Point the SDK at it through `spawnClaudeCodeProcess` with `fakeClaudeSpawner`
// (exported below), which runs `node claude-stream.mjs <the argv the SDK built>` whatever command the
// SDK asked for, and sets two environment variables:
//   PIR_FAKE_CLAUDE_SCRIPT    path of a JSON file: the script, below. Required.
//   PIR_FAKE_CLAUDE_RECEIVED  optional path of an NDJSON file the fake appends to: first
//                             {"argv":[…]}, then every stdin line as {"line":"…"}, then
//                             {"signal":"SIGTERM"} for each SIGTERM it catches. Tests read it to check
//                             what the SDK actually sent (a reply's PermissionResult, an interrupt).
//
// What it does without being told. It answers the SDK's `initialize` control request with a trimmed
// copy of the recorded response, answers every other control request (`interrupt`, anything a newer
// SDK adds) with `success`, and, when stdin reaches EOF, exits 0 — unless the script said otherwise.
//
// The script is a JSON array of steps, run in order:
//   {"emit": <object>}        write the object as one stdout line. Every string in it has
//                             `{{session}}` replaced with the session id from `--session-id=`.
//   {"emit": "<text>"}        write the text verbatim as one line (use it for garbage the SDK must
//                             choke on); `{{session}}` is replaced here too.
//   {"await": "user"}         wait for the next user message on stdin (a message that arrived early is
//                             taken from the queue, so the script never races the SDK).
//   {"await": "control_response"}  wait for the next control_response (the reply to a can_use_tool the
//                             script emitted).
//   {"await": "interrupt"}    wait for an interrupt control request (already acked with `success`).
//   {"sleep": <ms>}
//   {"exit": <code>}          exit now with that code.
//   {"onEof": "exit" | "ignore" | <code>}  what stdin EOF does from here on: exit 0 (the default), stay
//                             running, or exit with that code. "ignore" is the fake that will not go
//                             away when its input closes.
//   {"onSigterm": "exit" | "ignore"}  default "exit" (node's own SIGTERM death); "ignore" logs the signal
//                             and keeps running, so only SIGKILL ends it.
// After the last step the fake keeps reading stdin, acking control requests, until EOF.
//
// An interrupt does not cancel an open `can_use_tool` by itself: the real CLI sends
// `{"type":"control_cancel_request","request_id":…}`, which aborts the SDK's canUseTool signal. A
// script that interrupts a turn with an ask open emits that line itself after `{"await":"interrupt"}`.
//
// Helpers for scripts: `turn(text)` is the `init`, assistant text and `result` of one plain turn;
// `canUseTool(requestId, toolName, input)` is the control request of one permission ask. Both are
// exported so a test builds its script from the same shapes the recording holds.

import { appendFileSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);

// ---- For tests: building scripts and launching the fake. ----

export function initEvent() {
  return {
    type: 'system', subtype: 'init', cwd: '/fake', session_id: '{{session}}',
    tools: ['AskUserQuestion', 'Bash', 'Read'], mcp_servers: [], model: 'claude-fake',
    permissionMode: 'auto', slash_commands: ['context', 'model'], terminal_slash_commands: ['doctor'],
    apiKeySource: 'none', claude_code_version: '2.1.282', output_style: 'default', agents: [], skills: [],
    plugins: [], uuid: '00000000-0000-4000-8000-000000000001',
  };
}

export function assistantText(text) {
  return {
    type: 'assistant', parent_tool_use_id: null, session_id: '{{session}}',
    message: { model: 'claude-fake', id: 'msg_fake', type: 'message', role: 'assistant', content: [{ type: 'text', text }], stop_reason: null, usage: {} },
    uuid: '00000000-0000-4000-8000-000000000002',
  };
}

export function resultEvent(subtype = 'success', text = '') {
  const base = {
    type: 'result', subtype, duration_ms: 1, duration_api_ms: 1, num_turns: 1, stop_reason: subtype === 'success' ? 'end_turn' : null,
    session_id: '{{session}}', total_cost_usd: 0, usage: {}, modelUsage: {}, permission_denials: [],
    uuid: '00000000-0000-4000-8000-000000000003',
  };
  if (subtype === 'success') return { ...base, is_error: false, result: text };
  return { ...base, is_error: true, errors: [] };
}

// The three steps of one plain turn: what a real worker emits for "reply with one word".
export function turn(text) {
  return [{ emit: initEvent() }, { emit: assistantText(text) }, { emit: resultEvent('success', text) }];
}

// One permission ask, the shape of the recording's `can_use_tool` (T01 wire sample).
export function canUseTool(requestId, toolName, input, extra = {}) {
  return {
    type: 'control_request', request_id: requestId,
    request: {
      subtype: 'can_use_tool', tool_name: toolName, display_name: toolName, input,
      tool_use_id: `toolu_${requestId}`, ...extra,
    },
  };
}

// fakeClaudeSpawner({ script, received }) → a `spawnProcess` for startWorker / workerOptions. It runs
// this file under the current node with the SDK's own argv, cwd and env, plus the two variables above,
// and ignores the command the SDK asked for: that is how no test can ever launch the real `claude`.
// `calls` records each SpawnOptions the SDK passed, so a test can check the argv it built.
export function fakeClaudeSpawner({ script, received }) {
  const calls = [];
  const spawnProcess = ({ command, args, cwd, env }) => {
    calls.push({ command, args, cwd });
    const extra = { PIR_FAKE_CLAUDE_SCRIPT: script };
    if (received) extra.PIR_FAKE_CLAUDE_RECEIVED = received;
    return spawn(process.execPath, [SELF, ...args], { cwd, env: { ...env, ...extra }, stdio: ['pipe', 'pipe', 'pipe'] });
  };
  spawnProcess.calls = calls;
  return spawnProcess;
}

// ---- The fake itself. ----

// The recorded initialize response, trimmed to what the SDK reads.
const INITIALIZE_RESPONSE = {
  commands: [{ name: 'context', description: 'Show context usage', argumentHint: '' }],
  agents: [], output_style: 'default', available_output_styles: ['default'], models: [],
  account: { apiProvider: 'firstParty' }, pid: process.pid, current_permission_mode: 'auto',
  session_state: 'idle',
};

async function main() {
  const scriptPath = process.env.PIR_FAKE_CLAUDE_SCRIPT;
  const receivedPath = process.env.PIR_FAKE_CLAUDE_RECEIVED;
  const record = (obj) => {
    if (receivedPath) appendFileSync(receivedPath, JSON.stringify(obj) + '\n');
  };
  record({ argv: process.argv.slice(2) });

  const session = (process.argv.find((a) => a.startsWith('--session-id=')) ?? '').slice('--session-id='.length);
  const fill = (v) => {
    if (typeof v === 'string') return v.replaceAll('{{session}}', session);
    if (Array.isArray(v)) return v.map(fill);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x)]));
    return v;
  };
  const out = (v) => process.stdout.write((typeof v === 'string' ? fill(v) : JSON.stringify(fill(v))) + '\n');

  const steps = scriptPath ? JSON.parse(readFileSync(scriptPath, 'utf8')) : [];
  let onEof = 'exit';

  // Inbound lines are sorted into queues by kind; an `await` step takes from its queue or waits.
  const queues = { user: [], control_response: [], interrupt: [] };
  const waiters = { user: [], control_response: [], interrupt: [] };
  let eof = false;
  const deliver = (kind, msg) => {
    const w = waiters[kind].shift();
    if (w) w(msg);
    else queues[kind].push(msg);
  };
  const take = (kind) => (queues[kind].length ? Promise.resolve(queues[kind].shift()) : new Promise((r) => waiters[kind].push(r)));

  process.on('SIGTERM', () => {
    record({ signal: 'SIGTERM' });
    if (sigterm === 'exit') process.exit(143);
  });
  let sigterm = 'exit';

  const onEnd = () => {
    eof = true;
    if (onEof === 'exit') process.exit(0);
    if (typeof onEof === 'number') process.exit(onEof);
  };

  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      record({ line });
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.type === 'control_request') {
        const subtype = msg.request?.subtype;
        const response = subtype === 'initialize' ? INITIALIZE_RESPONSE : subtype === 'interrupt' ? { still_queued: [] } : {};
        out({ type: 'control_response', response: { subtype: 'success', request_id: msg.request_id, response } });
        if (subtype === 'interrupt') deliver('interrupt', msg);
      } else if (msg.type === 'control_response') {
        deliver('control_response', msg);
      } else if (msg.type === 'user') {
        deliver('user', msg);
      }
    }
  });
  process.stdin.on('end', onEnd);

  for (const step of steps) {
    if ('emit' in step) out(step.emit);
    else if ('await' in step) await take(step.await);
    else if ('sleep' in step) await new Promise((r) => setTimeout(r, step.sleep));
    else if ('exit' in step) process.exit(step.exit);
    else if ('onEof' in step) {
      onEof = step.onEof;
      if (eof) onEnd();
    } else if ('onSigterm' in step) sigterm = step.onSigterm;
  }
  // Script done: stdin keeps the process alive until EOF; with onEof "ignore", hold on regardless.
  if (onEof === 'ignore') setInterval(() => {}, 1 << 30);
}

if (process.argv[1] === SELF) main();
