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
// one of the four is ignored rather than guessed at.
export function helpersOf(entries) {
  const helpers = [];
  const byId = new Map();
  const list = Array.isArray(entries) ? entries : [];
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
        if (m.task_type !== 'local_agent' || byId.has(id)) continue;
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
