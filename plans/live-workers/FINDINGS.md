# Findings log

**What the build taught.** Read the rows touching the task you pick up. A ✅ row is the entire record
that something was seen working for real.

**Newest first. Forty words a row, counted.** The long version is in the commit message. Whoever
appends, compacts: over 60 rows or 15 KB, shrink first. Never drop a ✅ row or its date, or a term
somebody would grep for.

Legend: 🐞 defect found · ✅ verified by hand with the user · 📌 worth knowing · 🔄 a decision the user
changed.

| Date | | Finding |
|---|---|---|
| 2026-09-25 | 📌 | T10: `.npmrc` needs `omit[]=peer` / `omit[]=optional`; a repeated plain `omit=` keeps only the last, and `npm ci` then installed all 95 SDK peers. A CLI `--omit=dev` replaces the `.npmrc` list, so install.sh repeats all three. |
| 2026-09-25 | 📌 | T10: pi-tui 0.87.1 has no `TUI` export; its screens are `TuiMainScreen` and `TuiAltScreen` (T11). With optionals omitted `npm ci` leaves empty `@babel`, `@hono`, `@modelcontextprotocol`, `@stablelib` scope folders holding no package. |
| 2026-09-25 | 🔄 | T00 review: Claude honours SDK session grants, but the user kept pir's own "don't ask again" list so every grant-allowed request stays visible; pir never returns `updatedPermissions` (DESIGN §2.6). |
| 2026-09-25 | ✅ | T00 item 8, verified by hand with the user: pi-tui 0.87.1 drew Markdown and an Editor; ↑ ↓ ← → Esc Tab Enter Space Ctrl+S parsed as `up down left right escape tab enter space ctrl+s`; terminal clean after exit. |
| 2026-09-25 | 📌 | T00: an input listener also received the terminal's cell-size reply `\u001b[6;16;8t` at start; pir's key handling must ignore it, not treat it as a key. |
| 2026-09-25 | 📌 | T00 item 5b (user-approved after an auto-mode `[Create Unsafe Agents]` block): parent SIGKILLed mid `sleep 30 && echo slept`; worker alive at +10 s, gone by +20 s. The Bash tool refuses a standalone `sleep 30`. |
| 2026-09-25 | 📌 | T00 (CC 2.1.282, SDK 0.3.282, sonnet): an SDK worker in auto mode loaded pir-worker and pir-implement, built fixture `single` T01, committed and dropped its `implemented` report in 34 s. Zero permission requests; a local force-push passed unasked. |
| 2026-09-25 | 📌 | T00: a `result` with nothing pending was a reliable idle signal: nothing arrived in the 20 s after any of five results. `system:init` is re-sent at the start of every turn, not once per process. |
| 2026-09-25 | 📌 | T00: AskUserQuestion via `canUseTool` (opts `requiresUserInteraction:true`), answered with `updatedInput` + `answers`, reached the model. Bash request opts: `description`, `blockedPath`, `displayName`, `toolUseID`, `requestId`, `suggestions`; no `decisionReason` in default mode. |
| 2026-09-25 | 📌 | T00: a `canUseTool` request left unanswered 300 s was not timed out: no abort signal, no message; allowed afterwards, the worker carried on normally. |
| 2026-09-25 | 🐞 | T00, through the SDK: allowing with the `addRules` suggestion at `destination:"session"` stopped the identical next request, contradicting the 2026-09-24 raw-line row. No settings file written. Returning every suggestion also applied `setMode acceptEdits` (`system:status`); filter to `addRules`. |
| 2026-09-25 | 📌 | T00: ending the input queue after an idle turn, the worker exited code 0 in 755 ms. |
| 2026-09-25 | 📌 | T00: `extraArgs:{name}` passed `--name` intact; `claude agents --json` listed the worker `kind:"interactive"`, that name, `sessionId` = pir's uuid, `status:"idle"`, its pid. The worker's report `from` guessed a different `{repo}` than its name. |
| 2026-09-25 | 📌 | T00 wire: stdin `initialize`, user, `control_response`; stdout `control_response`, `system:init`, `assistant`, `user`, `rate_limit_event`, `system:thinking_tokens`, `system:vcs_state_changed`, `system:status`, `result:success`, and `can_use_tool` (not yielded by the SDK). No error result or notification seen. |
| 2026-09-25 | 📌 | Agent SDK 0.3.282 on the Max login: `apiKeySource:none`, no API key. It spawned `claude --output-format stream-json --verbose --input-format stream-json --permission-prompt-tool stdio --permission-mode … --session-id=<ours> --name <ours>`; `interrupt()` acked at once, turn ended `error_during_execution`. |
| 2026-09-25 | 📌 | `npm i --omit=peer --omit=optional @anthropic-ai/claude-agent-sdk` installs one package, 4.9 MB; `sdk.mjs` imports only Node built-ins and ran fine. Default install is 269 MB: 95 peer packages plus the bundled 222 MB `claude`. |
| 2026-09-25 | 📌 | An idle SDK-driven worker exited within about 1 s after its parent `process.exit`ed. The 2026-09-24 mid-command survival (22 s) is not disproved; T00 item 5 rechecks it. |
| 2026-09-25 | 📌 | Billing: Anthropic paused (2026-06-15) moving `claude -p` and Agent SDK use to a separate monthly credit; both still draw subscription limits (support.claude.com article 15036540). Piped stream-json without `-p` also runs print mode (`entrypoint:"sdk-cli"`). |
| 2026-09-24 | 📌 | pi-tui 0.87.1 ships prebuilt `.node` binaries (darwin-arm64 `darwin-platform.node`); `terminal.js` loads it for modifier keys and clipboard. It is native code, not only JavaScript (plan review, `npm pack`). |
| 2026-09-24 | 📌 | A `-p` stream-json worker is listed in `claude agents --json` as `kind:"interactive"`, its `-n` name, `status:"busy"`, `id:null`. Visible to the person, not attachable, and must never be used as a handle (2.1.282). |
| 2026-09-24 | 📌 | A `-p` worker survived its parent's SIGKILL for 22 s while mid-command, until killed by hand. Hence `workers.json` and the reap (DESIGN §2.12). T00 measures exit after the turn ends. |
| 2026-09-24 | 📌 | Returning `updatedPermissions` with `destination:"session"` in a `can_use_tool` reply did not stop the next identical request (SDK contradicts: see T00 row). pir keeps "don't ask again" itself anyway (DESIGN §2.6). |
| 2026-09-24 | 📌 | `--permission-mode auto`: routine commands pass silently; a force-push arrived as `can_use_tool` with `decision_reason:"This command requires approval"`. A deny reply reached the model as a refusal. Without the flag, `default` mode. T00: a local force-push passed unasked. |
| 2026-09-24 | 📌 | Interrupt: `{"type":"control_request","request_id":…,"request":{"subtype":"interrupt"}}` ended the open turn in about 1 s (`result` subtype `error_during_execution`); the next user line ran normally. A backgrounded command kept running. |
| 2026-09-24 | 📌 | AskUserQuestion exists over `-p` only with `--permission-prompt-tool stdio`. Reply `allow` with `updatedInput` = input + `answers:{question:label}`, multi-select joined `", "`; round trip verified with two questions. |
| 2026-09-24 | 📌 | Slash commands sent as user text work over the line (`/context` report, `/model sonnet` switched). `init.terminal_slash_commands` lists the four that do not: doctor, color, focus, reload-plugins. |
| 2026-09-24 | 📌 | Measured on 2.1.281: one `-p` stream-json process holds many turns; a mid-turn user line joins the open turn; `--session-id` then `--resume` in a new process keeps the conversation; closing stdin exits 0. |
| 2026-09-24 | 📌 | macOS has no `timeout`; bound a probe with `perl -e 'alarm N; exec @ARGV' claude …`. |
