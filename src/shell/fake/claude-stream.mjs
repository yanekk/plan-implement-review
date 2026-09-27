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
//   PIR_FAKE_CLAUDE_SCRIPT    path of a JSON file: the script, below.
//   PIR_FAKE_CLAUDE_SCRIPTS   path of a JSON file [{ match: <regex source>, script: [...] }], used instead
//                             of PIR_FAKE_CLAUDE_SCRIPT when set. The fake waits for the first user
//                             message and runs the first entry whose regex matches its text, so one file
//                             stands in for every session of a run: planner, reviewer, build workers
//                             (pir-plan-command T05). The message stays queued for the script's own
//                             `{"await":"user"}`. No entry matching is an error result, then idle.
//   PIR_FAKE_CLAUDE_RECEIVED  optional path of an NDJSON file the fake appends to: first
//                             {"argv":[…]}, then every stdin line as {"line":"…"}, then
//                             {"signal":"SIGTERM"} for each SIGTERM it catches. Tests read it to check
//                             what the SDK actually sent (a reply's PermissionResult, an interrupt).
//
// What it does without being told. It answers the SDK's `initialize` control request with a trimmed
// copy of the recorded response, a `remote_control` switching on with the session the real CLI returns
// (probed 2026-09-26), every other control request (`interrupt`, anything a newer SDK adds) with
// `success`, and, when stdin reaches EOF, exits 0 — unless the script said otherwise.
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
//   {"resultFor": "<requestId>", "allowed": "<text>"}  emit the tool_result a real worker's tool returns
//                             once pir answered that `canUseTool` (the reply taken by an earlier
//                             `{"await":"control_response"}`): allowed, the text, or for AskUserQuestion
//                             the answers as Claude words them; refused, an error result carrying pir's
//                             message. The tool_use id is `toolu_<requestId>`, as `canUseTool` builds it.
//   {"chat": {"workMs": <ms>, "init": <object>}}  from here on, answer every user message the way a
//                             worker replies to the person: a turn that says what it was sent, works for
//                             workMs (a tool step), then replies. An interrupt during the work ends the
//                             turn as the real CLI does (`[Request interrupted by user]`, then a result
//                             `error_during_execution`). Never returns; stdin EOF still exits.
//   {"react": "<command>"}    from here on, answer every user message by running `/bin/sh -c <command>`
//                             (as `sh`, with FAKE_MESSAGE set to the message's text) and replying with
//                             its stdout: init, the assistant text, a success result. A session that must
//                             answer whatever arrives, in whatever order (the coordinator agent of the
//                             pir-coordinator T07 drill), decides in the command. A non-zero exit replies
//                             with an error result carrying the stderr tail and keeps reacting. Never
//                             returns; stdin EOF still exits.
//   {"sh": "<command>"}       run `/bin/sh -c <command>` in the session's cwd and wait for it. Its env
//                             adds FAKE_CWD (that cwd) and FAKE_OPENING (the text of the first user
//                             message). A non-zero exit emits an error result carrying the stderr tail
//                             and ends the script there (the fake then idles until EOF), so a resume
//                             re-runs the failed step.
// In `emit` and `sh` steps `{{reportsDir}}` is replaced with the path after `Reports folder: ` in the
// opening message (pir-plan-command DESIGN §2.3), which is how a scripted session finds where to drop
// its report.
// After the last step the fake keeps reading stdin, acking control requests, until EOF.
//
// Resume (scripts-file mode only). Every completed step is recorded in `<dir>/fake-progress-<session>.json` ({ entry, done,
// opening }), <dir> being the folder of the scripts file. A start with `--resume=<id>` (or `--resume
// <id>`) takes no turn until a user message arrives, as real Claude does; that message is consumed as
// the resume prompt, and the script continues from the step after the last completed one, with the
// original opening. An `exit` step counts as completed before it exits, so a script that "crashes" with
// {"exit":1} resumes past the crash.
//
// An interrupt does not cancel an open `can_use_tool` by itself: the real CLI sends
// `{"type":"control_cancel_request","request_id":…}`, which aborts the SDK's canUseTool signal. A
// script that interrupts a turn with an ask open emits that line itself after `{"await":"interrupt"}`.
//
// Helpers for scripts: `turn(text)` is the `init`, assistant text and `result` of one plain turn;
// `wakeUp()` is a background job's notification and the turn it opens; `remoteInputTurn()` is a turn
// opened by input typed over Remote Control;
// `canUseTool(requestId, toolName, input)` is the control request of one permission ask. Both are
// exported so a test builds its script from the same shapes the recording holds.

import { appendFileSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
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

// One tool use and its result, as a worker's assistant message and the user message that answers it.
export function toolUse(id, name, input) {
  return {
    type: 'assistant', parent_tool_use_id: null, session_id: '{{session}}',
    message: { model: 'claude-fake', id: `msg_${id}`, type: 'message', role: 'assistant', content: [{ type: 'tool_use', id, name, input }], stop_reason: null, usage: {} },
    uuid: '00000000-0000-4000-8000-000000000004',
  };
}

export function toolResult(id, text, isError = false) {
  return {
    type: 'user', parent_tool_use_id: null, session_id: '{{session}}',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text, is_error: isError }] },
    uuid: '00000000-0000-4000-8000-000000000005',
  };
}

// A background job's wake-up, as Claude Code 2.1.283 emits it after the turn's `result`
// (src/core/fixtures/remote-answer-sample.ndjson, T00): the notification, then a turn pir never asked for.
export function taskNotification(taskId = 'bgfake') {
  return {
    type: 'system', subtype: 'task_notification', task_id: taskId, tool_use_id: `toolu_${taskId}`, status: 'completed',
    output_file: '/fake/task.output', summary: 'Background command completed', session_id: '{{session}}',
    uuid: '00000000-0000-4000-8000-000000000007',
  };
}

export function wakeUp(text = 'The background job finished.', taskId = 'bgfake') {
  return [{ emit: taskNotification(taskId) }, ...turn(text)];
}

// Input typed over Remote Control, as the real CLI announces it (T00): `command_lifecycle` `queued` and
// `started` before the turn it opens, `completed` after its `result`. The typed text itself never
// reaches the SDK stream without the replay option; pir's only sign of it is this lifecycle.
export function commandLifecycle(state, commandUuid = 'cmd-fake') {
  return { type: 'command_lifecycle', command_uuid: commandUuid, state, session_id: '{{session}}', uuid: '00000000-0000-4000-8000-000000000008' };
}

export function remoteInputTurn(text = 'Thanks, carrying on.', commandUuid = 'cmd-fake') {
  return [
    { emit: commandLifecycle('queued', commandUuid) },
    { emit: commandLifecycle('started', commandUuid) },
    ...turn(text),
    { emit: commandLifecycle('completed', commandUuid) },
  ];
}

// The user text block the CLI emits when a turn is interrupted (T01 probe).
export function interruptedText() {
  return {
    type: 'user', parent_tool_use_id: null, session_id: '{{session}}',
    message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] },
    uuid: '00000000-0000-4000-8000-000000000006',
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
// The shape Claude Code 2.1.283 returned for `enableRemoteControl(true, name)` (probe, 2026-09-26).
export const REMOTE_CONTROL_RESPONSE = {
  session_url: 'https://claude.ai/code/session_01FakeRemoteSession00000000',
  connect_url: 'https://claude.ai/code?environment=',
  environment_id: '',
  bridge_epoch: 1,
  bridge_session_id: 'cse_01FakeRemoteSession00000000',
};

const INITIALIZE_RESPONSE = {
  commands: [{ name: 'context', description: 'Show context usage', argumentHint: '' }],
  agents: [], output_style: 'default', available_output_styles: ['default'], models: [],
  account: { apiProvider: 'firstParty' }, pid: process.pid, current_permission_mode: 'auto',
  session_state: 'idle',
};

// argValue(argv, flag) → the value of `--flag=v` or `--flag v`, or null. The SDK writes `--resume=<id>`;
// the other form is what a person (or pir's own tests) types.
function argValue(argv, flag) {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith(`${flag}=`)) return argv[i].slice(flag.length + 1);
    if (argv[i] === flag && i + 1 < argv.length) return argv[i + 1];
  }
  return null;
}

// The text of a user message, whether its content is a string or blocks.
function userText(msg) {
  const content = msg?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((b) => b?.text ?? '').join(' ');
  return '';
}

async function main() {
  const scriptPath = process.env.PIR_FAKE_CLAUDE_SCRIPT;
  const scriptsPath = process.env.PIR_FAKE_CLAUDE_SCRIPTS;
  const receivedPath = process.env.PIR_FAKE_CLAUDE_RECEIVED;
  const record = (obj) => {
    if (receivedPath) appendFileSync(receivedPath, JSON.stringify(obj) + '\n');
  };
  const argv = process.argv.slice(2);
  record({ argv });

  const resumeId = argValue(argv, '--resume');
  const session = resumeId ?? argValue(argv, '--session-id') ?? '';
  let opening = null; // the text of the first user message; restored from progress on a resume
  // The path runs to the end of its line (DESIGN §2.3), so a folder whose path holds a space survives.
  const reportsDir = () => /Reports folder: (.+)/.exec(opening ?? '')?.[1].trim() ?? '';
  const fill = (v) => {
    if (typeof v === 'string') return v.replaceAll('{{session}}', session).replaceAll('{{reportsDir}}', reportsDir());
    if (Array.isArray(v)) return v.map(fill);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x)]));
    return v;
  };
  const out = (v) => process.stdout.write((typeof v === 'string' ? fill(v) : JSON.stringify(fill(v))) + '\n');

  // Only the scripts file persists progress: a single-script test's scratch dir stays exactly as it was.
  const progressPath = scriptsPath && session ? join(dirname(scriptsPath), `fake-progress-${session}.json`) : null;
  const readProgress = () => {
    try {
      return JSON.parse(readFileSync(progressPath, 'utf8'));
    } catch {
      return null;
    }
  };
  let entry = null; // index into the scripts file, null for a single script
  const saveProgress = (done) => {
    if (!progressPath) return;
    const tmp = `${progressPath}.tmp`;
    writeFileSync(tmp, JSON.stringify({ entry, done, opening }));
    renameSync(tmp, progressPath);
  };

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
  // take, or null after `ms`: the waiter is withdrawn on the timeout so a later line is not swallowed.
  const takeWithin = (kind, ms) =>
    new Promise((resolve) => {
      if (queues[kind].length) return resolve(queues[kind].shift());
      const w = (msg) => {
        clearTimeout(timer);
        resolve(msg);
      };
      const timer = setTimeout(() => {
        const i = waiters[kind].indexOf(w);
        if (i >= 0) waiters[kind].splice(i, 1);
        resolve(null);
      }, ms);
      waiters[kind].push(w);
    });
  const responses = new Map(); // request_id → the PermissionResult pir sent for it

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
        const response =
          subtype === 'initialize' ? INITIALIZE_RESPONSE
          : subtype === 'interrupt' ? { still_queued: [] }
          : subtype === 'remote_control' && msg.request.enabled ? REMOTE_CONTROL_RESPONSE
          : {};
        out({ type: 'control_response', response: { subtype: 'success', request_id: msg.request_id, response } });
        if (subtype === 'interrupt') deliver('interrupt', msg);
      } else if (msg.type === 'control_response') {
        deliver('control_response', msg);
      } else if (msg.type === 'user') {
        if (opening === null) opening = userText(msg);
        deliver('user', msg);
      }
    }
  });
  process.stdin.on('end', onEnd);

  // Which script, and from which step. A resume waits for its prompt before anything else, as the real
  // CLI takes no turn on `--resume` alone; the scripts file waits for the opening to choose by.
  let steps = [];
  let start = 0;
  const prior = resumeId ? readProgress() : null;
  if (prior) {
    await take('user');
    opening = prior.opening ?? null;
    entry = prior.entry ?? null;
    start = prior.done ?? 0;
    steps = entry === null ? readJson(scriptPath) : readJson(scriptsPath)[entry]?.script ?? [];
  } else if (scriptsPath) {
    const first = await take('user');
    queues.user.unshift(first); // left for the script's own {"await":"user"}
    const entries = readJson(scriptsPath);
    const text = userText(first);
    const i = entries.findIndex((e) => new RegExp(e.match).test(text));
    if (i < 0) {
      out(resultEvent('error_during_execution'));
      process.stderr.write(`fake claude: no script matches the opening message: ${text.slice(0, 200)}\n`);
    } else {
      entry = i;
      steps = entries[i].script ?? [];
    }
  } else if (scriptPath) {
    steps = readJson(scriptPath);
  }

  for (let i = start; i < steps.length; i++) {
    const step = steps[i];
    if ('exit' in step) saveProgress(i + 1);
    if ('emit' in step) out(step.emit);
    else if ('sh' in step) {
      const r = await runSh(fill(step.sh), opening ?? '');
      if (r.code !== 0) {
        out({ ...resultEvent('error_during_execution'), errors: [`sh exited ${r.code}: ${r.stderr.slice(-2000)}`] });
        break;
      }
    }
    else if ('await' in step) {
      const msg = await take(step.await);
      const r = msg?.response;
      if (step.await === 'control_response' && r?.request_id) responses.set(r.request_id, r.response ?? {});
    } else if ('resultFor' in step) out(resultFor(step, responses.get(step.resultFor) ?? {}));
    else if ('chat' in step) await chat(step.chat ?? {}, { out, take, takeWithin, queues });
    else if ('react' in step) await react(fill(step.react), { out, take, opening: () => opening ?? '' });
    else if ('sleep' in step) await new Promise((r) => setTimeout(r, step.sleep));
    else if ('exit' in step) process.exit(step.exit);
    else if ('onEof' in step) {
      onEof = step.onEof;
      if (eof) onEnd();
    } else if ('onSigterm' in step) sigterm = step.onSigterm;
    saveProgress(i + 1);
  }
  // Script done: stdin keeps the process alive until EOF; with onEof "ignore", hold on regardless.
  if (onEof === 'ignore') setInterval(() => {}, 1 << 30);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

// runSh(command, opening, { env, stdout }) → { code, stderr, stdout }. Asynchronous, so control requests
// are still acked while a long command runs. stdout is discarded unless asked for (a `react` step's reply):
// a session's shell output is not part of its stream.
function runSh(command, opening, { env = {}, stdout: keep = false } = {}) {
  return new Promise((resolve) => {
    const cwd = process.cwd();
    const child = spawn('/bin/sh', ['-c', command], {
      cwd,
      env: { ...process.env, FAKE_CWD: cwd, FAKE_OPENING: opening, ...env },
      stdio: ['ignore', keep ? 'pipe' : 'ignore', 'pipe'],
    });
    let stderr = '';
    let stdout = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => (stderr = (stderr + d).slice(-8192)));
    if (keep) {
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (d) => (stdout += d));
    }
    child.on('error', (e) => resolve({ code: 127, stderr: String(e.message), stdout }));
    child.on('close', (code, signal) => resolve({ code: code ?? (signal ? 128 : 1), stderr, stdout }));
  });
}

// The react step: one turn per user message, for ever, the reply being what the command printed.
async function react(command, { out, take, opening }) {
  for (;;) {
    const msg = await take('user');
    out(initEvent());
    const r = await runSh(command, opening(), { env: { FAKE_MESSAGE: userText(msg) }, stdout: true });
    if (r.code !== 0) {
      out({ ...resultEvent('error_during_execution'), errors: [`react exited ${r.code}: ${r.stderr.slice(-2000)}`] });
      continue;
    }
    const reply = r.stdout.trim() || '(nothing to say)';
    out(assistantText(reply));
    out(resultEvent('success', reply));
  }
}

// The tool_result for an answered `canUseTool`. An allowed AskUserQuestion reads back its answers in
// Claude's own words; any refusal is an error result carrying the message pir sent.
function resultFor(step, response) {
  const id = `toolu_${step.resultFor}`;
  if (response.behavior !== 'allow') return toolResult(id, response.message ?? 'The person refused.', true);
  const answers = response.updatedInput?.answers;
  if (answers && typeof answers === 'object') {
    const said = Object.entries(answers).map(([q, a]) => `"${q}"="${a}"`).join(', ');
    return toolResult(id, `User has answered your questions: ${said}. You can now continue with the user's answers in mind.`);
  }
  return toolResult(id, step.allowed ?? 'ok');
}

// The chat step: one turn per user message, for ever. The opening line names what was sent, so a
// driver sees its own message come back; the work in the middle is where an interrupt lands.
async function chat({ workMs = 1000, init = initEvent() }, { out, take, takeWithin, queues }) {
  for (let n = 1; ; n++) {
    const msg = await take('user');
    queues.interrupt.length = 0; // an interrupt sent while idle belongs to no turn
    const text = userText(msg);
    out(init);
    out(assistantText(`You said: ${text}. Working on it.`));
    const id = `toolu_chat_${n}`;
    out(toolUse(id, 'Bash', { command: `sleep ${Math.ceil(workMs / 1000)}`, description: 'Pretend to work' }));
    if (await takeWithin('interrupt', workMs)) {
      out(interruptedText());
      out(resultEvent('error_during_execution'));
      continue;
    }
    out(toolResult(id, 'done'));
    const reply = `Done with "${text}".`;
    out(assistantText(reply));
    out(resultEvent('success', reply));
  }
}

if (process.argv[1] === SELF) main();
