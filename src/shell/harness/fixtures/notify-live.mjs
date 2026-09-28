// notify-live — the live check of phone alerts (reliable-notifications T08, DESIGN §1 success criteria):
// real workers, the real coordinator agent, real ntfy alerts to the person's own topic, and the person on
// the phone. Two INDEPENDENT tasks at ceiling 2:
//   T01 asks, through the AskUserQuestion tool, a naming question this fixture's DESIGN.md answers. The
//       agent answers it, so T01 is never the person's and never alerts (no `notified` in its log).
//   T02 drops a `question` report and asks in plain text a public-API question. The project rules file
//       tells the agent to pass public-API questions on, so it becomes the person's: Remote Control switches
//       on, then an alert goes to the phone (`notified`, reminder false), and one reminder after
//       PIR_NOTIFY_REMIND_MS if the person waits. Nobody stands in for the person: they answer T02 on the
//       phone, and the episode's clear goes out.
//   Main does not move. When both tasks merge the run commits REPORT.md and waits in `ready to merge`,
//   which sends the end-of-run alert; the runner then merges as the person would (mergeWhenReady), and the
//   command finishes.
//
// `realNotify` points the run at the person's own ~/.pir/notify.json while `statusSnapshots` keeps PIR_HOME
// on a scratch folder (run.mjs notifyEnv). The facts below read the bundle; what the phone showed is the
// person's hand-verification (T08 "Needs a person").

import { defineScenario } from '../scenario.mjs';
import { agentAnswered, remoteOnlyAfterPass, readyWithReport, ceilingHeld } from '../assertions.mjs';
import { progressDoc, taskDoc } from './common.mjs';

const slug = 'notify-live';
const title = 'Phone alerts — a passed question buzzes the phone, an answered one does not, the end alert arrives';

const NAME_QUESTION = 'What should the exported greeting function in greet.mjs be called?';

const design = `---
setup: none
test:
  - npm test
---

# ${slug} — scratch fixture design

Throwaway plan for the live check of phone alerts. Not a real feature.

## Decisions

- **The greeting function is named \`greet\`.** \`greet.mjs\` exports \`greet(name)\`, returning
  \`Hello, \${name}!\`. Not \`sayHello\`: every verb in this project is one word.
- The public API of \`api.mjs\` (its function's name) is deliberately **not** decided here.

## Environment

The test command is \`npm test\`. It runs \`node --test\` and is green on a fresh checkout. There is no
git remote: nothing is ever pushed.
`;

// The project rules the agent reads from the feature worktree (docs/coordinator-agent.md).
const rules = `# Coordinator rules for this project

- Pass questions about the public API to the person: the name or signature of anything \`api.mjs\`
  exports is theirs to decide, even when the plan hints at an answer and you would pick one.
- Everything DESIGN.md settles, answer from DESIGN.md.
`;

const progress = progressDoc({
  slug,
  summary:
    'Two independent tasks: T01 asks a naming question DESIGN answers (the agent answers it, no alert); T02 asks a public-API question the rules pass on (the phone buzzes, the person answers there). The run ends in ready to merge, which sends the end alert (reliable-notifications T08).',
  tasks: [
    { num: 'T01', name: 'Greeting function (asks a name DESIGN settles)', deps: [], state: '⬜' },
    { num: 'T02', name: 'Version API (a passed question)', deps: [], state: '⬜' },
  ],
});

const tasks = {
  'T01-greeting.md': taskDoc({
    num: 'T01',
    title: 'Add the greeting function (asks its name)',
    goal:
      'Create `greet.mjs` at the repo root exporting one function that takes a name and returns ' +
      "`Hello, <name>!`. Before writing it, ask the function's name with the **AskUserQuestion " +
      `tool** (not plain text): one question, "${NAME_QUESTION}", header "Name", single-select, options ` +
      '`greet` and `sayHello`. Ask even if you think you know the answer, and use exactly the name the ' +
      'answer gives. A reviewer of this task does not ask again.',
    files: ['`greet.mjs` — new.'],
    tests: 'Add `greet.test.mjs` checking the function returns `Hello, Ada!` for `Ada`. Leave `npm test` green.',
    doneWhen: [
      'The name was asked through the AskUserQuestion tool, and `greet.mjs` exports the function under the answered name.',
      '`npm test` is green.',
    ],
  }),
  'T02-version.md': taskDoc({
    num: 'T02',
    title: 'Add the version API (asks a public-API question)',
    goal:
      'Create `api.mjs` at the repo root exporting one function that returns the string `1.0.0`. Its ' +
      "name is the public API and is the person's choice: before writing it, drop a `question` report " +
      'asking whether it is `version()` or `getVersion()`, then ask the person in plain text in your reply ' +
      '(NOT the AskUserQuestion tool) and end your turn. When the answer comes, write `api.mjs` with ' +
      'exactly that name and finish. A reviewer of this task does not ask again.',
    files: ['`api.mjs` — new.'],
    tests: 'Add `api.test.mjs` checking the function returns `1.0.0`. Leave `npm test` green.',
    doneWhen: ['`api.mjs` exports the function under the name the person gave.', '`npm test` is green.'],
  }),
};

const seedFiles = {
  [`plans/${slug}/DESIGN.md`]: design,
  '.claude/pir-coordinator.md': rules,
};

// --- Facts over the bundle (T08 "Automated checks") ------------------------------------------------

function notesOf(bundle, task, kind) {
  return (bundle.transcripts ?? [])
    .filter((t) => t.task === task)
    .flatMap((t) => (t.events ?? []).filter((e) => e?.dir === 'note' && e.kind === kind).map((e) => ({ key: t.key, ...e })));
}

// A conversation log stamps `t` in epoch ms; an ISO string is taken too, as a canned bundle may carry one.
const at = (e) => (typeof e.t === 'number' ? e.t : Date.parse(e.t));
const iso = (e) => new Date(at(e)).toISOString();

// neverAlerted(task) — `task`'s conversation carries no `notified` note: nothing about it reached the phone.
export function neverAlerted(task) {
  return {
    id: `never-alerted:${task}`,
    label: `${task} sent no alert to the phone`,
    check(bundle) {
      const sent = notesOf(bundle, task, 'notified');
      const evidence = sent.map((e) => `${e.key} ${iso(e)}: notified ${JSON.stringify({ reminder: e.reminder })}`);
      if (!(bundle.transcripts ?? []).some((t) => t.task === task)) return { pass: false, evidence, detail: `no conversation of ${task} in the bundle` };
      if (sent.length) return { pass: false, evidence, detail: `${task} alerted ${sent.length} time(s)` };
      return { pass: true, evidence, detail: `${task} has no \`notified\` note` };
    },
  };
}

// alertedOnceThenReminded(task) — `task` alerted once after its Remote Control link was known (the tap
// opens the worker's chat), and at most one reminder followed it. A reminder is not required: the person
// may answer inside PIR_NOTIFY_REMIND_MS.
export function alertedOnceThenReminded(task) {
  return {
    id: `alerted-once:${task}`,
    label: `${task} alerted the phone once, with its Remote Control link known, and reminded at most once`,
    check(bundle) {
      const sent = notesOf(bundle, task, 'notified').sort((a, b) => at(a) - at(b));
      const links = notesOf(bundle, task, 'remote-control').filter((e) => e.on && e.url);
      const evidence = [
        ...links.map((e) => `${e.key} ${iso(e)}: remote-control on, url known`),
        ...sent.map((e) => `${e.key} ${iso(e)}: notified ${JSON.stringify({ reminder: e.reminder })}`),
      ];
      const first = sent.filter((e) => !e.reminder);
      const reminders = sent.filter((e) => e.reminder);
      if (first.length !== 1) return { pass: false, evidence, detail: `${first.length} first alert(s) for ${task}, expected 1` };
      if (reminders.length > 1) return { pass: false, evidence, detail: `${reminders.length} reminders for ${task}, expected at most 1` };
      if (reminders.length && at(reminders[0]) < at(first[0])) return { pass: false, evidence, detail: 'the reminder came before the first alert' };
      if (!links.some((e) => at(e) <= at(first[0]))) return { pass: false, evidence, detail: `${task}'s alert went out before its Remote Control link was known` };
      return { pass: true, evidence, detail: `one alert${reminders.length ? ` and a reminder ${Math.round((at(reminders[0]) - at(first[0])) / 1000)}s later` : ', no reminder'}` };
    },
  };
}

const scenario = defineScenario({
  id: slug,
  title,
  fixture: slug,
  // Ceiling 2 so both tasks run at once; 30 minutes bounds two builds, two reviews, the person's answer on
  // the phone after the reminder, and the report (DESIGN §5.2).
  seatbelts: { ceiling: 2, timeoutMs: 30 * 60 * 1000 },
  coordinator: true,
  statusSnapshots: true,
  // No answerPending: the person answers T02 on the phone.
  realNotify: true,
  mergeWhenReady: true,
  facts: [
    agentAnswered('T01'),
    neverAlerted('T01'),
    remoteOnlyAfterPass('T02'),
    alertedOnceThenReminded('T02'),
    readyWithReport({ conflict: false }),
    ceilingHeld(2),
  ],
});

export default { id: slug, slug, title, progress, tasks, seedFiles, scenario };
