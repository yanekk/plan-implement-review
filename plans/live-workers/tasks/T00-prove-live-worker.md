# T00 — prove-live-worker

**Phase:** 0 · **Depends on:** — · **Weight:** medium

## Goal

Prove on this machine, with throwaway code, that a real worker driven over stream-json does a real
pir task end to end, and that pi-tui installs and draws here. The plan-time probes only exercised
one-line prompts; nothing yet shows the pir-worker skill, auto mode, report files and a multi-step
task behaving over the line. The answers go in `FINDINGS.md`, the spike code is deleted.

## Design sections this implements

DESIGN §2.1, §2.4, §2.6, §2.7, §2.8, §2.11, §2.12, §5.2.

## Files

None kept. A scratch repo copied from a harness fixture (`src/shell/harness/fixtures/single.mjs` or
the smallest one) on a path Claude Code already trusts, one task worktree, and a spike script in the
job's tmp folder. All deleted after.

## What to measure

1. A node spike spawns the §2.1 argv in the task worktree, sends `openingInstruction('implement', 'T01')`
   as the first user line, answers every `can_use_tool` by allowing it and logging it, and records every
   line to an NDJSON file. Does the worker load pir-worker and pir-implement, build the task, commit,
   and drop its `implemented` report into `reports/`? How many permission requests did auto mode send?
2. Across that whole run, is "a `result` event with nothing pending" a reliable idle signal? Note any
   `result` that arrived while the worker still meant to continue (for example a background task
   notification starting a new turn with no user line).
3. Ask the worker, in a second turn, to use AskUserQuestion; answer it; confirm the answer lands.
4. After the worker's turn has ended, close its stdin: does it exit, how fast, with what code? Then kill
   the parent spike with SIGKILL while the worker is idle: does the worker exit on its own, and how fast?
5. `-n "<name with ·>"`: does the name survive, and how does the worker appear in `claude agents --json`?
6. List every event kind the run produced (init, assistant text, tool_use, tool_result, `can_use_tool`
   for a tool and for AskUserQuestion, result success and interrupted, system notifications). Leave the
   recording in the scratch folder only until T01 starts: T01 regenerates its own sample lines with a
   short probe and commits them, so nothing from this spike needs to survive.
7. In a scratch folder, `npm i @earendil-works/pi-tui@0.87.1`, then a 30-line script that enters
   pi-tui, shows a Markdown block and an Editor, echoes the key names it receives for ↑ ↓ ← → Esc Tab
   Enter Space and Ctrl+S, and exits restoring the terminal.

## Environment (the worker owns this)

```
bring-up: copy the fixture into a trusted scratch path, git init, create the task worktree
teardown: kill any spike child still in `ps`, delete the scratch repo and the pi-tui scratch folder;
          confirm `claude agents --json` lists no pirprobe session
```

## Needs a person

Item 7 needs a real terminal. The worker prepares the script and asks the person to run it with a
seatbelt, `perl -e 'alarm 60; exec @ARGV' node <script>`.

Expect: a markdown block and an input box; each key pressed prints its name; the terminal is normal
after exit.
Tell me: did every key print the expected name, and was anything garbled or left behind on exit?

## Done when

- `FINDINGS.md` has one 📌 row per measurement above, with the Claude Code version.
- DESIGN §2.4 and §2.12 either stand or carry a dated one-line note of what changed.
- The person's answer to item 7 is recorded as a ✅ or 🐞 row; no scratch folder or probe process is left.

## Outside actions

- Probe worker — `worker`
- Install pi-tui from npm — `ask` (scratch folder only)
