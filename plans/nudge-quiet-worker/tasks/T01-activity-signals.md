# T01 — activity-signals

**Phase:** 1 · **Depends on:** — · **Weight:** medium

## Goal

The pure rule for "is this worker making progress": pick a worker's own actions out of its
conversation-log entries, give each action a signature, tell varied work from a repeated wait-loop,
recognise a person's reply to a parked worker, and fold one observation (worktree fingerprint plus new
log entries) into the tracked activity state. This is the loop detector the person asked for; it lives
in `src/core/` so what counts as "the same action" is one tested rule.

## Design sections this implements

DESIGN §2.2, §2.4 (observation starts at spawn; the person's reply un-parks), §2.7 (`raw` entries, git
failure), §3.5.

## Files

- `src/core/activity.mjs` (new)
- `src/core/activity.test.mjs` (new)
- Reads `src/core/fixtures/stream-sample.ndjson` (from live-workers T01) through `readEntry`.

## Interface

Entries are conversation-log entries as `worker-proc` writes them (`{ t, dir, … }`, live-workers DESIGN
§2.3). Every function reads them through `readEntry` from `core/stream.mjs`; none parses an SDK message
itself.

```js
// entries → the worker's own actions, oldest first. Only `tool-use` events count; tool results,
// system events, sent messages, requests, replies, notes, assistant text and `raw` do not.
// `at` is the entry's `t`.
ownActions(entries) → [{ at: number, sig: string }]

// tool name + input with digit runs → '#', whitespace collapsed, Bash `description` dropped.
actionSignature({ name, input }) → string

// entries → the person's replies, oldest first (DESIGN §2.4): a `sent` event from:'person', or a
// `reply` event from:'person' whose requestId is a question-set request. `questionIds` carries the
// ids of `questions` requests seen on earlier passes, since a request and its reply may arrive in
// different slices. Returns the ids seen in this slice so the caller can carry them forward.
personReplies(entries, { questionIds }) → { replies: [{ at: number }], questionIds: Set<string> }

// Fold one observation into the tracked state.
// prev: null on the first observation of a task (then lastActivityAt = now, nothing is "output").
// obs: { fingerprint: string|null, entries, reported: boolean }
//   fingerprint null = git failed this pass: keep prev.fingerprint, no output.
// windowMs: the quiet period; a sig counts as varied work if absent from `recent` within windowMs.
observeActivity(prev, obs, { now, windowMs }) → {
  state: { fingerprint, lastActivityAt, recent: [{at,sig}] /* pruned to windowMs */ },
  output: boolean,      // worktree changed or a report was dropped → resets the nudge count (§2.3)
  varied: boolean,      // at least one new signature → restarts the clock only
}
```

Why `reported` is an input: a dropped report is real output even when the worktree did not change,
and the loop already knows it from the report inbox.

## Tests

- [ ] `ownActions` on the stream fixture returns exactly its `tool-use` blocks, with each entry's `t`.
- [ ] Tool results, a `task_started`/`task_notification` system event, an assistant text, a `sent`
      message from pir or the person, a request, a reply and a note produce no actions.
- [ ] A `raw` entry in the middle is skipped and the rest still read.
- [ ] `actionSignature`: `sleep 30 && test -f x` and `sleep 45 && test -f x` are equal; two Bash calls
      differing only in `description` are equal; `Read a.mjs` and `Read b.mjs` differ.
- [ ] A poll loop (the same check repeated every 30 s for 20 min) is never `varied` after its first
      occurrence in the window.
- [ ] A reading worker (a different file each call) is `varied` on every observation.
- [ ] A signature seen longer ago than `windowMs` counts as new again.
- [ ] First observation: `lastActivityAt = now`, `output` false.
- [ ] Fingerprint change → `output` true and `lastActivityAt = now`; `reported` alone → `output` true.
- [ ] Fingerprint null → previous fingerprint kept, `output` false.
- [ ] `personReplies`: a person's message counts; pir's message (opening, conflict, nudge) does not; a
      person's answer to a question set counts, also when the request was in an earlier slice; a
      person's permission answer and a person's interrupt do not.
- [ ] `recent` is pruned to the window, so memory does not grow over a long run.

## Done when

- [ ] Every interface function exists with the shape above and every listed test passes in `npm test`.
- [ ] `boundary.test.mjs` is green with `activity.mjs` in `src/core/`.
- [ ] The fixture-driven test uses the real `stream-sample.ndjson`, not a hand-written imitation; the
      person-reply cases may use hand-built `out` entries in the shape `worker-proc` writes.
