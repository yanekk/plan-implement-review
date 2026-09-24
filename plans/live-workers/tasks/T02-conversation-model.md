# T02 — conversation-model

**Phase:** 1 · **Depends on:** T01 · **Weight:** medium

## Goal

Turn a worker's conversation log into the styled lines the conversation view paints, and model the two
interactive prompts, the permission gate and the question-set picker, as pure state with reducers. The
view in T13 then only paints lines and routes keys; every rule about what the person sees is here and
tested.

## Design sections this implements

DESIGN §2.3, §2.6, §2.7, §2.11 (conversation view content, one line per step, marking by sender).

## Files

- `src/core/conversation.mjs` (new), `src/core/conversation.test.mjs` (new)

## Interface

```js
// Styled lines as elsewhere in pir: arrays of { text, style } spans (render.mjs's convention).
buildConversation(entries, { full = false, width, taskId, readOnly = false }) → {
  lines: [[span…]…],      // the scrollback, oldest first
  pinned: Prompt | null,  // the pending request, drawn above the box
}
// Styles: 'pir', 'person', 'worker', 'step', 'step-error', 'dim', 'prompt', 'ok', 'bad'.
// Default (full=false): one line per tool use: `⎿ <Tool> <main arg>  <last result line>`, truncated to width.
// full=true: the step line plus every result line, indented. Worker text is wrapped, never truncated.
// Notes (undelivered, delivered-by-grant, exited) render as dim lines.

// Permission gate
gateFor(request) → { kind:'permission', requestId, tool, summary, reason, canAlwaysAllow }
// Question-set picker
pickerFor(request) → { kind:'questions', requestId, q: 0, cursor: 0, questions:[{…, picks:[], other:''}] }
pickerReducer(picker, event) → { picker, send: null | { answers } }
//   event: {type:'up'|'down'|'toggle'|'next'} | {type:'other', text}
//   'toggle' on a single-select question replaces the pick; on "Other" it asks for text (state flag).
//   'next' with no answer on the current question is a no-op; on the last question it returns send.
```

## Tests

- [ ] pir, person and worker messages each carry their own style and prefix
- [ ] one tool use renders as exactly one line by default, regardless of result length
- [ ] a failing tool result styles the step line `step-error`
- [ ] full mode shows every result line; toggling changes nothing else
- [ ] a pending permission appears as `pinned`, not in `lines`; once answered it moves into `lines` with the answer
- [ ] `canAlwaysAllow` is false when the request has no `addRules` suggestion
- [ ] picker: single-select replace, multi-select toggle, Other with text, next/submit, empty-answer no-op
- [ ] submit builds `answers` keyed by question text, multi labels in option order joined `", "`
- [ ] `raw` and `system` entries never crash the builder; unknown notes render dim
- [ ] width truncation never splits a surrogate pair or a wide character (use the same width helper as pir-tui)

## Done when

- [ ] `npm test` green with the tests above
- [ ] T01's committed sample, fed through `buildConversation`, gives one line per step and every message
- [ ] nothing in the module reads a clock or a file
