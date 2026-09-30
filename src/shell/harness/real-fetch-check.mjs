#!/usr/bin/env node
// The one read-only network check of the base-branch plan (DESIGN §4, §5.1, §5.3 `worker` row; T09). The
// test suite never touches the network: every fetch there is from a local bare repository, which exercises
// the same fetch, ancestry and create code. What that cannot show is a real fetch over https. This narrows
// it: in a new, empty temp repo whose `origin` is this project's public https remote, it runs prepareBase
// for `main` exactly as `pir plan` would, so the bounded ls-remote and fetch (§2.4) go over the real
// network, and the missing local `main` is created from the remote's copy (§2.3). It prints the commit and
// the action taken on the local branch, then deletes the temp repo. It clones nothing, writes nothing
// outside the temp folder and pushes nothing.
//
//   node src/shell/harness/real-fetch-check.mjs [--url <https remote>] [--base <branch>]
//
// What it still cannot show: a private remote with the person's own login, and an expired one failing fast
// (DESIGN §5.1). Exit 0 when the fetch succeeded, 1 with pir's own refusal text when it did not.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { defaultGit, prepareBase } from '../base-branch.mjs';
import { refusalText } from '../../core/basebranch.mjs';

// This repo's origin (DESIGN §5.3: public https, no credentials needed).
export const PUBLIC_ORIGIN = 'https://github.com/yanekk/plan-implement-review';

// realFetchCheck({ url, base, git, prepare, tmp }) → { ok, dir, sha, local, remote, text }. The temp repo
// is removed whatever happened; `dir` is where it was, so a test can see it is gone.
export function realFetchCheck({ url = PUBLIC_ORIGIN, base = 'main', git = defaultGit, prepare = prepareBase, tmp = tmpdir() } = {}) {
  const dir = mkdtempSync(join(tmp, 'pir-real-fetch-'));
  try {
    // An unborn branch that is not the base, so the base is missing locally and must come from the remote.
    for (const args of [['init', '-q', '-b', 'pir-real-fetch-check'], ['remote', 'add', 'origin', url]]) {
      const r = git(args, { cwd: dir });
      if (r.status !== 0) return { ok: false, dir, text: `real-fetch-check: git ${args[0]} failed: ${r.stderr.trim()}` };
    }
    const r = prepare(dir, base, { git });
    if (!r.ok) return { ok: false, dir, remote: r.remote, text: refusalText(r, { base, repo: 'real-fetch-check', file: '(this check)' }) };
    return { ok: true, dir, sha: r.sha, local: r.local, remote: r.remote, text: `fetched ${base} from ${url}: ${r.sha} · local ${base}: ${r.local}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function main(argv) {
  const opt = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const r = realFetchCheck({ url: opt('--url') ?? PUBLIC_ORIGIN, base: opt('--base') ?? 'main' });
  (r.ok ? console.log : console.error)(r.text);
  console.log(`temp repo removed: ${r.dir}`);
  process.exit(r.ok ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main(process.argv.slice(2));
