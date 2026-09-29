// An agent's helpers, read from its conversation log (visible-helpers DESIGN §2.1, §2.8). Pure: log
// entries in, data out; the helper line (T03), the interrupt rules (T04) and the Esc gate (T05) all read
// this one fold, so they cannot disagree about which helpers are alive.
//
// Wire facts this rests on (plan-0339 log, and the plan review's probe on Claude Code 2.1.284):
// - `system:task_started` with `task_type: 'local_agent'` starts a helper: `task_id`, `tool_use_id` (the
//   parent's Agent call), `description`, `subagent_type`, `is_backgrounded`. A background Bash job gets a
//   `task_started` too, with another task_type; it is not a helper.
// - `system:task_progress` carries the current step's `description` and `usage.tool_uses` / `duration_ms`.
// - It ends with `task_updated` (`patch.status`) and `task_notification` (`status`), in either order or
//   only one of them; the first status seen wins.

import { readEntry } from './stream.mjs';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const END_STATES = { completed: 'finished', failed: 'failed', killed: 'stopped', stopped: 'stopped' };

// helpersOf(entries) → Helper[] in start order, one per local_agent task_started seen:
//   { id, toolUseId, description, subagentType, background,
//     state: 'running' | 'finished' | 'stopped' | 'failed',
//     step, steps, durationMs, endedAt }
// `endedAt` is the index in `entries` of the first end event, null while running. A `resumed` note
// (pir-plan-command §2.14) is a new process: every helper still running then died with the old one, so it
// ends as 'stopped' at the note's index. A helper seen only in frames (a log cut mid-helper) is not listed:
// without its task_started there is nothing to name it by (DESIGN §2.8). An end event whose status is not
// one of the four is ignored rather than guessed at. A helper's own helper (nested) is not listed: its
// Agent call sits in a helper frame, and it rolls up into the outermost helper, whose line it shares
// (DESIGN §2.1). The calls are collected over the whole log first, so the order in which the CLI yields
// the inner call's frame and its task_started does not matter.
export function helpersOf(entries) {
  const helpers = [];
  const byId = new Map();
  const list = Array.isArray(entries) ? entries : [];
  const callsInHelpers = new Set();
  for (const entry of list) {
    for (const ev of readEntry(entry)) if (ev.kind === 'tool-use' && ev.helper && ev.toolUseId) callsInHelpers.add(ev.toolUseId);
  }
  list.forEach((entry, index) => {
    for (const ev of readEntry(entry)) {
      if (ev.kind === 'note' && ev.note === 'resumed') {
        for (const h of helpers) end(h, 'stopped', index);
        continue;
      }
      if (ev.kind !== 'system' || !isObject(ev.event)) continue;
      const m = ev.event;
      const id = typeof m.task_id === 'string' ? m.task_id : null;
      if (!id) continue;
      if (ev.subtype === 'task_started') {
        if (m.task_type !== 'local_agent' || byId.has(id) || callsInHelpers.has(m.tool_use_id)) continue;
        const h = {
          id,
          toolUseId: typeof m.tool_use_id === 'string' ? m.tool_use_id : '',
          description: typeof m.description === 'string' ? m.description : '',
          subagentType: typeof m.subagent_type === 'string' ? m.subagent_type : '',
          background: m.is_backgrounded === true,
          state: 'running',
          step: '',
          steps: 0,
          durationMs: null,
          endedAt: null,
        };
        byId.set(id, h);
        helpers.push(h);
        continue;
      }
      const h = byId.get(id);
      if (!h) continue;
      if (ev.subtype === 'task_progress') {
        if (typeof m.description === 'string') h.step = m.description;
        if (Number.isFinite(m.usage?.tool_uses)) h.steps = m.usage.tool_uses;
        if (Number.isFinite(m.usage?.duration_ms)) h.durationMs = m.usage.duration_ms;
      } else if (ev.subtype === 'task_updated') {
        end(h, END_STATES[m.patch?.status], index);
      } else if (ev.subtype === 'task_notification') {
        end(h, END_STATES[m.status], index);
      }
    }
  });
  return helpers;
}

function end(h, state, index) {
  if (!state || h.state !== 'running') return;
  h.state = state;
  h.endedAt = index;
}

// runningHelpers(entries) → the helpers whose state is still 'running'.
export function runningHelpers(entries) {
  return helpersOf(entries).filter((h) => h.state === 'running');
}

// helperOfFrame(helpers, parentToolUseId, entries) → the outermost Helper a frame belongs to, or null.
// A helper's own helper (nested) has frames whose parent_tool_use_id is the inner Agent call, which was
// itself made in a frame of the outer helper; climbing those tool_use frames rolls every nested frame up to
// the outermost helper, because the person asked to see the agent's helpers, not a tree (DESIGN §2.1).
export function helperOfFrame(helpers, parentToolUseId, entries) {
  if (typeof parentToolUseId !== 'string' || !parentToolUseId) return null;
  const byToolUse = new Map((Array.isArray(helpers) ? helpers : []).map((h) => [h.toolUseId, h]));
  // Each tool_use id → the parent_tool_use_id of the frame that made the call (null for the parent's own).
  const madeIn = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    for (const ev of readEntry(entry)) {
      if (ev.kind === 'tool-use' && ev.toolUseId) madeIn.set(ev.toolUseId, ev.helper ?? null);
    }
  }
  let found = null;
  const seen = new Set();
  for (let id = parentToolUseId; id && !seen.has(id); id = madeIn.get(id)) {
    seen.add(id);
    if (byToolUse.has(id)) found = byToolUse.get(id);
  }
  return found;
}

// ---- The interrupt rules (DESIGN §2.5, §2.6, §2.8). T05 wires them into the view and the send path. ----

const INTERRUPT_KEYS = new Set(['escape', 'ctrl+c-empty']);

// interruptGate(gate, key, running) → { gate, send } (DESIGN §2.5). `gate` is the view's armed state,
// null or { armed: true, helpers }; `running` is runningHelpers(entries) when the key is pressed. The
// first interrupt key with helpers running arms the warning and sends nothing; a second one sends, even
// if every helper has ended since, because the person has confirmed it. Any other key disarms and sends
// nothing, and the view then handles that key as usual (gateReducer's "any other key disarms"). Armed
// state, not a timer: the core reads no clock, and a warning left alone does nothing.
export function interruptGate(gate, key, running) {
  if (!INTERRUPT_KEYS.has(key)) return { gate: null, send: false };
  if (gate?.armed) return { gate: null, send: true };
  const helpers = Array.isArray(running) ? running : [];
  if (helpers.length === 0) return { gate: null, send: true };
  return { gate: { armed: true, helpers }, send: false };
}

// A helper's name in the warning and the note. The description is what the person saw on the helper
// line; the id stands in only for a task_started that carried none.
const nameOf = (h) => (h?.description ? h.description : String(h?.id ?? ''));

// gateWarning(gate) → the text drawn where the status line is while the warning is armed; '' when not.
export function gateWarning(gate) {
  const helpers = gate?.armed && Array.isArray(gate.helpers) ? gate.helpers : [];
  if (helpers.length === 0) return '';
  const noun = helpers.length === 1 ? 'helper' : 'helpers';
  return `esc again to interrupt · this also stops ${helpers.length} ${noun}: ${helpers.map(nameOf).join('; ')}`;
}

// stoppedByInterrupt(entries) → the helpers an interrupt stopped that no message has reported yet, in
// start order (DESIGN §2.6). A helper counts when it ended 'stopped' (killed or stopped) after an `out
// interrupt` and before the next `result`. An interrupt sent while the parent is idle gets no `result`
// of its own (§2.1), so its window runs on towards the next turn's `result`; the ends arrive within
// milliseconds of the interrupt. The person's next `out message` closes the window too: it opens a new
// turn, and a helper the agent stops itself in that turn was not stopped by the interrupt. A helper ended
// by a `resumed` note died with the old process, not by the person's interrupt, and is left out (§2.8).
// "Reported" is read off the log: the `helpersStopped` ids of any `out message` after the helper ended.
export function stoppedByInterrupt(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const inWindow = [];
  const resumedAt = new Set();
  const reported = []; // [index, ids]
  let open = false;
  list.forEach((entry, index) => {
    const raw = parsed(entry);
    if (raw?.dir === 'out' && raw.kind === 'message' && Array.isArray(raw.helpersStopped)) reported.push([index, raw.helpersStopped]);
    let here = open;
    for (const ev of readEntry(entry)) {
      if (ev.kind === 'interrupt') here = open = true;
      else if (ev.kind === 'note' && ev.note === 'resumed') resumedAt.add(index);
      else if ((ev.kind === 'result' && !ev.helper) || ev.kind === 'sent') open = false;
    }
    inWindow[index] = here;
  });
  return helpersOf(list).filter((h) => h.state === 'stopped'
    && inWindow[h.endedAt]
    && !resumedAt.has(h.endedAt)
    && !reported.some(([index, ids]) => index > h.endedAt && ids.includes(h.id)));
}

// The log keeps entries as parsed objects or as raw lines; the `helpersStopped` field on an `out
// message` is read off the entry itself, since readEntry's `sent` event does not carry it.
function parsed(entry) {
  if (typeof entry !== 'string') return isObject(entry) ? entry : null;
  try {
    const v = JSON.parse(entry);
    return isObject(v) ? v : null;
  } catch {
    return null;
  }
}

// helpersNote(helpers) → null when there is nothing to report, else the note pir puts before the
// person's next message (DESIGN §2.6). Descriptions are quoted verbatim, an inner double quote included:
// the model and the person both read it as prose, and escaping it would only add noise.
export function helpersNote(helpers) {
  const list = Array.isArray(helpers) ? helpers : [];
  if (list.length === 0) return null;
  const names = list.map((h) => `"${nameOf(h)}"`).join(', ');
  return list.length === 1
    ? `[pir] Before this message, the person's interrupt stopped your helper: ${names}. It will not report back. Start it again or do the work yourself if it is still needed.`
    : `[pir] Before this message, the person's interrupt stopped your helpers: ${names}. They will not report back. Start them again or do the work yourself if it is still needed.`;
}
