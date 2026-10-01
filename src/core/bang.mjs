// The pure rules of `!`, the person's own shell command run in a session's folder (bang-commands DESIGN
// §2.1–§2.3). The view and the forwarder both use these, so a box line, the agent's message and the status
// line are defined once. No clock and no randomness: `shellId` takes both as arguments (DESIGN §3).
//
// Output is cleaned by `plainText` and durations written by `helperTime`, reused rather than copied
// (DESIGN §7): a second stripper or a second duration format would need every fix made twice.

import { plainText } from './text.mjs';
import { helperTime } from './conversation.mjs';

// The hand tool's full name (DESIGN §2.6). Defined in stream.mjs, which reads its requests, to keep this
// module's import of conversation.mjs (which imports stream.mjs) free of a cycle.
export { HAND_TOOL } from './stream.mjs';

// What the hand tool's handler returns when it runs with no result from pir: the person allowed the request
// from outside pir (claude.ai or the phone), where pir runs nothing (DESIGN §2.6).
export const HAND_FALLBACK = 'The person allowed this from outside pir, so pir did not run it. Ask them in words whether they ran it and what it printed.';

export const HAND_DECLINED = 'The person declined to run it.';

// handDeclineMessage(text?) → the deny message for a declined hand request (DESIGN §3.2): the fixed line,
// then what the person typed when they declined by replying. Blank text is the bare line.
export function handDeclineMessage(text) {
  const said = typeof text === 'string' ? text.trim() : '';
  return said ? `${HAND_DECLINED} They said: ${said}` : HAND_DECLINED;
}

// Claude Code's own Bash output cap, so an agent reads a person's command the way it reads its own.
export const AGENT_OUTPUT_CAP = 30000;
// How much of one command's output the conversation log keeps before its single `clipped` marker.
export const LOG_OUTPUT_CAP = 1024 * 1024;

export const LEAD_RAN = 'The person ran a command in your working folder:';
export const LEAD_HANDED = 'The person ran your command:';
export const LEAD_EDITED = 'The person edited your command and ran it:';

// parseBang(text) → null | { command }. Command mode is derived from the text alone (DESIGN §2.1): the
// first character is `!`. A leading space is not command mode, so ` !ls` is an ordinary message. The
// command is trimmed and may be '' (the view then sends nothing); a multi-line command is kept whole.
export function parseBang(text) {
  if (typeof text !== 'string' || !text.startsWith('!')) return null;
  return { command: text.slice(1).trim() };
}

// capForAgent(output, cap) → { text, cut }. Keeps the last `cap` characters, since errors and summaries
// come last; `cut` is how many were dropped. Counted by code point, so an emoji is never split in half.
export function capForAgent(output, cap = AGENT_OUTPUT_CAP) {
  const s = String(output ?? '');
  // Cheap path: no string of at most `cap` UTF-16 units can hold more than `cap` code points.
  if (s.length <= cap) return { text: s, cut: 0 };
  const chars = [...s];
  if (chars.length <= cap) return { text: s, cut: 0 };
  const cut = chars.length - cap;
  return { text: chars.slice(cut).join(''), cut };
}

// shellStatusLine({ code, signal, stopped, ms }) → 'exit 0 · 6s' | 'killed by SIGTERM · 2s' |
// 'stopped by the person · 1m 12s'. A stop is named as the person's even though it arrives as a signal:
// the SIGTERM is pir's, sent on their behalf, and "killed by SIGTERM" would hide who stopped it.
export function shellStatusLine({ code, signal, stopped, ms } = {}) {
  let what;
  if (stopped) what = 'stopped by the person';
  else if (typeof signal === 'string' && signal) what = `killed by ${signal}`;
  else what = `exit ${Number.isInteger(code) ? code : '?'}`;
  const time = helperTime(ms);
  return time ? `${what} · ${time}` : what;
}

// bangMessage({ command, output, code, signal, stopped, ms, lead }) → the text the agent receives when the
// command ends (DESIGN §2.3):
//   [pir] {lead}
//   $ {command}
//   {status line}
//   [(output cut: the first {n} characters are not shown)]
//   {output, or "(no output)"}
// Trailing newlines of the output are dropped: the command's last `\n` is not part of what it said.
export function bangMessage({ command, output, code, signal, stopped, ms, lead = LEAD_RAN } = {}) {
  const clean = plainText(output ?? '').replace(/\n+$/, '');
  const { text, cut } = capForAgent(clean);
  const lines = [`[pir] ${lead}`, `$ ${command ?? ''}`, shellStatusLine({ code, signal, stopped, ms })];
  if (cut > 0) lines.push(`(output cut: the first ${cut} characters are not shown)`);
  lines.push(text === '' ? '(no output)' : text);
  return lines.join('\n');
}

// shellId(now, rand) → 'sh-{now}-{rand4}' (DESIGN §3.2). `rand` is a number in [0, 1) (the shell draws it)
// or a string, of which the first four characters are used.
export function shellId(now, rand) {
  let r;
  if (typeof rand === 'number' && Number.isFinite(rand)) {
    r = Math.floor(Math.abs(rand % 1) * 36 ** 4).toString(36).padStart(4, '0');
  } else {
    r = String(rand ?? '').slice(0, 4).padStart(4, '0');
  }
  return `sh-${now}-${r}`;
}
