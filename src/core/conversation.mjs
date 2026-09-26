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

// buildConversation(entries, { full, width, taskId, readOnly }) → { lines, pinned }.
// `pinned` is the oldest pending request as a fresh prompt (gateFor / pickerFor), kept out of `lines`;
// the view keeps its own prompt state and paints it with promptLines. Once answered, a request is drawn
// in `lines` where it was asked, with its answer. A read-only view (a worker no longer live) pins
// nothing and shows an unanswered request as never answered.
export function buildConversation(entries, { full = false, width = 80, taskId = 'worker', readOnly = false } = {}) {
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
  for (const entry of list) {
    for (const ev of readEntry(entry)) {
      if (ev.kind === 'tool-result') results.set(ev.toolUseId, ev);
      else if (ev.kind === 'reply') answers.set(ev.requestId, { result: isObject(entry.result) ? entry.result : {}, from: ev.from });
      else if (ev.kind === 'note' && ev.note === 'delivered-by-grant' && typeof ev.requestId === 'string') byGrant.add(ev.requestId);
    }
  }
  const pending = workerActivity(list).pending;
  const pendingIds = new Set(pending.map((r) => r.requestId));
  const pinnedRequest = !readOnly && pending.length ? pending[0] : null;
  // A request with no reply, no grant and no longer pending was cancelled by an interrupt (stream.mjs).
  const resolution = (id) => {
    if (answers.has(id)) return { by: 'reply', ...answers.get(id) };
    if (byGrant.has(id)) return { by: 'grant' };
    if (pendingIds.has(id)) return { by: readOnly ? 'never' : 'waiting' };
    return { by: 'interrupt' };
  };

  // Pass 2: the scrollback, oldest first.
  const lines = [];
  let interrupted = false; // an interrupt since the last result: its error_during_execution is expected
  for (const entry of list) {
    for (const ev of readEntry(entry)) {
      switch (ev.kind) {
        case 'sent': {
          const { prefix, style } = senderPrefix(ev.from, taskId);
          lines.push(...wrapped(prefix, ev.text, style, w));
          break;
        }
        case 'text': {
          if (!ev.text.trim() || ev.synthetic) break; // a skill body Claude injected: hundreds of lines nobody said
          if (ev.role === 'assistant') lines.push(...wrapped(`${taskId} ▸ `, ev.text, 'worker', w));
          else lines.push(...wrapped('  ', ev.text, 'dim', w)); // e.g. `[Request interrupted by user]`
          break;
        }
        case 'tool-use':
          lines.push(...stepLines(ev, results.get(ev.toolUseId), { full, width: w }));
          break;
        case 'permission':
        case 'questions':
          if (pinnedRequest && ev.requestId === pinnedRequest.requestId) break;
          lines.push(...requestLines(ev, resolution(ev.requestId), { width: w, taskId }));
          break;
        case 'interrupt': {
          const { prefix, style } = senderPrefix(ev.from || 'person', taskId);
          lines.push([span(`${prefix}⎋ interrupted the worker`, style)]);
          interrupted = true;
          break;
        }
        case 'result': {
          const expected = interrupted && ev.subtype === 'error_during_execution';
          interrupted = false;
          if (expected || (!ev.isError && ev.subtype === 'success')) break;
          lines.push(...wrapped('✕ ', `the turn failed (${ev.subtype || 'error'})${ev.text ? `: ${ev.text}` : ''}`, 'bad', w));
          break;
        }
        case 'note':
          lines.push(...noteLines(ev, w));
          break;
        case 'raw':
          lines.push([span('· an unreadable log line', 'dim')]);
          break;
        default:
          // init, system (rate limits, thinking tokens, task events), tool-result (drawn on its step).
          break;
      }
    }
  }

  let pinned = null;
  if (pinnedRequest) pinned = pinnedRequest.kind === 'questions' ? pickerFor(pinnedRequest) : gateFor(pinnedRequest);
  return { lines, pinned };
}

// One tool use. Default: exactly one line, `⎿ <Tool> <main arg>  <last result line>`, clipped to width.
// Full: the step line alone, then every result line indented, all wrapped. A failed result styles the
// step `step-error`.
function stepLines(use, result, { full, width }) {
  const style = result?.isError ? 'step-error' : 'step';
  const arg = firstLine(mainArg(use.name, use.input));
  const head = `  ⎿ ${use.name}${arg ? ` ${arg}` : ''}`;
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
    case 'sdk-error':
      text = `the worker's line failed: ${note.message ?? ''}`;
      break;
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
// question gets a final "Other" line (cursor index options.length) that takes typed text.
export function pickerFor(request) {
  return {
    kind: 'questions',
    requestId: request.requestId,
    q: 0,
    cursor: 0,
    typingOther: false,
    questions: (request.questions ?? []).map((qn) => ({ ...qn, picks: [], other: '' })),
  };
}

// The answer to one question: its picked labels in option order, then the Other text, joined ", ".
function answerOf(qn) {
  const labels = qn.options.filter((_, i) => qn.picks.includes(i)).map((o) => o.label);
  if (qn.other) labels.push(qn.other);
  return labels.join(', ');
}

// pickerReducer(picker, event) → { picker, send }. `send` is null or { answers }, answers keyed by
// question text. Events: up/down move (wrapping), toggle picks (single-select replaces, multi-select
// ticks; on Other it sets `typingOther` so the view takes the box's text), other {text} sets the Other
// answer (a single-select's picks give way to it), next moves on, and on the last question sends. next
// on an unanswered question does nothing. On a single-select question next first picks the line under the
// cursor, so one Enter answers it (user 2026-09-26, T18 drill); on its Other line with no text yet, next
// starts the typing instead.
export function pickerReducer(picker, event) {
  const qn = picker.questions[picker.q];
  if (!qn) return { picker, send: null };
  const n = qn.options.length + 1;
  const withQuestion = (changes, rest = {}) => ({
    ...picker,
    ...rest,
    questions: picker.questions.map((x, i) => (i === picker.q ? { ...x, ...changes } : x)),
  });
  switch (event?.type) {
    case 'up':
      return { picker: { ...picker, cursor: (picker.cursor + n - 1) % n, typingOther: false }, send: null };
    case 'down':
      return { picker: { ...picker, cursor: (picker.cursor + 1) % n, typingOther: false }, send: null };
    case 'toggle': {
      if (picker.cursor === qn.options.length) return { picker: { ...picker, typingOther: true }, send: null };
      if (qn.multiSelect) {
        const picks = qn.picks.includes(picker.cursor) ? qn.picks.filter((i) => i !== picker.cursor) : [...qn.picks, picker.cursor];
        return { picker: withQuestion({ picks }), send: null };
      }
      return { picker: withQuestion({ picks: [picker.cursor], other: '' }), send: null };
    }
    case 'other': {
      const text = typeof event.text === 'string' ? event.text.trim() : '';
      const changes = qn.multiSelect || !text ? { other: text } : { other: text, picks: [] };
      return { picker: withQuestion(changes, { typingOther: false }), send: null };
    }
    case 'next': {
      if (!qn.multiSelect) {
        if (picker.cursor < qn.options.length) picker = withQuestion({ picks: [picker.cursor], other: '' });
        else if (!qn.other) return { picker: { ...picker, typingOther: true }, send: null };
      }
      if (!answerOf(picker.questions[picker.q])) return { picker, send: null };
      if (picker.q < picker.questions.length - 1) {
        return { picker: { ...picker, q: picker.q + 1, cursor: 0, typingOther: false }, send: null };
      }
      const answers = {};
      for (const x of picker.questions) answers[x.question] = answerOf(x);
      return { picker, send: { answers } };
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
    const opts = [...qn.options, { label: 'Other', description: 'type your own answer in the box' }];
    opts.forEach((o, i) => {
      const isOther = i === qn.options.length;
      const on = isOther ? qn.other !== '' : qn.picks.includes(i);
      const box = qn.multiSelect ? (on ? '[x]' : '[ ]') : on ? '(•)' : '( )';
      const cursor = i === prompt.cursor ? '❯ ' : '  ';
      const label = isOther && qn.other ? `Other: ${qn.other}` : o.label;
      const spans = [span(`  ${cursor}${box} ${label}`, on ? 'ok' : i === prompt.cursor ? 'prompt' : null)];
      if (o.description) spans.push(span(`  ${o.description}`, 'dim'));
      out.push(clipSpans(spans, w));
    });
    const last = prompt.q === total - 1;
    const hint = prompt.typingOther
      ? 'type your answer in the box, then ↵'
      : qn.multiSelect
        ? `↑↓ move · space tick · ↵ ${last ? 'send answers' : 'next question'} · or type a reply to explain instead`
        : `↑↓ move · ↵ ${last ? 'choose and send' : 'choose, next question'} · or type a reply to explain instead`;
    out.push(...wrapped('  ', hint, 'prompt', w));
    return out;
  }
  return [];
}
