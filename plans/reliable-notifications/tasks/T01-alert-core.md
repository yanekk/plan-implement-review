# T01 — alert-core

**Phase:** 1 · **Depends on:** — · **Weight:** medium

## Goal

The pure heart of the feature: given the live build workers and the time, decide which alerts to send,
which to repeat once, and which to clear, and word each one. Everything the phone is told is decided
here, testable in milliseconds.

## Design sections this implements

DESIGN §2.1, §2.2, §2.3, §3.2.

## Files

- `src/core/notify.mjs` (new), `src/core/notify.test.mjs` (new).

## Interface

```
alertText({ plan, task, role, kind, decisionText, lastText, pending }) → { title, message }
  // kind: 'question' | 'questions' | 'permission'; pending: activity.pending (oldest first)
reminderText(message) → string            // 'Still waiting: ' + message
excerpt(text, max = 150) → string         // newlines folded, cut on code points, '…' when cut
newNotifyState() → { episodes: {}, counts: {} }
notifyStep(state, views, now, { remindMs = 900_000, linkWaitMs = 20_000 } = {}) → { state, actions }
  // views: [{ id, waiting: kind|null, title, message, remote: 'wanted'|'off'|'refused', url }]
  // actions: { type: 'send', id, seq, title, message, click, reminder } | { type: 'clear', id, seq }
notifyExit(state) → actions               // a clear per episode that was sent
```

`seq` is `pir-{id}-{n}` with `n` counting episodes per worker. The message is fixed at episode start.
The input state is not mutated.

## Tests

- [ ] Each kind's wording, including `questions` with `(+N more)`, `permission` via `mainArg`, a report
      `question`, a report-less `question` from `lastText`, and the `is waiting for you` fallback.
- [ ] `excerpt`: exactly 150, 151, multi-line, emoji (code points, not UTF-16 units), empty.
- [ ] First alert waits for the link while `remote: 'wanted'` and `url: null`; sends with `click` once
      `url` appears; sends without it at `linkWaitMs`; sends at once when `remote` is `off` or `refused`.
- [ ] One reminder at `remindMs` after the first alert, same `seq`, `reminder: true`; none after.
- [ ] Episode end (waiting null, or worker absent from views) clears only if sent; not-yet-sent episode
      ends silently.
- [ ] Waiting again after an end starts episode `n+1` with a new `seq`.
- [ ] Two workers waiting at once are independent. `notifyExit` clears sent episodes only.
- [ ] `now` going backwards sends no reminder early and does not throw.

## Done when

- [ ] Every test above passes under `npm test`, and `boundary.test.mjs` still passes.
- [ ] Nothing outside `src/core/notify*.mjs` changed.
