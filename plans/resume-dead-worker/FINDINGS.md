# Findings log

**What the build taught.** Newest first. Forty words a row, counted. The long version is in the
commit message.

Legend: 🐞 defect found · ✅ verified by hand with the user · 📌 worth knowing · 🔄 a decision the
user changed.

| Date | | Finding |
|---|---|---|
| 2026-09-24 | 📌 | Probe, Claude Code 2.1.281: SIGKILL of an idle bg session's listed pid removes it from `claude agents --json`; `--all` keeps it as `state:done`, no pid. |
| 2026-09-24 | 🐞 | Probe: SIGKILL while a `run_in_background` job ran left the session listed with no pid for ~1 min, then the daemon woke it with a new pid. Today's loop would count it alive. Its `sleep 90` child outlived it. |
| 2026-09-24 | 📌 | Probe: `claude --bg --resume <sessionId> "<msg>"` on a stopped session continues the same id and name, in its original cwd whatever the caller's cwd, memory intact. |
| 2026-09-24 | 📌 | Probe: resuming a still-running session, or passing `-n` to one whose record exists, starts a copy: new id, same name, caller's cwd. Output says `started a copy as <id>`. |
| 2026-09-24 | 📌 | Probe: after `claude rm` the `.jsonl` stays and resume works, but in the caller's cwd under an auto-generated name. `-n` on a removed session is unmeasured (T00). |
| 2026-09-24 | 📌 | Probe: `claude stop <id>` alone now drops a session off the active list (pid gone), contradicting parallel-pir FINDINGS 2026-09-09. Close's SIGTERM may be redundant; left alone. |
| 2026-09-24 | 📌 | `claude --bg` refuses an untrusted cwd and trust does not inherit from a trusted parent (`~/src`). Probes reuse absent paths already trusted in `~/.claude.json` `projects`. |
| 2026-09-24 | 📌 | A ⛔ row (e.g. restart's merge-conflict block) displays as `queued`: display.mjs has no blocked kind. Only the given-up case is in scope (T05). |
