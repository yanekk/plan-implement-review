# T07 — hand-view

**Phase:** 2 · **Depends on:** T05, T06 · **Weight:** medium

## Goal

The handed command as the person meets it: pinned above the box with run, edit and decline, the typed
reply that declines, the scrollback line once it is answered, and the row in the live view reading
`asking you · run a command`.

## Design sections this implements

DESIGN §2.6 (the pin and its keys), §2.7 (row), §2.8 (scrollback). Mock: `prototype/index.html` tabs 4–5.

## Files

- `src/core/person-input.mjs` and test — `grantFrom` null for `HAND_TOOL` (so `a` is never offered and
  no grant covers it).
- `src/core/conversation.mjs` and test — its pending-request collection (`ev.kind === 'permission' ||
  'questions'`) takes `'command'` too; `handGateFor(request)`, `handReducer(gate, key)` and `promptLines` for it; pin it
  for a pending `command` request; the answered
  form in the scrollback (`! T05 asked you to run: …`, `· declined`, `· declined: {text}`).
- `src/shell/conversation-view.mjs` and test — route ↵/e/n through `handReducer` while the box is empty;
  `e` sets the box to `! {command}`; a `!` line while a hand request is pinned carries its `requestId`; a
  typed non-`!` reply sends the deny with text.
- `src/shell/conversation-rig-helpers.mjs`, the three size files — the end to end tests below.

## Interface

```js
handGateFor(request) → { kind:'command', requestId, command, reason, helper }
handReducer(gate, key) → null | { send: { kind:'shell', command, requestId } }
                              | { send: { kind:'permission', requestId, decision:'deny' } }
                              | { edit: '! ' + command }
// keys: 'enter' → run, 'e' → edit, 'n' → decline; anything else → null
```

## Tests

- [ ] `grantFrom` null for a hand request; `promptLines` reads `↵ run · e edit first · n decline · or type a reply to decline with it`.
- [ ] `handReducer` for each key.
- [ ] `buildConversation` pins a hand request with the command, `why:` and the keys line; a helper's names the helper.
- [ ] the answered and declined forms in the scrollback.
- [ ] view unit: ↵ drops `shell` with `requestId`; `e` fills `! cmd` and keeps the pin; edited Enter carries the `requestId`; `n` drops the deny; typed `no thanks` drops deny with text; keys do nothing while the box has text.

## Done when

- [ ] The end to end tests below pass at all three sizes.
- [ ] The live view's row reads `asking you · run a command` while the request is pending and returns to `building` once it is answered.

## End to end (the worker drives this)

- suite: `conversation-rig-{60x20,80x24,120x40}.test.mjs` on T05's `hand` scenario · sizes: 60×20, 80×24, 120×40
- [ ] the request arrives → pinned `! T01 asks you to run a command`, the command, `why:`, the keys line; the live view row reads `asking you · run a command`.
- [ ] ↵ → the command's block streams; `rig.received` holds the control response with `pirResult`; the fake's reply appears; the pin is gone.
- [ ] `e` → box reads `! printf handed`; edit to `! printf edited` ↵ → block shows the edited command; `pirResult`'s lead says it was edited.
- [ ] `n` → `· declined` in the scrollback; the deny reached the fake.
- [ ] typing `not now` ↵ → `· declined: not now`.
