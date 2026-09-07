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
| 2026-09-07 | 📌 | `claude agents --cwd <path>` matches the repo root, not the live worktree cwd, so filtering by a worktree path returns `[]`. Read the `cwd` field from `--json` and resolve via `git rev-parse --git-common-dir` instead. |
| 2026-09-07 | 📌 | `claude --resume <id>` on an already-running session starts a copy rather than injecting a turn (per `--help`). So the immediate down-channel likely needs an idle worker or attach-injection; T00 settles which. |
| 2026-09-07 | 📌 | Probed on the machine: `claude` 2.1.263 has `--bg`, `agents --json` (id/name/cwd, `--all`, `--cwd`), and first-class `attach` / `logs` / `stop\|kill` / `rm` / `respawn`. `rm` removes the session's worktree when safe. |
| 2026-09-07 | 📌 | A carriage return submits an injected line; a newline does not. Only relevant if the attach-injection fallback is used instead of `--resume -p`. |
