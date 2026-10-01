# Findings

What the build taught, newest first. Forty words a row, counted. A hand-verification row keeps its date
for ever.

| Date | Finding |
|---|---|
| 2026-10-01 | T01: `notify-wiring.test.mjs` still fails its 10 cases in the full `npm test` on `pir/bang-commands` (main not yet fixed) but passes 14/14 run alone, so it is load-sensitive, not a fixed break. |
| 2026-10-01 | Plan review: the SDK's `tool()` rejects a JSON-schema input (`inputSchema must be a Zod schema or raw shape`), needs zod, which `.npmrc` omits as a peer; an external zod 4.6.5 works; undeclared arguments such as `pirResult` are stripped. |
| 2026-10-01 | Plan review: Claude Code here is logged in through Bedrock (`apiKeyHelper`), so a real session is billed API usage, not plan limits. Node on the PATH is v22.17.1, below `engines` >=22.19. |
| 2026-10-01 | Plan review fresh-copy run: `plan-rig-single-row.test.mjs` "single-red" failed once in the full suite (row read `"Fix the typo…"` not `rig-fix · `) and passed alone. Likely load-sensitive; watch it in the end gate. |
| 2026-10-01 | `notify-wiring.test.mjs` fails on `main` at `3a607f6` in a fresh worktree: 10 cases, all `Promise resolution is still pending`, on Node 22.17.1 and 22.22.3. To be fixed on `main` before this build (DESIGN §4). |
| 2026-10-01 | In `pir plan`, a message the planner wrote in the same turn just before AskUserQuestion did not reach the person's screen; the list had to be put inside the question text. Planners should put what is being approved in the question. |
| 2026-10-01 | `zsh -ic` with stdin `/dev/null` loads the person's 237 aliases in 1.2 s; `zsh -lc` loads 2. Hence `$SHELL -i -c` for `!` (DESIGN §2.2). |
