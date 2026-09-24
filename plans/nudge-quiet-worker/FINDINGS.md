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
| 2026-09-24 | 🔄 | Channel changed at plan review: this session's post to its own socket was blocked as "Credential Exploration"; the user rejected sockets. Now a note file shown by the worker's own `--settings` hooks, stop-and-resume as idle fallback (DESIGN §2.1). |
| 2026-09-24 | 📌 | A `claude -p --input-format stream-json` process lists in `claude agents --json` as `kind:interactive`, idle; `claude attach` takes only `--bg` ids. Cezar drives agents this way and hands over only stopped sessions. |
| 2026-09-24 | 📌 | Plan review: `claude agents --json` rows also carry `kind` and `waitingFor`; a session blocked on input showed `status:waiting`, `state:blocked`, `waitingFor:"input needed"`. Unused by this plan; a possible signal for the out-of-scope permission-prompt case (DESIGN §8). |
| 2026-09-24 | 📌 | Planning session's own post to another session's socket was blocked by the auto-mode classifier (Auto-Mode Bypass). Superseded: sockets are not used (DESIGN §2.1). |
| 2026-09-24 | 📌 | Probe: a `claude --bg` session that ended its turn with a background `sleep 1200` stayed `busy`/`working` in `claude agents --json` for over a minute. The docs say otherwise. Transcript mtime froze at turn end. |
| 2026-09-24 | 📌 | `claude agents --json` gives `pid` and `sessionId`; the socket was `/tmp/cc-socks/<pid>.sock`; the transcript was `~/.claude/projects/<mangled cwd>/<sessionId>.jsonl`. `claude --bg` refuses an untrusted folder; `.claude/worktrees/` in this repo is trusted and git-ignored. |
