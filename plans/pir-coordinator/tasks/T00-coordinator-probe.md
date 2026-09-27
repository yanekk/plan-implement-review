# T00 — coordinator-probe

**Phase:** 0 · **Depends on:** — · **Weight:** medium

## Goal

Measure, on this machine's Claude Code, the three things the agent's design sits on before anything is
built on them: what a permission request looks like when an `ask` rule forces it and when the command
is destructive, and whether a session in `default` permission mode can be held to read-only tools plus
writes into one absolute-path folder by a `canUseTool` gate. The probe is throwaway and deleted; its
answers go into FINDINGS.md and recorded fixtures.

First, check the precondition: `real-asking-state` is merged into main (`src/core/asking.mjs` exists on
main and its PROGRESS reads all ✅). If it is not, stop and tell the person; nothing here is valid
without it.

## Design sections this implements

DESIGN §2.4, §3.3, §3.4, §5.1, PLAN "T00 gates".

## Files

- A probe script in a scratch repo outside this checkout (deleted afterwards).
- `src/shell/fake/fixtures/coordinator-requests.json` (new, kept): the real `canUseTool` arguments
  recorded for each case below, for T01's tests.
- `plans/pir-coordinator/FINDINGS.md`: one row per answer.

## What to measure

In a scratch repo whose `.claude/settings.json` has `permissions.ask: ["Bash(git push:*)"]`, a session
held through the SDK `query()` with `canUseTool` logging every call:

1. `permissionMode: 'auto'`: ask it to run `git push origin HEAD` (no remote configured, so it fails
   harmlessly). Record whether `canUseTool` is called and with what `matchedAskRule`, `decisionReason`,
   `defaultToNo`.
2. `permissionMode: 'auto'`: ask it to run `rm -rf ./scratch-dir` and `git reset --hard`. Record whether
   `canUseTool` is called at all (the classifier may allow or block without asking) and the fields.
3. `permissionMode: 'default'`, `disallowedTools: ['Bash','Edit','NotebookEdit','WebFetch','WebSearch','Task','Agent']`,
   `canUseTool` allowing only `Read`/`Glob`/`Grep` and `Write` under an absolute folder outside cwd:
   ask it to read a file, write a JSON file into that folder, write a file in cwd, and run `ls`.
   Record which reach `canUseTool`, which land, and which are refused without reaching it.

## Tests

None kept beyond the fixture file; the probe is deleted. The fixture must parse (`JSON.parse`).

## Done when

- [ ] Precondition checked and stated in the commit message.
- [ ] FINDINGS.md has a row for each of the three measurements, with the CLI version.
- [ ] `coordinator-requests.json` holds the recorded arguments for cases 1 and 2; scratch and probe deleted.

## Outside actions

- Probe session — `worker` (DESIGN §5.3).

## If the answers differ from the plan

- No `matchedAskRule` in case 1: nothing changes; T01's `permissions.ask` match carries it. Note it.
- Destructive commands never reach `canUseTool` in auto mode: nothing changes for this plan (§2.4, the
  agent never widens what reaches the person). Note it.
- Case 3 lets a tool through unprompted, or refuses the absolute-path Write: stop and ask the person
  before T03, with what was seen and the options.
