// The setup/test front-matter block at the top of a plan's DESIGN.md (DESIGN §2.1). It declares the
// commands the engine runs: `setup` in every fresh worktree, `test` at the end-of-run gate. It replaces
// the guess `testCommandFrom` made from prose, which failed silently on plans naming the command inline.
//
// parseTestBlock(designText) →
//   { ok: true,  setup: string[], test: string[] }   // setup [] for `setup: none`
//   { ok: false, reason: string }                     // shown to the person verbatim
//
// Deliberately not YAML. A list item is `  - ` then one shell line, taken verbatim and trimmed, so what
// is written is what `/bin/sh -c` receives: quotes, colons and `&&` are the shell's business. A trailing
// `# note` stays on a command line (the shell ignores it); a key line takes no comment, so
// `setup: none  # x` is rejected. Only one shape per key is accepted (a list, or `none` for setup),
// because accepting two is how two plans end up disagreeing about which one works. Unknown keys and
// anything indented under them are skipped, so a later plan can add a key without breaking this parser.
// Pure text in, decision out — reading the file lives in the shell (boundary.test.mjs).

const KEY = /^([A-Za-z_][\w-]*):(.*)$/;
const ITEM = /^\s+-\s+(\S.*)$/;

export function parseTestBlock(designText) {
  const lines = String(designText ?? '').split(/\r?\n/);
  if (lines[0] !== '---') return fail('no front-matter block');
  const close = lines.indexOf('---', 1);
  if (close === -1) return fail('no front-matter block');

  const found = {}; // key → string[] | 'none'
  let current = null; // the key whose list items are being read, or '' while skipping an unknown key

  for (let i = 1; i < close; i++) {
    const line = lines[i];
    if (line.trim() === '' || line.trim().startsWith('#')) continue;

    const key = KEY.exec(line);
    if (key) {
      const [, name, rest] = key;
      const value = rest.trim();
      if (name !== 'setup' && name !== 'test') {
        current = '';
        continue;
      }
      if (name === 'setup' && value === 'none') {
        found.setup = 'none';
        current = null;
      } else if (value === '') {
        found[name] = [];
        current = name;
      } else {
        return fail(shapeReason(name));
      }
      continue;
    }

    if (current === '' && /^\s/.test(line)) continue; // body of an unknown key
    const item = current ? ITEM.exec(line) : null;
    if (!item) return fail(`line ${i + 1}: expected "  - <command>"`);
    found[current].push(item[1].trim());
  }

  if (!('setup' in found)) return fail('no setup key');
  if (!('test' in found)) return fail('no test key');
  if (Array.isArray(found.setup) && found.setup.length === 0) return fail(shapeReason('setup'));
  if (found.test.length === 0) return fail(shapeReason('test'));
  return { ok: true, setup: found.setup === 'none' ? [] : found.setup, test: found.test };
}

function shapeReason(key) {
  return key === 'setup' ? 'setup: expected none or a list' : 'test: expected a list of commands';
}

function fail(reason) {
  return { ok: false, reason };
}
