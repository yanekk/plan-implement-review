# Findings log

What the build taught. Read the rows touching the task you pick up; read it whole before
anything only a person can verify — a ✅ row is the entire record that something was seen
working for real.

Newest first. Forty words a row, counted. The long version is in the commit message.

Legend: 🐞 defect found · ✅ verified by hand with the user · 📌 worth knowing ·
🔄 a decision the user changed.

| Date | | Finding |
|---|---|---|
| 2026-09-17 | 📌 | A session reads its OWN name for the §2.7 startup check by matching `$CLAUDE_CODE_SESSION_ID` against the `sessionId` field in `claude agents --json`, which carries `name`. Coordinators run `--bg` and self-list, so this works at startup (probed in a live `--bg` session). This is the mechanism T05's name check needs. |
| 2026-09-17 | 📌 | Root cause of the `my-ender/print-vision` halt: a `you`-task completes with no `answer` and no `surface` to the coordinator, so a legitimate merge looked like unexplained silence. The coordinator read it as fraud and created the HALT file. This plan supplies the missing signal (T02). |
| 2026-09-17 | 📌 | The T02 down-send did NOT fail: SendMessage returned success/"queued" and the T02 reviewer received the "Option A" answer. The reviewer was killed mid-integration by the halt, not by a delivery failure. The message-flow fix (T01/T05) hardens a working-but-fragile path, not a broken one. |
| 2026-09-17 | 📌 | `spawnArgv` in platform.mjs sets NO permission mode (`['--bg','-n',name,instruction]`), so a worker lands in the default that required approval — why the T02 delivery said "its user must approve first". `claude --help` lists `--permission-mode bypassPermissions` and `--dangerously-skip-permissions`; T00 confirms which auto-accepts message delivery. |
| 2026-09-17 | 📌 | `naming.mjs` already has `coordinatorName` and `parseAgentName` (a `/` name returns `matches:false`), so T03's validator extends them, not rebuilds. The failed coordinator was launched `my-ender / print-vision-refactor` — a `/` and the wrong slug — but it did no harm because workers report up by file and never address the coordinator by name. |
