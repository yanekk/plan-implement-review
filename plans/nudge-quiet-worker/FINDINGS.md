# Findings log

**What the build taught.** Read the rows touching the task you pick up; read it whole before
anything only a person can verify. A ✅ row is the entire record that something was seen
working for real.

**Newest first. Forty words a row, counted.** The long version is in the commit message.

**Whoever appends, compacts.** Over 60 rows or 15 KB: merge repeats, drop rows now enforced by
code, a test or DESIGN (name where), never drop a ✅ row or its date, never drop a grep-able term.

Legend: 🐞 defect found · ✅ verified by hand with the user · 📌 worth knowing ·
🔄 a decision the user changed.

| Date | | Finding |
|---|---|---|
| 2026-09-26 | 📌 | Plan re-review: `/private/tmp/pir-quiet-worker`, the drill's `--into` path, has no `hasTrustDialogAccepted` entry in `~/.claude.json`, though live-workers §5.2 requires a trusted scratch path. Node 24.2.0, claude 2.1.283, SDK 0.3.282, 1034 tests green, as DESIGN §5 says. |
| 2026-09-26 | 🔄 | Re-planned on `live-workers` at the user's request: nudge sent by `platform.send`, activity read from pir's conversation log via `readEntry`. Hooks, note file, stop-and-resume, transcript reading and old T00/T04 dropped; tasks renumbered T01–T09. Needs `/pir-review-plan` again. |
| 2026-09-24 | 🔄 | Channel changed at plan review: this session's post to its own socket was blocked as "Credential Exploration"; the user rejected sockets. Now a note file shown by the worker's own `--settings` hooks, stop-and-resume as idle fallback (DESIGN §2.1). |
| 2026-09-24 | 📌 | Superseded by the re-plan, kept for grep: a `--bg` session ending its turn with a background `sleep 1200` stayed `busy` in `claude agents --json`; rows carry `pid`, `sessionId`, `kind`, `waitingFor`; transcript at `~/.claude/projects/<mangled cwd>/<sessionId>.jsonl`. |
| 2026-09-24 | 📌 | Superseded, kept for grep: posts to `/tmp/cc-socks/<pid>.sock` were blocked by the auto-mode classifier (Auto-Mode Bypass, Credential Exploration). `claude --bg` refuses an untrusted folder; `.claude/worktrees/` is trusted and git-ignored. |
