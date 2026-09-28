# T06 — conversation-wheel

**Phase:** 2 · **Depends on:** T04 · **Weight:** light

## Goal

In a worker's conversation, the wheel scrolls the history three lines a notch and a click in the typing
box moves the caret. The conversation view is a mounted component, so T04's root already forwards mouse
events to it; this task gives it, and the reviewer's head-line wrapper around it, a `handleMouse`.

## Design sections this implements

DESIGN §2.3 (conversation), §2.4, §2.6.

## Files

- `src/shell/conversation-view.mjs` — `handleMouse`
- `src/shell/pir-tui.mjs` — `withHeadLine` forwards `handleMouse` with `y - 1`
- `src/shell/conversation-view.test.mjs`, `src/shell/conversation-rig.test.mjs`

## Interface

```
conversationView.handleMouse(ev)
  wheel → scroll(-ev.wheelDelta)   // wheelDelta is ±3 per notch (T04's wheelScrollLines); up scrolls back
          → { handled: true }
  ev.y inside the Editor's rows (live worker only) → editor.handleMouse({ ...ev, y: ev.y - editorTop })
  anything else → undefined        // press/drag/release stay pi-tui's selection; the picker and gate take no clicks
withHeadLine: handleMouse(ev) → ev.y === 0 ? undefined : inner.handleMouse?.({ ...ev, y: ev.y - 1 })
```

## Tests

- [ ] wheel up once → scrolled back 3 lines, the `↓ 3 more below` hint shows; wheel down returns to the end
- [ ] wheel down at the end stays at the end; wheel up at the top stays at the top
- [ ] read-only view: the wheel scrolls; there is no box to click
- [ ] the coordinator agent's conversation (`openWorker.taskId 'coordinator'`) scrolls the same way
- [ ] a click in the box moves the caret; a click on the scrollback, the picker or the gate changes nothing
- [ ] withHeadLine: a wheel on its head line is ignored; one below it reaches the inner view shifted by one

## Done when

- [ ] The wheel scrolls the conversation as PgUp/PgDn do, three lines a notch, in live, read-only and followed views.
- [ ] A click in the box moves the caret; the picker and gate stay keyboard-only.
- [ ] The end-to-end case below and `npm test` are green.

## End to end (the worker drives this)

- suite: `conversation-rig.test.mjs` (the tour scenario) · sizes: 80×24, 120×40
- [ ] open a worker with more history than fits, wheel up twice → `↓ 6 more below` in the hint and earlier lines visible
- [ ] wheel down twice → back at the end, the hint without `more below`
