// The vocabulary of a worker's conversation (DESIGN §2.2–§2.7). Pure: it reads conversation-log
// entries (DESIGN §2.3) into events, builds the few values pir hands the Agent SDK, and folds a
// worker's entries into its activity. The wire protocol is the SDK's (DESIGN §2.1): nothing here
// builds or parses a stream-json line, and nothing here imports a package, so the SDK stays a
// shell-only dependency (DESIGN §5).
//
// Every shape below was checked against a real recording, src/core/fixtures/stream-sample.ndjson
// (Claude Code 2.1.282, SDK 0.3.282, T01 probe). Facts that shaped the code:
// - `system:init` is re-sent at the start of every turn, not once per process (T00).
// - A background job's `system:task_notification` arriving after a `result` is followed by a new turn
//   (`init`, assistant, `result`) that pir never asked for (T01 probe). So a turn can open with no
//   `out` message, and activity must open it on the worker's own `init` or assistant output.
// - Assistant messages carry `thinking` blocks the person never reads; they yield no event.
// - An interrupt ends the open turn with `result` subtype `error_during_execution` (T00).

const ASK_TOOL = 'AskUserQuestion';

export const DEFAULT_REFUSAL = 'The person refused.';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v : '');
const strArray = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);

// readEntry(entry) → WorkerEvent[]. `entry` is one conversation-log entry, or one raw log line (a
// string): a line that does not parse — a crash mid-append leaves a truncated last line — is kept as
// `raw` and never stops the reader (DESIGN §2.3). Never throws.
export function readEntry(entry) {
  if (typeof entry === 'string') {
    try {
      entry = JSON.parse(entry);
    } catch {
      return [{ kind: 'raw', raw: entry }];
    }
  }
  if (!isObject(entry) || typeof entry.dir !== 'string') return [{ kind: 'raw', raw: entry }];
  switch (entry.dir) {
    case 'in': {
      // A helper's frames (Agent tool) carry the parent's Agent call id as `parent_tool_use_id`; the
      // parent's own carry null (visible-helpers DESIGN §2.1). Every event from such a frame is tagged,
      // so the fold and the view never take a helper's words for the parent's.
      const evs = readMessage(entry.event, entry);
      const helper = isObject(entry.event) ? entry.event.parent_tool_use_id : null;
      return typeof helper === 'string' && helper ? evs.map((ev) => (ev.kind === 'raw' ? ev : { ...ev, helper })) : evs;
    }
    case 'request':
      return readRequest(entry);
    case 'out':
      return readOut(entry);
    case 'note': {
      if (typeof entry.kind !== 'string') return [{ kind: 'raw', raw: entry }];
      const { t, dir, kind, ...rest } = entry;
      return [{ ...rest, kind: 'note', note: kind }];
    }
    default:
      return [{ kind: 'raw', raw: entry }];
  }
}

// One SDK message, exactly as query() yielded it.
function readMessage(m, entry) {
  if (!isObject(m) || typeof m.type !== 'string') return [{ kind: 'raw', raw: entry }];
  switch (m.type) {
    case 'system':
      if (m.subtype === 'init') {
        return [{
          kind: 'init',
          sessionId: str(m.session_id),
          slashCommands: strArray(m.slash_commands),
          terminalSlashCommands: strArray(m.terminal_slash_commands),
          tools: strArray(m.tools),
          permissionMode: str(m.permissionMode),
        }];
      }
      // The full list of background jobs still running, re-sent whenever it changes and `[]` when the
      // last one ends (Claude Code 2.1.283; stopped-worker-asking DESIGN §2.2).
      if (m.subtype === 'background_tasks_changed') {
        const tasks = Array.isArray(m.tasks) ? m.tasks : [];
        return [{ kind: 'background', ids: tasks.filter(isObject).map((t) => t.task_id).filter((id) => typeof id === 'string') }];
      }
      return [{ kind: 'system', subtype: str(m.subtype), event: m }];
    case 'assistant':
      return blocks(m).flatMap((b) => {
        if (b.type === 'text') return [{ kind: 'text', role: 'assistant', text: str(b.text) }];
        if (b.type === 'tool_use') {
          return [{ kind: 'tool-use', toolUseId: str(b.id), name: str(b.name), input: isObject(b.input) ? b.input : {} }];
        }
        return [];
      });
    case 'user': {
      const content = m.message?.content;
      // A plain-string user message is a replay of what was sent; `[Request interrupted by user]`
      // arrives as a text block (T01 probe).
      if (typeof content === 'string') return [{ kind: 'text', role: 'user', text: content }];
      return blocks(m).flatMap((b) => {
        if (b.type === 'tool_result') {
          return [{ kind: 'tool-result', toolUseId: str(b.tool_use_id), text: resultText(b.content), isError: b.is_error === true }];
        }
        // Claude marks the text it injects itself `isSynthetic` (a loaded skill's whole body, T18 live
        // run); it is context for the model, not something anyone said.
        if (b.type === 'text') return [{ kind: 'text', role: 'user', text: str(b.text), ...(m.isSynthetic === true ? { synthetic: true } : {}) }];
        return [];
      });
    }
    case 'result':
      return [{ kind: 'result', subtype: str(m.subtype), text: str(m.result), isError: m.is_error === true }];
    default:
      // rate_limit_event, stream events and any type a newer Claude adds: shown, never an error.
      return [{ kind: 'system', subtype: str(m.subtype) || m.type, event: m }];
  }
}

function blocks(m) {
  const content = m.message?.content;
  return Array.isArray(content) ? content.filter(isObject) : [];
}

// A tool_result's content is a string or an array of content blocks.
function resultText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.filter((b) => isObject(b) && b.type === 'text').map((b) => str(b.text)).join('\n');
  return '';
}

// One `canUseTool` call, as pir recorded it (DESIGN §2.3). AskUserQuestion is a question set
// (DESIGN §2.7); every other tool is a permission request (DESIGN §2.6). A helper's request carries
// `agentId` (the SDK's `agentID`, the helper's task_id), which attributes it: it reaches canUseTool before
// the helper's own tool_use frame, so frame order cannot (visible-helpers DESIGN §2.1).
function readRequest(entry) {
  if (typeof entry.requestId !== 'string' || typeof entry.toolName !== 'string') return [{ kind: 'raw', raw: entry }];
  const input = isObject(entry.input) ? entry.input : {};
  const agent = typeof entry.agentId === 'string' ? { agentId: entry.agentId } : {};
  if (entry.toolName === ASK_TOOL) {
    const questions = (Array.isArray(input.questions) ? input.questions : []).filter(isObject).map((q) => ({
      question: str(q.question),
      header: str(q.header),
      multiSelect: q.multiSelect === true,
      options: (Array.isArray(q.options) ? q.options : []).filter(isObject).map((o) => ({ label: str(o.label), description: str(o.description) })),
    }));
    return [{ kind: 'questions', requestId: entry.requestId, questions, input, ...agent }];
  }
  return [{
    kind: 'permission',
    requestId: entry.requestId,
    toolName: entry.toolName,
    input,
    description: str(entry.description),
    reason: str(entry.reason),
    suggestions: Array.isArray(entry.suggestions) ? entry.suggestions : [],
    defaultToNo: entry.defaultToNo === true,
    suppressAlwaysAllowRule: entry.suppressAlwaysAllowRule === true,
    ...agent,
  }];
}

// Something pir sent the worker (DESIGN §2.2, §2.6–§2.8).
function readOut(entry) {
  switch (entry.kind) {
    case 'message':
      return [{ kind: 'sent', from: str(entry.from), text: str(entry.text) }];
    case 'interrupt':
      return [{ kind: 'interrupt', from: str(entry.from) }];
    case 'reply':
      if (typeof entry.requestId !== 'string') return [{ kind: 'raw', raw: entry }];
      return [{ kind: 'reply', requestId: entry.requestId, behavior: str(entry.result?.behavior), from: str(entry.from) }];
    default:
      return [{ kind: 'raw', raw: entry }];
  }
}

// ---- Values pir hands the SDK. Every one is built here and nowhere else. ----

// userMessage(text, sessionId) → the SDKUserMessage pushed into the worker's input queue (DESIGN §2.2).
export function userMessage(text, sessionId) {
  return { type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null, session_id: sessionId };
}

// allowResult(request) → allow once, input unchanged (DESIGN §2.6). Never carries
// `updatedPermissions`: pir keeps "don't ask again" itself (user 2026-09-25, T00 review).
export function allowResult(request) {
  return { behavior: 'allow', updatedInput: request.input };
}

// denyResult(request, message) → a refusal the worker reads as the tool's error. Blank typed text
// falls back to the default wording (DESIGN §2.6).
export function denyResult(request, message = DEFAULT_REFUSAL) {
  return { behavior: 'deny', message: typeof message === 'string' && message.trim() ? message : DEFAULT_REFUSAL };
}

// answersResult(request, answers) → the answered question set (DESIGN §2.7): the request's input plus
// `answers: { "<question>": "<label>" }`. A multi-select answer may be given as an array of labels;
// it is joined with ", ", the form the round trip was measured with.
export function answersResult(request, answers) {
  const joined = {};
  for (const [question, answer] of Object.entries(answers)) {
    joined[question] = Array.isArray(answer) ? answer.join(', ') : String(answer);
  }
  return { behavior: 'allow', updatedInput: { ...request.input, answers: joined } };
}

// declineQuestionsResult(request, text) → the person typed a reply instead of picking: the tool is
// refused with their text as the message, Claude's own "chat about this" (DESIGN §2.7).
export function declineQuestionsResult(request, text) {
  return denyResult(request, text);
}

// ---- Activity (DESIGN §2.4). ----

// Worker events that mean the worker itself has a turn under way. `init` opens every turn (T00) and a
// background job's notification opens one with nothing sent (T01 probe); assistant output covers a
// log whose `init` was lost. A tool_result, rate limit or task event alone does not, and neither does
// anything a helper said (an event with `helper`): a background helper keeps talking after the parent's
// `result`, and taking that for the parent re-opened a turn that never ran (visible-helpers DESIGN §2.7).
const TURN_OPENERS = new Set(['init', 'text', 'tool-use']);
const ANSWER_NOTES = new Set(['delivered-by-grant', 'answered-remotely']);

// Why a turn opened (real-asking-state DESIGN §2.2), measured by T00 against Claude Code 2.1.283
// (src/core/fixtures/remote-answer-sample.ndjson): input typed over Remote Control is announced by a
// top-level `command_lifecycle` message (`queued`, then `started`) before the turn's `init`; a pir send
// and a background wake-up never emit one. A wake-up follows `system:task_notification` after the last
// `result`. The SDK `UserPromptSubmit` hook does not separate the three (its `source` is absent for all).
const REMOTE_OPEN_STATES = new Set(['queued', 'started']);
// The coordinator agent's answer reaches a worker as a send `from: 'coordinator'` and answers it exactly as
// the person's does (pir-coordinator DESIGN §2.3), so it is a cause of its own, never `unknown`.
const SEND_CAUSES = { person: 'person', pir: 'pir', coordinator: 'coordinator' };

// workerActivity(entries) → { state, open, pending, turns, lastEventAt, slashCommands, turnCauses,
//                             personSends, remoteSends, background, coordinatorSends }.
//   starting   nothing has been sent and the worker has not spoken
//   busy       a turn is open: a message went in, or the worker began one, and no `result` came back
//   idle       the last turn ended and nothing is pending
//   permission / questions   the oldest unanswered request is a permission request / a question set
// A pending request outranks busy and idle: a background job may ask after its turn's `result`.
// An interrupt cancels the requests pending when it was sent: the SDK aborts their `canUseTool` signal
// and the turn ends with no reply ever logged (T01 review probe), so they are dropped at that `result`.
// `pending` holds the unanswered requests' events, oldest first. `turns` counts results. `open` is
// whether a turn is under way, whatever a pending request makes `state` read.
// `lastEventAt` is the last entry's `t`; this never reads a clock.
// `turnCauses` holds one entry per turn opened, in order: 'person' / 'pir' (opened by an `out` send from
// that sender), 'remote' (Remote Control input), 'system' (a background job's wake-up) or 'unknown'.
// `personSends` counts the person's `out` sends, `coordinatorSends` the coordinator agent's; `remoteSends` counts Remote Control inputs (distinct
// `command_lifecycle` command ids). Both count wherever the input landed, an open turn included, which is
// how resumeAnswered hears an answer given while the asking turn is still running (DESIGN §2.2).
// `background` holds the ids of the worker's background jobs still running (stopped-worker-asking DESIGN
// §2.2): those in the latest `background_tasks_changed`, plus any that left the list since the last turn
// opened or ended. A job that ends while the worker is idle is held until its wake-up turn opens, because
// the CLI sends the shrunken list, then the notification, then the turn's `init` (fixture case 5), and in
// that gap the worker would otherwise read as stopped with nothing running. One that ends inside an open
// turn is held to that turn's `result`. `[]` before any such event; a `resumed` note clears it.
export function workerActivity(entries) {
  let open = false;
  let started = false;
  let turns = 0;
  let lastEventAt = null;
  let slashCommands = [];
  const pending = new Map();
  let cancelled = null; // requests pending when the person interrupted, dropped at the turn's `result`
  const turnCauses = [];
  let nextCause = null; // what the next turn opened by the worker's own output was announced by
  let personSends = 0;
  let coordinatorSends = 0;
  const remoteCommands = new Set();
  let listed = [];
  const held = new Set(); // ids that left the list since the last turn opened or ended
  const openTurn = (cause) => {
    if (!open) {
      turnCauses.push(cause);
      held.clear();
    }
    open = true;
    started = true;
    nextCause = null;
  };

  for (const entry of entries) {
    if (isObject(entry) && Number.isFinite(entry.t)) lastEventAt = entry.t;
    for (const ev of readEntry(entry)) {
      switch (ev.kind) {
        case 'sent':
          if (ev.from === 'person') personSends += 1;
          if (ev.from === 'coordinator') coordinatorSends += 1;
          openTurn(SEND_CAUSES[ev.from] ?? 'unknown');
          break;
        case 'result':
          open = false;
          started = true;
          turns += 1;
          nextCause = null;
          held.clear();
          if (cancelled) for (const id of cancelled) pending.delete(id);
          cancelled = null;
          break;
        case 'interrupt':
          cancelled = new Set([...(cancelled ?? []), ...pending.keys()]);
          break;
        case 'permission':
        case 'questions':
          pending.set(ev.requestId, ev);
          started = true;
          break;
        case 'reply':
          pending.delete(ev.requestId);
          break;
        case 'note':
          // A request pir allowed from its own grant list is answered without the person (DESIGN §2.6);
          // one answered over Remote Control was answered by the person elsewhere (worker-proc.mjs).
          if (ANSWER_NOTES.has(ev.note) && typeof ev.requestId === 'string') pending.delete(ev.requestId);
          // A session resumed into the same log (pir-plan-command §2.14) is a new process: whatever was
          // pending or under way died with the old one, and its questions are lost (the resumed session is
          // told to ask again), so nothing before the note is still waiting.
          if (ev.note === 'resumed') {
            pending.clear();
            cancelled = null;
            open = false;
            nextCause = null;
            listed = [];
            held.clear();
          }
          break;
        case 'background': {
          const now = new Set(ev.ids);
          for (const id of listed) if (!now.has(id)) held.add(id);
          for (const id of now) held.delete(id);
          listed = [...now];
          break;
        }
        case 'system':
          if (ev.subtype === 'command_lifecycle' && REMOTE_OPEN_STATES.has(ev.event?.state)) {
            // Typed while a turn runs, the input may be queued for the next turn or injected into this
            // one (unprobed, T00 review); either way the person has spoken, so it is counted now.
            if (typeof ev.event.command_uuid === 'string') remoteCommands.add(ev.event.command_uuid);
            if (!open) nextCause = 'remote';
          } else if (ev.subtype === 'task_notification' && !open && nextCause === null) {
            nextCause = 'system';
          }
          break;
        default:
          if (ev.kind === 'init') slashCommands = ev.slashCommands;
          if (TURN_OPENERS.has(ev.kind) && !ev.helper) openTurn(nextCause ?? 'unknown');
      }
    }
  }

  const waiting = [...pending.values()];
  let state;
  if (waiting.length > 0) state = waiting[0].kind;
  else if (open) state = 'busy';
  else if (started) state = 'idle';
  else state = 'starting';
  return {
    state, open, pending: waiting, turns, lastEventAt, slashCommands, turnCauses, personSends,
    remoteSends: remoteCommands.size, background: [...listed, ...held], coordinatorSends,
  };
}
