# Finishing rules (default)

pir's default rules for finishing a parallel build run. Copied here by `install.sh` only when this file
did not exist, so your edits survive a reinstall. For one repository, put your own in
`.pir/rules/on-finish.md` in the repo or in `~/.pir/{repo}/rules/on-finish.md`; the first that exists wins.

The target branch is the branch the run was cut from. pir names it to the finisher; it is not set here.

1. In the person's main checkout, merge the build's branch into the target branch:
   `git -C <main checkout> merge pir/{slug}`, with the checkout on the target branch.
2. Confirm the target branch now contains the branch tip:
   `git -C <main checkout> merge-base --is-ancestor pir/{slug} <target>` succeeds.

Nothing else: no push, no pull request, no install.
