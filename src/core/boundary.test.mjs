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
    const source = readFileSync(join(CORE_DIR, file), 'utf8');
    for (const { label, pattern } of FORBIDDEN) {
      assert.ok(
        !pattern.test(source),
        `src/core/${file} contains "${label}", which only belongs in src/shell/. ` +
          `Move it to shell/ and pass the result into core as a parameter (DESIGN §3.1).`,
      );
    }
  });
}
