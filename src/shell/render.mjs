// The terminal renderer for the live display (DESIGN §2.3, §3.2). It is the shell half of the split:
// the pure model (src/core/display.mjs) turns run state into rows/summary/footer as data; this paints
// that data on a real terminal, `docker compose up`-style — the block redrawn in place on each pass,
// with a ticking spinner. It owns the glyph characters and the cursor control the model deliberately
// does not, because in-place painting can only be judged by a person watching a real terminal (T09).
//
// It degrades when stdout is not a TTY — piped, redirected, or captured by the test harness — to plain
// append-only lines with no cursor escapes, because cursor-control garbles a non-terminal and the
// harness reads the output as text (DESIGN §2.3). So `paint` only redraws in place when stream.isTTY;
// otherwise it appends the same lines plainly. This is why the model is pure and this is not: the
// vocabulary is tested in display.test.mjs; only the painting needs eyes.

// The spinner frames, ticked one per paint (a real run paints once per pass / poll). A reduced-motion
// terminal is a person's setting the renderer cannot read here; the frames are plain Braille dots.
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

// The glyph per row kind. Active kinds spin; a parked worker is a filled dot (it wants the person); a
// merged task is a check; an idle task is a faint dot. The model carries the kind; these characters are
// the renderer's alone (DESIGN §2.3).
const GLYPH = {
  building: null, // the spinner frame — filled in at paint time
  reviewing: null,
  merging: null,
  asking: '●',
  done: '✔',
  waiting: '·',
  queued: '·',
};

// mm:ss for an elapsed/duration in ms; null renders blank. 0:04, 1:23, 12:05.
function fmtElapsed(ms) {
  if (ms == null) return '';
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

// The block of plain-text lines for a display, given the current spinner character. No escapes here —
// this is the same content whether it is painted in place (TTY) or appended (non-TTY); only the cursor
// control around it differs. Exported so a test can assert the content without the escapes.
export function formatLines(display, { spinnerChar = SPINNER[0] } = {}) {
  const { summary, rows, footer, branch } = display;
  const lines = [summaryLine(summary, footer, branch, spinnerChar)];
  for (const r of rows) lines.push(rowLine(r, spinnerChar));
  for (const f of footerLines(footer, summary)) lines.push(f);
  return lines;
}

function summaryLine(summary, footer, branch, spinnerChar) {
  if (footer?.kind === 'interrupted') {
    return `✗ ${branch || 'run'} interrupted`;
  }
  if (summary.finished) {
    return `✓ ${branch || 'run'} · ${summary.done}/${summary.total} done`;
  }
  const parts = [`${summary.done}/${summary.total} done`, `${summary.running} running`];
  if (summary.asking > 0) parts.push(`${summary.asking} asking you`);
  parts.push(`${summary.waiting} waiting`);
  const ceiling = summary.ceiling != null ? ` · ceiling ${summary.ceiling}${summary.ceilingFull ? ' (full)' : ''}` : '';
  return `${spinnerChar} ${branch || 'run'} · ${parts.join(' · ')}${ceiling}`;
}

function rowLine(r, spinnerChar) {
  const glyph = GLYPH[r.kind] === null || GLYPH[r.kind] === undefined ? spinnerChar : GLYPH[r.kind];
  // For an idle/queued row the glyph is a faint dot; keep the columns aligned enough to read.
  const g = r.kind === 'waiting' || r.kind === 'queued' ? '·' : glyph;
  const id = r.id.padEnd(4);
  const slug = (r.slug ?? '').padEnd(22);
  const label = r.label.padEnd(24);
  const el = fmtElapsed(r.elapsedMs);
  return `  ${g} ${id} ${slug} ${label} ${el}`.replace(/\s+$/, '');
}

function footerLines(footer, summary) {
  switch (footer?.kind) {
    case 'asking':
      return [
        '',
        `● ${footer.task} ${footer.slug ?? ''} is asking you${footer.question ? `  ${footer.question}` : ''}`.trim(),
        '  answer it directly — find it in `claude agents`, attach, and reply there.',
      ];
    case 'handoff':
      return ['', `✔ all ${summary.total} task(s) green on ${footer.branch} · tests pass. Yours to merge:`, `    git merge ${footer.branch}`];
    case 'red':
      return ['', `✗ ${summary.total} task(s) built on ${footer.branch}, but its tests fail — not ready to merge.`];
    case 'interrupted':
      return ['', '^C — closing workers… main is untouched. Re-run to resume from committed work.'];
    default:
      return [''];
  }
}

// createRenderer({ stream }) → { paint(display), line(text) } (DESIGN §2.3).
//   paint(display) — on a TTY, clear the previously-painted block (cursor up N + clear to end) and
//                    redraw it in place, ticking the spinner; on a non-TTY, append the same lines
//                    plainly with no cursor escapes.
//   line(text)     — print a one-off line (startup notes, the final hand-off). It ends the current
//                    in-place block, so a following paint starts a fresh block below the line.
export function createRenderer({ stream = process.stdout } = {}) {
  const isTTY = !!stream.isTTY;
  let spinIdx = 0;
  let paintedLines = 0; // how many lines the last paint drew, for the in-place clear

  function write(s) {
    stream.write(s);
  }

  return {
    paint(display) {
      const spinnerChar = SPINNER[spinIdx % SPINNER.length];
      spinIdx += 1;
      const lines = formatLines(display, { spinnerChar });
      const block = lines.join('\n') + '\n';

      if (isTTY) {
        // Move the cursor up over the previous block and clear from there to the end of the screen,
        // then redraw — the block updates in place instead of scrolling (DESIGN §2.3). `\x1b[<n>A`
        // moves up n rows; `\x1b[0J` clears from the cursor to the end.
        if (paintedLines > 0) write(`\x1b[${paintedLines}A\x1b[0J`);
        write(block);
        paintedLines = lines.length;
      } else {
        // Not a terminal: append plain lines, never a cursor escape (they garble a pipe and the harness
        // reads this as text, DESIGN §2.3). No in-place redraw, so nothing to remember.
        write(block);
      }
    },

    // A one-off line outside the live block. On a TTY it ends the current block so the next paint draws
    // fresh below it (rather than clearing over the line just written); on a non-TTY it is just a line.
    line(text = '') {
      write(`${text}\n`);
      paintedLines = 0;
    },
  };
}
