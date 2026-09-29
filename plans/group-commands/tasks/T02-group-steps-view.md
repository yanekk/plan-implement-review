# T02 — group-steps-view

**Phase:** 2 · **Depends on:** T01 · **Weight:** medium

## Goal

Let the person open and fold a group with a left click in the conversation view, brighten a group line
under the pointer, and keep their place while groups open, fold, or fill up. This wires T01's group lines
to the mouse in the one view that draws them, for every caller (build workers, helpers, the coordinator
agent, the `pir plan` planner and reviewer).

## Design sections this implements

DESIGN §2.4 (click, hover, `rowClick`, read-only, forgetting on leave), §2.5 (placement after a click),
§2.6 (Tab keeps the open set), §2.7 (signed offset on arrival), §3.2 (click row → line).

## Files

- `src/shell/conversation-view.mjs`
- `src/shell/conversation-view.test.mjs`
- `src/shell/conversation-rig.test.mjs`
- `src/shell/conversation-rig.mjs`: the `pbcopy` shim (DESIGN §5.2; `startRig` returns `shimDir` and `clipboard`), and a scenario only if `tour` cannot show a case below (add one;
  do not change `tour`'s existing steps, other tests read them)

## Interface

```js
// Inside createConversationView:
let open = new Set();          // group ids; lives as long as this view instance (§2.4)
let hoverY = null;             // view-relative row under the pointer

model(width)                   // passes { open } to buildConversation; the cache key includes the open set's
                               // version so a toggle rebuilds; a toggle rebuild is not counted as arrival (§2.7)
handleMouse(ev)
  // 'click', button 'left', on a scrollback row whose line has hit.kind === 'group':
  //    toggle open, place per §2.5, requestRender → { handled: true, rowClick: true }
  // 'move': set hoverY; requestRender if the hit under it changed → { handled: true }
  // 'wheel' and box clicks: unchanged
  // everything else (press, drag, release, other clicks): undefined
render(width)                  // paints a scrollback line with paintLine(l, w, colour, { hovered }) when its
                               // row is hoverY and it has a hit
get state                      // adds: open (array of ids), for tests
```

The click row maps to a line with `render`'s own numbers: rows 0–1 are the header, then `height` scrollback
rows showing `lines.slice(max(0, end - height), end)`. Keep those numbers from the last render rather than
recomputing them differently.

## Tests

Unit (`conversation-view.test.mjs`, synthetic `handleMouse` events as the existing wheel tests do):

- [ ] Click on a folded group line → it opens (`▾`, its steps under it); click again → folded; both return `{ handled: true, rowClick: true }`.
- [ ] Click on a message line, a running step line, the header, a blank row, the typing box's rows (still the Editor's) → no toggle; non-box ones return undefined.
- [ ] Press, drag and release anywhere, a right click on a group line → undefined, no toggle.
- [ ] Click works in a read-only view.
- [ ] Move over a group line with colour on → that row painted bold (hovered); move off → plain; no hover with colour off; no hover on a non-group line.
- [ ] Following the end (scrollBack 0), click the last group near the bottom → its steps are visible, group line still on screen (§2.5 exception).
- [ ] Scrolled up, click a group mid-screen → the clicked line is on the same row afterwards; fold it → same row again.
- [ ] Tab after opening a group → full detail, no group lines; Tab back → the group still open.
- [ ] Scrolled up, a running step's result arrives and it folds into its group → the top visible line is unchanged (§2.7).
- [ ] A new view instance for the same worker starts with every group folded.
- [ ] Existing view tests broken by T01's default change are already rewritten (T01); any still failing here is fixed to the grouped form.

## Done when

- [ ] Every test above passes, including the end-to-end ones below, and `npm test` is green.
- [ ] A click on a group line opens and folds it in the real `pir` screen; a drag across it still copies.
- [ ] No existing mouse behaviour of the view changed (wheel, box clicks, declines).

## End to end (the worker drives this)

- suite: `src/shell/conversation-rig.test.mjs` (`startRig` `tour`, `openScreen`, `mouseBytes`) · sizes: 80×24, 120×40
- [ ] Open T01's conversation while the opening steps are paced → a running `⎿` line is visible, then after it finishes the screen shows `▸ Read 1 file` and later `▸ Read 1 file, searched 1 time, ran 1 shell command, edited 1 file · 1 failed`, no leftover `⎿` lines for them.
- [ ] Click that group line → `▾` and four indented `⎿` lines, the Bash one in the error style; click again → folded.
- [ ] After the tour's `rm -rf build/` request is refused, its step's group line reads `▸ Ran 1 shell command · 1 refused`, not failed.
- [ ] Two quick clicks on it → open then folded, and the `pbcopy` shim's `clipboard.txt` was not written (no word selection).
- [ ] A drag across the group line → the text lands in the shim's `clipboard.txt`, group not toggled.
- [ ] Seatbelt: `startRig` has no `pbcopy` shim, so a copy would reach the person's real clipboard. `startRig` does not launch pir (the test passes `env` to `openScreen`/`driveScreen`), so `startRig` writes the shim into its scratch folder, as `plan-rig.mjs` does (its `shimDir`, `clipboard.txt`), and returns `shimDir` and `clipboard`; the rig command (`node src/shell/conversation-rig.mjs`) and every drag or double-click test put `shimDir` first on pir's `PATH`, so the T03 drill has it too. Never run these against the real `pbcopy`.
- [ ] Tab → full detail shows `⎿ Bash npm test` and its result lines; Tab back → grouped.
- [ ] The existing assertion that the failed step is in the scrollback (`conversation-rig.test.mjs`, "the tool steps are in the scrollback") is rewritten to the grouped form (`· 1 failed`) or an opened group.
