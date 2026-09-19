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

test('the PROGRESS template parses without errors', () => {
  const { tasks, errors } = parseProgress(progressTemplate);
  assert.deepEqual(errors, [], `template PROGRESS.md should parse without errors, got: ${errors.join('; ')}`);
  // The auto/you Runs marker is no longer a parsed field (§2.5). The template still carries a Runs
  // column (T07 rewrites the templates), so the parser must tolerate it without error. That the column
  // is ignored rather than read into a field is covered in progress.test.mjs.
  assert.equal(tasks.length, 3, 'the template has its three illustrative tasks');
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
    errors: [],
  });
});

// The build→verify split (an `auto` builder plus a dependent `you` verifier) was removed with the
// auto/you distinction (§2.5); T07 rewrites these templates to drop the Runs column and the split
// machinery, and will re-express whatever template coverage remains. The former split assertion is
// gone because there is no parsed `runs` field to test it against.

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

test('the task-doc template carries a worker-run "Automated checks" section and the two-confirmations rule (T40)', () => {
  // DESIGN §2.6 (T40): a machine-decidable check — install a driver, run an e2e — is the hands-on
  // worker's to run and record, not the person's. The template must carry a worker-owned "Automated
  // checks" section between Environment and Needs a person, and the person's block must state the scribe
  // records the machine result and the person's judgement as two separate confirmations, never inflating
  // an ambiguous reply. Collapsing the check back into the person's steps, or dropping the split-record
  // rule, fails this.
  assert.match(taskTemplate, /^##\s+Automated checks \(the worker runs these\)\s*$/m, 'TASK.md carries a worker Automated-checks section');
  const checksHead = taskTemplate.indexOf('## Automated checks');
  const personHead = taskTemplate.indexOf('## Needs a person');
  const envHead = taskTemplate.indexOf('## Environment');
  assert.ok(envHead < checksHead && checksHead < personHead, 'Automated checks sits between Environment and Needs a person');
  const checksBlock = taskTemplate.slice(checksHead, personHead);
  assert.match(checksBlock, /worker/i, 'the automated-checks section names the worker as the runner');
  assert.match(checksBlock, /machine result|records/i, 'the worker records the machine result');
  const personBlock = taskTemplate.slice(personHead);
  assert.match(personBlock, /two separate\s+confirmations/i, "the person's block states the two-separate-confirmations rule");
  assert.match(personBlock, /never inflat|ambiguous/i, "the person's block forbids inflating an ambiguous reply");
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
});
