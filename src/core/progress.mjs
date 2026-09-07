// The two pure functions over PROGRESS.md that are genuinely this project's own (DESIGN
// §3.2, §3.3). `parseProgress` reads the file into a structured task table and the
// plan-reviewed gate; `reconcileTaskRow` folds one finished task's row back into the file
// without disturbing any other line. Pure text in, text or struct out — the filesystem
// read and write live in src/shell/, never here (DESIGN §3.1, enforced by boundary.test.mjs).
//
// Why a parser rather than trusting git's line merge: PROGRESS.md is the one file every
// worker writes, and its single-line fields (Status, Next pir-work will:, Review queue)
// would conflict on every parallel merge. The coordinator instead reads a worker's task
// row and folds just that row in with reconcileTaskRow, staying the single writer of the
// cross-cutting lines (DESIGN §2.5, §2.9).

// The five state glyphs a task row may carry (PROGRESS.md legend). A row whose state cell
// is none of these is surfaced as a parse error rather than dropped: a row the parser
// cannot read is a task silently never built, which is the exact failure this guards.
const KNOWN_STATES = new Set(['⬜', '🟡', '🔍', '✅', '⛔']);

// The two Runs markers (DESIGN §2.6). `auto` is the default when a plan predates the
// column, so classic plans still parse.
const KNOWN_RUNS = new Set(['auto', 'you']);

const NOTES_WORD_BUDGET = 60;

// Split one table line into its interior cells, trimmed. A markdown row `| a | b |`
// splits into ['', ' a ', ' b ', ''] on the pipe; we drop the outer empties (the cells
// before the first pipe and after the last) and keep every interior cell, including an
// empty Notes cell written as `| |`. Used for reading; reconcile works on the raw line.
function splitCells(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}

// A markdown separator row: every cell is dashes, optionally colon-anchored (`:--`, `--:`).
function isSeparatorRow(cells) {
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));
}

function wordCount(s) {
  return (s.trim().match(/\S+/g) || []).length;
}

// Map a header cell's text to the field it names. Returns null for a column we do not
// consume (so an unrecognised column is harmless, not an error). Matching is by name, not
// position, which is what lets a table with no Runs column parse (DESIGN §2.6).
function headerField(cellText) {
  switch (cellText.trim().toLowerCase()) {
    case '#':
      return 'num';
    case 'task':
      return 'name';
    case 'runs':
      return 'runs';
    case 'depends on':
      return 'deps';
    case 'state':
      return 'state';
    case 'notes':
      return 'notes';
    default:
      return null;
  }
}

// Find the task table: the first `|`-delimited header row that names at least the #, Task
// and State columns and is followed by a separator row. Returns the header line index, the
// column-name → cell-index map, the header cell count, and the [start, end) range of data
// lines, or null when there is no such table (a file with no table yields no tasks).
function locateTable(lines) {
  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i];
    if (!line.trim().startsWith('|')) continue;

    const headerCells = splitCells(line);
    const col = {};
    headerCells.forEach((text, idx) => {
      const field = headerField(text);
      if (field && col[field] === undefined) col[field] = idx;
    });
    // The three columns that identify this as the task table; the parse and the reconcile
    // both need them, and requiring them stops a stray table elsewhere being read as tasks.
    if (col.num === undefined || col.name === undefined || col.state === undefined) continue;

    if (!isSeparatorRow(splitCells(lines[i + 1]))) continue;

    // Data rows run from just after the separator until the first line that is not a table
    // row (a blank line or prose both end the table).
    let end = i + 2;
    while (end < lines.length && lines[end].trim().startsWith('|')) end++;

    return { headerIndex: i, col, headerCellCount: headerCells.length, dataStart: i + 2, dataEnd: end };
  }
  return null;
}

// Depends-on cell → list of task numbers. `—` or empty yields []; otherwise every T-number
// token in the cell, so both `T01` and `T01, T02` parse (DESIGN §3.2 interface).
function parseDeps(cell) {
  return cell.match(/T\d+/g) || [];
}

// Read the **Plan reviewed:** gate line. reviewed is false while the note begins "not yet",
// false when the note is empty, and false when the line is absent (the conservative default:
// an unreviewed-looking gate builds nothing, DESIGN §2.1 — the coordinator refuses on anything
// short of a positive verdict). note carries whatever follows the label, for the report.
function parsePlanReviewed(lines) {
  for (const line of lines) {
    const m = line.match(/\*\*Plan reviewed:\*\*\s*(.*)$/);
    if (!m) continue;
    const note = m[1].trim();
    return { reviewed: note !== '' && !/^not yet\b/i.test(note), note };
  }
  return { reviewed: false, note: '' };
}

// parseProgress(text) → { planReviewed, tasks, errors }.
// tasks is well-formed: every entry has a known state and a known Runs marker. A row the
// parser cannot read cleanly is described in errors, naming the task or the offending line,
// rather than being dropped or silently mis-read.
export function parseProgress(text) {
  const lines = text.split('\n');
  const planReviewed = parsePlanReviewed(lines);
  const tasks = [];
  const errors = [];

  const table = locateTable(lines);
  if (!table) return { planReviewed, tasks, errors };

  const { col, headerCellCount, dataStart, dataEnd } = table;

  for (let i = dataStart; i < dataEnd; i++) {
    const cells = splitCells(lines[i]);
    if (isSeparatorRow(cells)) continue;

    if (cells.length !== headerCellCount) {
      errors.push(
        `line ${i + 1}: malformed row, expected ${headerCellCount} cells but found ${cells.length}: ${lines[i].trim()}`,
      );
      continue;
    }

    const num = cells[col.num];
    if (!/^T\d+$/.test(num)) {
      errors.push(`line ${i + 1}: unrecognised task id "${num}": ${lines[i].trim()}`);
      continue;
    }

    const state = cells[col.state];
    if (!KNOWN_STATES.has(state)) {
      errors.push(`task ${num}: unknown state glyph "${state}"`);
      continue;
    }

    let runs = 'auto';
    if (col.runs !== undefined) {
      const raw = cells[col.runs].toLowerCase();
      if (KNOWN_RUNS.has(raw)) {
        runs = raw;
      } else {
        // Report and default to auto rather than silently spawning an autonomous worker on
        // a person-only ("you") task because of a typo in the marker.
        errors.push(`task ${num}: unknown Runs marker "${cells[col.runs]}", defaulting to auto`);
      }
    }

    const deps = col.deps !== undefined ? parseDeps(cells[col.deps]) : [];
    const name = cells[col.name];

    tasks.push({ num, name, deps, runs, state });
  }

  return { planReviewed, tasks, errors };
}

// reconcileTaskRow(progressText, { num, state, notes }) → newText.
// Replaces only the target row's State and Notes cells; every other line is byte-for-byte
// identical, including the coordinator-managed Status / Next pir-work will: / Review queue
// lines (DESIGN §2.5). This is what lets many worker branches fold into one shared file
// without git's line merge colliding on those single-line fields.
//
// Errors rather than guessing: an unknown task number, a notes cell over the word budget,
// a state that is not a known glyph, or a `|` in the new content (which would corrupt the
// table). None of these is truncated or written silently.
export function reconcileTaskRow(progressText, { num, state, notes }) {
  if (!KNOWN_STATES.has(state)) {
    throw new Error(`reconcileTaskRow: state "${state}" is not a known glyph`);
  }
  const notesText = notes ?? '';
  if (wordCount(notesText) > NOTES_WORD_BUDGET) {
    throw new Error(
      `reconcileTaskRow: notes for ${num} is ${wordCount(notesText)} words, over the ${NOTES_WORD_BUDGET}-word budget`,
    );
  }
  if (state.includes('|') || notesText.includes('|')) {
    throw new Error(`reconcileTaskRow: state/notes for ${num} contain "|", which would corrupt the table`);
  }

  const lines = progressText.split('\n');
  const table = locateTable(lines);
  if (!table) throw new Error(`reconcileTaskRow: no task table found`);

  const { col, dataStart, dataEnd, headerCellCount } = table;
  if (col.notes === undefined) {
    throw new Error(`reconcileTaskRow: the task table has no Notes column`);
  }

  for (let i = dataStart; i < dataEnd; i++) {
    const cells = splitCells(lines[i]);
    if (cells.length !== headerCellCount || cells[col.num] !== num) continue;

    // Work on the raw line so the cells we are NOT changing keep their exact bytes. Split on
    // the pipe: parts[0] is the text before the first pipe (empty for a normal row) and the
    // last part is after the final pipe; interior cell k sits at parts[k + 1].
    const parts = lines[i].split('|');
    if (parts.length - 2 !== headerCellCount) {
      throw new Error(`reconcileTaskRow: row for ${num} has an irregular pipe layout`);
    }
    parts[col.state + 1] = ` ${state} `;
    parts[col.notes + 1] = notesText ? ` ${notesText} ` : ' ';
    lines[i] = parts.join('|');
    return lines.join('\n');
  }

  throw new Error(`reconcileTaskRow: no task row for ${num}`);
}
