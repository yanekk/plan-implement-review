# base-branch — delivery report

## What was delivered

All ten tasks are done and reviewed, and the tests pass.

- **Each repo now names its own base branch.** pir no longer assumes `main`. A repo names the branch work starts from and returns to (for example `dev`) in a small settings file that is committed for everyone. You can also keep a file for your own machine only, and it overrides the committed one.
- **pir refuses to start when no base branch is named.** Planning and starting a build both stop, even in a repo that has `main`. The message gives the exact line to add. This repo now names `main`, so pir still runs on itself.
- **Work starts from the newest copy of the base branch.** Before cutting a branch, pir checks the remote for a newer copy of the base (it only reads, it never pushes) and starts from that. When it is safe, it moves your local copy forward too. If your local copy is checked out with unsaved changes, pir leaves it alone.
- **Clear refusals, with nothing half-made left behind.** pir refuses to start with a message saying what is wrong and how to fix it when:
  - the remote can't be reached or your login has expired;
  - your local branch and the remote's have split apart;
  - the branch exists nowhere;
  - a settings file is broken.
- **Repos with no remote just work.** They use the local branch, with no warning.
- **A running build keeps its base.** Changing the setting mid-build does not move it.
- **The end of a build syncs with the right branch and waits when it has to.** If the remote can't be reached, or the two copies have split apart, the run waits and retries every minute. It sends you one alert instead of handing over something stale. While it waits for your merge, it also checks the remote every 5 minutes, so it notices a merge you did on GitHub.
- **Every screen, alert, report and hand-off names the real branch.** The hand-off is now `git switch dev && git merge pir/{slug}` (with your branch name), so it is right whichever branch you have checked out.
- **The rules the sessions follow, the docs and the README** now talk about "the base branch" instead of `main`.

Not delivered, by design: promoting code between dev, stage and prod; any push or pull request; a different base per plan.

## Decisions made for you

None.

## What to check by hand

- **Refresh the installed pir after you merge.** Run `./install.sh` from this repo, while no run is live. Until you do, the `pir` you type still behaves the old way.
- **Add a settings file to every other repo you use pir in.** Otherwise pir will refuse to plan or build there. The refusal message gives the exact line, for example `{"baseBranch": "dev"}` in `.pir/settings.json`.
- **Try it once against a private remote with your real login.** The tests only used local copies, plus one public read of this repo from GitHub, which worked in about 2 seconds. In a repo with a private remote, run `pir plan` and check it starts from the newest base branch. If you can, also try once with an expired login or a locked SSH key: it should fail within about 30 seconds with a "could not fetch" message, not hang.
- **Everything else was already checked.** A worker drove the screens itself at two window sizes, in a repo that has only `dev`. Every line that names a branch said `dev`.

## Risks and follow-ups

- **An unreachable remote can freeze the screen for up to 30 seconds.**
  - At the end of a build, if the remote stops answering (rather than refusing straight away), the live view can freeze each time pir retries: once a minute while it waits, and every 5 minutes while it waits for your merge.
  - When you start a plan from the dashboard box, a slow remote freezes the screen with no "fetching…" note.
  - The worst case is 30 seconds each time. Worth a follow-up.
- **The dashboard shows only the reason code when a build can't start.** It shows `no-base-setting` instead of the full message with the fix. `pir start` shows the full message.
- **A plan name can be missed as already taken.** If your local base is out of date and has unsaved changes, pir doesn't move it forward. A plan that exists only on the remote's copy is then not seen as taken. Rare.
- **A base branch named exactly `pir` would fail with a git error** instead of a clear refusal. The check refuses only names starting `pir/`.
- **Bare `pir plan` checks the remote twice before starting.** It is harmless, only a little slower.
- **Old auto-mode rule left behind.** After `./install.sh`, your settings will hold both the old and the new pir auto-mode rule. Both are harmless; you can delete the old one by hand.
- **One planning-screen test sometimes fails on timing** when the whole suite runs, and passes when run again. It was not investigated.

## Branch

Synced with `main` at `0e775d2eb007` on 2026-09-30T05:03:47Z.
Tests: green.
