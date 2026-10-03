// single-finisher-live — one single run with real Claude that ends with the finisher (single-finisher T10,
// DESIGN §2.2, §2.5, §2.7, §5.1).
//
// Built on single-run-live: the same scratch package with its seeded off-by-one, the same settings, prompt
// and canned reply. Two things are added. The repo carries `.pir/rules/on-finish.md` (merge into the target
// branch, write FINISHED in the main checkout), so the finisher has rules to prepare. And the runner commits
// `moveBase` on the base once the build has started, in a file nobody else touches, so the base has moved
// by the time the review is over and the sync merges it in (`sync main into pir/{name}`) and runs the tests.
//
// Nobody stands in for the person's go: the answerer only reads build and review logs (capture parseLogName
// ignores `finisher-{n}.ndjson`), and the runner records every drop it made so a fact can show none went to
// the finisher. Once the finisher waits for the go the runner prints the dashboard command and the finisher's
// Remote Control link; the person answers `Go` in either. The dry pass in run-single.test.mjs plays that
// person through `onAwaitingGo`.
//
// The live command (T10 Environment; a `worker` action, DESIGN §5.3):
//
//   perl -e 'alarm 1500; exec @ARGV' node src/shell/harness/run.mjs single-finisher-live --into /tmp/pir-single-finisher-live

import { defineScenario } from '../scenario.mjs';
import {
  singleBuilderCommitGreen,
  singleFinished,
  singleFinisherFinishedAfterGo,
  singleFinisherWaitedSynced,
  singleGoLeftToPerson,
  singleIndexUnderName,
  singleNoSessionLeft,
} from '../assertions.mjs';
import singleRunLive, { PIR_HOME_DIR, PROMPT, REPLY, SETTINGS } from './single-run-live.mjs';

const id = 'single-finisher-live';
const title = 'A single run with real Claude that the finisher merges on the person\'s go, after the base moved';

// The project's finishing rules (finisher DESIGN §2.2: the repo's own file wins). `{target}` is said in words:
// the finisher is told the run's base, and the rules must not name a branch the run was not cut from.
export const RULES = `# Finishing rules for this scratch repo

1. In the person's main checkout, merge the run's branch into the target branch (the run's base):
   \`git -C <main checkout> merge --no-edit pir/<name>\`, then confirm
   \`git -C <main checkout> merge-base --is-ancestor pir/<name> <target>\` succeeds.
2. Write a file named \`FINISHED\` at the root of the main checkout, containing the one line \`finished\`.
   Do not commit it.

Nothing else: no push, no pull request, no install.
`;

// The commit the runner makes on the base once the build has started: a file the change never touches, so
// the sync merges it in cleanly and no resolve helper is needed.
export const MOVE_BASE = {
  files: { 'NOTES.md': '# Notes\n\nA line written on the base while the single run was building.\n' },
  message: 'notes: written on main while the single run built',
};

const files = { ...singleRunLive.files, '.pir/rules/on-finish.md': RULES };

const scenario = defineScenario({
  id,
  title,
  fixture: id,
  kind: 'single',
  // The live command runs under a 1500 s alarm (T10 Environment); the runner's own clock stops the run a
  // minute and a half before it, so the stop, the teardown and the bundle still happen. It bounds the
  // build, the review, the sync, the finisher's look and the person's go.
  seatbelts: { timeoutMs: 23 * 60_000 },
  reply: REPLY,
  replyCap: 10,
  facts: [
    singleFinished(),
    singleBuilderCommitGreen(),
    singleFinisherWaitedSynced(),
    singleGoLeftToPerson(),
    singleFinisherFinishedAfterGo(),
    singleIndexUnderName(),
    singleNoSessionLeft(),
  ],
});

export default {
  id,
  slug: null,
  title,
  files,
  settings: SETTINGS,
  carrySource: false,
  pirHome: PIR_HOME_DIR,
  prompt: PROMPT,
  finisher: true,
  moveBase: MOVE_BASE,
  scenario,
};
