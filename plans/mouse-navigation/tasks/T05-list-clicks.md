# T05 — list-clicks

**Phase:** 2 · **Depends on:** T02, T03, T04 · **Weight:** heavy

## Goal

Wire the mouse into the dashboard's lists: a click on a run, task or step opens it; the row under the
pointer is highlighted; the wheel moves the selection. This is where the hits (T02), the hover paint (T03)
and the live mouse (T04) meet `runTui`, and where the list view hands its box's clicks to the Editor so
the caret and the `@repo` pop-up take clicks too.

## Design sections this implements

DESIGN §2.1, §2.2, §2.3 (lists), §2.4, §2.6, §3.2, §3.5.

## Files

- `src/shell/pir-tui.mjs` — `runTui`: `onMouse`, `hoverY`, a shared `dispatch(event)` factored out of `onData`'s reducer tail
- `src/shell/list-view.mjs` — `handleMouse`, `update({ hoverY })`, `onListMouse` option
- `src/shell/pir-tui.test.mjs`, `src/shell/list-view.test.mjs`, `src/shell/plan-rig.test.mjs`

## Interface

```
runTui:
  dispatch(event)   // the reducer + selectedKey/selectedTask pinning + act() tail onData runs today,
                    // shared so a click and a key cannot drift apart
  onMouse(ev):      // painted frames (live view, steps); the list view calls it via onListMouse
    move  → hoverY = ev.y; repaint only if hitAt(frame, y) changed; returns { handled: true, render: false }
    click, left, hitAt(frame, ev.y) → dispatch({ type: 'select', index }) then dispatch({ type: 'open' })
    wheel → dispatch({ type: wheelDelta < 0 ? 'up' : 'down' }), once per event
    landing screen (ui.openStep), worker view, anything else → undefined
    press / drag / release → undefined, always (keeps text selection, DESIGN §3.2)

createListView({ …, onListMouse })
  handleMouse(ev): ev.y inside the box rows → editor.handleMouse({ ...ev, y: ev.y - boxTop });
                   else → onListMouse(ev) with the list block's frame, so hitAt works on it
  update({ hoverY })  // paints the hovered list row via paintLine's hovered option
```

The last frame painted is kept (by `runTui` for painted frames, by the list view for its block) so a
click reads the same lines the person sees.

## Tests

- [ ] fake terminal: click on run row i opens run i (ui.view 'watch', openKey of row i); sel is i after ←
- [ ] click on the header, a `↑ n more` marker, the counts line, the hint line → nothing changes
- [ ] click on a task row with a worker opens its conversation; without one, the no-worker note
- [ ] click on a step row under the go question opens the step, and does not start the build
- [ ] click cancels an armed Ctrl+S (armed null after); a pointer move does not
- [ ] move over row i then row j: row j painted hovered, row i not; a move within one row does not repaint
- [ ] wheel down twice in the list → sel +2; in the live view → taskSel +2; on the landing screen → nothing
- [ ] list view: a click inside the box moves the Editor caret; a click on a pop-up entry picks it
- [ ] list view with typed text: click a run, ←, the text is still in the box
- [ ] every existing key test passes unchanged

## Done when

- [ ] Click, hover and wheel behave as DESIGN §2.1–§2.3 on the list, live view and steps view.
- [ ] Box clicks reach the Editor, and typed text survives a click-open and ←.
- [ ] The end-to-end cases below and `npm test` are green.

## End to end (the worker drives this)

- suite: `plan-rig.test.mjs` with T01's `mouseBytes` and `boldAt` · sizes: 80×24, 120×40, 80×12
- [ ] click the second run's row → its live view shows; ← → the list, second row selected
- [ ] move the pointer over a run row → that row's text cells are bold, the others not
- [ ] 80×12 with more runs than fit: wheel down past the window → the list scrolls, `↑ n more` appears
- [ ] in a build's live view, click a task with a worker → its conversation shows
- [ ] Ctrl+S, then a click on another run → no `⚠` line remains, nothing stopped
