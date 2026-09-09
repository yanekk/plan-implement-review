# Findings log

**What the build taught.** Read the rows touching the task you pick up; read it whole before
anything only a person can verify — a ✅ row is the entire record that something was seen
working for real.

**Newest first. Forty words a row, counted.** The long version is in the commit message that
carried the fix. This is the index, not the account.

Legend: 🐞 defect found · ✅ verified by hand with the user · 📌 worth knowing ·
🔄 a decision the user changed.

| Date | | Finding |
|---|---|---|
| 2026-09-09 | 🐞 | T08 first live run: loop.mjs reads PROGRESS.md at the feature-worktree root (`join(feature.path,'PROGRESS.md')`), but the real plan keeps it at `plans/{slug}/PROGRESS.md`. The T05 fake writes it at root, hiding this. Blocks every real run; fix spans loop, fake, harness transport. |
| 2026-09-08 | 📌 | T08: a plain Node coordinator has no SendMessage inbox (it is an agent tool), so spawn-one-scratch.mjs observes the worker's task-branch PROGRESS row (🔍→implemented, ✅→done) instead. The real SendMessage-backed transport is T09's coordinate.mjs. |
| 2026-09-08 | 📌 | T07 review: `resolveSameRepo` scopes by repo only, so it also keeps the coordinator's own session, not just workers. Inert for the loop (spawn-driven, tracks workers by id). T09 must drop self (task=null) if it enumerates the list. |
| 2026-09-08 | 🐞 | T07 probe: SendMessage rejects a `to` starting with `@` ("to must be a bare teammate name"). Naming prefixed `@{repo}`, so a worker addressing the coordinator would fail. `·` and spaces are accepted. User dropped the `@` (2026-09-08); naming.mjs, §2.8, skills updated. |
| 2026-09-08 | 📌 | T07: `·` (U+00B7) separator confirmed accepted live by SendMessage — a nonexistent `·`-name fails at delivery ("No agent named … reachable"), not validation. Closes the §2.8 `·` live check. Agent probe, user away; no live agent spawned. |
| 2026-09-08 | 🐞 | T06 review: `remove` used single `git worktree remove --force`, which git refuses on a locked worktree; it reported ok anyway. Fixed to `--force --force`, confirmed on real git, with a test. A lock is the state `claude rm` also keeps. |
| 2026-09-08 | ✅ | T06 hand-verified with the user on a scratch clone (`src/pir-2`): `openFeature`/`createTask` made `.claude/worktrees/pir-demo` (`pir/demo`) and `pir-demo-T99` (`pir/demo-T99`) at the expected paths; `remove` of both ran without error. Real git matches the scratch-repo tests. |
| 2026-09-08 | 📌 | T06: real coordinator worktrees live at `<main>/.claude/worktrees/pir-{plan}[-T{nn}]`. In a scratch repo the empty `.claude/` container shows `?? .claude/`; the real repo stays clean (tracked siblings, and git excludes registered worktrees). `mergeTask`/`promote`/`commitFeature` force `commit.gpgsign=false` per-call so an automated run never blocks on signing. |
| 2026-09-08 | 🐞 | T05 review: loop calls `worktree.commitFeature` (the reconcile commit); not in T06's interface (openFeature/createTask/integrate/mergeTask/promote/remove, §3.2, T06.md). Added in T06 as a factory-only method (message-only; stateful over the remembered feature worktree). |
| 2026-09-08 | 🐞 | T05 review: the coordinator folds each merged row as `✅` with empty Notes — `parseProgress` drops the Notes column, so the worker's own row account is lost at promotion. Restore when the parser surfaces notes (T02) or T09 writes them. |
| 2026-09-08 | 📌 | T05 review: the loop tracks worker→task/phase in in-memory `state.tasks`, not via `parseAgentName` over live names (§2.8, T05 sketch). A coordinator crash without the kill switch leaves live workers a restart won't re-adopt; it re-spawns their tasks. T09 decides. |
| 2026-09-08 | 🐞 | T05: git refuses a branch `pir/{plan}` and `pir/{plan}/T{nn}` at once (directory/file ref clash). Task branches are now `pir/{plan}-T{nn}`, beside the feature branch. User chose the dash. DESIGN §2.9, T06/T07 docs, worktree.mjs updated. |
| 2026-09-08 | 📌 | T05 loop contracts for T06/T08: platform.close stops the session only; worktree.remove owns worktree/branch teardown, so an implementer closes while its reviewer keeps the shared worktree. A merge conflict surfaces as a worker decision message, not a mergeTask return. |
| 2026-09-08 | 📌 | T05 loop: a crashed worker (gone from `agents --json`) is cleaned up before the spawn step, and decideDispatch re-spawns its still-⬜ task the same pass. So a crash is retried, not dropped; a task that always crashes would respawn each pass. |
| 2026-09-07 | 📌 | T03 review: two decideDispatch crash gaps for the loop (T05/T06). A review-ready worker dying before its reviewer spawns is closed, orphaning the 🔍 task. A done worker dying before merge is closed unmerged; promoteToMain ignores dead workers, promoting without it. |
| 2026-09-07 | 📌 | T01 review: boundary scanner matches DESIGN §3.1's seven tokens exactly, but is text-based and non-recursive. It misses `node:http(s)`, `node:dns`, `performance.now`, `process.hrtime`; a future core clock or network leak via those passes. A decision if the core grows. |
| 2026-09-07 | 🐞 | T00: `SendMessage` addresses by NAME only and rejects a name containing `/` (`to must be a bare teammate name`). Names must be slash-free. Resolved: separator is now `·` not `/` (§2.8, naming.mjs); T07 confirms `·` is accepted live. |
| 2026-09-07 | 📌 | T00: coordinator→worker message reached the idle/blocked worker and it acted; reply arrived automatically, no receive-side setting needed. Worker replies to the `from=uds:/tmp/cc-socks/<n>.sock` socket address, so reply works despite the coordinator's own slashed name. |
| 2026-09-07 | 🐞 | T00: `claude --bg` takes the task as POSITIONAL, not `-p` (`--bg`+`--print` conflict, exit 1). DESIGN §2.8 and task docs wrote `-p "<task>"`; wrong. `-n "<name>"` sets the `agents --json` name verbatim (no repo prefix) and cwd is the worktree. |
| 2026-09-07 | 📌 | T00: fresh review confirmed — a second `--bg` session in the same worktree (implementer stopped first) reviewed with no shared context. Close: `claude stop <id>` drops the session; `git worktree remove --force` clears the worktree. Run by the agent, user away and delegating; not user-watched. |
| 2026-09-07 | 📌 | `FORCE_COLOR=3` is set in this environment. `NO_COLOR=1` alone is ignored by `node --test` (it warns and still emits ANSI). `FORCE_COLOR=0` inside the test command gives clean dot output. Command now sets `FORCE_COLOR=0` (DESIGN §5). |
| 2026-09-07 | 📌 | `claude --bg -n/--name "<name>"` sets a session's display name (picker, terminal title, `agents --json` name field). Observed names are `{repo} / {label}`. Whether the repo is auto-prefixed to `--name` and whether `SendMessage` addresses by this name is for T00 to confirm. |
| 2026-09-07 | 📌 | Fresh-eyes review needs no `/clear` trick: point a separate fresh session at the worker's worktree and it reviews the `🔍` task with no implementer context. Two sequential sessions on one worktree, which the platform supports. |
| 2026-09-07 | 📌 | Claude Code's own primitives cover the orchestration and work headless in any project: `claude --bg` + auto per-session worktrees, `SendMessage`/`ListAgents` cross-session messaging (v2.1.248+, all providers), `claude stop`/`rm` as the kill switch. Lean on these; do not rebuild. |
| 2026-09-07 | 🐞 | The brief's down-channel `claude --resume <id> -p "msg"` does NOT inject a turn into a running worker — it resumes a stopped session in a new terminal. The real primitive is `SendMessage` (bidirectional, headless). Corrected before build. |
| 2026-09-07 | 📌 | `claude agents --json` reports `status` (idle/busy) and `state` (working/done) per session, and lists sessions across other repos. Same-repo filtering must resolve each `cwd` via `git rev-parse --git-common-dir`; `--cwd` matches the repo root and returns `[]` for a worktree. |
| 2026-09-07 | 📌 | `claude rm <id>` removes the session's worktree only when it is clean (no uncommitted changes, no locks); otherwise it keeps both. Agent-view delete (Ctrl+X) always removes it. So close after a clean merge, or force-remove the worktree explicitly. |
