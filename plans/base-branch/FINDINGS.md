# Findings log

What the build taught. Newest first. Forty words a row, counted. Legend: 🐞 defect found · ✅ verified by
hand with the user · 📌 worth knowing · 🔄 a decision the user changed.

| Date | | Finding |
|---|---|---|
| 2026-09-29 | 📌 | `slugTaken` reads the local base only. When the local `dev` is dirty and behind `origin/dev` (not moved, §2.3), a plan only on `origin/dev` is missed, though the plan branch contains it. Reproduced in T05 review; left for the user. |
| 2026-09-29 | 📌 | The dashboard box calls `startPlanRun` synchronously, so a slow fetch freezes the screen up to 30 s with no note. §2.6 asks for a synchronous fetch; a "fetching…" note first would help. Seen in T05 review. |
| 2026-09-29 | 📌 | Bare `pir plan` runs `planPreflight` (fetch included) before the brief box and again in `startPlanRun`, so a slow remote is waited on twice. Harmless; passing the first result through would remove it. |
| 2026-09-29 | 📌 | `validBranchName` accepts a base named exactly `pir`, which git cannot hold beside `pir/*` branches (ref directory clash), so cutting `pir/plan-*` would fail with a git error. §2.2 refuses only `pir/`. Left for the user. |
| 2026-09-29 | 📌 | T03 renamed `syncMain`/`mainContains`/`mainTip` to `syncBase`/`baseContains`/`baseTip`; `docs/branch-model.md` and `docs/coordinator-agent.md` still name the old functions. For T10. |
| 2026-09-29 | 📌 | `plan-rig.test.mjs` timing flakes under full `npm test`, pass alone and on re-run: "120×40: still in the planner's conversation" (T01, T08, T03 review, T04) and "80×24: → answers the planner" (T05, 30 s timeout). Not investigated. |
| 2026-09-29 | 📌 | T08 changed `PIR_AUTOMODE_RULE` text. `mergeUserAutoMode` appends a rule by exact text, so `./install.sh` on a machine with the old rule keeps both in `autoMode.allow`. Harmless; removing the stale pir rule would need a change in `settings.mjs`. |
| 2026-09-29 | 🔄 | No settings file: first agreed as default to `main`, reversed at the task checkpoint to refuse planning and building until a base is set. DESIGN §2.1, §7. |
| 2026-09-29 | 📌 | Measured: `git fetch origin dev:dev` refuses a checked-out branch (exit 128); `git branch -m` carries `branch.<name>.pirBase`; `ls-remote --exit-code --heads` exits 0 found, 2 missing, 128 unreachable; `GIT_TERMINAL_PROMPT=0` fails an https miss in 0.6 s. |
| 2026-09-29 | 📌 | `ensureMain` in `coordinate.mjs` runs `git checkout -B main HEAD` on the live path when `main` is missing. In a dev repo it would invent a `main`. T06 removes it. |
| 2026-09-29 | 📌 | macOS has no GNU `timeout`; bound git calls with Node `spawnSync`'s `timeout` option. |
