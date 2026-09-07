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
| 2026-09-07 | 📌 | `FORCE_COLOR=3` is set in this environment. `NO_COLOR=1` alone is ignored by `node --test` (it warns and still emits ANSI). `FORCE_COLOR=0` inside the test command gives clean dot output. Command now sets `FORCE_COLOR=0` (DESIGN §5). |
| 2026-09-07 | 📌 | `claude --bg -n/--name "<name>"` sets a session's display name (picker, terminal title, `agents --json` name field). Observed names are `{repo} / {label}`. Whether the repo is auto-prefixed to `--name` and whether `SendMessage` addresses by this name is for T00 to confirm. |
| 2026-09-07 | 📌 | Fresh-eyes review needs no `/clear` trick: point a separate fresh session at the worker's worktree and it reviews the `🔍` task with no implementer context. Two sequential sessions on one worktree, which the platform supports. |
| 2026-09-07 | 📌 | Claude Code's own primitives cover the orchestration and work headless in any project: `claude --bg` + auto per-session worktrees, `SendMessage`/`ListAgents` cross-session messaging (v2.1.248+, all providers), `claude stop`/`rm` as the kill switch. Lean on these; do not rebuild. |
| 2026-09-07 | 🐞 | The brief's down-channel `claude --resume <id> -p "msg"` does NOT inject a turn into a running worker — it resumes a stopped session in a new terminal. The real primitive is `SendMessage` (bidirectional, headless). Corrected before build. |
| 2026-09-07 | 📌 | `claude agents --json` reports `status` (idle/busy) and `state` (working/done) per session, and lists sessions across other repos. Same-repo filtering must resolve each `cwd` via `git rev-parse --git-common-dir`; `--cwd` matches the repo root and returns `[]` for a worktree. |
| 2026-09-07 | 📌 | `claude rm <id>` removes the session's worktree only when it is clean (no uncommitted changes, no locks); otherwise it keeps both. Agent-view delete (Ctrl+X) always removes it. So close after a clean merge, or force-remove the worktree explicitly. |
