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
| 2026-09-27 | ✅ | T05 verified by hand with the user's phone: T01 `building` until turn end 07:50:26.8, `asking` 07:50:27.3, Remote Control on 07:50:27.7; phone reply 07:55:10.6, `building` 07:55:16.3. T02 stayed `asking` through its wake-up, `building` 2 s after the harness answer. |
| 2026-09-27 | 📌 | T05: the user's phone showed no notification for T01 although Remote Control switched on only after its turn ended. Push notifications for a waiting Remote Control session are not driven by pir; not in this plan's scope. |
| 2026-09-27 | 📌 | T05: the harness coordinator writes `status.json` only under `PIR_RUN`; a scenario's `statusSnapshots` sets it with a scratch `PIR_HOME` under `.parallel/`. Run 1 timed out unanswered; on HALT T01's Remote Control toggled off then on before exit. |
| 2026-09-27 | ⚠️ | T01, T03: `./install.sh` not run, barred during a live parallel run (DESIGN §5.3). The `ask` wording and the narrowed un-park reach `~/.claude/` only once someone installs after the run. |
| 2026-09-27 | 📌 | T00 review: not probed are a Remote Control message typed while a turn is open, and `origin` on `result`, which `readEntry` drops. T03 keys on `command_lifecycle` and tests the mid-turn case itself. |
| 2026-09-27 | ✅ | T00 verified by hand with the user's phone: a Remote Control typed reply, an AskUserQuestion pick and a permission allow each reached the probe worker; pick and allow logged `answered-remotely`. Recorded in `src/core/fixtures/remote-answer-sample.ndjson`. |
| 2026-09-27 | 📌 | T00 stream-only candidate separates, and T03 should use it: a Remote Control-typed turn opens with `command_lifecycle` `queued`/`started`; pir sends and wake-ups never emit it. Its `result` has `origin.kind` `human`, a wake-up's `task-notification`. Supersedes the `system/init`-only row. |
| 2026-09-27 | 📌 | T00 hook candidate does not separate: the SDK `UserPromptSubmit` callback fires for pir sends, Remote Control input and wake-ups alike, with `source` absent every time (Claude Code 2.1.283). Only the prompt text differs (`<task-notification>` prefix). |
| 2026-09-27 | 📌 | T00 replay candidate separates but is unneeded: `extraArgs { "replay-user-messages": null }` works headless; Remote Control input is replayed `isReplay` with `origin.kind` `human`, wake-ups are not. It only adds entries; the stream-only signal appears without it. |
| 2026-09-26 | 📌 | Planning: SDK 0.3.282 `UserPromptSubmitHookInput.source` is `user`/`sdk`/`system`/…; `SDKTaskNotificationMessage` precedes a background wake-up; `SDKUserMessageReplay` has `isReplay`. None yet measured against Remote Control input (T00). |
| 2026-09-26 | 📌 | Planning, from the `pir-remote-control` session: Remote Control-typed input yields no `user` message and no `bridge_state` in pir's stream, only the new turn's `system/init` (Claude Code 2.1.283). |
| 2026-09-25 | 🐞 | Live-workers run: T10 dropped a `question` report before an `ask`-bin `npm i`, auto mode allowed it with no prompt, and its row read `asking you` while it worked to `implemented`. The origin of this plan. |
