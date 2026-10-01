# T06 — bang-view

**Phase:** 2 · **Depends on:** T02, T03 · **Weight:** heavy

## Goal

What the person sees and does with `!` in the conversation view: the command mode, the running command's
status line, the command block in the history, Esc and Ctrl+C stopping the command, and the refusals,
in every session's conversation.

## Design sections this implements

DESIGN §2.1, §2.2 (one at a time), §2.4 (keys), §2.8 (except the hand request's pin). Mock:
`prototype/index.html` tabs 1–3 (non-binding).

## Files

- `src/core/conversation.mjs` and test — the command block in `buildConversation` (grouped: last 12
  lines and the `… {n} earlier lines · Tab shows all` line; full detail: all), the end line, hiding the
  `shell`-tagged sent message, the status part `● running your command · {elapsed} · esc stops it`.
- `src/shell/conversation-view.mjs` and test — mode from the text, the `shell` style on the box border and
  `!`, the hint line, submit through `parseBang`, Esc/Ctrl+C → `shell-stop` while `activity.shell` is set,
  the local `busy` refusal, a `!` while a permission is pinned does not refuse it.
- `src/shell/palette.mjs` — a `shell` style in both palettes (and none under `NO_COLOR`, where the `!`
  alone marks the mode).
- `src/shell/conversation-rig-helpers.mjs`, `conversation-rig-{60x20,80x24,120x40}.test.mjs` — the end to
  end tests below, on T03's `bang` scenario.

## Tests

- [ ] `buildConversation`: a finished block, a running block, a stopped one, a clipped one, the 12-line
      fold, full detail, the end line for each `sent` value, the hidden sent message.
- [ ] view unit: typing `!` sets the mode; backspace over it clears it; Enter with `!` alone sends
      nothing; Enter with `! ls` drops `{kind:'shell', command:'ls'}`; Esc with a command running drops
      `shell-stop` and not `interrupt`; Esc with none interrupts as before; the helper warning is not
      shown when a command is running; a second `!` is refused with the status text.

## Done when

- [ ] The end to end tests below pass at all three sizes in `npm test`.
- [ ] Every existing conversation-rig and conversation-view test still passes.

## End to end (the worker drives this)

- suite: `conversation-rig-{60x20,80x24,120x40}.test.mjs` on the `bang` scenario · sizes: 60×20, 80×24, 120×40
- [ ] type `!` → the box shows the `!` in the shell style and the hint reads `! command`.
- [ ] `! printf 'one\ntwo\n'` ↵ → `you ! printf…`, `one`, `two`, `✓ exit 0 · 0s · sent to T01`, then the fake's reply line.
- [ ] `! sleep 30` ↵ → status `● running your command`; Esc → `✗ stopped by you`; the worker was not interrupted (`rig.received` holds no interrupt).
- [ ] `! seq 1 200` ↵ → 12 lines and `… 188 earlier lines · Tab shows all`; Tab → all 200 visible by scrolling.
- [ ] a second `!` while `sleep` runs → `a command is already running · esc stops it`.
- [ ] with the run stopped (index record not running) → the `not running` refusal and the text stays in the box.
