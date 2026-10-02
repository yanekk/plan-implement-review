# T03 — rows-and-alert

**Phase:** 1 · **Depends on:** T01, T02 · **Weight:** light

## Goal

The pure display pieces: the build view's three new task row kinds, the end gate's queued footer, the
phone alert sent when the third red stops a build, and the dashboard's stopped-tests-red row and stale
note. T05, T06 and T12 wire and paint them.

## Design sections this implements

DESIGN §2.3 (not asking while in tests), §2.4 (alert and row text), §2.8 (build rows, end gate footer).

## Files

- `src/core/display.mjs`, `src/core/display.test.mjs`
- `src/core/notify.mjs`, `src/core/notify.test.mjs`
- `src/core/dashboard.mjs`, `src/core/dashboard.test.mjs`

## Interface

The run state's task gains `tests: { state: 'queued', position } | { state: 'running', since, limitMs } |
null` and `fixing: { tryNo } | null` (set by T05). The run state gains `testsQueued: { position } | null`
for the end gate (T08) and the final status gains `stopReason` (T06), the shape from T02's `stopReason`.

```js
// display.mjs — rowFor
//   tests.state 'queued'  → kind 'tests-queued',  text 'waiting for tests · {nth(position)} in queue'
//   tests.state 'running' → kind 'testing',       text 'testing · m:ss / m:ss'   (elapsed from since, the limit)
//   fixing                → kind 'fixing-tests',  text 'fixing tests · try {tryNo} of 3'
//   all three are ACTIVE kinds; none counts in askingCount
// footerFor: run state with testsQueued → 'all N task(s) merged · waiting for tests · {nth} in queue'
// notify.mjs
testsStopAlert({ slug, stopReason }) → { title: '{slug} · stopped', body: 'T{nn} {taskSlug}: pir\'s tests failed 3 times ({role}). {reason}' }
// dashboard.mjs
//   runDisplayState: a stopped run whose record carries stopReason.kind 'tests-red' → '◼ stopped · tests red'
stoppedTestsNote({ stopReason, worktree }) → [lines]   // task, reason, log, worktree, 'Ctrl+R Ctrl+R to resume with 3 fresh tries'
```

`nth` comes from T01's `testqueue.mjs`.

## Tests

- [ ] rowFor each new kind with exact text; a task with both tests and an asking pending request reads asking
- [ ] the three kinds are active and do not count in askingCount
- [ ] footerFor with testsQueued at 1st and 3rd; without it, today's testing footer unchanged
- [ ] testsStopAlert exact title and body for implement and review
- [ ] runDisplayState: stopped with and without stopReason; the STATE column width rule still holds
- [ ] stoppedTestsNote lines exact

## Done when

- [ ] The listed tests are green in `npm test`.
- [ ] Texts match DESIGN §2.4 and §2.8.
- [ ] No existing display, notify or dashboard test changes its expectation.
