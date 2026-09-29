# T03 — helper-lines

**Phase:** 2 · **Depends on:** T01, T02 · **Weight:** medium

## Goal

Draw each helper as one updating line in the conversation, move the helper's own steps and words out of
the default view into the labelled Tab detail view, and name the helper on a permission request it
makes. This is the "see my helpers" half of the brief.

## Design sections this implements

DESIGN §2.2, §2.3, §2.4, §2.8.

## Files

- `src/core/conversation.mjs`: `buildConversation` reads `helpersOf` (T01); the `local_agent` branch of
  the background lines becomes the helper line; frames with `helper` are skipped by default and
  labelled in `full`; `gateHead`, `questionsHead` and `requestLines` take the helper from `agentId`.
- `src/core/conversation.test.mjs`.
- `src/shell/worker-proc.mjs`: `canUseTool` logs `agentId: opts.agentID` when it is a string.
- `src/shell/worker-proc.test.mjs`.
- `src/shell/conversation-view.test.mjs` or `src/shell/conversation-rig.test.mjs`: the end-to-end tests.

## Interface

```js
// conversation.mjs (existing export, same signature)
buildConversation(entries, { full, width, taskId, readOnly }) → { lines, pinned, background }
//   `background` keeps counting running background commands and monitors, and no longer counts helpers.
//   New: returns `helpers: runningHelpers(entries).length` for the view.

// Helper line text (DESIGN §2.2), one line, clipped to width:
//   running:  `  ↳ helper · ${description} · ${step || 'starting'} · ${steps} steps[ · ${time}]`
//   ended:    `  ↳ helper ${finished|stopped|failed} · ${description} · ${steps} steps[ · ${time}]`
//   time: `${s}s` under a minute, `${m}m ${s}s` from one minute; omitted when durationMs is null.

// Request head for a helper's request (DESIGN §2.4):
//   `? helper "${description}" asks …` | `? a helper asks …` (agentId unknown), in place of `? ${taskId} asks …`
```

## Tests

- [ ] Helper line for each state, with and without progress, the minute boundary (59 s, 60 s), clipping
      at 40 columns.
- [ ] On `helper-sample.ndjson`: default view has exactly one helper line and none of the helper's step
      lines or its "Now notify.mjs endAlert…" sentence; the parent's own lines are all there in order.
- [ ] Same log in `full`: the helper's steps drawn with `helper ⎿` and its text with `helper ▸`, in log
      order.
- [ ] A foreground helper gets the same line under its Agent step line.
- [ ] Background Bash and Monitor tasks keep their two existing lines.
- [ ] A permission request with a known `agentId`: pinned gate head and answered scrollback both name
      the helper; unknown `agentId` reads `a helper`; no `agentId` reads as today.
- [ ] `worker-proc`: a `canUseTool` call with `opts.agentID` logs `agentId`; without it, no field.
- [ ] `boundary.test.mjs` still passes.

## Done when

- [ ] Every test above passes in `npm test`, including the end-to-end cases below.
- [ ] In the rig's `helpers` scenario the default view shows one line per helper and no helper step
      lines; Tab shows them labelled.
- [ ] A helper's permission prompt names the helper.

## End to end (the worker drives this)

- suite: `conversation-rig.test.mjs` pty driver, scenario `helpers` (T02) · sizes: 80×24, 120×40
- [ ] Open the conversation → two helper lines; A's step text and step count change on a later frame.
- [ ] B ends → its line reads `helper finished · Check the tests · …`.
- [ ] No line of the helpers' own tool steps in the default view; Tab → they appear prefixed `helper`.
- [ ] A's permission request is pinned with `? helper "Survey the code" asks …`; Enter allows it.
