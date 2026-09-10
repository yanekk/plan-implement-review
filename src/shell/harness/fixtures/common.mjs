// Shared boilerplate for the six live-scenario fixtures (DESIGN §4.1, T16). A fixture is a scratch
// plan engineered so a REAL claude worker reliably hits one coordinator path (PM decision: all-real
// workers, DESIGN §4.1). The distinctive part of each fixture — its PROGRESS.md task graph and the
// task docs that force the path — lives in the fixture module; the invariant scaffolding (a runnable
// `npm test`, a .gitignore, and the DESIGN/PLAN/FINDINGS a complete plan carries) is centralised here
// so it is written once, not copied into six directories.
//
// Everything is plain text a person can read under pressure (DESIGN §3.5). These builders only shape
// strings — no clock, no I/O; the loader (fixtures.mjs) is the one thing that writes files and seeds git.

// The plan-reviewed gate line (DESIGN §2.1): the coordinator refuses to start on an unreviewed plan, so
// every fixture is pre-marked reviewed. A fixed date keeps the seed deterministic.
const REVIEWED_LINE =
  '**Plan reviewed:** 2026-01-01 — scratch fixture, pre-approved for the live-scenario harness (T16).';

// progressDoc({ slug, summary, tasks }) → a PROGRESS.md text parseProgress reads (DESIGN §3.2). Each
// task is { num, name, runs?, deps?, state?, notes? }; runs defaults auto, state defaults ⬜, no deps
// renders as `—`. The column set is the canonical one, including Runs (DESIGN §2.6), so the fixture's
// markers survive the round-trip.
export function progressDoc({ slug, summary, tasks }) {
  const rows = tasks
    .map((t) => {
      const runs = t.runs ?? 'auto';
      const deps = t.deps && t.deps.length ? t.deps.join(', ') : '—';
      const state = t.state ?? '⬜';
      const notes = t.notes ?? '';
      return `| ${t.num} | ${t.name} | ${runs} | ${deps} | ${state} | ${notes} |`;
    })
    .join('\n');
  return `# Progress — ${slug} (scratch fixture)

${summary}

${REVIEWED_LINE}

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and done · ⛔ blocked.

| # | Task | Runs | Depends on | State | Notes |
|---|---|---|---|---|---|
${rows}
`;
}

// taskDoc({ num, title, runs, goal, files, tests, doneWhen }) → one task file's text, the shape a real
// worker's pir-implement reads (goal, files, tests, acceptance). Kept small on purpose: a fixture task
// is trivial deliverable-wise; its job is to force a coordinator path, not to be real work.
export function taskDoc({ num, title, runs = 'auto', goal, files = [], tests, doneWhen = [] }) {
  const filesList = files.length ? files.map((f) => `- ${f}`).join('\n') : '- (none)';
  const dw = doneWhen.map((d) => `- [ ] ${d}`).join('\n');
  return `# ${num} — ${title}

**Runs:** ${runs}

## Goal
${goal}

## Files
${filesList}

## Tests
${tests ?? 'None. This is a scratch fixture task; write no new tests and leave `npm test` green.'}

## Done when
${dw}
`;
}

// commonPlanFiles(slug, { title }) → the DESIGN/PLAN/FINDINGS a complete, runnable scratch plan carries.
// DESIGN names the test command (`npm test`) so a worker's pir-implement knows the only evidence it may
// produce (DESIGN §5). PLAN and FINDINGS are minimal but present so the plan tree is whole.
export function commonPlanFiles(slug, { title }) {
  return {
    [`plans/${slug}/DESIGN.md`]: `# ${slug} — scratch fixture design

Throwaway plan used by the parallel-pir live-scenario harness (T16/T17). Not a real feature; it exists
only to force one coordinator path with a real worker, then be torn down.

## Environment

The test command is \`npm test\`. It is the only evidence a session may produce on its own; it runs
\`node --test\` and is green on a fresh checkout.
`,
    [`plans/${slug}/PLAN.md`]: `# ${slug} — plan\n\n${title}\n`,
    [`plans/${slug}/FINDINGS.md`]: `# Findings log\n\n| Date | | Finding |\n|---|---|---|\n`,
  };
}

// repoScaffold() → the files that make the scratch repo a runnable, self-contained project: a
// dependency-free \`npm test\` (DESIGN §5 forbids runtime deps), one passing smoke test so \`node --test\`
// exits green on a fresh checkout and inside every task worktree, and a .gitignore that keeps the
// coordinator's per-run control state and linked worktrees out of git (DESIGN §3.5: \`plans/*/.parallel/\`
// is never committed; \`.claude/skills/\` deliberately IS, so a task-branch worktree carries the parallel
// skills — FINDINGS 2026-09-09, they are not installed in ~/.claude/skills).
export function repoScaffold() {
  return {
    'package.json': `${JSON.stringify(
      {
        name: 'pir-scratch-fixture',
        private: true,
        type: 'module',
        scripts: { test: 'node --test --test-reporter=dot' },
      },
      null,
      2,
    )}\n`,
    'scratch.test.mjs': `import { test } from 'node:test';
import assert from 'node:assert/strict';

// A single passing test so \`npm test\` is green on a fresh fixture checkout and inside every task
// worktree cut from it. A real worker adds its own tests on top; this only guarantees a green baseline.
test('scratch fixture smoke — npm test is green on a fresh checkout', () => {
  assert.ok(true);
});
`,
    '.gitignore': `node_modules/
.claude/worktrees/
plans/*/.parallel/
`,
  };
}
