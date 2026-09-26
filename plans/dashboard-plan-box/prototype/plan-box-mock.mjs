// THROWAWAY MOCK — the dashboard's "new plan" box. Reads the real run index (read-only), paints the real
// list, and puts a pi-tui Editor under it with @repo completion over Claude Code's project list. Enter with
// text runs the real planPreflight for the chosen repo (read-only git calls) and reports what WOULD start;
// nothing is created. Run: node plan-box-mock.mjs   (from any folder)
import { Editor, getKeybindings, isKeyRelease, parseKey } from '/Users/jan.krolikowski/src/plan-implement-review/node_modules/@earendil-works/pi-tui/dist/index.js';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
const R = '/Users/jan.krolikowski/src/plan-implement-review/src/shell/';
const { createScreen, loadDashboard, buildListFrame } = await import(R + 'pir-tui.mjs');
const { paintLine, SGR, RESET } = await import(R + 'pir-view.mjs');
const { planPreflight } = await import(R + 'launch.mjs');

const span = (text, style = null) => ({ text, style });

// Repos: every git repo directly inside ~/src (or each folder in PIR_REPOS, colon-separated) that has a
// local main, most recently worked in first (newest mtime among .git/index, .git/HEAD, .git/logs/HEAD).
import { readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
function knownRepos() {
  const roots = (process.env.PIR_REPOS ?? join(homedir(), 'src')).split(':').filter(Boolean).map((r) => r.replace(/^~/, homedir()));
  const out = [];
  for (const root of roots) {
    let names = [];
    try { names = readdirSync(root); } catch {}
    for (const name of names) {
      const path = join(root, name);
      if (!existsSync(join(path, '.git'))) continue;
      try { execFileSync('git', ['-C', path, 'rev-parse', '--verify', '--quiet', 'refs/heads/main'], { stdio: 'ignore' }); } catch { continue; }
      let t = 0;
      for (const f of ['index', 'HEAD', 'logs/HEAD']) { try { t = Math.max(t, statSync(join(path, '.git', f)).mtimeMs); } catch {} }
      out.push({ path, name, t });
    }
  }
  return out.sort((a, b) => b.t - a.t);
}
const REPOS = knownRepos();

const provider = {
  triggerCharacters: ['@'],
  async getSuggestions(lines, line, col) {
    const before = lines[line].slice(0, col);
    const m = before.match(/(?:^|\s)@([\w.-]*)$/);
    if (!m) return null;
    const q = m[1].toLowerCase();
    const items = REPOS.filter((r) => r.name.toLowerCase().includes(q))
      .slice(0, 30)
      .map((r) => ({ value: r.name, label: '@' + r.name, description: r.path.replace(homedir(), '~') }));
    return items.length ? { items, prefix: '@' + m[1] } : null;
  },
  applyCompletion(lines, line, col, item, prefix) {
    const l = lines[line];
    const start = col - prefix.length;
    const next = l.slice(0, start) + '@' + item.value + ' ' + l.slice(col);
    const out = [...lines];
    out[line] = next;
    return { lines: out, cursorLine: line, cursorCol: start + item.value.length + 2 };
  },
};

// The brief must start with @name, an exact repo name; everything after it is the brief.
function parse(text) {
  const m = text.match(/^@([\w.-]*)\s*([\s\S]*)$/);
  if (!m) return { repo: null, name: null, brief: text.trim() };
  return { repo: REPOS.find((r) => r.name === m[1]) ?? null, name: m[1], brief: m[2].trim() };
}

const screen = createScreen({});
const colour = screen.colour;
const style = (s, t) => (colour && SGR[s] ? `${SGR[s]}${t}${RESET}` : t);
const editor = new Editor(screen.host, {
  borderColor: (s) => style('dim', s),
  selectList: { selectedPrefix: (s) => style('prompt', s), selectedText: (s) => style('prompt', s), description: (s) => style('dim', s), scrollInfo: (s) => style('dim', s), noMatch: (s) => style('dim', s) },
});
editor.setAutocompleteProvider(provider);
editor.setText('@');
let ui = { sel: 0, armed: null };
let note = null;

const comp = {
  focused: true,
  invalidate() { editor.invalidate(); },
  render(width) {
    const dash = loadDashboard();
    const list = buildListFrame(dash, ui, { columns: width });
    list.pop(); // the real footer; the mock writes its own
    while (list.length && list[list.length - 1].length === 0) list.pop();
    const text = editor.getText();
    const p = parse(text);
    const bare = text === '@' || text === '';
    const where = p.repo ? `in ${p.repo.name}` : bare ? 'start with @repo' : p.name ? `@${p.name} is not a repo in ~/src` : 'start with @repo';
    const box = editor.render(width);
    const tail = 3 + box.length + (note ? 1 : 0);
    const rowsAvail = (screen.host.terminal?.rows ?? 24) - tail;
    const out = list.slice(0, Math.max(0, rowsAvail)).map((l) => paintLine(l, width, colour));
    while (out.length < rowsAvail) out.push('');
    if (note) out.push(paintLine([span(note.text, note.style)], width, colour));
    out.push(paintLine([span('new plan ', 'head'), span(where, p.repo || bare ? 'dim' : 'your-go')], width, colour));
    out.push(...box);
    const hint = !bare
      ? '↵ start planning · @ pick repo · shift+↵ new line · esc clear'
      : '↑↓ select · → open · type to plan something new (@repo picks the repo) · ctrl+s stop · ctrl+x remove · esc quit';
    out.push(paintLine([span(hint, 'hint')], width, colour));
    return out;
  },
  handleInput(data) {
    if (isKeyRelease(data)) return;
    const key = parseKey(data);
    const text = editor.getText();
    const bare = text === '@' || text === '';
    const kb = getKeybindings();
    const acOpen = editor.isShowingAutocomplete?.() ?? false;
    if (key === 'ctrl+c' || (key === 'escape' && bare && !acOpen)) return quit();
    if (key === 'escape' && !acOpen) { editor.setText('@'); note = null; return screen.renderNow(); }
    if (!acOpen && bare && (key === 'up' || key === 'down')) {
      const n = loadDashboard().rows.length;
      ui = { ...ui, sel: Math.max(0, Math.min(n - 1, ui.sel + (key === 'up' ? -1 : 1))) };
      return screen.renderNow();
    }
    if (!acOpen && bare && (key === 'right' || key === 'enter')) {
      note = { text: '(mock) would open the selected run', style: 'dim' };
      return screen.renderNow();
    }
    if (!acOpen && kb.matches(data, 'tui.input.submit') && !kb.matches(data, 'tui.input.newLine')) {
      const p = parse(text);
      if (!p.repo) note = { text: p.name ? `no repo @${p.name} in ~/src — pick one from the list` : 'start with @repo', style: 'your-go' };
      else if (!p.brief) note = { text: `say what to plan after @${p.repo.name}`, style: 'your-go' };
      else {
        const pre = planPreflight({ cwd: p.repo.path, env: { ...process.env, PARALLEL_ALLOW_HERE: '1' } }); // the guard is dropped (req 9)
        note = pre.ok
          ? { text: `(mock) would start planning in ${pre.root}: "${p.brief.slice(0, 50)}" → the planner's conversation`, style: 'count-run' }
          : { text: `(mock) refused in ${p.repo.name}: ${pre.reason}`, style: 'count-crash' };
        if (pre.ok) editor.setText('@');
      }
      return screen.renderNow();
    }
    editor.handleInput(data);
    screen.renderNow();
  },
};
function quit() { clearInterval(tick); screen.close(); process.exit(0); }
screen.mount(comp);
screen.listen((d) => { try { comp.handleInput(d); } catch (e) { screen.close(); console.error(e); process.exit(1); } }, (e) => { screen.close(); console.error(e); process.exit(1); });
screen.renderNow();
const tick = setInterval(() => screen.renderNow(), 1000);
