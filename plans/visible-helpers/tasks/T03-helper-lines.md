# T03 — helper-lines

**Phase:** 2 · **Depends on:** T01, T02 · **Weight:** medium

## Goal

Draw each helper as one updating line in the conversation, move the helper's own steps and words out of
the default view into the labelled Tab detail view, name the helper on a permission request it makes,
and name running helpers in the status line above the box. This is the "see my helpers" half of the brief.

## Design sections this implements

DESIGN §2.2, §2.3, §2.4, §2.8.

## Files

- `src/core/conversation.mjs`: `buildConversation` reads `helpersOf` (T01); the `local_agent` branch of
  the background lines becomes the helper line; frames with `helper` are skipped by default and
  labelled in `full`; a background command whose `task_started.tool_use_id` is a helper frame's tool_use
  is the helper's (DESIGN §2.3); `gateFor` and `pickerFor` carry the helper's name from `agentId`, and
  `gateHead`, `questionsHead`, `requestLines` and `promptLines` draw it.
- `src/core/conversation.test.mjs`.
- `src/shell/worker-proc.mjs`: `canUseTool` logs `agentId: opts.agentID` when it is a string.
- `src/shell/worker-proc.test.mjs`.
- `src/shell/conversation-view.mjs`: the status line above the box names running helpers (DESIGN §2.2),
  from `buildConversation`'s `helpers`.
- `src/shell/conversation-view.test.mjs` or `src/shell/conversation-rig.test.mjs`: the end-to-end tests.

## Interface

```js
// conversation.mjs (existing export, same signature)
buildConversation(entries, { full, width, taskId, readOnly }) → { lines, pinned, background }
//   `background` keeps counting running background commands and monitors the parent started, and no
//   longer counts helpers or a helper's own background commands.
//   New: returns `helpers: runningHelpers(entries).length` for the view's status line.

// Status line above the box (DESIGN §2.2), conversation-view.mjs:
//   idle:  `◌ ${n} helper(s) running[ · ${b} running in the background]`, or today's `◌ ${b} running in the background`
//   busy:  `● working…[ · ${n} helper(s) running][ · ${b} running in the background]`

// Helper line text (DESIGN §2.2), one line, clipped to width:
//   running:  `  ↳ helper · ${description} · ${step || 'starting'} · ${steps} steps[ · ${time}]`
//   ended:    `  ↳ helper ${finished|stopped|failed} · ${description} · ${steps} steps[ · ${time}]`
//   time: `${s}s` under a minute, `${m}m ${s}s` from one minute; omitted when durationMs is null.

// Request head for a helper's request (DESIGN §2.4): the subject `${taskId}` becomes
//   `helper "${description}"`, or `a helper` when agentId matches no helper:
//   `⚑ helper "${description}" wants to use ${tool}` · `? helper "${description}" asks you ${n} question(s)`
```

## Tests

- [ ] Helper line for each state, with and without progress, the minute boundary (59 s, 60 s), clipping
      at 40 columns.
- [ ] On `helper-sample.ndjson`: default view has exactly one helper line and none of the helper's step
      lines or its "Now notify.mjs endAlert…" sentence; the parent's own lines are all there in order.
- [ ] Same log in `full`: the helper's steps drawn with `helper ⎿` and its text with `helper ▸`, in log
      order.
- [ ] A foreground helper gets the same line under its Agent step line.
- [ ] Background Bash and Monitor tasks the parent started keep their two existing lines; one a helper
      started (its `tool_use_id` is a helper frame's tool_use) has none by default and `helper ↳` lines
      in `full`, and is not in `background`.
- [ ] Status line: idle with 2 helpers → `◌ 2 helpers running`; busy with 1 → `● working… · 1 helper
      running`; a helper and a background command → both parts; no helper → today's text.
- [ ] A permission request with a known `agentId`: pinned gate head (`promptLines`) and answered
      scrollback both read `⚑ helper "…" wants to use …`; a question set likewise `? helper "…" asks you
      …`; unknown `agentId` reads `a helper`; no `agentId` reads as today.
- [ ] `worker-proc`: a `canUseTool` call with `opts.agentID` logs `agentId`; without it, no field.
- [ ] `boundary.test.mjs` still passes.

## Done when

- [ ] Every test above passes in `npm test`, including the end-to-end cases below.
- [ ] In the rig's `helpers` scenario the default view shows one line per helper and no helper step
      lines; Tab shows them labelled.
- [ ] A helper's permission prompt names the helper.
- [ ] While helpers run and the parent is idle, the status line reads `◌ N helper(s) running`.

## End to end (the worker drives this)

- suite: `conversation-rig.test.mjs` pty driver, scenario `helpers` (T02) · sizes: 80×24, 120×40
- [ ] Open the conversation → two helper lines; A's step text and step count change on a later frame.
- [ ] After the parent's `result`, with A still running → the status line reads `◌ 1 helper running`.
- [ ] B ends → its line reads `helper finished · Check the tests · …`.
- [ ] No line of the helpers' own tool steps in the default view; Tab → they appear prefixed `helper`.
- [ ] A's permission request is pinned with `⚑ helper "Survey the code" wants to use …`; Enter allows it.
