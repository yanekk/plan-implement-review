# Findings log

**What the build taught.** Newest first. Forty words a row, counted. The long version is in the
commit message.

Legend: 🐞 defect found · ✅ verified by hand with the user · 📌 worth knowing · 🔄 a decision the
user changed.

| Date | | Finding |
|---|---|---|
| 2026-09-26 | 🔄 | Re-planned onto live workers. The 2026-09-24 `claude --bg` probe rows (agents-list death shapes, `--bg --resume` copies, `claude rm`) were dropped: that transport is gone. The old T00 spike went with them. |
| 2026-09-26 | 📌 | Probe, Claude Code 2.1.283, SDK 0.3.282: a worker SIGKILLed mid-Bash, resumed via `query({ resume: id })` in the same cwd with `--name`, kept its id, `.jsonl` and memory; no copy. It wrongly said its killed command never started. |
| 2026-09-24 | 📌 | `claude --bg` refuses an untrusted cwd and trust does not inherit from a trusted parent (`~/src`). Probes reuse absent paths already trusted in `~/.claude.json` `projects`. |
| 2026-09-24 | 📌 | A ⛔ row (e.g. restart's merge-conflict block) displays as `queued`: display.mjs has no blocked kind. Only the given-up case is in scope (T05). |
