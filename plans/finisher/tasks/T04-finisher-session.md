# T04 — finisher-session

**Phase:** 2 · **Depends on:** T00, T01, T02 · **Weight:** heavy

## Goal

The finisher held as a live session: started fenced (T00's mechanism, T01's verdicts), its status
files drained and applied to its phase, the person's go recognised from pir's reply or a phone answer,
its record kept, and resumed after an exit or a pir restart. The shell counterpart of
`coordinator-agent.mjs`, sharing its start/resume pattern.

## Design sections this implements

DESIGN §2.3–§2.7, §2.10, §2.12, §3.3, §3.5.

## Files

- `src/shell/finisher-agent.mjs` (new), `src/shell/finisher-agent.test.mjs` (new)
- `src/shell/coordinator-agent.mjs`: export `gateFor` with the allowed skill name as a parameter
  (default `pir-coordinator`), plus `canonical`, `within` and the session-file/restart helpers, for reuse
  (no behaviour change). The finisher's Read/Glob/Grep/Write/Skill checks are `gateFor` over its read
  roots and status folder, passed to `finisherVerdict` as `fileVerdict` (DESIGN §3.2).
- `src/shell/worker-proc.mjs`: only if T00's fence needs an option `startWorker` does not pass yet
  (e.g. `hooks` or `settingSources`); `decide` may return `'person'` meaning park (today `null`).
- `src/shell/fake/claude-stream.mjs`: only if the fake must honour the new option for the tests.

## Interface

```js
export function startFinisher({
  controlDir, featurePath, repoRoot, slug, mainCheckout, rules /* { path, source } */,
  reportPath, askRules, platform, startWorker, claudePath, now, remote, skillsDir, engineDir, uuid, env,
}) → {
  id, session, logPath,           // as the coordinator agent's; withAgent (T05) and `c` (T07) read these
  alive(), givenUp(), close(opts), remoteUrl(),   // remoteUrl for the alert's tap (T06)
  drain() → { accepted: Status[], refused: { file, why }[], go: null | { by: 'person'|'phone' } },
  phase(), goGiven(),
  view() → { id, logPath, state: phase|'restarting'|'given-up', summary, steps, rulesSource, asking: bool },
  tell(text), resynced(mainSha),  // resynced: phase → preparing and a finisherResynced message
}
```

`drain()` each pass: read `control/finisher/status/` (name order, parse-twice rule), `checkStatus`
against the phase, apply, write `state.json` atomically, append the ledger, refuse with
`finisherRefusal`; then read the conversation log since the last pass for answered `AskUserQuestion`
requests and apply `isGoAnswer` (a `reply` from pir, or `answered-remotely` + the tool result naming
`"…"="Go"`). A `Not yet` is ledgered and nothing changes.

Name: `${basename(repoRoot)} / ${slug} / finisher`. Log files `conversations/finisher-{n}.ndjson`.
Remote Control on for the whole session unless `remote` is false. Presence env as for the agent.
Started with the `tools` allowlist T00 settled: every tool the finisher needs in either phase, and none the
fence does not see (DESIGN §3.3). A go sets `goGiven` in `state.json` for good (DESIGN §2.8).

## Tests

- [ ] Starts with the fence T00 chose; in `preparing` an allow-ruled `git merge` reaches pir and is
      denied (fake SDK honouring the option; one test stating that the real CLI behaviour is T00's).
- [ ] `ready` file → phase `awaiting-go`, ledger line; malformed file retried once then refused.
- [ ] Scripted pir reply `Go` to a `Go` question → `finishing`, ledger `by: person`.
- [ ] Scripted `answered-remotely` + tool result `"Ready to finish?"="Go"` → `finishing`, `by: phone`.
- [ ] `Not yet` → phase unchanged; `Go` to a question with another header → unchanged.
- [ ] In `finishing`, `rm -rf x` parks for the person (not allowed, not denied).
- [ ] `stuck` → look-only again; a Bash `git merge` then denied.
- [ ] Exit in `finishing` → resumed, phase `stuck`, resumed message carries the summary.
- [ ] Four exits within an hour → given up.
- [ ] A go sets `goGiven`; it survives `stuck`, a finisher restart and a pir restart.
- [ ] Restart of pir with `state.json` present → phase kept per `afterRestart`.

## Done when

- [ ] `startFinisher` exists with the tests above passing under the fake SDK.
- [ ] The coordinator agent's tests are unchanged and green.
- [ ] Nothing calls `startFinisher` yet except tests (T05 wires it).
