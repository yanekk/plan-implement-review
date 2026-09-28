# Findings log

**What the build taught.** Read the rows touching the task you pick up; read it whole before
anything only a person can verify. A ✅ row is the entire record that something was seen
working for real.

**Newest first. Forty words a row, counted.** The long version is in the commit message.

**Whoever appends, compacts** (over 60 rows or 15 KB). Never drop a ✅ row or its date; never drop
what somebody would grep for. Never write the user's ntfy topic here.

Legend: 🐞 defect found · ✅ verified by hand with the user · 📌 worth knowing ·
🔄 a decision the user changed.

| Date | | Finding |
|---|---|---|
| 2026-09-28 | 📌 | Plan re-review: local `main` is 305 commits ahead of `origin/main`, so the default icon URL (GitHub `main`) serves nothing until `main` is pushed. `gh auth status` and `claude auth status` both logged in; `ntfy.sh/v1/health` 200. |
| 2026-09-28 | 🔄 | Redesign: alerts now fire when a question is the person's (agent pass, timeout, reserved, agent down or off), plus one end-of-run alert and an icon. Branch synced with main first (`sync main into pir/reliable-notifications`). |
| 2026-09-28 | 📌 | Planning: ntfy publish docs list `icon` (JPEG or PNG by URL, cached 24 h) for Android, iOS and web. Unmeasured on the iPhone; T08 records it. |
| 2026-09-28 | 📌 | Planning: the harness sets a scratch `PIR_HOME` when `statusSnapshots` is on, hiding `~/.pir/notify.json`; T08 adds `realNotify` to set `PIR_NOTIFY_CONFIG`. |
| 2026-09-27 | 📌 | Plan review: JSON POST to `https://ntfy.sh` with `sequence_id` and `click` accepted, and `PUT /{topic}/{seq}/clear` returned 200 with a `message_clear` event (throwaway topic). Messages are cached about 12 h. `uqr` 0.1.3 is 79 KB unpacked, not 92. |
| 2026-09-27 | 📌 | Planning: ntfy docs name only Android and web for clearing (`PUT /{topic}/{seq}/clear`) and only Android for `ntfy://` links. iOS behaviour for both is unmeasured; T08 records it. |
| 2026-09-27 | 📌 | Planning: `CLAUDE_CLIENT_PRESENCE_FILE` (skip mobile push while the file exists) is on code.claude.com's remote-control page and in the 2.1.283 binary. Unmeasured for a headless SDK worker. |
| 2026-09-27 | 📌 | Planning: SDK `Options.env` replaces `process.env` rather than merging; pass `{ ...process.env, X }`. `enableRemoteControl` returns `session_url` like `https://claude.ai/code/session_…`. |
| 2026-09-27 | 📌 | Planning: `uqr` 0.1.3 `renderUnicodeCompact` draws a scannable QR in the terminal (probed in /tmp). fetch rejects non-Latin-1 header values, so publish as JSON. |
