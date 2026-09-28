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
| 2026-09-28 | ✅ | T08 live run, verified by hand with the user: T02 alert arrived, reminder arrived, tap opened the worker's chat in the Claude app, the alert vanished after answering (iOS clear works), Claude app stayed silent, end alert's tap opened the agent's chat. |
| 2026-09-28 | 📌 | T08 bundle (UTC): pass T02 19:06:49.6, remote-control url 19:06:50.2, `notified` 19:06:55.0, reminder 19:08:57.2, answered 19:09:21.8, clear 19:09:22.2, end alert 19:10:57.5 (agent log). T01: no `notified`. All six facts pass. |
| 2026-09-28 | 📌 | T08: the iOS ntfy app has no QR scanner; the camera reads the QR as a URL. The user typed the topic in "Subscribe to topic". T09 and `pir notify`'s printed steps should lead with typing it. |
| 2026-09-28 | ✅ | T08, verified by hand with the user: `pir notify test` alerts arrived on the iPhone once subscribed; the first was missed before subscribing. No icon shown. |
| 2026-09-28 | 🔄 | T08: ntfy's publish docs mark `icon` Android-only; the planning row saying iOS was wrong. pir sends it correctly (URL 200, `image/png`). User chose: keep the icon, Android only. |
| 2026-09-28 | 📌 | T08: pushed `pir/reliable-notifications` to GitHub (`ask`, approved); icon URL 404 before, 200 after. Way back: `git push origin --delete pir/reliable-notifications`, which takes the default icon offline. |
| 2026-09-28 | 📌 | T08: a live drill without `statusSnapshots` keeps the real `PIR_HOME`, so once `~/.pir/notify.json` exists it sends real alerts to the person's phone. The harness could blank `PIR_NOTIFY_CONFIG` unless `realNotify`. Left alone (scope). |
| 2026-09-28 | 📌 | T06 review: uqr's compact QR draws light modules as `█` with a 1-module quiet zone, so it reads correctly on a dark terminal and inverted on a light one. T08 should scan it from the terminal the user actually uses. |
| 2026-09-28 | 📌 | T06: `uqr` is now a third runtime package, but `install.sh` and `src/shell/deps.test.mjs` still say "two runtime packages" and deps.test does not import it. Left alone (scope). |
| 2026-09-28 | 📌 | Plan re-review: local `main` is 305 commits ahead of `origin/main`, so the default icon URL (GitHub `main`) serves nothing until `main` is pushed. `gh auth status` and `claude auth status` both logged in; `ntfy.sh/v1/health` 200. |
| 2026-09-28 | 🔄 | Redesign: alerts now fire when a question is the person's (agent pass, timeout, reserved, agent down or off), plus one end-of-run alert and an icon. Branch synced with main first (`sync main into pir/reliable-notifications`). |
| 2026-09-28 | 📌 | Planning: ntfy publish docs list `icon` (JPEG or PNG by URL, cached 24 h) for Android, iOS and web. Unmeasured on the iPhone; T08 records it. |
| 2026-09-28 | 📌 | Planning: the harness sets a scratch `PIR_HOME` when `statusSnapshots` is on, hiding `~/.pir/notify.json`; T08 adds `realNotify` to set `PIR_NOTIFY_CONFIG`. |
| 2026-09-27 | 📌 | Plan review: JSON POST to `https://ntfy.sh` with `sequence_id` and `click` accepted, and `PUT /{topic}/{seq}/clear` returned 200 with a `message_clear` event (throwaway topic). Messages are cached about 12 h. `uqr` 0.1.3 is 79 KB unpacked, not 92. |
| 2026-09-27 | 📌 | Planning: ntfy docs name only Android and web for clearing (`PUT /{topic}/{seq}/clear`) and only Android for `ntfy://` links. iOS behaviour for both is unmeasured; T08 records it. |
| 2026-09-27 | 📌 | Planning: `CLAUDE_CLIENT_PRESENCE_FILE` (skip mobile push while the file exists) is on code.claude.com's remote-control page and in the 2.1.283 binary. Unmeasured for a headless SDK worker. |
| 2026-09-27 | 📌 | Planning: SDK `Options.env` replaces `process.env` rather than merging; pass `{ ...process.env, X }`. `enableRemoteControl` returns `session_url` like `https://claude.ai/code/session_…`. |
| 2026-09-27 | 📌 | Planning: `uqr` 0.1.3 `renderUnicodeCompact` draws a scannable QR in the terminal (probed in /tmp). fetch rejects non-Latin-1 header values, so publish as JSON. |
