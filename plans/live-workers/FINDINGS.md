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
| 2026-09-25 | 📌 | Agent SDK 0.3.282 on the Max login: `apiKeySource:none`, no API key. It spawned `claude --output-format stream-json --verbose --input-format stream-json --permission-prompt-tool stdio --permission-mode … --session-id=<ours> --name <ours>`; `interrupt()` acked at once, turn ended `error_during_execution`. |
| 2026-09-25 | 📌 | `npm i --omit=peer --omit=optional @anthropic-ai/claude-agent-sdk` installs one package, 4.9 MB; `sdk.mjs` imports only Node built-ins and ran fine. Default install is 269 MB: 95 peer packages plus the bundled 222 MB `claude`. |
| 2026-09-25 | 📌 | An idle SDK-driven worker exited within about 1 s after its parent `process.exit`ed. The 2026-09-24 mid-command survival (22 s) is not disproved; T00 item 5 rechecks it. |
| 2026-09-25 | 📌 | Billing: Anthropic paused (2026-06-15) moving `claude -p` and Agent SDK use to a separate monthly credit; both still draw subscription limits (support.claude.com article 15036540). Piped stream-json without `-p` also runs print mode (`entrypoint:"sdk-cli"`). |
| 2026-09-24 | 📌 | pi-tui 0.87.1 ships prebuilt `.node` binaries (darwin-arm64 `darwin-platform.node`); `terminal.js` loads it for modifier keys and clipboard. It is native code, not only JavaScript (plan review, `npm pack`). |
| 2026-09-24 | 📌 | A `-p` stream-json worker is listed in `claude agents --json` as `kind:"interactive"`, its `-n` name, `status:"busy"`, `id:null`. Visible to the person, not attachable, and must never be used as a handle (2.1.282). |
| 2026-09-24 | 📌 | A `-p` worker survived its parent's SIGKILL for 22 s while mid-command, until killed by hand. Hence `workers.json` and the reap (DESIGN §2.12). T00 measures exit after the turn ends. |
| 2026-09-24 | 📌 | Returning `updatedPermissions` with `destination:"session"` in a `can_use_tool` reply did not stop the next identical request. pir keeps "don't ask again" itself (DESIGN §2.6). |
| 2026-09-24 | 📌 | `--permission-mode auto`: routine commands pass silently; a force-push arrived as `can_use_tool` with `decision_reason:"This command requires approval"`. A deny reply reached the model as a refusal. Without the flag a `-p` worker is in `default` mode. |
| 2026-09-24 | 📌 | Interrupt: `{"type":"control_request","request_id":…,"request":{"subtype":"interrupt"}}` ended the open turn in about 1 s (`result` subtype `error_during_execution`); the next user line ran normally. A backgrounded command kept running. |
| 2026-09-24 | 📌 | AskUserQuestion exists over `-p` only with `--permission-prompt-tool stdio`. Reply `allow` with `updatedInput` = input + `answers:{question:label}`, multi-select joined `", "`; round trip verified with two questions. |
| 2026-09-24 | 📌 | Slash commands sent as user text work over the line (`/context` report, `/model sonnet` switched). `init.terminal_slash_commands` lists the four that do not: doctor, color, focus, reload-plugins. |
| 2026-09-24 | 📌 | Measured on 2.1.281: one `-p` stream-json process holds many turns; a mid-turn user line joins the open turn; `--session-id` then `--resume` in a new process keeps the conversation; closing stdin exits 0. |
| 2026-09-24 | 📌 | macOS has no `timeout`; bound a probe with `perl -e 'alarm N; exec @ARGV' claude …`. |
