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
//                             With `"parent": "<tool_use id>"` the result is a helper's: its
//                             `parent_tool_use_id` is that Agent call (visible-helpers DESIGN §2.1).
//   {"repeat": [[<object>, …], …], "everyMs": <ms>, "until": "interrupt"}  emit each round's objects in
//                             turn, one round every everyMs, until an interrupt control request arrives;
//                             once the rounds run out, just wait for it. What a background helper does
//                             while its parent sits idle between turns (visible-helpers T02): it keeps
//                             reporting progress until the person interrupts, which the script's next
//                             steps answer. An interrupt already queued ends it before the first round.
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
//   {"tool": {"id": "<requestId>", "name": "<Tool>", "input": {...}, "allowRuled": <bool>, "request": {...}}}  one tool call
//                             as the real CLI handles it in `default` mode (finisher T00, DESIGN §3.3):
//                             the tool_use, then every PreToolUse hook callback the SDK registered at
//                             `initialize` (a `hook_callback` control request, its reply awaited). A hook
//                             `deny` ends it with the error result `PreToolUse:<Tool> hook error: <reason>`;
//                             `allow` runs it; `ask` sends it to `can_use_tool` whatever the rules say. With
//                             no hook decision the settings decide: `allowRuled` runs it unseen, otherwise
//                             `can_use_tool` asks, pir's reply is awaited and its tool_result emitted. A
//                             run tool's result is `ran <name>`. `request` adds fields to the
//                             `can_use_tool` request (`default_to_no`, `decision_reason`). Each outcome is recorded in the received
//                             file as {"tool": id, "outcome": "hook-deny" | "ran" | "asked"}.
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
// `backgroundTasks(ids)` is the running-jobs list; `wakeUp()` is a background job's end, its notification
// and the turn it opens; `remoteInputTurn()` is a turn
// opened by input typed over Remote Control;
// `canUseTool(requestId, toolName, input)` is the control request of one permission ask; `extra.agentId`
// makes it a helper's ask, written as the wire's `request.agent_id`, which the SDK hands `canUseTool` as
// `opts.agentID` (visible-helpers DESIGN §2.1). Both are
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
export function canUseTool(requestId, toolName, input, { agentId, ...extra } = {}) {
  if (agentId) extra = { ...extra, agent_id: agentId };
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

// The list of background jobs still running, which the CLI re-sends whole whenever it changes and sends
// as `[]` when the last one ends (stopped-worker-asking DESIGN §2.2). A script emits `backgroundTasks(['bgfake'])`
// when its job starts; `wakeUp()` emits the shrunken list when it ends.
export function backgroundTasks(ids = []) {
  return {
    type: 'system', subtype: 'background_tasks_changed',
    tasks: ids.map((id) => ({ task_id: id, task_type: 'local_bash', description: `fake job ${id}` })),
    session_id: '{{session}}', uuid: '00000000-0000-4000-8000-000000000009',
  };
}

// The job's end in the order the real CLI sends it (fixture case 5): the shrunken list, the notification,
// then the wake-up turn. `still` names the jobs that keep running.
export function wakeUp(text = 'The background job finished.', taskId = 'bgfake', still = []) {
  return [{ emit: backgroundTasks(still) }, { emit: taskNotification(taskId) }, ...turn(text)];
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

// ---- Helpers: sessions a worker starts with its Agent tool (visible-helpers DESIGN §2.1). Every shape is
// copied from plans/visible-helpers/evidence/plan-0339-helper.ndjson (Claude Code 2.1.284). `agent` below
// is { taskId, callId, description, subagentType }: the helper's task id, the parent's Agent call id.

// The parent's Agent tool_use that starts a helper, and the tool_result the CLI returns at once for a
// background one.
export function agentCall(agent, prompt = `Pretend helper: ${agent.description}`) {
  return toolUse(agent.callId, 'Agent', { description: agent.description, subagent_type: agent.subagentType ?? 'Explore', prompt, run_in_background: true });
}

export function agentLaunched(agent) {
  return {
    ...toolResult(agent.callId, `Async agent launched successfully.\nagentId: ${agent.taskId} (internal ID - do not mention to user.)`),
    tool_use_result: { isAsync: true, status: 'async_launched', agentId: agent.taskId, description: agent.description, outputFile: `/fake/tasks/${agent.taskId}.output`, canReadOutputFile: true },
  };
}

// The running-jobs list naming helpers (`local_agent`), as background_tasks_changed re-sends it whole.
export function backgroundAgents(agents = []) {
  return {
    type: 'system', subtype: 'background_tasks_changed',
    tasks: agents.map((a) => ({ task_id: a.taskId, task_type: 'local_agent', description: a.description })),
    session_id: '{{session}}', uuid: '00000000-0000-4000-8000-00000000000a',
  };
}

export function taskStarted(agent, { backgrounded = true } = {}) {
  return {
    type: 'system', subtype: 'task_started', task_id: agent.taskId, tool_use_id: agent.callId, description: agent.description,
    subagent_type: agent.subagentType ?? 'Explore', is_backgrounded: backgrounded, spawn_depth: 1, task_type: 'local_agent',
    prompt: `Pretend helper: ${agent.description}`, session_id: '{{session}}', uuid: '00000000-0000-4000-8000-00000000000b',
  };
}

export function taskProgress(agent, description, { toolUses, durationMs, lastTool = 'Read' }) {
  return {
    type: 'system', subtype: 'task_progress', task_id: agent.taskId, tool_use_id: agent.callId, description,
    subagent_type: agent.subagentType ?? 'Explore', usage: { total_tokens: 1000 * toolUses, tool_uses: toolUses, duration_ms: durationMs },
    last_tool_name: lastTool, session_id: '{{session}}', uuid: '00000000-0000-4000-8000-00000000000c',
  };
}

// A helper's end: task_updated with its status, then task_notification. The CLI reports a kill as
// `killed` in the patch and `stopped` in the notification (plan-0339, 2026-09-29).
export function taskUpdated(agent, status, endTime = 1790663110161) {
  return { type: 'system', subtype: 'task_updated', task_id: agent.taskId, patch: { status, end_time: endTime }, session_id: '{{session}}', uuid: '00000000-0000-4000-8000-00000000000d' };
}

export function agentNotification(agent, status) {
  return {
    type: 'system', subtype: 'task_notification', task_id: agent.taskId, tool_use_id: agent.callId, status,
    output_file: `/fake/tasks/${agent.taskId}.output`, summary: agent.description, session_id: '{{session}}', uuid: '00000000-0000-4000-8000-00000000000e',
  };
}

// helperFrame(agent, frame) → one of the helper's own assistant or user frames: `parent_tool_use_id` is the
// parent's Agent call, and the CLI adds the helper's type and description.
export function helperFrame(agent, frame) {
  return { ...frame, parent_tool_use_id: agent.callId, subagent_type: agent.subagentType ?? 'Explore', task_description: agent.description };
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
  let preToolUse = []; // the PreToolUse hook callback ids the SDK registered at `initialize`

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
        if (subtype === 'initialize') {
          preToolUse = (msg.request.hooks?.PreToolUse ?? []).flatMap((m) => m?.hookCallbackIds ?? []);
        }
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
    } else if ('resultFor' in step) {
      const r = resultFor(step, responses.get(step.resultFor) ?? {});
      out(step.parent ? { ...r, parent_tool_use_id: step.parent } : r);
    } else if ('tool' in step) await runTool(step.tool, { out, take, record, responses, hooks: preToolUse });
    else if ('repeat' in step) {
      let stopped = false;
      for (const round of step.repeat) {
        if (await takeWithin('interrupt', 0)) {
          stopped = true;
          break;
        }
        for (const e of round) out(e);
        if (await takeWithin('interrupt', step.everyMs ?? 700)) {
          stopped = true;
          break;
        }
      }
      if (!stopped) await take('interrupt');
    } else if ('chat' in step) await chat(step.chat ?? {}, { out, take, takeWithin, queues });
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

// The tool step: one tool call through the hooks, the settings' rules and `can_use_tool`, in the order
// T00 measured on the real CLI (finisher DESIGN §3.3).
let hookSeq = 0;
async function runTool({ id, name, input = {}, allowRuled = false, request = {} }, { out, take, record, responses, hooks }) {
  const toolUseId = `toolu_${id}`;
  out(toolUse(toolUseId, name, input));
  let decision = null;
  let reason = '';
  for (const callbackId of hooks) {
    const requestId = `hook_req_${++hookSeq}`;
    out({
      type: 'control_request', request_id: requestId,
      request: {
        subtype: 'hook_callback', callback_id: callbackId, tool_use_id: toolUseId,
        input: { hook_event_name: 'PreToolUse', session_id: '{{session}}', tool_name: name, tool_input: input, tool_use_id: toolUseId },
      },
    });
    const reply = await take('control_response');
    const hso = reply?.response?.response?.hookSpecificOutput;
    const d = hso?.permissionDecision;
    if (d === 'deny' || (d && decision === null) || (d === 'ask' && decision === 'allow')) {
      decision = d;
      reason = hso.permissionDecisionReason ?? '';
    }
    if (decision === 'deny') break;
  }
  if (decision === 'deny') {
    record({ tool: id, outcome: 'hook-deny' });
    out(toolResult(toolUseId, `PreToolUse:${name} hook error: ${reason}`, true));
    return;
  }
  if (decision === 'allow' || (decision === null && allowRuled)) {
    record({ tool: id, outcome: 'ran' });
    out(toolResult(toolUseId, `ran ${name}`));
    return;
  }
  record({ tool: id, outcome: 'asked' });
  out(canUseTool(id, name, input, request));
  const msg = await take('control_response');
  const r = msg?.response;
  if (r?.request_id) responses.set(r.request_id, r.response ?? {});
  out(resultFor({ resultFor: id, allowed: `ran ${name}` }, responses.get(id) ?? {}));
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
