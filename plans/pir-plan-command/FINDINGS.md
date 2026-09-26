# Findings log

**What the build taught.** Read the rows touching the task you pick up; read it whole before
anything only a person can verify. A ✅ row is the entire record that something was seen working
for real.

**Newest first. Forty words a row, counted.** The long version is in the commit message.

**What goes here:** what the next session would otherwise rediscover · what you noticed and left
alone under the scope rule · every answer that came back from the user's own hands, dated.

**Whoever appends, compacts.** Over 60 rows or 15 KB: merge, drop what code or DESIGN now enforces
(say where), never drop a ✅ row or a grep-able term.

Legend: 🐞 defect found · ✅ verified by hand with the user · 📌 worth knowing ·
🔄 a decision the user changed.

| Date | | Finding |
|---|---|---|
| 2026-09-26 | 📌 | A repo without `.claude/worktrees/` ignored shows `?? .claude/` in the person's main checkout once `openFeature` or `openPlanBranch` adds a worktree; this repo hides it only via `.git/info/exclude`. worktree.mjs comment claims git excludes it (T04). |
| 2026-09-26 | 📌 | Claude Code docs (skills): a personal skill in `~/.claude/skills` shadows a same-named project skill. The harness `carrySkills` copy is ignored for any installed skill, so a live run uses the installed `pir-plan`. Plan review. |
| 2026-09-26 | 🐞 | Claude Code docs (permission-modes § protected paths): writes under `.git` are never auto-approved; auto mode routes them to the classifier and `permissions.allow` cannot pre-approve them. Control folder moved to `plans/plan-{hex4}/` (DESIGN §2.2). |
| 2026-09-26 | 📌 | SDK resume measured by `plans/resume-dead-worker` (2.1.283, SDK 0.3.282): SIGKILLed session resumed with `query({ resume })` kept id and memory, but thought its killed command never ran. T00 dropped (user). |
| 2026-09-26 | 📌 | Headless `claude` (stream-json with `--permission-prompt-tool stdio`, 2.1.283) has AskUserQuestion, Task and Skill but no Artifact tool, so a planner under `pir` cannot publish a mock. Plain `-p` lacks AskUserQuestion too. DESIGN §2.15. |
| 2026-09-26 | 📌 | git 2.50.1: `git branch -m` on a branch checked out in a linked worktree, then `git worktree move`, both work; the worktree reports the new branch. DESIGN §2.6. |
| 2026-09-26 | 📌 | `resolveClaudePath` is `command -v claude`, so a fake `claude` first on `PATH` reaches a detached run with no code change. DESIGN §5 End to end. |
