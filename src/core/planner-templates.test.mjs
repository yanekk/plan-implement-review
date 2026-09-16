// Golden tests over the /pir-plan templates (T11, DESIGN §2.6, §2.7). The planner's templates
// ship a Runs column and a width report; parseProgress reads that column and analyzeParallelism
// computes the width. The risk this guards is drift: a template whose column header the parser
// no longer recognises, or a template task graph whose numbers the method would misquote. So
// these read the real template files on disk and run them through the same two core functions
// the method uses, rather than a hand-written fixture that could agree with a broken template.
//
// A test file may reach for the filesystem; the core logic it guards may not (boundary.test.mjs).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseProgress } from './progress.mjs';
import { analyzeParallelism } from './parallelism.mjs';

// src/core/ → repo root → the templates that /pir-plan copies into a new plan.
const TEMPLATES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'skills', 'pir-plan', 'templates');
const progressTemplate = readFileSync(join(TEMPLATES, 'PROGRESS.md'), 'utf8');
const taskTemplate = readFileSync(join(TEMPLATES, 'TASK.md'), 'utf8');

test('the PROGRESS template parses and every task exposes its Runs marker', () => {
  const { tasks, errors } = parseProgress(progressTemplate);
  assert.deepEqual(errors, [], `template PROGRESS.md should parse without errors, got: ${errors.join('; ')}`);
  const byNum = Object.fromEntries(tasks.map((t) => [t.num, t]));
  // The template illustrates every marker the method uses: T00 a spike (you, no deliverable),
  // T01 a build (auto), and T02 a hand-verification of T01's deliverable (you, the build→verify
  // split, DESIGN §2.6). If the column header ever stops matching what the parser reads, these
  // read back as the auto default and the assertion catches it.
  assert.equal(byNum.T00.runs, 'you');
  assert.equal(byNum.T01.runs, 'auto');
  assert.equal(byNum.T02.runs, 'you');
});

test('analyzeParallelism over the PROGRESS template yields the width the method quotes', () => {
  // The width report is computed over the parsed PROGRESS task table (the one authoritative
  // table that carries deps + Runs + state, and the shape analyzeParallelism consumes). The
  // PLAN template's per-phase tables are illustrative and not parseProgress-shaped, so the
  // metric is tied to PROGRESS here — see the T11 note in PROGRESS.md.
  const { tasks } = parseProgress(progressTemplate);
  const width = analyzeParallelism(tasks);
  assert.deepEqual(width, {
    totalTasks: 3,
    criticalPathLength: 3, // T00 → T01 → T02 is a chain of 3
    maxWidth: 1, // one long chain: at most one task per layer
    autonomousCount: 1, // T01
    humanCount: 2, // T00 (spike) + T02 (build→verify split)
    errors: [],
  });
});

test('the PROGRESS template carries a build→verify split: an auto builder and a dependent you verify task', () => {
  // DESIGN §2.6: when a deliverable can only be verified by a person, the method plans a pair —
  // an `auto` task builds it and a separate `you` task depending on the builder has a person run
  // it — rather than folding the check into a single `auto` task. This asserts the pair exists in
  // the template: a `you` task whose dependency is an `auto` task. The mutation this guards is
  // exactly the fold — collapse T01+T02 into one `auto` row and no `you`-depends-on-`auto` pair
  // remains, so this fails.
  const { tasks } = parseProgress(progressTemplate);
  const byNum = Object.fromEntries(tasks.map((t) => [t.num, t]));
  const verify = tasks.find((t) => t.runs === 'you' && t.deps.some((d) => byNum[d]?.runs === 'auto'));
  assert.ok(verify, 'expected a you verify task depending on an auto builder (the build→verify split)');
  const builder = verify.deps.map((d) => byNum[d]).find((t) => t?.runs === 'auto');
  assert.equal(builder.runs, 'auto', 'the verify task depends on the auto builder');
  // The paired you verify task is counted in the you total, like any other you task.
  const width = analyzeParallelism(tasks);
  assert.ok(width.humanCount >= 2, 'the you verify task is counted in the you (humanCount) total');
});

test('the task-doc template carries a "Needs a person" block for a split verify task', () => {
  // The `you` verify half of a build→verify split IS a "Needs a person" block — the seatbelted
  // command, what to expect, and what only a person can answer — so the hands-on worker has
  // something concrete to present. Removing the block from the template fails this.
  assert.match(taskTemplate, /^##\s+Needs a person\s*$/m, 'TASK.md should carry a "Needs a person" section');
  assert.match(taskTemplate, /Expect:/, 'the block should say what to expect');
  assert.match(taskTemplate, /Tell me:/, 'the block should say what only a person can answer');
});

test('the task-doc template splits the worker-owned environment from the person\'s judgement (T39)', () => {
  // DESIGN §2.6 (T39): standing an environment up and tearing it down is the hands-on worker's
  // job, not the person's; teardown-before-done is the seatbelt (§5.2). The template must carry a
  // worker-owned "Environment" section separate from "Needs a person", and name the teardown
  // seatbelt. Collapsing the two — putting up/down back into the person's block — fails this.
  assert.match(taskTemplate, /^##\s+Environment \(the worker owns this\)\s*$/m, 'TASK.md carries a worker Environment section');
  const envHead = taskTemplate.indexOf('## Environment');
  const personHead = taskTemplate.indexOf('## Needs a person');
  assert.ok(envHead !== -1 && personHead !== -1 && envHead < personHead, 'Environment precedes Needs a person');
  const envBlock = taskTemplate.slice(envHead, personHead);
  assert.match(envBlock, /worker/i, 'the environment section names the worker as the owner');
  assert.match(envBlock, /teardown/i, 'the environment section covers teardown');
  assert.match(envBlock, /seatbelt/i, 'teardown is named as the seatbelt (§5.2)');
  // The person's block is judgement — it says so and does not claim the environment chores.
  const personBlock = taskTemplate.slice(personHead);
  assert.match(personBlock, /judge/i, "the person's block is framed as judgement");
});

// Drop one named column from every markdown table row in the text, to model a plan written
// before that column existed — derived from the shipped template so the back-compat test
// cannot quietly diverge from the real template's shape.
function dropColumn(text, colName) {
  const lines = text.split('\n');
  let interiorIndex = -1;
  return lines
    .map((line) => {
      if (!line.trim().startsWith('|')) return line;
      const parts = line.split('|'); // interior cell k is parts[k + 1]
      const interior = parts.slice(1, -1);
      if (interiorIndex === -1) {
        const found = interior.findIndex((c) => c.trim().toLowerCase() === colName.toLowerCase());
        if (found === -1) return line; // not the task table's header (or a row before it)
        interiorIndex = found;
      }
      parts.splice(interiorIndex + 1, 1);
      return parts.join('|');
    })
    .join('\n');
}

test('the template still parses with the Runs column removed, defaulting every task to auto', () => {
  const classic = dropColumn(progressTemplate, 'Runs');
  assert.ok(!/\|\s*Runs\s*\|/i.test(classic), 'the Runs column should have been stripped');
  const { tasks, errors } = parseProgress(classic);
  assert.deepEqual(errors, []);
  assert.equal(tasks.length, 3);
  assert.ok(tasks.every((t) => t.runs === 'auto'), 'a plan with no Runs column defaults to auto');
});
