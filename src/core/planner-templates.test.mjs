// Golden tests over the /pir-plan templates (DESIGN §2.5, §2.9). The planner's PROGRESS template
// ships the task table parseProgress reads and analyzeParallelism measures. The risk this guards is
// drift: a template whose columns the parser no longer recognises, or a template task graph whose
// numbers the method would misquote. So these read the real template files on disk and run them
// through the same two core functions the method uses, rather than a hand-written fixture that could
// agree with a broken template. The auto/you Runs column and the build→verify split are gone (§2.5);
// the Task cell is now the task's kebab slug (§2.9).
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
  assert.equal(tasks.length, 3, 'the template has its three illustrative tasks');
});

test('the PROGRESS template carries no Runs column (§2.5)', () => {
  // The auto/you distinction is gone; the template must not reintroduce the column. Back-compat —
  // parseProgress still tolerating a Runs column in a plan written before this — is covered in
  // progress.test.mjs, not here.
  assert.ok(!/\|\s*Runs\s*\|/i.test(progressTemplate), 'the template must not carry a Runs column');
});

test('the PROGRESS Task cells are kebab slugs (§2.9)', () => {
  // §2.9: the Task cell is the task's kebab slug, the same name as its tasks/T{nn}-{slug}.md file.
  // A slug is lowercase words joined by single hyphens — no spaces and no {placeholder} braces.
  const { tasks } = parseProgress(progressTemplate);
  for (const t of tasks) {
    assert.match(t.name, /^[a-z0-9]+(-[a-z0-9]+)*$/, `Task cell "${t.name}" should be a kebab slug`);
  }
});

test('analyzeParallelism over the PROGRESS template yields the width the method quotes', () => {
  // The width report is computed over the parsed PROGRESS task table (the one authoritative table
  // that carries deps + state, and the shape analyzeParallelism consumes). The PLAN template's
  // per-phase tables are illustrative and not parseProgress-shaped, so the metric is tied to PROGRESS.
  const { tasks } = parseProgress(progressTemplate);
  const width = analyzeParallelism(tasks);
  assert.deepEqual(width, {
    totalTasks: 3,
    criticalPathLength: 3, // T00 → T01 → T02 is a chain of 3
    maxWidth: 1, // one long chain: at most one task per layer
    errors: [],
  });
});

test('the task-doc template carries a "Needs a person" block (§2.5)', () => {
  // A task whose real proof is a person's judgement raises a "Needs a person" block — what to judge,
  // what to expect, and what only a person can answer — so the worker has something concrete to put
  // in front of them. Removing the block from the template fails this.
  assert.match(taskTemplate, /^##\s+Needs a person\s*$/m, 'TASK.md should carry a "Needs a person" section');
  assert.match(taskTemplate, /Expect:/, 'the block should say what to expect');
  assert.match(taskTemplate, /Tell me:/, 'the block should say what only a person can answer');
});

test('the task-doc template splits the worker-owned environment from the person\'s judgement (§2.5)', () => {
  // Standing an environment up and tearing it down is the worker's job, not the person's;
  // teardown-before-done is the seatbelt. The template must carry a worker-owned "Environment"
  // section separate from "Needs a person", and name the teardown seatbelt. Collapsing the two —
  // putting up/down back into the person's block — fails this.
  assert.match(taskTemplate, /^##\s+Environment \(the worker owns this\)\s*$/m, 'TASK.md carries a worker Environment section');
  const envHead = taskTemplate.indexOf('## Environment');
  const personHead = taskTemplate.indexOf('## Needs a person');
  assert.ok(envHead !== -1 && personHead !== -1 && envHead < personHead, 'Environment precedes Needs a person');
  const envBlock = taskTemplate.slice(envHead, personHead);
  assert.match(envBlock, /worker/i, 'the environment section names the worker as the owner');
  assert.match(envBlock, /teardown/i, 'the environment section covers teardown');
  assert.match(envBlock, /seatbelt/i, 'teardown is named as the seatbelt');
  // The person's block is judgement — it says so and does not claim the environment chores.
  const personBlock = taskTemplate.slice(personHead);
  assert.match(personBlock, /judge/i, "the person's block is framed as judgement");
});

test('the task-doc template carries a worker-run "Automated checks" section (§2.5)', () => {
  // A machine-decidable check — install a driver, run an e2e — is the worker's to run and record,
  // not the person's. The template must carry a worker-owned "Automated checks" section between
  // Environment and Needs a person, and the person's block must forbid inflating an ambiguous result.
  // Collapsing the check back into the person's steps fails this.
  assert.match(taskTemplate, /^##\s+Automated checks \(the worker runs these\)\s*$/m, 'TASK.md carries a worker Automated-checks section');
  const checksHead = taskTemplate.indexOf('## Automated checks');
  const personHead = taskTemplate.indexOf('## Needs a person');
  const envHead = taskTemplate.indexOf('## Environment');
  assert.ok(envHead < checksHead && checksHead < personHead, 'Automated checks sits between Environment and Needs a person');
  const checksBlock = taskTemplate.slice(checksHead, personHead);
  assert.match(checksBlock, /worker/i, 'the automated-checks section names the worker as the runner');
  assert.match(checksBlock, /machine result|records/i, 'the worker records the machine result');
  const personBlock = taskTemplate.slice(personHead);
  assert.match(personBlock, /never inflat|ambiguous/i, "the person's block forbids inflating an ambiguous reply");
});

test('the task-doc template names no removed skill or auto/you machinery (§2.5)', () => {
  // §2.5 removed pir-verify, the Runs marker, the you role, and the build→verify split. The template
  // must not reintroduce any of them.
  assert.ok(!/pir-verify|build→verify|build-verify/i.test(taskTemplate), 'no verify skill or build→verify split');
  assert.ok(!/\bRuns:\s*(auto|you)/i.test(taskTemplate), 'no Runs: auto / you marker in the header');
});
