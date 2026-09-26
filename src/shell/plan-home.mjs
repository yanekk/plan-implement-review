// plan-home.mjs — where a build finds its plan (pir-plan-command DESIGN §2.9, T03).
//
// `pir plan` leaves a reviewed plan committed on branch pir/{slug}, not in the main checkout, so every
// place the launcher and the coordinator read PROGRESS.md or DESIGN.md goes through this one resolver:
//
//   1. 'main'   — <root>/plans/{slug}/PROGRESS.md exists in the main checkout's working tree. Today's
//                 behaviour, unchanged, and first so a hand-made plan (and a narrow re-review committed
//                 on main while its build runs) reads byte-for-byte as before.
//   2. 'branch' — else the COMMITTED tree of refs/heads/pir/{slug} holds plans/{slug}/PROGRESS.md. Read
//                 with `git show`, never from the branch's worktree: a worktree may hold uncommitted
//                 edits that no build would see.
//   3. 'none'   — neither (the launcher's `no-plan`).
//
// `exec` and `fs` are injected so a test can count git calls; the defaults are real git and node:fs.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_FS = { existsSync, readFileSync };

// exec(args, { cwd }) → stdout string; throws on a non-zero exit (execFileSync's contract). stderr is
// swallowed: a missing branch or path is an expected answer here, not something to print. maxBuffer is
// raised from execFileSync's 1 MB so a large DESIGN.md is read whole rather than thrown as an error.
function defaultExec(args, { cwd } = {}) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
}

// A slug is one path segment and one ref component. `..` or `/` would reach outside plans/ on disk and
// name a different ref in git, so it is refused before any file or git call (task T03).
export function validSlug(slug) {
  return typeof slug === 'string' && slug.length > 0 && !slug.includes('/') && !slug.includes('..') && !slug.includes('\\');
}

// Only a bare file name may be read: the callers ask for 'PROGRESS.md' and 'DESIGN.md'.
function validFile(file) {
  return typeof file === 'string' && file.length > 0 && !file.includes('/') && !file.includes('..') && !file.includes('\\');
}

const NONE = Object.freeze({ where: 'none', read: () => null });

// planHome(slug, { root, exec, fs }) → { where: 'main'|'branch'|'none', read(file) → string|null }
export function planHome(slug, { root = process.cwd(), exec = defaultExec, fs = DEFAULT_FS } = {}) {
  if (!validSlug(slug)) return NONE;

  const planDir = join(root, 'plans', slug);
  if (fs.existsSync(join(planDir, 'PROGRESS.md'))) {
    return {
      where: 'main',
      read(file) {
        if (!validFile(file)) return null;
        try {
          return fs.readFileSync(join(planDir, file), 'utf8');
        } catch {
          return null;
        }
      },
    };
  }

  // refs/heads/ pins the local branch, so a tag or a remote-tracking ref of the same name is never read.
  const ref = `refs/heads/pir/${slug}`;
  const blob = (file) => `${ref}:plans/${slug}/${file}`;
  try {
    exec(['cat-file', '-e', blob('PROGRESS.md')], { cwd: root });
  } catch {
    return NONE; // no branch, no plan on it, or root is not a git repo at all
  }
  return {
    where: 'branch',
    read(file) {
      if (!validFile(file)) return null;
      try {
        return exec(['show', blob(file)], { cwd: root });
      } catch {
        return null;
      }
    },
  };
}
