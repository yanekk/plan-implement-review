# T02 — bang-rules

**Phase:** 1 · **Depends on:** — · **Weight:** medium

## Goal

The pure rules of `!`: what a box line means, the text the agent receives, the drop kinds the screen may
send, and how the conversation log's new `shell` entries are read into activity, so the view and the
forwarder agree on one definition of each.

## Design sections this implements

DESIGN §2.1 (parse), §2.2 (plain text), §2.3 (message, caps), §3.2 (drops, entries), §7 (reuse).

## Files

- `src/core/bang.mjs` (new), `src/core/bang.test.mjs` (new).
- `src/core/person-input.mjs` and its test — kinds `shell`, `shell-stop`.
- `src/core/stream.mjs` and its test — `readEntry` for `dir:'shell'`; `workerActivity` gains `shell`;
  `readOut` keeps `shell` on a sent message.

## Interface

```js
// bang.mjs
export const AGENT_OUTPUT_CAP = 30000;
export const LOG_OUTPUT_CAP = 1024 * 1024;
export function parseBang(text) → null | { command }   // null unless text starts with '!'; command trimmed, may be ''
export function capForAgent(output, cap = AGENT_OUTPUT_CAP) → { text, cut /* chars dropped */ }
export function shellStatusLine({ code, signal, stopped, ms }) → 'exit 0 · 6s' | 'killed by SIGTERM · 2s' | 'stopped by the person · 1m 12s'
//   the duration is conversation.mjs helperTime(ms), reused (DESIGN §7); output is cleaned by
//   core/text.mjs plainText, reused, not by a new stripper
export function bangMessage({ command, output, code, signal, stopped, ms, lead }) → string
//   lead: 'The person ran a command in your working folder:' (default) | 'The person ran your command:' |
//   'The person edited your command and ran it:'. Format exactly as DESIGN §2.3.
export function shellId(now, rand) → 'sh-{now}-{rand4}'

// person-input.mjs: validateDrop accepts
{ to, kind: 'shell', command: non-empty string after trim, requestId?: non-empty string }
{ to, kind: 'shell-stop' }

// stream.mjs
// readEntry: { dir:'shell', kind:'start'|'output'|'end', … } → { kind:'shell-start'|'shell-output'|'shell-end', id, … }
// workerActivity(entries).shell → null | { id, command, t, requestId? }   // the running one: a start with no end
```

`shell` is cleared by the matching end and by an `exited` note (a dead worker's command is not running
as far as the view can tell; T03 ends it properly).

## Tests

- [ ] `parseBang`: `'!ls'`, `'! ls -la '`, `'!'` → `''`, `'ls'` → null, `' !ls'` → null (leading space is not command mode), multi-line kept.
- [ ] `plainText` (reused) on a chunked stream: colour codes, OSC 8 links and a progress bar's `\r` overwrites come out as DESIGN §2.2 says when applied per coalesced chunk; if a chunk boundary splits an escape or a `\r` line, T03 applies it per completed line instead (test both).
- [ ] `capForAgent` under, at and over the cap; keeps the tail; reports `cut`.
- [ ] `bangMessage` for exit 0 with output, exit 1, empty output `(no output)`, stopped, signal, cut output with the note, each `lead`.
- [ ] `shellStatusLine` durations through `helperTime`: 0.4 s → `0s`, 6 s, 72 s → `1m 12s`, over an hour → `72m 0s`.
- [ ] `validateDrop`: accepts both kinds; rejects empty/whitespace command, non-string requestId, extra `decision`.
- [ ] `workerActivity.shell`: start → running; start+end → null; start+exited → null; two starts with one end → the open one.
- [ ] `readOut` of `{dir:'out', kind:'message', shell:'sh-…'}` keeps `shell`.

## Done when

- [ ] The interface above is exported and tested; `boundary.test.mjs` still passes.
- [ ] `bangMessage` output matches DESIGN §2.3's example byte for byte for that input.
