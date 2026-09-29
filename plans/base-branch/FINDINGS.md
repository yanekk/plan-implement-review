# Findings log

What the build taught. Newest first. Forty words a row, counted. Legend: 🐞 defect found · ✅ verified by
hand with the user · 📌 worth knowing · 🔄 a decision the user changed.

| Date | | Finding |
|---|---|---|
| 2026-09-29 | 📌 | `validBranchName` accepts a base named exactly `pir`, which git cannot hold beside `pir/*` branches (ref directory clash), so cutting `pir/plan-*` would fail with a git error. §2.2 refuses only `pir/`. Left for the user. |
| 2026-09-29 | 📌 | `plan-rig.test.mjs` end-to-end cases at 120×40 flake under full `npm test` load (read `finished` not `live`, or reviewer row not yet ✔); pass alone and on re-run. Seen by T01 and T08. Not investigated. |
| 2026-09-29 | 📌 | T08 changed `PIR_AUTOMODE_RULE` text. `mergeUserAutoMode` appends a rule by exact text, so `./install.sh` on a machine with the old rule keeps both in `autoMode.allow`. Harmless; removing the stale pir rule would need a change in `settings.mjs`. |
| 2026-09-29 | 🔄 | No settings file: first agreed as default to `main`, reversed at the task checkpoint to refuse planning and building until a base is set. DESIGN §2.1, §7. |
| 2026-09-29 | 📌 | Measured: `git fetch origin dev:dev` refuses a checked-out branch (exit 128); `git branch -m` carries `branch.<name>.pirBase`; `ls-remote --exit-code --heads` exits 0 found, 2 missing, 128 unreachable; `GIT_TERMINAL_PROMPT=0` fails an https miss in 0.6 s. |
| 2026-09-29 | 📌 | `ensureMain` in `coordinate.mjs` runs `git checkout -B main HEAD` on the live path when `main` is missing. In a dev repo it would invent a `main`. T06 removes it. |
| 2026-09-29 | 📌 | macOS has no GNU `timeout`; bound git calls with Node `spawnSync`'s `timeout` option. |
