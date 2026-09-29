# Findings log

What the build taught. Newest first. Forty words a row, counted. Legend: 🐞 defect found · ✅ verified by
hand with the user · 📌 worth knowing · 🔄 a decision the user changed.

| Date | | Finding |
|---|---|---|
| 2026-09-29 | 📌 | T03 renamed `syncMain`/`mainContains`/`mainTip` to `syncBase`/`baseContains`/`baseTip`; `docs/branch-model.md` and `docs/coordinator-agent.md` still name the old functions. For T10. |
| 2026-09-29 | 📌 | `plan-rig.test.mjs` "end to end at 120×40 … reviewer's" failed once under full `npm test` load (reviewer row still ⠋), passed three runs alone and the next full run. Timing flake, untouched by T03. |
| 2026-09-29 | 🔄 | No settings file: first agreed as default to `main`, reversed at the task checkpoint to refuse planning and building until a base is set. DESIGN §2.1, §7. |
| 2026-09-29 | 📌 | Measured: `git fetch origin dev:dev` refuses a checked-out branch (exit 128); `git branch -m` carries `branch.<name>.pirBase`; `ls-remote --exit-code --heads` exits 0 found, 2 missing, 128 unreachable; `GIT_TERMINAL_PROMPT=0` fails an https miss in 0.6 s. |
| 2026-09-29 | 📌 | `ensureMain` in `coordinate.mjs` runs `git checkout -B main HEAD` on the live path when `main` is missing. In a dev repo it would invent a `main`. T06 removes it. |
| 2026-09-29 | 📌 | macOS has no GNU `timeout`; bound git calls with Node `spawnSync`'s `timeout` option. |
