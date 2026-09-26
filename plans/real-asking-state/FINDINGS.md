# Findings log

**What the build taught.** Read the rows touching the task you pick up; read it whole before
anything only a person can verify — a ✅ row is the *entire* record that something was seen
working for real.

**Newest first. Forty words a row, counted, not estimated.** The long version is already in
the commit message that carried the fix. This is the index, not the account.

**What goes here:** what the next session would otherwise rediscover · what you noticed and
left alone under the scope rule · every answer that came back from the user's own hands, dated.

**What does not:** a decision and its reasoning (that is the commit message) · anything the
code or a test now states for itself · a restatement of the row above.

Legend: 📌 fact learned · 🐞 bug found · ✅ verified by hand with the user · ⚠️ left alone (scope).

| Date | | Finding |
|---|---|---|
| 2026-09-26 | 📌 | Planning: SDK 0.3.282 `UserPromptSubmitHookInput.source` is `user`/`sdk`/`system`/…; `SDKTaskNotificationMessage` precedes a background wake-up; `SDKUserMessageReplay` has `isReplay`. None yet measured against Remote Control input (T00). |
| 2026-09-26 | 📌 | Planning, from the `pir-remote-control` session: Remote Control-typed input yields no `user` message and no `bridge_state` in pir's stream, only the new turn's `system/init` (Claude Code 2.1.283). |
| 2026-09-25 | 🐞 | Live-workers run: T10 dropped a `question` report before an `ask`-bin `npm i`, auto mode allowed it with no prompt, and its row read `asking you` while it worked to `implemented`. The origin of this plan. |
