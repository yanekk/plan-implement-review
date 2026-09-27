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
| 2026-09-27 | ⚠️ | T01: `./install.sh` not run by implementer or reviewer, the task bars it during a live parallel run. The new `ask` wording reaches `~/.claude/skills/pir-worker/SKILL.md` only once someone installs after the run. |
| 2026-09-27 | 📌 | T00 review: not probed are a Remote Control message typed while a turn is open, and `origin` on `result`, which `readEntry` drops. T03 keys on `command_lifecycle` and tests the mid-turn case itself. |
| 2026-09-27 | ✅ | T00 verified by hand with the user's phone: a Remote Control typed reply, an AskUserQuestion pick and a permission allow each reached the probe worker; pick and allow logged `answered-remotely`. Recorded in `src/core/fixtures/remote-answer-sample.ndjson`. |
| 2026-09-27 | 📌 | T00 stream-only candidate separates, and T03 should use it: a Remote Control-typed turn opens with `command_lifecycle` `queued`/`started`; pir sends and wake-ups never emit it. Its `result` has `origin.kind` `human`, a wake-up's `task-notification`. Supersedes the `system/init`-only row. |
| 2026-09-27 | 📌 | T00 hook candidate does not separate: the SDK `UserPromptSubmit` callback fires for pir sends, Remote Control input and wake-ups alike, with `source` absent every time (Claude Code 2.1.283). Only the prompt text differs (`<task-notification>` prefix). |
| 2026-09-27 | 📌 | T00 replay candidate separates but is unneeded: `extraArgs { "replay-user-messages": null }` works headless; Remote Control input is replayed `isReplay` with `origin.kind` `human`, wake-ups are not. It only adds entries; the stream-only signal appears without it. |
| 2026-09-26 | 📌 | Planning: SDK 0.3.282 `UserPromptSubmitHookInput.source` is `user`/`sdk`/`system`/…; `SDKTaskNotificationMessage` precedes a background wake-up; `SDKUserMessageReplay` has `isReplay`. None yet measured against Remote Control input (T00). |
| 2026-09-26 | 📌 | Planning, from the `pir-remote-control` session: Remote Control-typed input yields no `user` message and no `bridge_state` in pir's stream, only the new turn's `system/init` (Claude Code 2.1.283). |
| 2026-09-25 | 🐞 | Live-workers run: T10 dropped a `question` report before an `ask`-bin `npm i`, auto mode allowed it with no prompt, and its row read `asking you` while it worked to `implemented`. The origin of this plan. |
