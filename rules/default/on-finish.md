# Finishing rules (default)

pir's default rules for finishing a parallel build run. Copied here by `install.sh` only when this file
did not exist, so your edits survive a reinstall. For one repository, put your own in
`.pir/rules/on-finish.md` in the repo or in `~/.pir/{repo}/rules/on-finish.md`; the first that exists wins.

1. In the person's main checkout, merge the build's branch into `main`:
   `git -C <main checkout> merge pir/{slug}`.
2. Confirm `main` now contains the branch tip:
   `git -C <main checkout> merge-base --is-ancestor pir/{slug} main` succeeds.

Nothing else: no push, no pull request, no install.
