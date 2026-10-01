# Findings

What the build taught, newest first. Forty words a row, counted. A hand-verification row keeps its date
for ever.

| Date | Finding |
|---|---|
| 2026-10-01 | `notify-wiring.test.mjs` "the end alert knows the finisher takes over…" fails 3/3 on `main` at `3a607f6` in a fresh worktree (`Promise resolution is still pending`). To be fixed on `main` before this build (DESIGN §4). |
| 2026-10-01 | In `pir plan`, a message the planner wrote in the same turn just before AskUserQuestion did not reach the person's screen; the list had to be put inside the question text. Planners should put what is being approved in the question. |
| 2026-10-01 | `zsh -ic` with stdin `/dev/null` loads the person's 237 aliases in 1.2 s; `zsh -lc` loads 2. Hence `$SHELL -i -c` for `!` (DESIGN §2.2). |
