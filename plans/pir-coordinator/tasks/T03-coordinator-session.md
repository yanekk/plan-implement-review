# T03 — coordinator-session

**Phase:** 1 · **Depends on:** T01 · **Weight:** medium

## Goal

Hold the coordinator agent as a live session and give the run one object to talk to it: brief it,
receive its decisions, check and apply them, refuse the bad ones with a message back, keep the ledger,
keep its Remote Control on, and resume it after a crash or a restart. Wiring it into the pass loop is
T04's and T05's; this task makes it work against the fake platform.

## Design sections this implements

DESIGN §2.3, §2.5 (Remote Control on for a pass), §2.7 (ledger lines), §2.8, §2.11 (exit,
restart limit, bad files, denied tools), §3.4, §3.5.

## Files

- `src/shell/worker-proc.mjs`, `worker-proc.test.mjs`: `startWorker` takes optional `permissionMode`,
  `disallowedTools` and `decide(toolName, input) → 'allow'|'deny'|null`. When `decide` returns a verdict
  the request is answered at once and logged `decided-by-gate`; `null` parks it as today.
- `src/shell/coordinator-agent.mjs` (new), `coordinator-agent.test.mjs` (new).
- `src/core/coordinator-brief.mjs` (new), `coordinator-brief.test.mjs` (new): every message text.
- `src/shell/fake/claude-stream.mjs`: none expected. Its existing `sh` step writes a decision file from
  a script and `emit` shows the matching `Write` tool use; add a step only if those two cannot do it.
- `src/shell/fake/platform.mjs`: add `remoteControl(id, on)` and `note(id, kind, fields)`, which the
  real platform has and the fake lacks, recorded for assertions.
- `src/shell/coordinate.mjs` `clearTransientFeeds`: clear `coordinator/decisions/`, keep the rest.

## Interface

```js
// coordinator-agent.mjs
export function startCoordinatorAgent({
  controlDir, featurePath, repoRoot, slug, projectRulesPath /* or null */,
  platform,            // answer(id, requestId, result, {from}), send(id, text, {from}), remoteControl(id, on), note(id, kind, fields)
  askRules,            // string[] from .claude/settings.json permissions.ask
  startWorker, claudePath, now = Date.now,
}) // → CoordinatorAgent

CoordinatorAgent = {
  id,                          // its session id, persisted in coordinator/session.json
  alive(),                     // false while down or given up (§2.11)
  brief(item),                 // item: a T01 `waiting` entry + text context; sends briefFor(item), remembers it
  answeredElsewhere(item),     // tells the agent the person answered first
  drain(waiting),              // reads decisions/, runs readDecision + checkDecision, applies via platform,
                               //   appends ledger lines, returns { passed: [{worker, requestId?, reason, suggestion}],
                               //   report?: sections, close?: true }
  tell(text),                  // a `from: 'pir'` message into its session (hand-off, re-sync); the agent
                               //   relays it to the person in its reply. Pointers are its own replies.
  ledger(),                    // parsed coordinator/ledger.jsonl
  close(),
}

// coordinator-brief.mjs (pure)
export function briefFor(item)            // permission / questions / report-park, reserved variant
export function refusalFor(why)
export function answeredElsewhereFor(item)
export function openingFor({ slug, projectRulesPath, dropDir })
```

The gate is `decide` from DESIGN §3.4: `Read`/`Glob`/`Grep` under `repoRoot`, its `.claude/worktrees/`,
and `~/.claude/skills/`; `Skill` with skill `pir-coordinator`; `Write` whose `file_path` resolves inside `controlDir/coordinator/decisions/`;
everything else `deny`. Paths are resolved (`path.resolve`) before comparing, so `..` cannot escape.

## Tests

- [ ] Gate: each allowed tool and path allowed; Write outside the folder, Write via `..`, Bash, Edit,
      `Skill` for another skill denied.
- [ ] A scripted agent allows a permission → `platform.answer` called with `allowResult`, `from: 'coordinator'`,
      ledger line written.
- [ ] Answers to a question set, a message to a report-parked worker: applied and ledgered.
- [ ] A `permission` on a reserved item: refused, returned in `passed` with the agent's reason, agent told.
- [ ] Malformed file, unknown worker, already-answered request: dropped, agent told, nothing applied.
      A file that fails to parse is left for one pass and applied if it parses then (DESIGN §3.5).
- [ ] `pass`: returned in `passed`; no note written (the pointer is the agent's reply, DESIGN §2.5).
- [ ] Exit: resumed with the stored session id; a fourth exit within an hour → `alive()` false for good.
- [ ] Restart: a second `startCoordinatorAgent` on the same control folder resumes the session and keeps
      the ledger.
- [ ] `clearTransientFeeds` clears `decisions/` and keeps `ledger.jsonl` and `session.json`.

## Done when

- [ ] `startCoordinatorAgent` behaves as above against the fake stream; every test passes in `npm test`.
- [ ] `worker-proc.mjs` without the new options behaves exactly as before (its existing tests unchanged).
- [ ] `./install.sh` run after the change.
