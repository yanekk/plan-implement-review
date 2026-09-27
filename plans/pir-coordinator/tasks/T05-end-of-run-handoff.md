# T05 — end-of-run-handoff

**Phase:** 2 · **Depends on:** T04 · **Weight:** heavy

## Goal

Replace the one-line hand-off with the agent's: once every task is ✅ and the tests pass, bring main
into the run's branch, get conflicts resolved by a worker, rerun the tests, have the agent write the
report, commit `REPORT.md` in the plan, and hold the run in `ready to merge` until the person closes it
or merges. With the agent off, the end is exactly today's.

## Design sections this implements

DESIGN §2.7 (decisions section, adopted tasks notable), §2.9, §2.10, §2.11 (red, restart in ready,
sync conflict unresolved), §3.3 (main-sync prompt), §3.5.

## Files

- `src/shell/worktree.mjs`, test: `syncMain(featurePath, { root })`, `mainContains(branch, { root })`.
- `src/core/conflict.mjs`, test: `buildConflictPrompt({ kind: 'main-sync', slug, plan, files, audience: 'worker' })`.
- `src/core/coordinator-report.mjs` (new), test.
- `src/shell/coordinate.mjs`, `loop.mjs`, tests: the end sequence after the green end gate; the
  `ready to merge` state in the run state and snapshot; `finalState: 'finished'` on close or merge;
  re-sync when main moves; restart in `ready to merge`.
- `src/shell/coordinator-agent.mjs`: `briefEnd(facts)`; `drain` already returns `report`/`close` (T03).
- `src/core/coordinator-brief.mjs`: `endBriefFor(facts)`, `handoffFor({ slug, reportPath, ready })`.

## Interface

```js
// worktree.mjs
export function syncMain(featurePath, { root }) // → { state: 'up-to-date'|'merged'|'conflict', mainSha, files?: string[] }
export function mainContains(branch, { root })  // → boolean (git merge-base --is-ancestor branch main)

// coordinator-report.mjs (pure)
export function notableDecisions(ledgerLines, adoptedTasks) // → [{ question, answer, why, task }]
export function decisionsSection(notable)                   // markdown; "None." when empty
export function branchFooter({ mainSha, tests: 'green'|'red', syncedAt })
export function assembleReport({ slug, sections, notable, footer }) // → REPORT.md text
export function endFacts({ tasks, ledger, findings, unverified, sync, tests }) // → the end brief's facts

// run state
runState.handoff = { state: 'preparing'|'ready'|'red', reportPath: 'plans/{slug}/REPORT.md'|null, mainSha }
```

Sequence, one step per pass so the display stays live: end gate green → `syncMain` → (`conflict` →
spawn a worker in the feature worktree with the main-sync prompt, wait for its `done`) → tests →
`briefEnd` → wait for the `report` decision → `assembleReport`, write, `commitFeature` with
`report({slug}): delivery report` → `say(handoffFor(…))` → `ready`. In `ready`, each pass: `mainContains`
→ finish; main tip changed → back to `syncMain`, update the footer, commit, `say` it; a `close`
decision → finish.

`adoptedTasks` are rows `adoptNewTaskRows` adopted during the run while the agent was alive.

## Tests

- [ ] `syncMain` on the fake worktree: up to date, clean merge, conflict with its files.
- [ ] Main-sync prompt names the in-progress merge, the plan's test lines, commit and `done`.
- [ ] Report assembly: four sections in order, decisions from notable ledger lines and adopted tasks,
      "None." when empty, footer with sha and tests.
- [ ] Fake run to the end: sync clean → report committed on the feature branch → `ready` → the person
      merges (fake main contains the tip) → `finished`.
- [ ] Conflict: a worker spawned with the main-sync prompt; its `done` → tests → report.
- [ ] Red tests after sync: report written with the red footer, `handoff.state: 'red'`, no merge offered.
- [ ] `close` decision in `ready` → `finished`. Main moves in `ready` → re-sync, footer updated, agent says so.
- [ ] Restart in `ready`: report not rewritten, returns to `ready`.
- [ ] Agent off: today's `renderHandoff` end, unchanged tests.

## Done when

- [ ] A fake run goes from the last ✅ to `ready` with `REPORT.md` committed, and ends on merge or close.
- [ ] The conflict, red and restart paths above pass in `npm test`.
- [ ] `./install.sh` run after the change.
