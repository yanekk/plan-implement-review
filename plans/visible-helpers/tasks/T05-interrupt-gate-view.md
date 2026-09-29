# T05 — interrupt-gate-view

**Phase:** 2 · **Depends on:** T02, T03, T04 · **Weight:** medium

## Goal

Wire T04's rules into the running program: the conversation view warns before an interrupt that would
stop helpers, and the person's next message carries the note naming the helpers an interrupt stopped,
from the view through the drop, the inbox and the platform to the worker, which logs it and sends it to
the model. The conversation then draws the note under the person's message.

## Design sections this implements

DESIGN §2.5, §2.6, §3.3.

## Files

- `src/shell/conversation-view.mjs`: Esc and Ctrl+C-on-empty go through `interruptGate`; the armed
  warning is drawn in the status line (`gateWarning`, style `prompt`); `submit` of a typed message adds
  `preface` and `helpersStopped` from `stoppedByInterrupt` / `helpersNote`.
- `src/shell/person-inbox.mjs`: a `message` drop passes `preface` and `helpersStopped` to
  `platform.send`.
- `src/shell/platform.mjs`, `src/shell/plan-run.mjs` (its platform `send`), `src/shell/coordinator-agent.mjs`
  (its `send` wrapper): pass the two options through.
- `src/shell/worker-proc.mjs`: `send(text, { from, preface, helpersStopped })` logs
  `{ dir: 'out', from, kind: 'message', text, preface?, helpersStopped? }` and queues
  `preface + '\n\n' + text` when `preface` is set.
- `src/core/stream.mjs`: the `sent` event carries `preface` and `helpersStopped` when present.
- `src/core/conversation.mjs`: after a `sent` line with `preface`, a `pir ▸ ` line with the preface.
- Tests beside each file, and the end-to-end tests.

## Interface

```js
// drop (conversation-view → person-inbox), a typed message:
{ to, kind: 'message', text, preface?: string, helpersStopped?: string[] }
// platform.send(id, text, { from, preface, helpersStopped }) → { ok }
// worker.send(text, { from, preface, helpersStopped }) → boolean
// log entry: { t, dir: 'out', from: 'person', kind: 'message', text, preface, helpersStopped }
// to the model: `${preface}\n\n${text}`
```

A drop from an older `pir` with neither field behaves exactly as today.

## Tests

- [ ] View: Esc with no helper running sends `interrupt` at once (unchanged).
- [ ] View: Esc with a helper running sends nothing and shows the warning; Esc again sends `interrupt`.
- [ ] View: armed, then a typed character: warning gone, character in the box, nothing sent.
- [ ] View: Ctrl+C on an empty box behaves as Esc; Ctrl+C with text still clears the box.
- [ ] View: armed with a question pinned, Esc again: interrupt sent (the question is cancelled as today).
- [ ] View: after an interrupt that stopped a helper, submitting "continue" drops `preface` and
      `helpersStopped`; a second message drops neither.
- [ ] View: a permission refusal with text and question answers never carry the fields.
- [ ] Inbox, platform, plan-run, coordinator-agent: the options reach `worker.send`.
- [ ] worker-proc: the logged entry has `text` unchanged plus both fields; the queued user message is
      preface, blank line, text; without `preface` the message is the text alone.
- [ ] conversation.mjs: `you ▸ continue` then `pir ▸ [pir] Before this message…`.

## Done when

- [ ] Every test above passes in `npm test`, including the end-to-end cases below.
- [ ] In the rig, the person sees the warning before the interrupt and the note under their next message,
      and the fake received the preface before the text.

## End to end (the worker drives this)

- suite: `conversation-rig.test.mjs` pty driver, scenario `helpers` (T02) · sizes: 80×24, 120×40
- [ ] While helper A runs, Esc → the status line reads `esc again to interrupt · this also stops 1 helper: Survey the code`
      (B has finished by then); nothing sent (the fake's received file has no interrupt).
- [ ] Type `x` → warning gone, `x` in the box.
- [ ] Clear, Esc, Esc → `you ▸ ⎋ interrupted the worker`; A's line reads `helper stopped`.
- [ ] Type `continue`, Enter → `you ▸ continue` then the `pir ▸` note naming "Survey the code"; the fake's
      received file shows the note, a blank line, then `continue`.
- [ ] Type `again`, Enter → no note.
