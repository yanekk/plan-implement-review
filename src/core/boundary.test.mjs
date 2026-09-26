// The boundary test. It keeps src/core/ pure so that the whole of the coordinator's
// behaviour stays checkable in milliseconds (DESIGN §3.1). It scans every non-test file
// in src/core/ for references that only belong in src/shell/, and fails naming the file
// and the token. If it fails, the fix is to MOVE the code into src/shell/ and pass the
// result into core as a parameter — never to relax this test. The test is the rule.
//
// This file uses node:fs itself, which is exactly one of the forbidden tokens. That is
// fine and intentional: the scan excludes *.test.mjs, so a test may reach for the
// filesystem while the core logic it guards may not.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const CORE_DIR = dirname(fileURLToPath(import.meta.url));

// Each rule is a token a pure module must not contain. The label is what the failure
// prints; the regex is what it matches. `new Date(...)` with an argument is allowed —
// only the argumentless `new Date()`, which reads the system clock, is forbidden — so
// the pattern pins the empty parens. The others are literal substrings, escaped.
const FORBIDDEN = [
  { label: 'node:fs', pattern: /node:fs/ },
  { label: 'node:child_process', pattern: /node:child_process/ },
  { label: 'node:net', pattern: /node:net/ },
  { label: 'fetch(', pattern: /fetch\(/ },
  { label: 'Date.now', pattern: /Date\.now/ },
  { label: 'new Date() (no argument)', pattern: /new Date\(\s*\)/ },
  { label: 'Math.random', pattern: /Math\.random/ },
];

// Every module specifier the source imports or re-exports: static `import … from '…'`, bare
// `import '…'`, `export … from '…'`, and dynamic `import('…')`. A template-literal or computed
// dynamic import is not caught; core has none and a reviewer would see one.
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*)(['"])([^'"]+)\1/g;

// A specifier is bare when it names a package rather than a file or a Node built-in. Core may
// reach only its siblings (relative paths) and pure `node:` built-ins; any package — pi-tui, the
// Agent SDK, anything else — belongs in src/shell/ (DESIGN §3.1, §5).
function isBare(spec) {
  return !(spec.startsWith('./') || spec.startsWith('../') || spec.startsWith('/') || spec.startsWith('node:'));
}

// Every rule the source breaks, as the labels the failure prints. Empty means pure.
function violations(source) {
  const found = FORBIDDEN.filter(({ pattern }) => pattern.test(source)).map(({ label }) => label);
  for (const [, , spec] of source.matchAll(SPECIFIER)) {
    if (isBare(spec)) found.push(`bare import '${spec}'`);
  }
  return found;
}

// Every .mjs in src/core/ that is not itself a test. These are the files that must be pure.
function coreSourceFiles() {
  return readdirSync(CORE_DIR)
    .filter((f) => f.endsWith('.mjs') && !f.endsWith('.test.mjs'))
    .sort();
}

const files = coreSourceFiles();

// If this ever fires, the layout is wrong: T01 leaves a stub in src/core/, so the scan
// should always have at least one file to prove it can pass on a clean core.
test('boundary: there is at least one core source file to scan', () => {
  assert.ok(
    files.length > 0,
    `no non-test .mjs files found in ${CORE_DIR}; the scanner has nothing to prove itself against`,
  );
});

for (const file of files) {
  test(`boundary: src/core/${file} is pure`, () => {
    const found = violations(readFileSync(join(CORE_DIR, file), 'utf8'));
    assert.deepEqual(
      found,
      [],
      `src/core/${file} contains ${found.map((l) => `"${l}"`).join(', ')}, which only belongs in src/shell/. ` +
        `Move it to shell/ and pass the result into core as a parameter (DESIGN §3.1).`,
    );
  });
}

// The scanner proves itself on fixture text, so a regex that silently matches nothing cannot pass.
test('boundary: a core file importing pi-tui, the SDK or any package is caught', () => {
  const cases = [
    [`import { TuiMainScreen } from '@earendil-works/pi-tui';`, `bare import '@earendil-works/pi-tui'`],
    [`import { query } from "@anthropic-ai/claude-agent-sdk";`, `bare import '@anthropic-ai/claude-agent-sdk'`],
    [`import marked from 'marked';`, `bare import 'marked'`],
    [`import 'left-pad';`, `bare import 'left-pad'`],
    [`export { x } from 'some-pkg/sub';`, `bare import 'some-pkg/sub'`],
    [`const m = await import('zod');`, `bare import 'zod'`],
    [`import {\n  a,\n  b,\n} from 'multi-line-pkg';`, `bare import 'multi-line-pkg'`],
  ];
  for (const [source, label] of cases) {
    assert.deepEqual(violations(source), [label], source);
  }
});

test('boundary: relative and pure node: imports are allowed', () => {
  const source = [
    `import { a } from './sibling.mjs';`,
    `import b from '../core/other.mjs';`,
    `import { strict } from 'node:assert';`,
    `export { c } from './c.mjs';`,
    `const d = await import('./lazy.mjs');`,
  ].join('\n');
  assert.deepEqual(violations(source), []);
});

test('boundary: the older forbidden tokens still fire through the same function', () => {
  assert.deepEqual(violations(`import { readFileSync } from 'node:fs';`), ['node:fs']);
  assert.deepEqual(violations(`const t = Date.now();`), ['Date.now']);
});
