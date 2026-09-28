// reliable-notifications T02 — the ntfy config, the presence marker, the topic and the icon URL.
// Every test runs on a scratch PIR_HOME; none touches the real ~/.pir.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, statSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_ICON,
  notifyIcon,
  notifyPaths,
  readNotifyConfig,
  writeNotifyConfig,
  removeNotifyConfig,
  newTopic,
  ensurePresenceMarker,
} from './notify-config.mjs';

function scratchEnv(t, extra = {}) {
  const home = mkdtempSync(join(tmpdir(), 'pir-notify-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  return { home, env: { PIR_HOME: home, ...extra } };
}

test('notifyPaths sits beside the run index under PIR_HOME, then HOME', () => {
  assert.deepEqual(notifyPaths({ PIR_HOME: '/x', HOME: '/h' }), {
    dir: '/x/.pir',
    config: '/x/.pir/notify.json',
    presence: '/x/.pir/presence',
  });
  assert.equal(notifyPaths({ HOME: '/h' }).dir, '/h/.pir');
});

test('PIR_NOTIFY_CONFIG moves only the config path, not the marker', () => {
  const p = notifyPaths({ PIR_HOME: '/x', PIR_NOTIFY_CONFIG: '/real/notify.json' });
  assert.equal(p.config, '/real/notify.json');
  assert.equal(p.presence, '/x/.pir/presence');
  assert.equal(p.dir, '/x/.pir');
});

test('notifyIcon returns the default, or PIR_NOTIFY_ICON when set', () => {
  assert.equal(notifyIcon({}), DEFAULT_ICON);
  assert.equal(notifyIcon({ PIR_NOTIFY_ICON: '' }), DEFAULT_ICON);
  assert.equal(notifyIcon({ PIR_NOTIFY_ICON: 'https://e.test/i.png' }), 'https://e.test/i.png');
  assert.equal(
    DEFAULT_ICON,
    'https://raw.githubusercontent.com/yanekk/plan-implement-review/pir/reliable-notifications/assets/pir-notify-icon.png',
  );
});

test('config round-trips, creates the directory and is mode 0600', (t) => {
  const { env } = scratchEnv(t);
  assert.equal(readNotifyConfig(env), null);
  writeNotifyConfig({ server: 'https://ntfy.sh', topic: 'pir-abc' }, env);
  assert.deepEqual(readNotifyConfig(env), { server: 'https://ntfy.sh', topic: 'pir-abc' });
  const { config } = notifyPaths(env);
  assert.equal(statSync(config).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(readFileSync(config, 'utf8')), { server: 'https://ntfy.sh', topic: 'pir-abc' });
  // Overwriting keeps 0600 and leaves no temp file behind.
  writeNotifyConfig({ server: 'https://ntfy.sh', topic: 'pir-def' }, env);
  assert.equal(readNotifyConfig(env).topic, 'pir-def');
  assert.equal(statSync(config).mode & 0o777, 0o600);
  assert.deepEqual(readdirSync(notifyPaths(env).dir), ['notify.json']);
});

test('a crash between the temp write and the rename leaves the old config', (t) => {
  const { env } = scratchEnv(t);
  writeNotifyConfig({ server: 'https://ntfy.sh', topic: 'pir-old' }, env);
  const fs = { ...nodeFs, renameSync: () => { throw new Error('crash before rename'); } };
  assert.throws(() => writeNotifyConfig({ server: 'https://ntfy.sh', topic: 'pir-new' }, env, { fs }));
  assert.deepEqual(readNotifyConfig(env), { server: 'https://ntfy.sh', topic: 'pir-old' });
});

test('an unparseable file and a file with no topic both read corrupt; missing reads null', (t) => {
  const { env } = scratchEnv(t);
  const { dir, config } = notifyPaths(env);
  assert.equal(readNotifyConfig(env), null);
  mkdirSync(dir, { recursive: true });
  for (const text of ['{not json', '', '{"server":"https://ntfy.sh"}', '{"topic":""}', '{"topic":7}', 'null', '[]', '"x"']) {
    writeFileSync(config, text);
    assert.deepEqual(readNotifyConfig(env), { corrupt: true }, text);
  }
});

test('an unreadable config (not merely missing) reads corrupt', (t) => {
  const { env } = scratchEnv(t);
  const fs = { ...nodeFs, readFileSync: () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); } };
  assert.deepEqual(readNotifyConfig(env, { fs }), { corrupt: true });
});

test('a config with a topic but no server reads ntfy.sh', (t) => {
  const { env } = scratchEnv(t);
  const { dir, config } = notifyPaths(env);
  mkdirSync(dir, { recursive: true });
  writeFileSync(config, '{"topic":"pir-abc"}');
  assert.deepEqual(readNotifyConfig(env), { server: 'https://ntfy.sh', topic: 'pir-abc' });
});

test('PIR_NOTIFY_CONFIG is where the config is read and written', (t) => {
  const { home } = scratchEnv(t);
  const other = join(home, 'elsewhere', 'n.json');
  const env = { PIR_HOME: join(home, 'scratch'), PIR_NOTIFY_CONFIG: other };
  writeNotifyConfig({ server: 'https://ntfy.sh', topic: 'pir-x' }, env);
  assert.ok(existsSync(other));
  assert.equal(existsSync(join(home, 'scratch', '.pir', 'notify.json')), false);
  assert.equal(readNotifyConfig(env).topic, 'pir-x');
});

test('newTopic from fixed bytes gives a fixed 28-char base32 result', () => {
  const zeros = (n) => Buffer.alloc(n, 0);
  const ones = (n) => Buffer.alloc(n, 0xff);
  let asked;
  const t0 = newTopic((n) => ((asked = n), zeros(n)));
  assert.equal(asked, 15);
  assert.equal(t0, 'pir-' + 'a'.repeat(24));
  assert.equal(newTopic(ones), 'pir-' + '7'.repeat(24));
  const seq = (n) => Buffer.from(Array.from({ length: n }, (_, i) => i * 17 + 3));
  const t1 = newTopic(seq);
  assert.equal(t1, newTopic(seq));
  assert.equal(t1.length, 28);
  assert.match(t1, /^pir-[a-z2-7]{24}$/);
  // RFC 4648 base32 of these 15 bytes, lowercased: the encoding is the standard one.
  assert.equal(t1, 'pir-' + rfc4648(seq(15)).toLowerCase());
});

test('newTopic with real randomness matches the pattern and differs between calls', () => {
  const a = newTopic();
  const b = newTopic();
  assert.match(a, /^pir-[a-z2-7]{24}$/);
  assert.notEqual(a, b);
});

// A plain reference encoder, written differently from the one under test (one bit at a time).
function rfc4648(bytes) {
  const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bits = [...bytes].map((b) => b.toString(2).padStart(8, '0')).join('');
  let out = '';
  for (let i = 0; i + 5 <= bits.length; i += 5) out += alpha[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}

test('ensurePresenceMarker creates an empty marker once and leaves an existing one alone', (t) => {
  const { env } = scratchEnv(t);
  const p = ensurePresenceMarker(env);
  assert.equal(p, notifyPaths(env).presence);
  assert.equal(readFileSync(p, 'utf8'), '');
  writeFileSync(p, 'kept');
  assert.equal(ensurePresenceMarker(env), p);
  assert.equal(readFileSync(p, 'utf8'), 'kept');
});

test('removeNotifyConfig removes both files and succeeds when neither exists', (t) => {
  const { env } = scratchEnv(t);
  writeNotifyConfig({ server: 'https://ntfy.sh', topic: 'pir-abc' }, env);
  const marker = ensurePresenceMarker(env);
  removeNotifyConfig(env);
  assert.equal(existsSync(notifyPaths(env).config), false);
  assert.equal(existsSync(marker), false);
  assert.equal(readNotifyConfig(env), null);
  removeNotifyConfig(env);
  const { home } = scratchEnv(t);
  removeNotifyConfig({ PIR_HOME: join(home, 'never-made') });
});
