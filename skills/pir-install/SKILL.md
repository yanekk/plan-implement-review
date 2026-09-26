---
name: pir-install
description: Install the plan-implement-review (PIR) working method into the current repository — make sure the account-level pir-* skills are reachable here (refreshing them from a local PIR checkout when one is at hand) and create or amend this repo's CLAUDE.md with the PIR routine. Use when the user says "pir-install", "install pir", or asks to set up plan-implement-review in a project.
---

# install

Set the current repository up to use the plan-implement-review method. Two jobs, in order:

1. **The six working skills must be reachable here.** They are account-scoped — installed
   once under `~/.claude/skills/` and available in every repository — never copied per
   project, because a per-project copy is a copy that goes stale.
2. **This repository's `CLAUDE.md` must carry the PIR routine**, so every session opened in
   it works to the same method.

Do both, report what changed, and stop. This skill writes no plan and no product code.

## 1 — Make sure the account-level skills are reachable

The six are `pir-plan`, `pir-review-plan`, `pir-work`, `pir-implement`, `pir-review`, `pir-e2e`, and
they belong under `~/.claude/skills/`. Check which are present:

```sh
for s in pir-plan pir-review-plan pir-work pir-implement pir-review pir-e2e; do
  [ -d "$HOME/.claude/skills/$s" ] && echo "present  $s" || echo "MISSING  $s"
done
```

**If the current repo is a checkout of the PIR source** — detected by an `install.sh` and a
`skills/pir-work/SKILL.md` in the tree — refresh the account skills to the latest from it, so
they never lag behind the source, then report that they were refreshed:

```sh
./install.sh --global
```

**If it is not a PIR checkout**, do not download anything and do not carry a copy — an
arbitrary repo has no source to install from. Just report the check:

- All six present → say so and move on to `CLAUDE.md`.
- Any missing → **stop here.** Tell the user how to install them for their account, then stop
  and wait; do not try to work around it:

  ```
  Needs you — the pir-* skills are not installed for your account, and I cannot
  fetch them from an arbitrary repo. From a checkout of the PIR source, run:

      git clone https://github.com/yanekk/plan-implement-review
      cd plan-implement-review && ./install.sh --global

  Then re-run /pir-install here.
  ```

## 2 — Create or amend this repo's CLAUDE.md

The routine text is the PIR `CLAUDE.md`. Take it from the first of these that exists:

1. `./CLAUDE.md`, when the current repo **is** the PIR source checkout — the freshest copy.
2. `~/.claude/skills/pir-install/PIR-CLAUDE.md`, the copy `install.sh` dropped beside this
   skill when it installed it.

If neither exists, stop and tell the user you have the installer but not the routine text to
append, and point them at the PIR repo's `CLAUDE.md`.

**Append once, never twice.** The routine block opens with a comment carrying the marker
`Appended by plan-implement-review`, so re-running is safe:

- If this repo's `CLAUDE.md` already contains that marker → leave it alone, say so.
- Else if `CLAUDE.md` exists → append `\n\n---\n\n`, then the routine text.
- Else → create `CLAUDE.md` from the routine text.

Then make sure `plans/` exists (that is where every plan will live), with a `.gitkeep` if the
repo tracks empty directories.

## Report, then stop

One plain block:

- which account skills were present, and whether they were refreshed to latest;
- whether this repo's `CLAUDE.md` was created, amended, or already carried the routine;
- the next command — `/pir-plan` to start planning something.

Do not run `/pir-plan` yourself. Installing and planning are different sessions.
