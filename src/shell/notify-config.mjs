// The per-account ntfy config, the presence marker and the icon URL (plans/reliable-notifications
// DESIGN §2.5, §2.6, §2.7, §3.4). Everything takes `env` so tests point it at a scratch PIR_HOME and
// never touch the real `~/.pir`.
//
// Where: `{PIR_HOME ?? HOME}/.pir/`, beside the run index, because `~/.claude/pir-engine` is deleted by
// every install.sh. Per account, not per project: the phone is the person's, not the repo's.

import * as nodeFs from 'node:fs';
import { randomBytes as cryptoRandomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { indexDir } from './index-store.mjs';
import { writeJsonAtomic } from './atomic-write.mjs';

// Temporary: the pushed feature branch's copy, because GitHub's `main` lags the local one (DESIGN §2.5,
// user 2026-09-28). Where the icon lives for good is an open decision in PLAN.
export const DEFAULT_ICON =
  'https://raw.githubusercontent.com/yanekk/plan-implement-review/pir/reliable-notifications/assets/pir-notify-icon.png';

export const DEFAULT_SERVER = 'https://ntfy.sh';

// notifyIcon(env) → the icon URL. PIR_NOTIFY_ICON is for the live check and a later move; undocumented.
export function notifyIcon(env = process.env) {
  return env.PIR_NOTIFY_ICON || DEFAULT_ICON;
}

// notifyPaths(env) → { dir, config, presence }. `dir` is the parent of the run index, reused from
// index-store.mjs rather than re-derived. PIR_NOTIFY_CONFIG moves only the config: it lets the live
// harness read the person's real config while PIR_HOME points at a scratch folder, and the marker must
// stay with PIR_HOME (DESIGN §2.6).
export function notifyPaths(env = process.env) {
  const dir = dirname(indexDir({ env }));
  return {
    dir,
    config: env.PIR_NOTIFY_CONFIG || join(dir, 'notify.json'),
    presence: join(dir, 'presence'),
  };
}

// readNotifyConfig(env, { fs }) → { server, topic } | null | { corrupt: true }.
// null only when the file is absent. Anything else that is not a usable config, an unreadable file
// included, reads corrupt: the sender treats it as no config, and `pir notify` reports it and offers
// `pir notify off` (DESIGN §2.8). A missing server falls back to ntfy.sh, the only one supported (§8).
export function readNotifyConfig(env = process.env, { fs = nodeFs } = {}) {
  let text;
  try {
    text = fs.readFileSync(notifyPaths(env).config, 'utf8');
  } catch (err) {
    if (err?.code === 'ENOENT') return null;
    return { corrupt: true };
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return { corrupt: true };
  }
  if (!value || typeof value !== 'object' || typeof value.topic !== 'string' || value.topic === '') {
    return { corrupt: true };
  }
  const server = typeof value.server === 'string' && value.server !== '' ? value.server : DEFAULT_SERVER;
  return { server, topic: value.topic };
}

// writeNotifyConfig(config, env, { fs }) → void. Mode 0600: the topic is the only secret. Through the
// shared temp-then-rename writer, so a crash mid-write leaves the old file or none.
export function writeNotifyConfig({ server, topic }, env = process.env, { fs = nodeFs } = {}) {
  writeJsonAtomic(notifyPaths(env).config, { server, topic }, { fs, mode: 0o600 });
}

// removeNotifyConfig(env, { fs }) → void. Deletes the config and the presence marker; either being
// absent is fine. Deleting the marker is what lets already-running sessions push through the Claude
// app again (DESIGN §2.7).
export function removeNotifyConfig(env = process.env, { fs = nodeFs } = {}) {
  const { config, presence } = notifyPaths(env);
  fs.rmSync(config, { force: true });
  fs.rmSync(presence, { force: true });
}

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

// newTopic(randomBytes) → 'pir-' + 24 lowercase base32 characters (120 bits from 15 random bytes).
// The topic is the only secret on ntfy, so it must not be guessable.
export function newTopic(randomBytes = cryptoRandomBytes) {
  const bytes = randomBytes(15);
  let bits = 0;
  let acc = 0;
  let out = '';
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += BASE32[(acc >> bits) & 31];
    }
    acc &= (1 << bits) - 1;
  }
  return 'pir-' + out;
}

// ensurePresenceMarker(env, { fs }) → the marker's path. Creates it empty if absent and leaves an
// existing one alone. Claude Code skips mobile push while this file exists (DESIGN §2.7).
export function ensurePresenceMarker(env = process.env, { fs = nodeFs } = {}) {
  const { dir, presence } = notifyPaths(env);
  fs.mkdirSync(dir, { recursive: true });
  try {
    fs.writeFileSync(presence, '', { flag: 'wx' });
  } catch (err) {
    if (err?.code !== 'EEXIST') throw err;
  }
  return presence;
}
