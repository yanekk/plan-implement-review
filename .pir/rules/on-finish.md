# Finishing rules for plan-implement-review

1. In the person's main checkout, merge the build's branch into the target branch:
   `git -C <main checkout> merge pir/{slug}`, then confirm
   `git -C <main checkout> merge-base --is-ancestor pir/{slug} <target>` succeeds.
2. Make the merged code live: run `./install.sh` from the main checkout. A code change is not live until
   it is installed (`CLAUDE.md § A code change is not live until you install it`).
3. Confirm the installed copy matches what was merged. From the main checkout:
   - `diff -rq src ~/.claude/pir-engine/src` prints nothing;
   - for each skill directory `skills/pir-*`, `diff -rq skills/<name> ~/.claude/skills/<name>` prints
     nothing, except that `pir-install` also holds the installed `PIR-CLAUDE.md`, which is expected.

Do not push and do not open a pull request.
