// A stalled run still ends on the backstop, not on a spin (fast-tests T02, DESIGN §2.3, §2.6).
//
// The real coordinate.mjs runs on a scratch plan whose one task is ⛔: nothing live, nothing to dispatch.
// Every pass is quiet, so passProgressed never wakes the loop and each wait runs its full PARALLEL_POLL_MS.
// A wake on a quiet pass would space passes PASS_MIN_GAP_MS apart instead, which shows as extra painted
// frames (the non-TTY renderer appends one per pass). Its own file so it runs beside the unit tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const COORDINATE = fileURLToPath(new URL('./coordinate.mjs', import.meta.url));
const POLL = 600;
const STALL_GRACE = 3; // coordinate.mjs main()

test('a stalled run (nothing live, nothing to do) ends after STALL_GRACE backstop waits, not sooner, with no extra passes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pir-stall-'));
  try {
    const repo = join(dir, 'repo');
    const plan = join(repo, 'plans', 'stall');
    mkdirSync(plan, { recursive: true });
    mkdirSync(join(dir, 'home'));
    mkdirSync(join(dir, 'bin'));
    writeFileSync(join(plan, 'DESIGN.md'), '---\nsetup: none\ntest:\n  - true\n---\n\n# stall\n');
    writeFileSync(
      join(plan, 'PROGRESS.md'),
      '# Progress\n\n**Plan reviewed:** yes\n\n## Tasks\n\n| # | Task | Depends on | State | Notes |\n|---|---|---|---|---|\n| T01 | stuck | — | ⛔ | |\n',
    );
    // coordinate.mjs refuses to start until the repo names its base branch (base-branch DESIGN §2.1).
    mkdirSync(join(repo, '.pir'));
    writeFileSync(join(repo, '.pir', 'settings.json'), '{"baseBranch": "main"}\n');
    const git = (...a) => execFileSync('git', a, { cwd: repo, stdio: 'pipe' });
    git('init', '-q', '-b', 'main');
    git('add', '-A');
    git('-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'init');
    // resolveClaudePath needs a `claude` on PATH; nothing is ever spawned, so it only has to exist.
    const shim = join(dir, 'bin', 'claude');
    writeFileSync(shim, '#!/bin/sh\nexit 1\n');
    chmodSync(shim, 0o755);

    const started = Date.now();
    const run = spawnSync(process.execPath, [COORDINATE, 'stall'], {
      cwd: repo,
      encoding: 'utf8',
      timeout: 30_000,
      env: {
        ...process.env,
        HOME: join(dir, 'home'),
        PIR_HOME: join(dir, 'home', '.pir'),
        PATH: `${join(dir, 'bin')}:${process.env.PATH}`,
        PARALLEL_LIVE: '1',
        PARALLEL_COORDINATOR: '0',
        PARALLEL_REMOTE: '0',
        PARALLEL_POLL_MS: String(POLL),
        PIR_RUN: '',
      },
    });
    const elapsed = Date.now() - started;
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /nothing left to do/);
    const passes = run.stdout.split('\n').filter((l) => l.includes('pir/stall ·')).length;
    // Quiet passes a full backstop apart: STALL_GRACE waits after the first quiet pass, so grace + 1 passes.
    // A spin at the 250 ms pass gap would paint about twice as many.
    assert.ok(passes >= STALL_GRACE && passes <= STALL_GRACE + 1, `passes: ${passes}\n${run.stdout}`);
    assert.ok(elapsed >= STALL_GRACE * POLL, `ended after ${elapsed} ms, sooner than ${STALL_GRACE} backstops`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
