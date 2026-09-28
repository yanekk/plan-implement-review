// The colour palette every pir screen paints with: one style→SGR table, shared by render.mjs (the
// coordinator's own display) and pir-view.mjs (the `pir` screen), so the two never drift apart.
//
// pir's colours are Catppuccin Mocha, "clear": Mocha's foreground colours with no background of its own,
// so the terminal's background shows through (user 2026-09-27; the Pi theme `catppuccin-mocha-clear`).
// They are exact 24-bit colours, which only a terminal that says it can show them gets: COLORTERM
// `truecolor`/`24bit`, or FORCE_COLOR=3. Any other terminal keeps the basic 16-colour table — a 24-bit
// code sent to a terminal that cannot show it is approximated or ignored, and the nearest basic colour is
// a better guess than whatever the terminal picks. The basic table is also what a colour-off run holds
// (NO_COLOR set): nothing is painted then, and the tests pin its codes.
//
// Each style keeps its meaning across both tables (asking amber and bold, crashed red, running green),
// so docs that name a colour stay true either way.

const fg = (hex, bold = false) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `\x1b[${bold ? '1;' : ''}38;2;${r};${g};${b}m`;
};
const bg = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `\x1b[48;2;${r};${g};${b}m`;
};

// Catppuccin Mocha, the values of the Pi theme's `vars`.
const MOCHA = {
  green: '#a6e3a1',
  cyan: '#94e2d5',
  yellow: '#f9e2af',
  red: '#f38ba8',
  blue: '#89b4fa',
  purple: '#cba6f7',
  orange: '#fab387',
  dim: '#7f849c',
  selected: '#313244',
  subtext1: '#bac2de',
};

// The basic table: the codes pir painted before the palette, one per style.
export const BASIC_SGR = {
  // render.mjs's row/footer keys.
  done: '\x1b[32m', // green
  active: '\x1b[36m', // cyan
  asking: '\x1b[1;33m', // bold amber
  idle: '\x1b[2m', // dim
  red: '\x1b[31m', // failure / interrupted
  // the list's keys (live-workers §2.11).
  head: '\x1b[1m', // the `pir` title, bold
  running: '\x1b[32m', // a running run's state word, green
  crashed: '\x1b[31m', // a crashed run's state word, red
  ended: '\x1b[2m', // finished / stopped, dim
  'bar-run': '\x1b[34m', // progress bar of a running run, blue
  'bar-crash': '\x1b[31m', // progress bar of a crashed run, red
  'bar-idle': '\x1b[2m', // progress bar otherwise, dim
  selected: '\x1b[34m', // the selected row's `▎` mark, blue — drawn only with colour off (see paintLine)
  'count-run': '\x1b[32m', // the running count, green
  'count-crash': '\x1b[31m', // the crashed count, red
  hint: '\x1b[2m', // the faint key-hint footer
  armed: '\x1b[1;33m', // the armed stop/remove confirmation, amber and bold
  dim: '\x1b[2m', // plain dim text (repo column, worker count, notes)
  // the TYPE column and the planning run's `your go` (pir-plan-command §2.10).
  'type-plan': '\x1b[35m', // TYPE `plan`, magenta
  'type-work': '\x1b[34m', // TYPE `work`, blue
  'your-go': '\x1b[1;33m', // a reviewed plan waiting on the person's go: amber bold, the colour of asking
  // the conversation view (live-workers §2.11): pir orange, the person green, the worker bold, a step
  // magenta (red when it failed), a pending prompt amber.
  pir: '\x1b[38;5;208m',
  person: '\x1b[32m',
  worker: '\x1b[1m',
  step: '\x1b[35m',
  'step-error': '\x1b[31m',
  prompt: '\x1b[1;33m',
  ok: '\x1b[32m',
  bad: '\x1b[31m',
};

// The selected row's band on the basic table: a dark grey background (256-colour 236, user 2026-09-26).
export const BASIC_SELECTED_BG = '\x1b[48;5;236m';

// The Mocha table: the same styles, the same meanings. Bold stays bold; "dim" becomes Mocha's dim grey
// rather than the terminal's faint attribute, which some terminals render too faint to read.
export const MOCHA_SGR = {
  done: fg(MOCHA.green),
  active: fg(MOCHA.cyan),
  asking: fg(MOCHA.yellow, true),
  idle: fg(MOCHA.dim),
  red: fg(MOCHA.red),
  head: '\x1b[1m',
  running: fg(MOCHA.green),
  crashed: fg(MOCHA.red),
  ended: fg(MOCHA.dim),
  'bar-run': fg(MOCHA.blue),
  'bar-crash': fg(MOCHA.red),
  'bar-idle': fg(MOCHA.dim),
  selected: fg(MOCHA.blue),
  'count-run': fg(MOCHA.green),
  'count-crash': fg(MOCHA.red),
  hint: fg(MOCHA.dim),
  armed: fg(MOCHA.yellow, true),
  dim: fg(MOCHA.dim),
  'type-plan': fg(MOCHA.purple),
  'type-work': fg(MOCHA.blue),
  'your-go': fg(MOCHA.yellow, true),
  pir: fg(MOCHA.orange),
  person: fg(MOCHA.green),
  worker: '\x1b[1m',
  step: fg(MOCHA.purple),
  'step-error': fg(MOCHA.red),
  prompt: fg(MOCHA.yellow, true),
  ok: fg(MOCHA.green),
  bad: fg(MOCHA.red),
};

export const MOCHA_SELECTED_BG = bg(MOCHA.selected);

// The hover lift (mouse-navigation §2.2): the code a dim span paints in on the row under the pointer, so
// a finished or stopped run brightens too. Bold throughout, since the hovered row's text is bold. Mocha
// lifts the dim grey to subtext1, the next step up its greys; the basic table has no lighter grey than
// plain text, so the lift there is plain bold — the faint attribute dropped.
export const BASIC_HOVER_LIFT = '\x1b[1m';
export const MOCHA_HOVER_LIFT = fg(MOCHA.subtext1, true);

// hoverLiftFor(env) → the hover lift for the table paletteFor(env) picks. Kept out of paletteFor's
// result so that object's shape — pinned by its tests and read by render.mjs — is unchanged.
export function hoverLiftFor(env) {
  return truecolour(env) ? MOCHA_HOVER_LIFT : BASIC_HOVER_LIFT;
}

// truecolour(env) → whether this terminal says it shows 24-bit colour and colour has not been turned off.
export function truecolour(env) {
  if ('NO_COLOR' in env) return false;
  return /^(truecolor|24bit)$/i.test(env.COLORTERM ?? '') || env.FORCE_COLOR === '3';
}

// paletteFor(env) → { sgr, selectedBg }: the table this terminal paints with.
export function paletteFor(env) {
  return truecolour(env) ? { sgr: MOCHA_SGR, selectedBg: MOCHA_SELECTED_BG } : { sgr: BASIC_SGR, selectedBg: BASIC_SELECTED_BG };
}
