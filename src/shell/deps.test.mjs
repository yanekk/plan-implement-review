// The two runtime packages resolve from src/shell/ once `npm ci` has run (DESIGN §5). pi-tui
// 0.87.1 has no `TUI` export; its screen classes are TuiMainScreen and TuiAltScreen.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TuiMainScreen, TuiAltScreen } from '@earendil-works/pi-tui';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { getNativePlatformHelper } from '@earendil-works/pi-tui/dist/native-platform.js';

test('deps: pi-tui screens and the SDK query() import from shell', () => {
  assert.equal(typeof TuiMainScreen, 'function');
  assert.equal(typeof TuiAltScreen, 'function');
  assert.equal(typeof query, 'function');
});

// .npmrc omits optionals; pi-tui's native binary ships inside the package, not as an optional
// dependency, so it must still load. The loader swallows a failed require and returns undefined,
// so this assert is the only place a missing binary would show.
test('deps: pi-tui loads its bundled native helper with optionals omitted', { skip: !['darwin', 'win32'].includes(process.platform) }, () => {
  const helper = getNativePlatformHelper();
  assert.ok(helper, 'native platform helper did not load');
  assert.equal(typeof helper.getText, 'function');
});

// bang-commands T05 (DESIGN §4): zod is a direct dependency, because the SDK's tool() takes only a zod shape
// and .npmrc never installs the SDK's peers. Resolving it from here, with peers omitted, is what shows the
// installed engine (`npm ci --omit=peer`) carries it.
test('deps: zod imports from shell with peers omitted, and is a direct dependency pinned exactly', async () => {
  const { z } = await import('zod');
  assert.equal(typeof z.string, 'function');
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.dependencies.zod, '4.6.5');
  const lock = JSON.parse(readFileSync(new URL('../../package-lock.json', import.meta.url), 'utf8'));
  assert.equal(lock.packages['node_modules/zod'].version, '4.6.5');
  assert.equal(lock.packages['node_modules/zod'].peer, undefined, 'not marked peer, so omit=peer installs it');
});
