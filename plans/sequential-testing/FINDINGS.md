# Findings log

**What the build taught.** Read the rows touching the task you pick up; read it whole before
anything only a person can verify. A ✅ row is the entire record that something was seen working
for real.

**Newest first. Forty words a row, counted.** The long version is in the commit message.

**Whoever appends, compacts.** Over 60 rows or 15 KB, shrink it first. Never drop a ✅ row or its
date, or a term somebody would grep for.

Legend: 🐞 defect found · ✅ verified by hand with the user · 📌 worth knowing ·
🔄 a decision the user changed.

| Date | | Finding |
|---|---|---|
| 2026-10-02 | 📌 | `claude auth status` here reports `apiProvider: bedrock`, `authMethod: third_party`. Real sessions are paid usage, not plan limits as earlier plans' §5.3 rows say, so T16's live run is `ask`. |
| 2026-10-02 | 📌 | `npm test` took 3 min 17 s wall at about 230% CPU. Without `node_modules` two harness tests fail (`api-usage-e2e`, `fixtures.test.mjs` "node_modules was linked in"); the setup line fixes that. |
| 2026-10-02 | 📌 | `runFeatureTests` runs the suite with `execFileSync` inside the pass, freezing repaint, inbox and agent for the whole suite. T08 replaces it with a queued job. |
| 2026-10-02 | 📌 | A build restart spawns fresh workers; it cannot reopen a closed worker's session (`resume-dead-worker` is planned, unbuilt). T07's retest worker is a fresh session told to check the person's edits. |
