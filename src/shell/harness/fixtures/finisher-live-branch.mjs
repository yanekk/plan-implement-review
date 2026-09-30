// finisher-live-branch — the live check of the finisher on a run cut from a branch other than `main`
// (user, 2026-09-30). The same scratch plan as finisher-live, with three things made hard on purpose:
//
//   - the run's base is `release`, named in `.pir/settings.json`, so `release` is the finisher's target;
//   - the person's main checkout is left on `main`, a second branch at the same commit, so the finisher
//     must list a switch to `release` as a step and take it only after the go;
//   - the repo's rules still say "merge into `main`", as a rules file written before the finisher was told
//     its target would: the run's target must win, and the ready summary must say so.
//
// What the run must show, beyond finisher-live's facts: before the go the checkout is still on `main` and
// nothing is merged anywhere; after it `pir/{slug}` is in `release` and not in `main`, and the checkout is
// on `release`. The person reads the ready summary on the phone and answers `Go` there.
//
//   perl -e 'alarm 900; exec @ARGV' node src/shell/harness/run.mjs finisher-live-branch --into /tmp/pir-finisher-live-branch

import { finisherLiveFixture } from './finisher-live.mjs';

export default finisherLiveFixture({
  slug: 'finisher-live-branch',
  title: 'The finisher on a run cut from `release` — switches the checkout after the go, merges into `release`, not `main`',
  base: 'release',
  parkOn: 'main',
});
