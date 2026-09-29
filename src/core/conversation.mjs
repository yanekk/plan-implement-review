// A worker's conversation as the person reads it (DESIGN §2.3, §2.6, §2.7, §2.11). Pure: conversation-log
// entries in, styled lines out, plus the two interactive prompts (the permission gate and the question-set
// picker) as state with reducers. The conversation view (T13) only paints these lines and routes keys to
// these reducers, so every rule about what the person sees is decided and tested here.
//
// Lines follow render.mjs's convention: a line is an array of `{ text, style }` spans. Styles: 'pir',
// 'person', 'worker', 'step', 'step-error', 'dim', 'prompt', 'ok', 'bad', or null for plain.
//
// Widths count code points (text.mjs). Exact clipping of wide characters is the painter's job in the
// shell (pi-tui `truncateToWidth`): core may not import a package (DESIGN §3.1).

import { readEntry, workerActivity, DEFAULT_REFUSAL } from './stream.mjs';
import { grantFrom } from './person-input.mjs';
import { wrapLine, clipText, plainText } from './text.mjs';

const span = (text, style = null) => ({ text, style });
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const firstLine = (s) => String(s ?? '').split('\n').find((l) => l.trim() !== '')?.trim() ?? '';

// The input field that says what a tool call is about: the one a person scans a step line for. A tool
// not listed shows its first string field, so a tool a newer Claude adds still reads sensibly.
const MAIN_ARG = {
  Bash: 'command',
  Read: 'file_path',
  Write: 'file_path',
  Edit: 'file_path',
  MultiEdit: 'file_path',
  NotebookEdit: 'notebook_path',
  Grep: 'pattern',
  Glob: 'pattern',
  WebFetch: 'url',
  WebSearch: 'query',
  Task: 'description',
  Agent: 'description',
  Skill: 'skill',
};

export function mainArg(name, input) {
  if (!isObject(input)) return '';
  const key = MAIN_ARG[name];
  if (key && typeof input[key] === 'string') return input[key];
  if (key) return '';
  const first = Object.values(input).find((v) => typeof v === 'string');
  return first ?? '';
}

// Clip a line of spans to `width` code points in total; the span that crosses the edge ends in `…`.
function clipSpans(spans, width) {
  const out = [];
  let left = Math.max(1, width | 0);
  for (const raw of spans) {
    const s = span(plainText(raw.text).replace(/\n/g, ' '), raw.style);
    const n = [...s.text].length;
    if (n < left || (n === left && raw === spans[spans.length - 1])) {
      out.push(s);
      left -= n;
      continue;
    }
    const cut = clipText(s.text + ' ', left); // force the ellipsis: something follows past the edge
    if (cut) out.push(span(cut, s.style));
    break;
  }
  return out;
}

// Word-wrap a line of spans to `width` code points, keeping each character's style. Continuation lines
// are indented by `indent` columns; no break is taken inside the first `keep` characters (a prompt's
// `❯ ( ) Other: ` head), so the head stays on one line. A word longer than the room hard-breaks.
function wrapSpans(spans, width, { indent = 0, keep = 0 } = {}) {
  const chars = [];
  for (const raw of spans) for (const ch of plainText(raw.text).replace(/\n/g, ' ')) chars.push({ ch, style: raw.style });
  const rows = [];
  let start = 0;
  do {
    const room = Math.max(1, width - (rows.length ? indent : 0));
    let end = Math.min(start + room, chars.length);
    if (end < chars.length && chars[end].ch !== ' ') {
      for (let i = end; i > Math.max(start, keep); i--) {
        if (chars[i - 1].ch === ' ') {
          end = i;
          break;
        }
      }
    }
    const row = chars.slice(start, end);
    while (row.length && row[row.length - 1].ch === ' ' && end < chars.length) row.pop();
    rows.push(row);
    start = end;
    while (start < chars.length && chars[start].ch === ' ') start += 1;
  } while (start < chars.length);
  return rows.map((row, i) => {
    const out = [];
    for (const c of row) {
      const last = out[out.length - 1];
      if (last && last.style === c.style) last.text += c.ch;
      else out.push(span(c.ch, c.style));
    }
    return i && indent ? [span(' '.repeat(indent), null), ...out] : out;
  });
}

// Wrap `text` (which may hold newlines) under a prefix: the first line starts with the prefix, the rest
// are indented to line up under the text. Wrapped, never truncated: a message is read in full.
function wrapped(prefix, text, style, width) {
  prefix = plainText(prefix);
  const indent = ' '.repeat([...prefix].length);
  const w = Math.max(1, width - [...prefix].length);
  const lines = [];
  for (const logical of plainText(text).replace(/\s+$/, '').split('\n')) {
    for (const seg of wrapLine(logical, w)) lines.push([span((lines.length ? indent : prefix) + seg, style)]);
  }
  return lines;
}

function senderPrefix(from, taskId) {
  if (from === 'person') return { prefix: 'you ▸ ', style: 'person' };
  if (from === 'pir') return { prefix: 'pir ▸ ', style: 'pir' };
  if (from === 'worker') return { prefix: `${taskId} ▸ `, style: 'worker' };
  return { prefix: `${from || '?'} ▸ `, style: 'pir' };
}

// ---- The conversation. ----

// buildConversation(entries, { full, width, taskId, readOnly, open }) → { lines, pinned, background }.
// Default mode folds each run of consecutive tool steps into one group line (group-commands DESIGN §2.1–
// §2.4); `open` is a Set of group ids (a group's first toolUseId) drawn unfolded. Each group line carries
// `line.hit = { kind: 'group', id }` so the view can click it; no other line has a hit. Full mode draws
// every step with its whole result and no groups (§2.6).
// `pinned` is the oldest pending request as a fresh prompt (gateFor / pickerFor), kept out of `lines`;
// the view keeps its own prompt state and paints it with promptLines. Once answered, a request is drawn
// in `lines` where it was asked, with its answer. A read-only view (a worker no longer live) pins
// nothing and shows an unanswered request as never answered.
export function buildConversation(entries, { full = false, width = 80, taskId = 'worker', readOnly = false, open = new Set() } = {}) {
  // A raw log line (a string) is parsed once here, so pass 1 can read a reply's `result` off the entry;
  // one that does not parse stays a string and readEntry keeps it as `raw`.
  const list = (Array.isArray(entries) ? entries : []).map((e) => {
    if (typeof e !== 'string') return e;
    try {
      return JSON.parse(e);
    } catch {
      return e;
    }
  });
  const w = Math.max(10, width | 0);

  // Pass 1: what each tool use returned, and how each request was resolved.
  const results = new Map(); // toolUseId → tool-result event
  const answers = new Map(); // requestId → { result, from } from the reply entry
  const byGrant = new Set();
  const remotely = new Set(); // requestIds answered over Remote Control
  const lost = new Set(); // requestIds still pending at a `resumed` note: they died with the old process
  const toolNames = new Map(); // toolUseId → tool name, so a background task knows it is a Monitor
  const background = new Map(); // task_id → { description, tool, ended } for work moved to the background
  const requests = []; // every permission and questions event, to tie a refusal to its step (§2.2)
  list.forEach((entry, i) => {
    for (const ev of readEntry(entry)) {
      if (ev.kind === 'tool-use') toolNames.set(ev.toolUseId, ev.name);
      if (ev.kind === 'permission' || ev.kind === 'questions') requests.push(ev);
      if (ev.kind === 'system') {
        const task = backgroundEvent(ev);
        if (task?.started) background.set(task.id, { description: task.description, tool: toolNames.get(task.toolUseId) ?? '', ended: null });
        else if (task?.ended && background.has(task.id)) background.get(task.id).ended ??= task.ended;
      }
      if (ev.kind === 'tool-result') results.set(ev.toolUseId, ev);
      else if (ev.kind === 'reply') answers.set(ev.requestId, { result: isObject(entry.result) ? entry.result : {}, from: ev.from });
      else if (ev.kind === 'note' && ev.note === 'delivered-by-grant' && typeof ev.requestId === 'string') byGrant.add(ev.requestId);
      else if (ev.kind === 'note' && ev.note === 'answered-remotely' && typeof ev.requestId === 'string') remotely.add(ev.requestId);
      // Only what was still pending: one an interrupt cancelled earlier keeps reading cancelled (T14 review).
      else if (ev.kind === 'note' && ev.note === 'resumed') for (const r of workerActivity(list.slice(0, i)).pending) lost.add(r.requestId);
    }
  });
  const pending = workerActivity(list).pending;
  const pendingIds = new Set(pending.map((r) => r.requestId));
  const pinnedRequest = !readOnly && pending.length ? pending[0] : null;
  // A request with no reply, no grant and no longer pending was cancelled by an interrupt (stream.mjs).
  const resolution = (id) => {
    if (answers.has(id)) return { by: 'reply', ...answers.get(id) };
    if (byGrant.has(id)) return { by: 'grant' };
    if (remotely.has(id)) return { by: 'remote' };
    if (pendingIds.has(id)) return { by: readOnly ? 'never' : 'waiting' };
    if (lost.has(id)) return { by: 'never' };
    return { by: 'interrupt' };
  };

  // A step whose request was answered no is refused, not failed (§2.2): a permission refused, or a question
  // set answered in text instead. Tied by the request's toolUseId; a log written before it was recorded
  // ties by a requestId equal to the step's toolUseId.
  const refusedSteps = new Set();
  for (const req of requests) {
    const answer = answers.get(req.requestId);
    if (answer?.result.behavior === 'deny') refusedSteps.add(req.toolUseId ?? req.requestId);
  }

  // Pass 2: the scrollback, oldest first. Every drawn line goes through `emit`, which first closes the
  // open group of steps: a line drawn between two steps is exactly what ends a group (§2.1), and an event
  // that draws nothing (a tool result, init, the pinned request) leaves the group open.
  const lines = [];
  let group = null; // { id, steps: [{ use, result }] } — the run of steps not yet drawn
  const flush = () => {
    if (!group) return;
    lines.push(...groupLines(group, { width: w, open: open instanceof Set && open.has(group.id), refusedSteps }));
    group = null;
  };
  const emit = (drawn) => {
    if (!drawn.length) return;
    flush();
    lines.push(...drawn);
  };
  let interrupted = false; // an interrupt since the last result: its error_during_execution is expected
  for (const entry of list) {
    for (const ev of readEntry(entry)) {
      switch (ev.kind) {
        case 'sent': {
          const { prefix, style } = senderPrefix(ev.from, taskId);
          emit(wrapped(prefix, ev.text, style, w));
          break;
        }
        case 'text': {
          if (!ev.text.trim() || ev.synthetic) break; // a skill body Claude injected: hundreds of lines nobody said
          if (ev.role === 'assistant') emit(wrapped(`${taskId} ▸ `, ev.text, 'worker', w));
          else emit(wrapped('  ', ev.text, 'dim', w)); // e.g. `[Request interrupted by user]`
          break;
        }
        case 'tool-use':
          if (full) emit(stepLines(ev, results.get(ev.toolUseId), { full, width: w }));
          else {
            group ??= { id: ev.toolUseId, steps: [] };
            group.steps.push({ use: ev, result: results.get(ev.toolUseId) });
          }
          break;
        case 'permission':
        case 'questions':
          if (pinnedRequest && ev.requestId === pinnedRequest.requestId) break;
          emit(requestLines(ev, resolution(ev.requestId), { width: w, taskId }));
          break;
        case 'interrupt': {
          const { prefix, style } = senderPrefix(ev.from || 'person', taskId);
          emit([[span(`${prefix}⎋ interrupted the worker`, style)]]);
          interrupted = true;
          break;
        }
        case 'result': {
          const expected = interrupted && ev.subtype === 'error_during_execution';
          interrupted = false;
          if (expected || (!ev.isError && ev.subtype === 'success')) break;
          emit(wrapped('✕ ', `the turn failed (${ev.subtype || 'error'})${ev.text ? `: ${ev.text}` : ''}`, 'bad', w));
          break;
        }
        case 'note':
          emit(noteLines(ev, w));
          break;
        case 'raw':
          emit([[span('· an unreadable log line', 'dim')]]);
          break;
        case 'system': {
          // Background work (user 2026-09-26, T18 drill): one line when a command or a monitor moves to the
          // background and one when it ends, so a worker waiting on it does not look idle. The monitor's
          // own events never reach pir (Claude hands them to the model only), so only its start and end show.
          const task = backgroundEvent(ev);
          const known = task && background.get(task.id);
          if (!known) break;
          const what = known.description || (known.tool === 'Monitor' ? 'a monitor' : 'a command');
          if (task.started) emit(wrapped('  ↳ ', `${known.tool === 'Monitor' ? 'monitor started' : 'running in the background'}: ${what}`, 'dim', w));
          else if (task.ended && task.notification) {
            const verb = task.ended === 'completed' ? (known.tool === 'Monitor' ? 'monitor ended' : 'finished in the background') : `${task.ended} in the background`;
            emit(wrapped('  ↳ ', `${verb}: ${what}`, task.ended === 'completed' ? 'dim' : 'bad', w));
          }
          break;
        }
        default:
          // init, tool-result (drawn on its step).
          break;
      }
    }
  }
  flush();

  let pinned = null;
  if (pinnedRequest) pinned = pinnedRequest.kind === 'questions' ? pickerFor(pinnedRequest) : gateFor(pinnedRequest);
  // How many background commands and monitors are still running: started and not yet ended.
  const running = [...background.values()].filter((b) => !b.ended).length;
  return { lines, pinned, background: running };
}

// backgroundEvent(ev) → { id, started, toolUseId, description } | { id, ended, notification } | null, for
// one `system` event (stream.mjs) about background work, as measured on Claude Code 2.1.282 (T18 live run):
// `task_started` with `is_backgrounded: true` when a Bash command or a Monitor goes to the background;
// `task_updated` with a terminal `patch.status`, then `task_notification` with `status`, when it ends.
// Anything else (a foreground task, rate limits, thinking tokens) is null.
function backgroundEvent(ev) {
  const e = ev?.event;
  if (!isObject(e) || typeof e.task_id !== 'string') return null;
  if (e.subtype === 'task_started') {
    return e.is_backgrounded === true ? { id: e.task_id, started: true, toolUseId: e.tool_use_id, description: typeof e.description === 'string' ? e.description : '' } : null;
  }
  const status = e.subtype === 'task_notification' ? e.status : e.subtype === 'task_updated' ? e.patch?.status : null;
  if (!['completed', 'failed', 'killed', 'stopped'].includes(status)) return null;
  return { id: e.task_id, ended: status, notification: e.subtype === 'task_notification' };
}

// ---- Groups of steps (group-commands DESIGN §2.1–§2.4). ----

// What a tool's steps are counted as on a group line (§2.2). Tools sharing a phrase share a key, so an Edit
// and a MultiEdit read `edited 2 files`. An unknown tool keeps its own name.
const KINDS = {
  Bash: ['shell', 'ran', 'shell command', 'shell commands'],
  Read: ['read', 'read', 'file', 'files'],
  Write: ['write', 'wrote', 'file', 'files'],
  Edit: ['edit', 'edited', 'file', 'files'],
  MultiEdit: ['edit', 'edited', 'file', 'files'],
  NotebookEdit: ['edit', 'edited', 'file', 'files'],
  Grep: ['search', 'searched', 'time', 'times'],
  Glob: ['search', 'searched', 'time', 'times'],
  WebFetch: ['fetch', 'fetched', 'page', 'pages'],
  WebSearch: ['web', 'searched the web', 'time', 'times'],
  Task: ['agent', 'ran', 'agent', 'agents'],
  Agent: ['agent', 'ran', 'agent', 'agents'],
  Skill: ['skill', 'loaded', 'skill', 'skills'],
  TodoWrite: ['todo', 'updated the to-do list', 'time', 'times'],
  AskUserQuestion: ['ask', 'asked', 'question set', 'question sets'],
  Monitor: ['monitor', 'started', 'monitor', 'monitors'],
};

// stepKind(toolName) → { key, verb, one, many }.
export function stepKind(toolName) {
  const name = plainText(String(toolName ?? ''));
  const known = Object.hasOwn(KINDS, name) ? KINDS[name] : null;
  if (known) {
    const [key, verb, one, many] = known;
    return { key, verb, one, many };
  }
  return { key: `tool:${name}`, verb: `used ${name}`, one: 'time', many: 'times' };
}

// groupLabel(finishedSteps) → { text, failed, refused }. `finishedSteps` is [{ name, isError, refused }] in
// log order; kinds are listed in the order each first appeared, first letter capitalised. A refused step
// counts in `refused`, never in `failed`.
export function groupLabel(finishedSteps) {
  const counts = new Map(); // key → { kind, n }, insertion order = first appearance
  let failed = 0;
  let refused = 0;
  for (const step of finishedSteps ?? []) {
    const kind = stepKind(step.name);
    const c = counts.get(kind.key) ?? counts.set(kind.key, { kind, n: 0 }).get(kind.key);
    c.n += 1;
    if (step.refused) refused += 1;
    else if (step.isError) failed += 1;
  }
  const text = [...counts.values()].map(({ kind, n }) => `${kind.verb} ${n} ${n === 1 ? kind.one : kind.many}`).join(', ');
  return { text: text ? text[0].toUpperCase() + text.slice(1) : '', failed, refused };
}

// One group: its line (only when a step in it has finished), its finished steps under it when open, then
// its running steps on their own lines in the order they were used (§2.3, §2.4).
function groupLines(group, { width, open, refusedSteps }) {
  const finished = group.steps.filter((s) => s.result);
  const running = group.steps.filter((s) => !s.result);
  const out = [];
  if (finished.length) {
    const label = groupLabel(finished.map((s) => ({ name: s.use.name, isError: s.result.isError === true, refused: refusedSteps.has(s.use.toolUseId) })));
    const suffix = [];
    if (label.failed) suffix.push(span(` · ${label.failed} failed`, 'step-error'));
    if (label.refused) suffix.push(span(` · ${label.refused} refused`, 'dim'));
    // The suffixes are never clipped: the label is cut first, so a failure shows at any width.
    const room = Math.max(1, width - suffix.reduce((n, s) => n + [...s.text].length, 0));
    const head = `  ${open ? '▾' : '▸'} ${plainText(label.text)}`;
    const line = [span([...head].length <= room ? head : clipText(head, room), 'step'), ...suffix];
    line.hit = { kind: 'group', id: group.id };
    out.push(line);
    if (open) for (const s of finished) out.push(...stepLines(s.use, s.result, { full: false, width, indent: '    ' }));
  }
  for (const s of running) out.push(...stepLines(s.use, null, { full: false, width }));
  return out;
}

// One tool use. Default: exactly one line, `⎿ <Tool> <main arg>  <last result line>`, clipped to width;
// `indent` is what precedes the `⎿` (an open group's steps sit two columns deeper). Full: the step line
// alone, then every result line indented, all wrapped. A failed result styles the step `step-error`.
function stepLines(use, result, { full, width, indent = '  ' }) {
  const style = result?.isError ? 'step-error' : 'step';
  const arg = firstLine(mainArg(use.name, use.input));
  const head = `${indent}⎿ ${use.name}${arg ? ` ${arg}` : ''}`;
  if (!full) {
    const last = result ? lastLine(plainText(result.text)) : '';
    const spans = [span(head, style)];
    if (last) spans.push(span(`  ${last}`, 'dim'));
    return [clipSpans(spans, width)];
  }
  const out = wrapped('', head, style, width);
  if (result) {
    const body = String(result.text ?? '').replace(/\s+$/, '');
    if (body) out.push(...wrapped('      ', body, 'dim', width));
  }
  return out;
}

function lastLine(text) {
  const lines = String(text ?? '').split('\n').filter((l) => l.trim() !== '');
  return lines.length ? lines[lines.length - 1].trim() : '';
}

// A request drawn in the scrollback: answered, cancelled, never answered, or waiting behind the pinned one.
function requestLines(req, res, { width, taskId }) {
  const out = req.kind === 'questions' ? questionsHead(req, taskId, width) : gateHead(gateFor(req), taskId, width);
  const answer = (text, style) => out.push(...wrapped('  → ', text, style, width));
  switch (res.by) {
    case 'reply': {
      const r = res.result;
      if (req.kind === 'questions') {
        if (r.behavior === 'allow') {
          const given = isObject(r.updatedInput?.answers) ? r.updatedInput.answers : {};
          for (const q of req.questions) out.push(...wrapped('  ', `${q.question} → ${given[q.question] ?? '(no answer)'}`, 'ok', width));
        } else {
          answer(`replied in text instead: ${r.message ?? ''}`, 'dim');
        }
      } else if (r.behavior === 'allow') {
        answer('allowed', 'ok');
      } else {
        answer(r.message && r.message !== DEFAULT_REFUSAL ? `refused: ${r.message}` : 'refused', 'bad');
      }
      break;
    }
    case 'grant':
      break; // the `delivered-by-grant` note that follows is its answer
    case 'remote':
      break; // the `answered-remotely` note that follows is its answer; the tool result carries what was said
    case 'interrupt':
      answer('cancelled by the interrupt', 'dim');
      break;
    case 'never':
      answer('never answered', 'dim');
      break;
    default:
      answer('waiting: answer the request above first', 'prompt');
  }
  return out;
}

function gateHead(gate, taskId, width) {
  const out = [[span(plainText(`⚑ ${taskId} wants to use ${gate.tool}`), 'prompt')]];
  if (gate.summary) out.push(...wrapped('  ', gate.summary, null, width));
  if (gate.description) out.push(...wrapped('  ', `(${gate.description})`, 'dim', width));
  if (gate.reason) out.push(...wrapped('  ', gate.reason, 'dim', width));
  return out;
}

function questionsHead(req, taskId, width) {
  const n = req.questions.length;
  return wrapped('', `? ${taskId} asks you ${n} question${n === 1 ? '' : 's'}`, 'prompt', width);
}

// Notes pir wrote into the log (DESIGN §2.3), drawn dim. An unknown kind shows its name.
function noteLines(note, width) {
  let text;
  switch (note.note) {
    case 'delivered-by-grant':
      text = `pir allowed ${note.toolName || 'it'}: you said not to ask again for this`;
      break;
    case 'undelivered':
      text = `not delivered: the ${note.what || 'input'}${note.reason ? ` (${note.reason})` : ''}`;
      break;
    case 'exited': {
      const how = note.signal ? `signal ${note.signal}` : note.code !== undefined && note.code !== null ? `code ${note.code}` : '';
      text = `the worker exited${how ? ` (${how})` : ''}`;
      break;
    }
    case 'remote-control':
      text = note.on ? `remote control on: answer from claude.ai or the Claude app${note.url ? ` (${note.url})` : ''}` : 'remote control off';
      break;
    case 'remote-control-failed':
      text = `remote control could not be switched ${note.on ? 'on' : 'off'}: ${note.message ?? ''}`;
      break;
    case 'answered-remotely':
      text = 'answered on claude.ai';
      break;
    case 'sdk-error':
      text = `the worker's line failed: ${note.message ?? ''}`;
      break;
    // What the phone was told (reliable-notifications DESIGN §2.8), so the person can see it in `pir`.
    case 'notified':
      text = note.reminder ? 'reminder sent to your phone' : 'alert sent to your phone';
      break;
    case 'notify-failed': {
      const why = typeof note.error === 'string' && note.error !== '' ? note.error : note.status != null ? `HTTP ${note.status}` : 'unknown error';
      text = `alert not sent: ${why}`;
      break;
    }
    default:
      text = note.note;
  }
  return wrapped('· ', text, 'dim', width);
}

// ---- The permission gate (DESIGN §2.6). ----

// gateFor(request) → the gate for a pending permission request (a stream.mjs `permission` event, or the
// log's `request` entry: both carry the same fields). `a` is offered exactly when core's grantFrom
// would record a grant, so the key never promises a "don't ask again" the inbox then drops.
export function gateFor(request) {
  const tool = request.toolName ?? '';
  return {
    kind: 'permission',
    requestId: request.requestId,
    tool,
    summary: mainArg(tool, request.input),
    description: typeof request.description === 'string' ? request.description : '',
    reason: typeof request.reason === 'string' ? request.reason : '',
    canAlwaysAllow: grantFrom(request) !== null,
    confirmAllow: request.defaultToNo === true,
    armed: false,
  };
}

// gateReducer(gate, key) → { gate, send }. `send` is null or 'allow' | 'deny' | 'allow-always'.
// Enter on the empty box allows (user 2026-09-26, T18 drill: it replaced `y`, so a typed reply starting
// with "y" can no longer approve). With confirmAllow (Claude's defaultToNo) one stray key must not
// approve: the first Enter arms, a second Enter allows, any other key disarms; `a` approves too, so it
// arms the same way and a second `a` sends allow-always. `armed` records which approval is armed
// ('allow' | 'allow-always'), or false. `n` refuses in one press.
export function gateReducer(gate, key) {
  const disarmed = { ...gate, armed: false };
  const approve = (action) => {
    if (!gate.confirmAllow || gate.armed === action) return { gate: disarmed, send: action };
    return { gate: { ...gate, armed: action }, send: null };
  };
  if (key === 'n') return { gate: disarmed, send: 'deny' };
  if (key === 'enter') return approve('allow');
  if (key === 'a' && gate.canAlwaysAllow) return approve('allow-always');
  return { gate: disarmed, send: null };
}

// ---- The question-set picker (DESIGN §2.7). ----

// pickerFor(request) → the picker for a pending question set (a stream.mjs `questions` event). Every
// question ends with an "Other" line (cursor index options.length) that is itself a text field: the
// person's own answer is typed there, next to "Other:", never in the box (user 2026-09-26, T18 drill).
// `caret` is the Other text's cursor, in code points; ←/→ move it (user 2026-09-27).
export function pickerFor(request) {
  return {
    kind: 'questions',
    requestId: request.requestId,
    q: 0,
    cursor: 0,
    questions: (request.questions ?? []).map((qn) => ({ ...qn, picks: [], other: '', caret: 0 })),
  };
}

// onOther(picker) → is the cursor on the current question's Other line.
export function onOther(picker) {
  const qn = picker?.questions?.[picker.q];
  return !!qn && picker.cursor === qn.options.length;
}

// The Other text's caret, clamped to the text; a question without one (an older state) sits at the end.
function caretOf(qn) {
  const n = [...qn.other].length;
  return Number.isInteger(qn.caret) ? Math.max(0, Math.min(n, qn.caret)) : n;
}

// The answer to one question: its picked labels in option order, then the Other text, joined ", ".
function answerOf(qn) {
  const labels = qn.options.filter((_, i) => qn.picks.includes(i)).map((o) => o.label);
  const own = qn.other.trim();
  if (own) labels.push(own);
  return labels.join(', ');
}

// pickerReducer(picker, event) → { picker, send }. `send` is null or { answers }, answers keyed by
// question text. Events (user 2026-09-26, T18 drill):
//   up/down    move, wrapping through the Other line; the Other text stays when the cursor leaves it.
//   toggle     space on an option: a single-select question replaces its pick, a multi-select one ticks.
//   char {text}  typing: it lands on the Other line, moving the cursor there first if it was on an option,
//              so typed text is only ever the person's own answer (their option 1).
//   backspace  on the Other line, deletes the character before the caret.
//   left/right on the Other line, moves the caret within the text.
//   next       Enter: answers and moves on, sending on the last question. A single-select question takes
//              the line under the cursor (an option, or the Other text); a multi-select one its ticks plus
//              any Other text. With no answer it does nothing.
export function pickerReducer(picker, event) {
  const qn = picker.questions[picker.q];
  if (!qn) return { picker, send: null };
  const n = qn.options.length + 1;
  const withQuestion = (p, changes) => ({
    ...p,
    questions: p.questions.map((x, i) => (i === p.q ? { ...x, ...changes } : x)),
  });
  const advance = (p) => {
    if (!answerOf(p.questions[p.q])) return { picker, send: null };
    if (p.q < p.questions.length - 1) return { picker: { ...p, q: p.q + 1, cursor: 0 }, send: null };
    const answers = {};
    for (const x of p.questions) answers[x.question] = answerOf(x);
    return { picker: p, send: { answers } };
  };
  const other = qn.options.length;
  switch (event?.type) {
    case 'up':
      return { picker: { ...picker, cursor: (picker.cursor + n - 1) % n }, send: null };
    case 'down':
      return { picker: { ...picker, cursor: (picker.cursor + 1) % n }, send: null };
    case 'toggle': {
      if (picker.cursor === other) return pickerReducer(picker, { type: 'char', text: ' ' });
      if (qn.multiSelect) {
        const picks = qn.picks.includes(picker.cursor) ? qn.picks.filter((i) => i !== picker.cursor) : [...qn.picks, picker.cursor];
        return { picker: withQuestion(picker, { picks }), send: null };
      }
      return { picker: withQuestion(picker, { picks: [picker.cursor] }), send: null };
    }
    case 'char': {
      const text = typeof event.text === 'string' ? event.text : '';
      if (!text) return { picker, send: null };
      const chars = [...qn.other];
      // Typed from an option, the text goes at the end of what is already there.
      const at = picker.cursor === other ? caretOf(qn) : chars.length;
      chars.splice(at, 0, ...text);
      return { picker: withQuestion({ ...picker, cursor: other }, { other: chars.join(''), caret: at + [...text].length }), send: null };
    }
    case 'backspace': {
      const at = caretOf(qn);
      if (picker.cursor !== other || at === 0) return { picker, send: null };
      const chars = [...qn.other];
      chars.splice(at - 1, 1);
      return { picker: withQuestion(picker, { other: chars.join(''), caret: at - 1 }), send: null };
    }
    case 'left':
    case 'right': {
      if (picker.cursor !== other) return { picker, send: null };
      const at = caretOf(qn) + (event.type === 'left' ? -1 : 1);
      return { picker: withQuestion(picker, { caret: Math.max(0, Math.min([...qn.other].length, at)) }), send: null };
    }
    case 'next': {
      if (qn.multiSelect) return advance(picker);
      if (picker.cursor === other) return qn.other.trim() ? advance(withQuestion(picker, { picks: [] })) : { picker, send: null };
      return advance(withQuestion(picker, { picks: [picker.cursor], other: '' }));
    }
    default:
      return { picker, send: null };
  }
}

// ---- The pinned prompt, as the view paints it above the box. ----

// promptLines(prompt, { width, taskId }) → styled lines for a gate or a picker in its current state.
export function promptLines(prompt, { width = 80, taskId = 'worker' } = {}) {
  const w = Math.max(10, width | 0);
  if (prompt?.kind === 'permission') {
    const out = gateHead(prompt, taskId, w);
    let keys;
    if (prompt.armed === 'allow') keys = 'press ↵ again to allow · any other key cancels';
    else if (prompt.armed === 'allow-always') keys = 'press a again to allow and not ask again · any other key cancels';
    else keys = `↵ allow · n refuse${prompt.canAlwaysAllow ? " · a allow, don't ask again" : ''} · or type a reply to refuse with it`;
    out.push(...wrapped('  ', keys, 'prompt', w));
    return out;
  }
  if (prompt?.kind === 'questions') {
    const total = prompt.questions.length;
    const tabs = prompt.questions.map((x, i) => `[${x.header || i + 1}${answerOf(x) ? ' ✔' : ''}]`).join(' ');
    const out = wrapped('', `? ${taskId} asks you ${total} question${total === 1 ? '' : 's'}  ${tabs}`, 'prompt', w);
    const qn = prompt.questions[prompt.q];
    if (!qn) return out;
    out.push(...wrapped('  ', `${qn.question} (${qn.multiSelect ? 'pick any' : 'pick one'})`, null, w));
    qn.options.forEach((o, i) => {
      const on = qn.picks.includes(i);
      const box = qn.multiSelect ? (on ? '[x]' : '[ ]') : on ? '(•)' : '( )';
      const cursor = i === prompt.cursor ? '❯ ' : '  ';
      const head = `  ${cursor}${box} `;
      const spans = [span(`${head}${o.label}`, on ? 'ok' : i === prompt.cursor ? 'prompt' : null)];
      if (o.description) spans.push(span(`  ${o.description}`, 'dim'));
      // Wrapped, not clipped: a description is what the person decides on (user 2026-09-27).
      out.push(...wrapSpans(spans, w, { indent: head.length, keep: head.length }));
    });
    // The Other line is a text field: the typed answer sits next to "Other:", with a caret while the cursor
    // is on it (user 2026-09-26, T18 drill).
    const here = onOther(prompt);
    const own = qn.other !== '';
    const otherBox = qn.multiSelect ? (own ? '[x]' : '[ ]') : own && !qn.picks.length ? '(•)' : '( )';
    // Wrapped, not clipped, so the whole answer stays in view while it is typed (user 2026-09-27).
    const otherHead = `  ${here ? '❯ ' : '  '}${otherBox} Other: `;
    const otherSpans = [span(otherHead, own ? 'ok' : here ? 'prompt' : null)];
    if (here) {
      const chars = [...qn.other];
      const at = caretOf(qn);
      otherSpans.push(span(chars.slice(0, at).join(''), 'ok'), span('▏', 'prompt'), span(chars.slice(at).join(''), 'ok'));
    } else otherSpans.push(own ? span(qn.other, 'ok') : span('type your own answer', 'dim'));
    const otherIndent = `  ❯ ${otherBox} `.length;
    out.push(...wrapSpans(otherSpans.filter((s) => s.text !== ''), w, { indent: otherIndent, keep: otherHead.length }));
    const last = prompt.q === total - 1;
    const hint = here
      ? `type your answer here · ↵ ${last ? 'send' : 'next question'} · ↑↓ leave it`
      : qn.multiSelect
        ? `↑↓ move · space tick · ↵ ${last ? 'send answers' : 'next question'} · or just type your own answer`
        : `↑↓ move · ↵ ${last ? 'choose and send' : 'choose, next question'} · or just type your own answer`;
    out.push(...wrapped('  ', hint, 'prompt', w));
    return out;
  }
  return [];
}
