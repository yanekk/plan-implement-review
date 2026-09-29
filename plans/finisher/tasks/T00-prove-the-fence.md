# T00 — prove-the-fence

**Phase:** 0 · **Depends on:** — · **Weight:** medium

## Goal

The finisher needs Bash, and this machine's settings pre-approve `git merge` and `./install.sh`, so a
`canUseTool` gate in `permissionMode: 'default'` would not see them (DESIGN §3.3). Find, on Claude Code
2.1.284 with `@anthropic-ai/claude-agent-sdk` 0.3.282, a way to start a session through the SDK so
that pir decides every tool call, an allow-ruled one included, and write down exactly what holds.
Throwaway: the probe script is deleted; only the findings stay.

## Design sections this implements

DESIGN §3.3, §2.4.

## Files

- A probe script in a temp folder (not committed), built from `src/shell/worker-proc.mjs`'s
  `workerOptions` and the SDK's `query`.
- `plans/finisher/FINDINGS.md`: one row per answer below.
- `plans/finisher/DESIGN.md §3.3`: replace the three candidates with the one that holds, with its
  measurement date.

## What to measure

In a scratch repo `/tmp/pir-finisher-fence` whose `.claude/settings.json` allows `Bash(git merge:*)`
and `Bash(touch:*)` (and with the user's own `~/.claude/settings.json` as it is), a session told to run
`touch probe.txt` and then `git merge side`:

1. `permissionMode: 'default'` with `canUseTool` only: is `canUseTool` called for the allow-ruled
   commands? (Expected: no. This is the problem, confirm it.)
2. The same plus an SDK `hooks: { PreToolUse: [{ hooks: [callback] }] }` whose callback returns a deny
   decision for Bash: is the callback called for the allow-ruled commands, and does its deny stop them?
   Does it fire for `Read`, `Write`, `AskUserQuestion` too? Can it return "ask" so the request then
   reaches `canUseTool` (so reserved requests can be parked for the person)?
3. If 2 fails: `settingSources: []` (or `['local']`): does `canUseTool` then see the commands, and does
   the session still load the repo's `CLAUDE.md` and the user's skills (`Skill` of `pir-finisher`-like
   installed skill)?
4. If 2 and 3 fail: `extraArgs: { settings: '{"permissions":{"deny":["Bash"]}}' }` or equivalent.
5. The phone path is already measured (2026-09-26): confirm only that an `AskUserQuestion` answered in
   pir reaches the log as a `reply` whose `result.updatedInput.answers` names the chosen label.

## Done when

- [ ] FINDINGS.md has a dated row for each question answered, with the SDK option shape that worked.
- [ ] DESIGN §3.3 names the one fence T04 must use, and whether the `decide` gate is still needed for
      non-Bash tools.
- [ ] The probe and the scratch repo are deleted; nothing else in the repo changed.

## Environment (the worker owns this)

```
git init /tmp/pir-finisher-fence && (cd /tmp/pir-finisher-fence && git commit --allow-empty -m a && git branch side && mkdir .claude && printf '{"permissions":{"allow":["Bash(git merge:*)","Bash(touch:*)"]}}' > .claude/settings.json)
rm -rf /tmp/pir-finisher-fence    # teardown, confirm it is gone
```

## Outside actions

- A real Claude session for the probe: draws plan limits, no paid API — `worker` (wrap it in
  `perl -e 'alarm 300; exec @ARGV' node <probe>`).
