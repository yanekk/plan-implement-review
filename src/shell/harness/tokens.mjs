// tokens.mjs — token accounting over a captured bundle (T25, the PM's measurement requirement).
//
// A live run's cost is dominated by how many LLM turns each session takes and how big its context is;
// the coordinator's relay (removed in T25) made it take a turn per worker message for nothing. To see
// whether that cost actually fell, this reads a bundle's transcripts and sums the token usage each
// assistant turn recorded, grouped by the manifest's role (coordinator / worker / foreign). Foreign
// sessions were merely alive during the run (FINDINGS 2026-09-13) and are reported separately, never
// folded into the run total. The baseline and the after-run are measured the identical way, so the
// difference is the transport change (plus T26's prompt hardening — one combined re-run, PM decision).
//
// It is a read-only analysis over an already-captured bundle: no live agent, no paid run. `sumUsage`
// is pure and unit-tested; `tokenReport` and the CLI are the thin fs wrapper around it.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// sumUsage(lines) → the token totals over the assistant turns in one transcript. `lines` is the JSONL
// transcript, either raw strings (one JSON event per line) or already-parsed objects; a blank or
// unparseable line is skipped. Only `type:"assistant"` events with a `message.usage` are counted — a
// user turn or a tool result carries no model spend. Pure: no I/O, no clock, no randomness.
export function sumUsage(lines) {
  const acc = { turns: 0, input: 0, cacheCreate: 0, cacheRead: 0, output: 0, thinking: 0 };
  for (const line of lines) {
    let o = line;
    if (typeof line === 'string') {
      const s = line.trim();
      if (!s) continue;
      try {
        o = JSON.parse(s);
      } catch {
        continue;
      }
    }
    const u = o?.message?.usage;
    if (o?.type !== 'assistant' || !u) continue;
    acc.turns += 1;
    acc.input += u.input_tokens ?? 0;
    acc.cacheCreate += u.cache_creation_input_tokens ?? 0;
    acc.cacheRead += u.cache_read_input_tokens ?? 0;
    acc.output += u.output_tokens ?? 0;
    acc.thinking += u.output_tokens_details?.thinking_tokens ?? 0;
  }
  return acc;
}

const addInto = (a, b) => {
  for (const k of ['turns', 'input', 'cacheCreate', 'cacheRead', 'output', 'thinking']) a[k] += b[k];
  return a;
};
const zero = () => ({ turns: 0, input: 0, cacheCreate: 0, cacheRead: 0, output: 0, thinking: 0 });

// tokenReport(bundleDir) → { sessions, coordinator, workers, run, foreign }. Reads the bundle's
// manifest and each session's copied transcript, sums per session, and rolls the coordinator + worker
// sessions into the run total (foreign kept aside). The `run` total is the number to compare across
// runs. A session whose transcript is missing contributes zeros rather than throwing.
export function tokenReport(bundleDir) {
  const manifest = JSON.parse(readFileSync(join(bundleDir, 'manifest.json'), 'utf8'));
  const sessions = [];
  for (const [name, entry] of Object.entries(manifest)) {
    if (!entry.copiedTo) continue;
    let lines = [];
    try {
      lines = readFileSync(join(bundleDir, entry.copiedTo), 'utf8').split('\n');
    } catch {
      /* transcript not in the bundle — count it as zero, do not fail the whole report */
    }
    sessions.push({ name, role: entry.role ?? 'unknown', ...sumUsage(lines) });
  }
  const totalOf = (role) => sessions.filter((s) => s.role === role).reduce((a, s) => addInto(a, s), zero());
  const coordinator = totalOf('coordinator');
  const workers = totalOf('worker');
  const run = addInto(addInto(zero(), coordinator), workers);
  const foreign = totalOf('foreign');
  return { sessions, coordinator, workers, run, foreign };
}

// --- CLI: node src/shell/harness/tokens.mjs <bundleDir> -------------------------------------------

function grand(t) {
  const inSide = t.input + t.cacheCreate + t.cacheRead;
  return { inSide, total: inSide + t.output };
}
const n = (x) => x.toLocaleString('en-US');

function printReport(bundleDir) {
  const rep = tokenReport(bundleDir);
  const order = { coordinator: 0, worker: 1, foreign: 2, unknown: 3 };
  const rows = [...rep.sessions].sort((a, b) => (order[a.role] - order[b.role]) || a.name.localeCompare(b.name));
  console.log('Per session (assistant turns; token components):\n');
  for (const s of rows) {
    console.log(
      `${s.role.padEnd(11)} ${String(s.turns).padStart(4)} turns  ` +
        `cacheRead ${n(s.cacheRead).padStart(13)}  out ${n(s.output).padStart(8)}  ` +
        `(grand ${n(grand(s).total).padStart(11)})  | ${s.name}`,
    );
  }
  const block = (label, t) => {
    const g = grand(t);
    console.log(
      `\n${label}: ${n(t.turns)} turns  |  cacheCreate ${n(t.cacheCreate)}  cacheRead ${n(t.cacheRead)}  ` +
        `output ${n(t.output)} (thinking ${n(t.thinking)})  |  grand total ${n(g.total)}`,
    );
  };
  console.log('\n================ RUN (coordinator + workers; foreign excluded) ================');
  block('COORDINATOR', rep.coordinator);
  block('WORKERS', rep.workers);
  block('RUN TOTAL', rep.run);
  if (rep.foreign.turns) block('(foreign, excluded)', rep.foreign);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2];
  if (!dir) {
    console.error('usage: node src/shell/harness/tokens.mjs <bundleDir>');
    process.exit(2);
  }
  printReport(dir);
}
