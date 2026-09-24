# T01 — activity-signals

**Phase:** 1 · **Depends on:** T00 · **Weight:** medium

## Goal

The pure rule for "is this worker making progress": parse a worker's own actions out of its
transcript, give each action a signature, tell varied work from a repeated wait-loop, and fold one
outside observation (worktree fingerprint plus new transcript text) into the tracked activity state.
This is the loop detector the person asked for; it lives in `src/core/` so what counts as "the same
action" is one tested rule.

## Design sections this implements

DESIGN §2.2, §2.4 (observation starts at spawn; the person's reply un-parks), §2.7 (degraded transcript), §3.5.

## Files

- `src/core/activity.mjs` (new)
- `src/core/activity.test.mjs` (new)
- Reads `src/core/fixtures/transcript-sample.jsonl` (from T00).

## Interface

```js
// JSONL text of complete lines → the worker's own actions, oldest first. Only assistant tool_use
// blocks count; tool results, attachments, notifications, incoming messages and assistant text do not.
// A line that does not parse is skipped, not thrown.
parseOwnActions(text) → [{ at: number /* ms, Date.parse(timestamp) */, sig: string }]

// JSONL text of complete lines → the times of messages the person typed into the session, oldest
// first. Tool results, notifications, attachments and socket posts are not the person (T00 names the
// field that tells them apart). The loop uses this to un-park an AWAITING worker (DESIGN §2.4).
parsePersonReplies(text) → [{ at: number }]

// tool name + input with digit runs → '#', whitespace collapsed, Bash `description` dropped.
actionSignature({ name, input }) → string

// Fold one observation into the tracked state.
// prev: null on the first observation of a task (then lastActivityAt = now, nothing is "output").
// obs: { fingerprint: string|null, actions: [{at,sig}], transcriptFound: boolean, reported: boolean }
//   fingerprint null = git failed this pass: keep prev.fingerprint, no output.
// windowMs: the quiet period; a sig counts as varied work if absent from `recent` within windowMs.
observeActivity(prev, obs, { now, windowMs }) → {
  state: { fingerprint, lastActivityAt, recent: [{at,sig}] /* pruned to windowMs */ },
  output: boolean,      // worktree changed or a report was dropped → resets the nudge count (§2.3)
  varied: boolean,      // at least one new signature → restarts the clock only
}
```

Why `reported` is an input: a dropped report is real output even when the worktree did not change,
and the loop already knows it from the inbox.

## Tests

- [ ] `parseOwnActions` on the T00 fixture returns exactly its assistant tool_use actions with times.
- [ ] Tool results, a background-task notification, an attachment, a received message and assistant
      text produce no actions.
- [ ] A malformed line in the middle is skipped and the rest still parse.
- [ ] `actionSignature`: `sleep 30 && test -f x` and `sleep 45 && test -f x` are equal; two Bash calls
      differing only in `description` are equal; `Read a.mjs` and `Read b.mjs` differ.
- [ ] A poll loop (the same check repeated every 30 s for 20 min) is never `varied` after its first
      occurrence in the window.
- [ ] A reading worker (a different file each call) is `varied` on every observation.
- [ ] A signature seen longer ago than `windowMs` counts as new again.
- [ ] First observation: `lastActivityAt = now`, `output` false.
- [ ] Fingerprint change → `output` true and `lastActivityAt = now`; `reported` alone → `output` true.
- [ ] Fingerprint null → previous fingerprint kept, `output` false.
- [ ] `transcriptFound` false → only the fingerprint and `reported` can move `lastActivityAt`.
- [ ] `parsePersonReplies` on the T00 fixture returns exactly the person-typed line; the socket post,
      notification and tool results in the same fixture return nothing.
- [ ] `recent` is pruned to the window, so memory does not grow over a long run.

## Done when

- [ ] Every interface function exists with the shape above and every listed test passes in `npm test`.
- [ ] `boundary.test.mjs` is green with `activity.mjs` in `src/core/`.
- [ ] The fixture-driven test uses the real T00 transcript, not a hand-written imitation.
