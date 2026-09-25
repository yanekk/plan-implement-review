# T00 — prove-live-worker

**Phase:** 0 · **Depends on:** — · **Weight:** medium

## Goal

Prove on this machine, with throwaway code, that a real worker driven through the Agent SDK does a real
pir task end to end, and that pi-tui installs and draws here. The plan-time probes only exercised
one-line prompts, most of them on the raw line before the SDK was chosen (2026-09-25); nothing yet shows
the pir-worker skill, auto mode, report files and a multi-step task behaving through the SDK. The
answers go in `FINDINGS.md`, the spike code is deleted.

## Design sections this implements

DESIGN §2.1, §2.4, §2.6, §2.7, §2.8, §2.11, §2.12, §5, §5.2.

## Files

None kept. A scratch repo copied from a harness fixture (`src/shell/harness/fixtures/single.mjs` or
the smallest one) on a path Claude Code already trusts, one task worktree, and a spike script plus its
own `npm i --omit=peer --omit=optional @anthropic-ai/claude-agent-sdk@0.3.282` in the job's tmp folder.
All deleted after.

## What to measure

1. A node spike calls `query()` with the DESIGN §2.1 options in the task worktree, pushes
   `openingInstruction('implement', 'T01')` as the first user message, allows every `canUseTool` call and
   logs it, and records every SDK message to an NDJSON file. Its `spawnClaudeCodeProcess` also tees the
   raw stdin and stdout lines to a second file. Does the worker load pir-worker and pir-implement, build
   the task, commit, and drop its `implemented` report into `reports/`? How many permission requests did
   auto mode send?
2. Across that whole run, is "a `result` message with nothing pending" a reliable idle signal? Note any
   `result` that arrived while the worker still meant to continue (for example a background task
   notification starting a new turn with no user message).
3. Ask the worker, in a second turn, to use AskUserQuestion; answer it through `canUseTool`; confirm the
   answer lands. Leave one permission request unanswered for 5 minutes: does anything time it out?
4. Return `updatedPermissions` (the request's `suggestions`, `destination:"session"`) on one allow: is the
   next identical request still asked? (Measured yes on the raw line, 2026-09-24.)
5. End the input queue after the worker's turn has ended: does the process exit, how fast, with what code?
   Then kill the parent spike with SIGKILL while the worker is mid-command (`sleep 30` in Bash): is the
   worker still alive 10 s later?
6. `extraArgs: { name: <a real workerName(), e.g. repo / plan / T01 / slug / implement> }` (naming.mjs
   joins with ` / `): does the name survive, and how does the worker appear in `claude agents --json`?
7. Which SDK message types and subtypes the run produced (system init, assistant text and tool_use, user
   tool_result, result success and error_during_execution, rate_limit_event, system notifications), and
   which control requests the tee saw that the SDK did not yield. Recordings stay in the scratch folder
   only until T01 starts: T01 regenerates and commits its own.
8. In a scratch folder, `npm i @earendil-works/pi-tui@0.87.1`, then a 30-line script that enters
   pi-tui, shows a Markdown block and an Editor, echoes the key names it receives for ↑ ↓ ← → Esc Tab
   Enter Space and Ctrl+S, and exits restoring the terminal.

The spike stops itself after a fixed number of turns and ends its input queue with a sentinel it never
sends as a message: a probe on 2026-09-25 that pushed its stop marker as a user message looped for 170
turns until its alarm fired.

## Environment (the worker owns this)

```
bring-up: copy the fixture into a trusted scratch path, git init, create the task worktree
teardown: kill any spike child still in `ps`, delete the scratch repo and the npm scratch folders;
          confirm `claude agents --json` lists no pirprobe session
```

## Needs a person

Item 8 needs a real terminal. The worker prepares the script and asks the person to run it with a
seatbelt, `perl -e 'alarm 60; exec @ARGV' node <script>`.

Expect: a markdown block and an input box; each key pressed prints its name; the terminal is normal
after exit.
Tell me: did every key print the expected name, and was anything garbled or left behind on exit?

## Done when

- `FINDINGS.md` has one 📌 row per measurement above, with the Claude Code and SDK versions.
- DESIGN §2.4, §2.6 and §2.12 either stand or carry a dated one-line note of what changed.
- The person's answer to item 8 is recorded as a ✅ or 🐞 row; no scratch folder or probe process is left.

## Outside actions

- Probe worker — `worker`
- Install packages from npm — `ask` (scratch folders only)
