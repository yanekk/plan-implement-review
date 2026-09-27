# Findings log

**What the build taught.** Read the rows touching the task you pick up; read it whole before
anything only a person can verify: a ✅ row is the entire record that something was seen working
for real.

**Newest first. Forty words a row, counted.** The long version is in the commit message.

**Whoever appends, compacts** when this file is over 60 rows or 15 KB. Never drop a ✅ row or its
date; never drop what somebody would grep for.

Legend: 🐞 defect found · ✅ verified by hand with the user · 📌 worth knowing ·
🔄 a decision the user changed.

| Date | | Finding |
|---|---|---|
| 2026-09-27 | 📌 | The runs list now reads `asking you` for a build while `askingCount` (`display.mjs`) is non-zero. T06 must make it count only person-held asks, or coordinator-held ones turn the run amber. |
| 2026-09-27 | 📌 | SDK 0.3.282 custom tools (`createSdkMcpServer`, `tool()`) need peers `zod` ^4 and `@modelcontextprotocol/sdk` ^1.29, not installed here. Hence decision files (DESIGN §2.3). |
| 2026-09-27 | 📌 | SDK 0.3.282 `CanUseTool` options carry `matchedAskRule {source, toolName, ruleContent}` for asks forced by a `permissions.ask` rule, and `defaultToNo`. Unmeasured on the real CLI until T00. |
| 2026-09-27 | 🔄 | The person first wanted the agent to merge, then chose "leave merging to me": the agent prepares the branch and hands over (DESIGN §2.9). |
