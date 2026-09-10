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

test('the PROGRESS template parses and every task exposes its Runs marker', () => {
  const { tasks, errors } = parseProgress(progressTemplate);
  assert.deepEqual(errors, [], `template PROGRESS.md should parse without errors, got: ${errors.join('; ')}`);
  const byNum = Object.fromEntries(tasks.map((t) => [t.num, t]));
  // The template illustrates both markers: T00 a spike (you), T01 a build (auto). If the
  // column header ever stops matching what the parser reads, these read back as the auto
  // default and the assertion catches it.
  assert.equal(byNum.T00.runs, 'you');
  assert.equal(byNum.T01.runs, 'auto');
});

test('analyzeParallelism over the PROGRESS template yields the width the method quotes', () => {
  // The width report is computed over the parsed PROGRESS task table (the one authoritative
  // table that carries deps + Runs + state, and the shape analyzeParallelism consumes). The
  // PLAN template's per-phase tables are illustrative and not parseProgress-shaped, so the
  // metric is tied to PROGRESS here — see the T11 note in PROGRESS.md.
  const { tasks } = parseProgress(progressTemplate);
  const width = analyzeParallelism(tasks);
  assert.deepEqual(width, {
    totalTasks: 2,
    criticalPathLength: 2, // T00 → T01 is a chain of 2
    maxWidth: 1, // one long chain: at most one task per layer
    autonomousCount: 1, // T01
    humanCount: 1, // T00
    errors: [],
  });
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
  assert.equal(tasks.length, 2);
  assert.ok(tasks.every((t) => t.runs === 'auto'), 'a plan with no Runs column defaults to auto');
});
