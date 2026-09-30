// The login item's pure rules (api-service DESIGN §2.6–§2.8): the plist text launchd reads, which steps
// `on`, `off` and `refresh` take in each situation, and the exact lines `pir service` prints. The shell
// (src/shell/service-ctl.mjs) gathers the facts, runs the steps and does the printing. This module
// imports nothing from usage.mjs: the status check has only the body the service answered, not a Reading.

export const SERVICE_LABEL = 'com.pir.api-service';

// The port named when the status check has no url to read it from. It restates api.mjs's fixed port
// (DESIGN §2.2) rather than importing it, so this module stands without that one.
const FIXED_PORT = 47717;

const NEEDS_MACOS = 'pir service needs macOS (launchd)';
const RETRY_HINT = 'try: pir service off, then pir service on';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// A plist is XML, and the script path sits under the person's home, whose name may hold any character.
function xml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// plistText({ label, node, script, env }) → the launchd agent's plist. `node` must be an absolute path:
// launchd's PATH is /usr/bin:/bin:/usr/sbin:/sbin, so a bare `node` is not found (measured, FINDINGS).
// `env`, when given, becomes EnvironmentVariables; only T09's scratch check passes it (PIR_HOME).
export function plistText({ label, node, script, env }) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '\t<key>Label</key>',
    `\t<string>${xml(label)}</string>`,
    '\t<key>ProgramArguments</key>',
    '\t<array>',
    `\t\t<string>${xml(node)}</string>`,
    `\t\t<string>${xml(script)}</string>`,
    '\t</array>',
    '\t<key>RunAtLoad</key>',
    '\t<true/>',
    '\t<key>KeepAlive</key>',
    '\t<true/>',
    '\t<key>ProcessType</key>',
    '\t<string>Background</string>',
  ];
  if (isObject(env)) {
    lines.push('\t<key>EnvironmentVariables</key>', '\t<dict>');
    for (const [key, value] of Object.entries(env)) {
      lines.push(`\t\t<key>${xml(key)}</key>`, `\t\t<string>${xml(value)}</string>`);
    }
    lines.push('\t</dict>');
  }
  lines.push('</dict>', '</plist>', '');
  return lines.join('\n');
}

const refused = (message, code) => ({ steps: [], message, code });

// servicePlan(action, facts) → { steps, message, code }. The refusals are checked in this order, and
// the first that applies wins. `code` is the exit code of a plan with no steps; a plan with steps ends
// in the status check's code, so its own `code` is 0 and unused.
export function servicePlan(action, facts) {
  // Without this an unknown action falls through to the `refresh` steps and registers the login item.
  if (action !== 'on' && action !== 'off' && action !== 'refresh') {
    throw new Error(`servicePlan: unknown action ${JSON.stringify(action)}`);
  }
  const { kind, platform, installedEngine, off, loaded } = facts;
  // `refresh` is what install.sh runs: it must not report a failure where nothing could start.
  if (platform !== 'darwin') return refused(NEEDS_MACOS, action === 'refresh' ? 0 : 1);
  if (kind !== 'real') return refused('skipped the API service (not the real home)', 0);
  // A checkout or a task worktree would register a script path that is later deleted (§2.6). `off`
  // is not refused: it writes no path, and it must work from any copy.
  if (action !== 'off' && !installedEngine) {
    return refused('pir service: run the installed pir (./install.sh first)', 1);
  }
  if (action === 'refresh' && off) {
    return refused('the API service is off (pir service on turns it on)', 0);
  }
  const step = (name) => ({ do: name });
  const bootout = loaded ? [step('bootout')] : [];
  if (action === 'off') {
    return {
      steps: [...bootout, step('remove-plist'), step('remove-stale-discovery'), step('write-off')],
      message: null,
      code: 0,
    };
  }
  // The plist is rewritten before the restart so a moved `node` is picked up (§2.9).
  const start = [step('write-plist'), ...bootout, step('bootstrap'), step('await-answer')];
  return { steps: action === 'on' ? [step('remove-off'), ...start] : start, message: null, code: 0 };
}

// ageText(ms) → how long ago, in the coarsest unit that is at least 1. A negative age (the clock moved
// back between the reading and now) reads as `just now` rather than as a negative count.
export function ageText(ms) {
  const minutes = Math.floor(ms / 60_000);
  if (!(minutes >= 1)) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

function windowText(name, window) {
  const pct = isObject(window) ? window.used_percentage : null;
  return Number.isFinite(pct) ? `${name} ${Math.round(pct)}%` : `${name} unknown`;
}

function readingLine(usage, now) {
  const limits = isObject(usage) ? usage.rate_limits : null;
  if (!isObject(limits) || !Number.isFinite(usage.observed_at)) {
    return 'no usage reading yet: it arrives with the first pir run on a Claude subscription';
  }
  const windows = `${windowText('5-hour', limits.five_hour)}, ${windowText('weekly', limits.seven_day)}`;
  return `last usage reading ${ageText(now - usage.observed_at)}: ${windows}`;
}

function portOf(url) {
  const m = typeof url === 'string' ? /:(\d+)\/?$/.exec(url) : null;
  return m ? Number(m[1]) : FIXED_PORT;
}

// statusText(facts, now) → { text, code }: the texts of DESIGN §2.7, lines joined by `\n` with no
// trailing newline (the caller adds it when printing). Code 0 only for `running`.
export function statusText(facts, now) {
  const { state, url, pid, usage, lastExit, detail } = facts;
  const failed = (...lines) => ({ text: lines.join('\n'), code: 1 });
  switch (state) {
    case 'running':
      return { text: `pir service: running at ${url} (pid ${pid})\n${readingLine(usage, now)}`, code: 0 };
    case 'off':
      return failed('pir service: off', 'turn it on with: pir service on');
    case 'not-installed':
      return failed('pir service: not installed', 'run ./install.sh, or: pir service on');
    case 'port-held':
      return failed(
        `pir service: not answering: port ${portOf(url)} is held by another program`,
        'it retries every 10 seconds and comes up once the port is free',
      );
    case 'not-answering': {
      // No bracket when launchd has no exit code for the service: it never exited, or the line is absent.
      const bracket = Number.isFinite(lastExit) ? ` (last exit code ${lastExit})` : '';
      return failed(`pir service: registered but not answering${bracket}`, RETRY_HINT);
    }
    case 'register-failed':
      // launchctl's stderr ends in a newline; without the trim the hint would sit after a blank line.
      return failed(`pir service: macOS would not register it: ${String(detail ?? '').trim()}`, RETRY_HINT);
    case 'needs-macos':
      return failed(NEEDS_MACOS);
    default:
      throw new Error(`statusText: unknown state ${JSON.stringify(state)}`);
  }
}
