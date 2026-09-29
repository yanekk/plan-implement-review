# T01 — alert-core

**Phase:** 1 · **Depends on:** — · **Weight:** medium

## Goal

The pure heart of the feature: given the live build workers that are the person's and the time, decide
which alerts to send, which to repeat once, and which to clear, and word each one, including why the
question is the person's and the end-of-run alert. Everything the phone is told is decided here,
testable in milliseconds.

## Design sections this implements

DESIGN §2.1, §2.2, §2.3, §2.4 (text), §3.2.

## Files

- `src/core/notify.mjs` (new), `src/core/notify.test.mjs` (new).

## Interface

```
alertText({ plan, task, role, name, why, kind, decisionText, lastText, pending }) → { title, message }
  // kind: 'question' | 'questions' | 'permission'; pending: activity.pending (oldest first)
  // why: 'passed' | 'timeout' | 'reserved' | 'unavailable' | 'off' | null → the §2.3 prefix
  // name: a helper worker's `{label} {slug}` title part; when set it replaces `{task} {role}`
reminderText(message) → string            // 'Still waiting: ' + message
excerpt(text, max = 150) → string         // plainText, newlines folded, then clipText (both src/core/text.mjs):
                                          // at most 150 code points, the last one '…' when cut
endAlert({ slug, ready, taskCount, reason, unresolved }) → { title, message, tags }   // DESIGN §2.4;
  // red: unresolved → the merge-with-main message, else tests red with the reason when there is one
newNotifyState() → { episodes: {}, counts: {} }
notifyStep(state, views, now, { remindMs = 900_000, linkWaitMs = 20_000 } = {}) → { state, actions }
  // views: [{ id, waiting: kind|null, title, message, remote: 'wanted'|'off'|'refused', url }]
  //   (the shell builds title and message with alertText; waiting null means not the person's)
  // actions: { type: 'send', id, seq, title, message, click, reminder } | { type: 'clear', id, seq }
notifyExit(state) → actions               // a clear per episode that was sent
```

`seq` is `pir-{id}-{n}` with `n` counting episodes per worker. The message is fixed at episode start.
The input state is not mutated.

## Tests

- [ ] Each kind's wording, including `questions` with `(+N more)`, `permission` via `mainArg`, a report
      `question`, a report-less `question` from `lastText`, and the `is waiting for you` fallback.
- [ ] Each reason's prefix, and none for `off` and `null`; the prefix is outside the 150-code-point cut.
- [ ] A helper's title uses `name`.
- [ ] `endAlert`: ready and red titles, messages and tags; a long red reason is cut to 150; `unresolved`
      gives `Merge with main unresolved on pir/{slug}`; red with no reason drops the `: `.
- [ ] `excerpt`: exactly 150, 151, multi-line, emoji (code points, not UTF-16 units), empty.
- [ ] First alert waits for the link while `remote: 'wanted'` and `url: null`; sends with `click` once
      `url` appears; sends without it at `linkWaitMs`; sends at once when `remote` is `off` or `refused`.
- [ ] One reminder at `remindMs` after the first alert, same `seq`, `reminder: true`; none after.
- [ ] A view whose message changes mid-episode (say, the reason) keeps the episode's first message.
- [ ] Episode end (waiting null, or worker absent from views) clears only if sent; a not-yet-sent episode
      ends silently.
- [ ] Waiting again after an end starts episode `n+1` with a new `seq`.
- [ ] Two workers waiting at once are independent. `notifyExit` clears sent episodes only.
- [ ] `now` going backwards sends no reminder early and does not throw.

## Done when

- [ ] Every test above passes under `npm test`, and `boundary.test.mjs` still passes.
- [ ] Nothing outside `src/core/notify*.mjs` changed.
