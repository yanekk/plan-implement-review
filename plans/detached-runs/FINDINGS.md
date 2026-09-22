# Findings log

**What the build taught.** Read the rows touching the task you pick up; read it whole before
anything only a person can verify — a ✅ row is the *entire* record that something was seen
working for real.

**Newest first. Forty words a row, counted, not estimated.** The long version is in the commit
message that carried the fix. This is the index, not the account.

## Keeping it short

**Whoever appends, compacts.** Over 60 rows or 15 KB, spend two minutes shrinking first. Merge
rows that are one lesson twice; drop a row a test now enforces, naming where it went; never drop
a ✅ row or its date, and never drop a flag, error string or path someone would grep for.

Legend: 🐞 defect found · ✅ verified by hand with the user · 📌 worth knowing · 🔄 a decision
the user changed.

| Date | | Finding |
|---|---|---|
| 2026-09-22 | 🐞 | T12 hand-check: a crashed run with no status.json wrongly showed "died mid-pass; frame stale". Now shows "no snapshot recorded — failed to start" with the run.log tail and full path. Surfaced by a PARALLEL_ALLOW_HERE refusal in the canonical checkout. |
| 2026-09-22 | 🔄 | Key binding changed (user): ← steps back watch→list, Esc quits pir — replacing Esc-steps-back-then-quits (DESIGN §2.4, §2.11, prototype). /docs (T13) must carry the new keys; DESIGN §2.4/§2.11 now describe the old model. |
| 2026-09-22 | 📌 | pir dashboard refresh flicker: full-screen `2J` each poll read as the selection dropping. Fixed: paint home+EL(`\e[K`)+ED(`\e[J`) overwrite in place (no blank), and pin the selection to the run's slug, not its row index. |
| 2026-09-22 | 📌 | launch.mjs (T08) pre-flight gap: startRun spawns a coordinator that then refuses inside the canonical checkout (PARALLEL_ALLOW_HERE), leaving a crashed record — the "crashed instead of a clean error" DESIGN §2.5 says pre-flight should prevent. Consider adding the guard to startRun. |
| 2026-09-22 | 📌 | T12 ships keyboard nav only. The mock's mouse-click row-select (DESIGN §2.3 "arrow keys or a click") is deferred — arrows + Enter fully navigate. Mouse needs SGR-1006 tracking and parsing; ask the user if it is wanted before T13 docs. |
| 2026-09-22 | 📌 | T10 self-reporting needs T06 `index-store` to stamp a run's final status, but T06 is not a T10 dependency and is unbuilt. `coordinate.mjs` loads `index-store` lazily (dynamic import); `updateIndexFinalState` logic tested via injection. Consider adding T06 to T10's deps. |
| 2026-09-22 | 📌 | `stopRun` (control-run.mjs) signals `record.pid` on a bare `isAlive` check, no `lstart` re-verify (`exec` dropped). The pid-reuse guard is `classifyRun`'s (§3.3), upstream. Only call stop on a run classified `running`; stop is the actuator, not the identity guard. |
| 2026-09-22 | 🔄 | T08 survival check (run outlives terminal restart) deferred to the T12 live run (user): `pir` (T11) does not exist at T08's point, and only a seatbelted real run exercises it. T08 handed off with that half unverified. |
| 2026-09-22 | 📌 | `spawn(node, args, {detached:true, stdio:['ignore',fd,fd]})` + `child.unref()` outlives its parent on this Mac: the child reparented to pid 1 and kept running after the parent exited. This is the `pir start` mechanism (T08). |
| 2026-09-22 | 📌 | Process identity against number reuse: `ps -p {pid} -o lstart=` returns a stable launch time like `Tue Sep 22 08:27:37 2026`. Record it at start; a live process whose lstart differs is a reused number, so the run is crashed (DESIGN §3.3). |
| 2026-09-22 | 📌 | `caffeinate` at `/usr/bin/caffeinate`, `claude` at `~/.local/bin/claude`, node v24.2.0 at `/opt/homebrew/bin/node`. Keep-awake is `caffeinate -i -w {pid}`: `-w` waits on the process and exits when it dies, so keep-awake self-releases on any run death (DESIGN §2.9). |
| 2026-09-22 | ✅ | Prototype `prototype/index.html` approved by the user: `pir {slug}` starts and drops into the live view, `pir` opens a cross-repo list, a run opens the live task block, Esc steps back then quits, stop/remove are double-confirmed Ctrl+S / Ctrl+X chords, no process-number column. |
