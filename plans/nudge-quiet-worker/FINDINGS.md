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
| 2026-09-24 | 📌 | Planning session's own post to another session's socket was blocked by the auto-mode classifier (Auto-Mode Bypass). T00 needs its `ask` permission rule in place first; the coordinator itself is a plain process and is not classifier-gated. |
| 2026-09-24 | 📌 | Probe: a `claude --bg` session that ended its turn with a background `sleep 1200` stayed `busy`/`working` in `claude agents --json` for over a minute. The docs say otherwise. Transcript mtime froze at turn end. |
| 2026-09-24 | 📌 | `claude agents --json` gives `pid` and `sessionId`; the socket was `/tmp/cc-socks/<pid>.sock`; the transcript was `~/.claude/projects/<mangled cwd>/<sessionId>.jsonl`. `claude --bg` refuses an untrusted folder; `.claude/worktrees/` in this repo is trusted and git-ignored. |
| 2026-09-24 | 📌 | Socket wire format, from the 2.1.281 binary's help text: optional `{"type":"auth","token":…}` line, then `{"type":"user","message":{"role":"user","content":"…"}}`. The docs page omits the message line. Connection must send a full line within 30 s. |
