# T00 — spike-death-shapes

**Phase:** 0 · **Depends on:** — · **Weight:** light

## Goal

Measure, on this machine, how a killed `claude --bg` session looks in `claude agents --json` and
whether it can be revived, for the cases the plan-time probe did not reach. Throwaway: the answer
goes in `FINDINGS.md` and the probe code is deleted. It gates the death rule T03 implements
(DESIGN §2.1) and the record-keeping T06 implements (§2.7).

## Design sections this implements

DESIGN §2.1, §2.3, §2.7, §5.2 (probe cleanup).

## Files

None kept. A scratch repo plus one git worktree on paths Claude Code already trusts (see FINDINGS
2026-09-24 on trust; list trusted absent paths from `~/.claude.json` `projects`), deleted after.

## What to measure

1. SIGKILL the listed `pid` of a session while it is (a) idle, (b) running a foreground Bash command
   (a `node -e` busy loop under the harness's sleep block), (c) generating a long reply, (d) running
   a `run_in_background` command. For each, poll `claude agents --json` every 5 s for 2 min and record:
   absent, listed without `pid`, or woken by the daemon with a new `pid`.
2. For shape (b): `claude stop <id>` then `claude --bg --resume <sessionId> "<msg>"` from the
   worktree. Does the conversation continue sensibly after the tool call that never returned?
3. `claude rm <id>` a stopped session, then `claude --bg --resume <sessionId> -n "<name>" "<msg>"`
   with cwd = worktree. Same id? Name honoured? cwd the worktree?
4. `claude stop` on a session the daemon has just woken, then resume: continues, or a copy?

## Done when

- `FINDINGS.md` has one 📌 row per question with the observed answer and Claude Code version.
- DESIGN §2.1 and §2.7 either stand or carry a one-line dated note of what changed and why.
- No probe session is listed in `claude agents --json --all`; the scratch folders are gone.

## Outside actions

- Probe sessions — `worker`
- Kill a scratch worker — `worker`
