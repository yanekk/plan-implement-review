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
    case 'in':
      return readMessage(entry.event, entry);
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
        if (b.type === 'text') return [{ kind: 'text', role: 'user', text: str(b.text) }];
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
// (DESIGN §2.7); every other tool is a permission request (DESIGN §2.6).
function readRequest(entry) {
  if (typeof entry.requestId !== 'string' || typeof entry.toolName !== 'string') return [{ kind: 'raw', raw: entry }];
  const input = isObject(entry.input) ? entry.input : {};
  if (entry.toolName === ASK_TOOL) {
    const questions = (Array.isArray(input.questions) ? input.questions : []).filter(isObject).map((q) => ({
      question: str(q.question),
      header: str(q.header),
      multiSelect: q.multiSelect === true,
      options: (Array.isArray(q.options) ? q.options : []).filter(isObject).map((o) => ({ label: str(o.label), description: str(o.description) })),
    }));
    return [{ kind: 'questions', requestId: entry.requestId, questions, input }];
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
// log whose `init` was lost. A tool_result, rate limit or task event alone does not.
const TURN_OPENERS = new Set(['init', 'text', 'tool-use']);

// workerActivity(entries) → { state, pending, turns, lastEventAt, slashCommands }.
//   starting   nothing has been sent and the worker has not spoken
//   busy       a turn is open: a message went in, or the worker began one, and no `result` came back
//   idle       the last turn ended and nothing is pending
//   permission / questions   the oldest unanswered request is a permission request / a question set
// A pending request outranks busy and idle: a background job may ask after its turn's `result`.
// An interrupt cancels the requests pending when it was sent: the SDK aborts their `canUseTool` signal
// and the turn ends with no reply ever logged (T01 review probe), so they are dropped at that `result`.
// `pending` holds the unanswered requests' events, oldest first. `turns` counts results.
// `lastEventAt` is the last entry's `t`; this never reads a clock.
export function workerActivity(entries) {
  let open = false;
  let started = false;
  let turns = 0;
  let lastEventAt = null;
  let slashCommands = [];
  const pending = new Map();
  let cancelled = null; // requests pending when the person interrupted, dropped at the turn's `result`

  for (const entry of entries) {
    if (isObject(entry) && Number.isFinite(entry.t)) lastEventAt = entry.t;
    for (const ev of readEntry(entry)) {
      switch (ev.kind) {
        case 'sent':
          open = true;
          started = true;
          break;
        case 'result':
          open = false;
          started = true;
          turns += 1;
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
          // A request pir allowed from its own grant list is answered without the person (DESIGN §2.6).
          if (ev.note === 'delivered-by-grant' && typeof ev.requestId === 'string') pending.delete(ev.requestId);
          break;
        default:
          if (ev.kind === 'init') slashCommands = ev.slashCommands;
          if (TURN_OPENERS.has(ev.kind)) {
            open = true;
            started = true;
          }
      }
    }
  }

  const waiting = [...pending.values()];
  let state;
  if (waiting.length > 0) state = waiting[0].kind;
  else if (open) state = 'busy';
  else if (started) state = 'idle';
  else state = 'starting';
  return { state, pending: waiting, turns, lastEventAt, slashCommands };
}
