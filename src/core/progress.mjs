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

// Where a plan keeps its PROGRESS.md, relative to a repo/worktree root: `plans/{slug}/PROGRESS.md`
// (CLAUDE.md §The files, DESIGN §3.5). Every reader and writer of the coordinator's PROGRESS.md —
// the loop, the real and fake worktrees, the fake worker's commit, the scratch harness — derives the
// path from here, so the location lives in exactly one place. It returns a forward-slash path, which
// is both a valid fs path and the form `git add` wants. Pure string work: no I/O, so it belongs in
// core. Fixed 2026-09-09: the first live run found the loop and fakes hardcoding a root PROGRESS.md,
// which the fake hid because it wrote there too (FINDINGS).
export function progressPathFor(slug) {
  return `plans/${slug}/PROGRESS.md`;
}

// The five state glyphs a task row may carry (PROGRESS.md legend). A row whose state cell
// is none of these is surfaced as a parse error rather than dropped: a row the parser
// cannot read is a task silently never built, which is the exact failure this guards.
const KNOWN_STATES = new Set(['⬜', '🟡', '🔍', '✅', '⛔']);

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
// position, which is what lets a table with or without a `Runs` column parse: the column is
// no longer read (DESIGN §2.5), so a `Runs` header maps to null and its cell is ignored
// rather than erroring — older plans and this plan's own PROGRESS.md still carry it.
function headerField(cellText) {
  switch (cellText.trim().toLowerCase()) {
    case '#':
      return 'num';
    case 'task':
      return 'name';
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

// Depends-on cell → { deps, blocks }. `—` or empty yields no deps; otherwise every T-number
// token in the cell, so both `T01` and `T01, T02` parse (DESIGN §3.2 interface). A trailing
// `; blocks T10` clause names existing tasks that must wait for this one: it is how a worker-added
// task gates a task already in the table without editing that task's row, which add-only forbids
// (docs/task-state.md). Found live on real-screen-time's remote-grant run, where a mid-run task
// the deploy check needed could only be noted in FINDINGS and the deploy was dispatched without it.
function parseDeps(cell) {
  const [own, blocked = ''] = cell.split(/\bblocks\b/i);
  return { deps: own.match(/T\d+/g) || [], blocks: blocked.match(/T\d+/g) || [] };
}

// The Depends-on cell text for a row, the inverse of parseDeps: `—` for no deps, matching the
// table's own convention so parseDeps reads [] back off it.
function depsCell(deps, blocks) {
  const own = deps.length ? deps.join(', ') : '—';
  return blocks.length ? `${own}; blocks ${blocks.join(', ')}` : own;
}

// Fold every `blocks` clause into its target's deps, so each task's `deps` is the full set it
// waits on and every consumer (dispatch, display, parallelism) honours the edge with no change of
// its own. `ownDeps` keeps what the row itself declares: that, not the folded set, is what
// add-only compares, because a task branch forked before a blocker landed still carries the
// target's row as it was and must not read as an edit. A blocks target that is not in the table
// is an error, not ignored: an edge that gates nothing is a task dispatched too early.
function foldBlocks(tasks, errors) {
  const byNum = new Map(tasks.map((t) => [t.num, t]));
  for (const t of tasks) {
    for (const b of t.blocks) {
      const target = byNum.get(b);
      if (!target || b === t.num) {
        errors.push(`task ${t.num}: blocks ${b}, which is not another task in this table`);
        continue;
      }
      if (!target.deps.includes(t.num)) target.deps.push(t.num);
    }
  }
}

// Whether task `start` can reach itself through deps — a cycle through it, which would leave every
// task on the cycle waiting for ever. Only the cycles through a given task are looked for, so a
// merge is blamed for a cycle its own new rows close, never for one already on the feature branch.
function cyclesThrough(tasks, start) {
  const byNum = new Map(tasks.map((t) => [t.num, t]));
  const seen = new Set();
  const stack = [...(byNum.get(start)?.deps ?? [])];
  while (stack.length) {
    const n = stack.pop();
    if (n === start) return true;
    if (seen.has(n)) continue;
    seen.add(n);
    stack.push(...(byNum.get(n)?.deps ?? []));
  }
  return false;
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
// tasks is well-formed: every entry has a known state. Each carries `deps` (everything it waits
// on, including edges other rows' `blocks` clauses add), `ownDeps` and `blocks` (what its own
// Depends-on cell says). A row the parser cannot read cleanly
// is described in errors, naming the task or the offending line, rather than being dropped or
// silently mis-read. A `Runs` column present in the table is ignored, not an error (DESIGN §2.5).
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

    const { deps, blocks } = col.deps !== undefined ? parseDeps(cells[col.deps]) : { deps: [], blocks: [] };
    const name = cells[col.name];

    tasks.push({ num, name, deps: [...deps], ownDeps: deps, blocks, state });
  }

  foldBlocks(tasks, errors);
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

// Two dependency lists name the same tasks, regardless of order. Compared as sorted sets so
// a worker reordering `T01, T02` into `T02, T01` is not misread as an edit — the meaning is
// what add-only protects, not the spelling (DESIGN §2.2).
function sameDeps(a, b) {
  const norm = (d) => [...new Set(d)].sort();
  const x = norm(a);
  const y = norm(b);
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

// Build one markdown table row for the feature table's layout. `values` maps a column index
// to its cell text; any index not in it (a column the parser does not consume, e.g. a legacy
// `Runs` column) renders as an empty cell. An empty value renders as ` ` (a single space
// between pipes), the same canonical empty cell reconcileTaskRow writes, so a re-parse and a
// later fold both find a well-formed row.
function buildRow(headerCellCount, values) {
  const inner = [];
  for (let j = 0; j < headerCellCount; j++) {
    const v = values[j] ?? '';
    inner.push(v === '' ? ' ' : ` ${v} `);
  }
  return `|${inner.join('|')}|`;
}

// adoptNewTaskRows(featureText, branchText) → { text, added, errors }.
// The add-only merge rule (DESIGN §2.2, §3.3). Given the authoritative feature-branch
// PROGRESS.md and a merging task branch's PROGRESS.md, decide which of the branch's task rows
// are genuinely new, append them to the feature table as ⬜, and reject anything that would
// edit an existing task or that could never be dispatched. Pure text: no I/O, no clock. The
// filesystem read of the branch copy and the write-back live in src/shell/ (DESIGN §3.1).
//
//   text    featureText with each new task row appended to the table, state forced to ⬜.
//           Byte-identical to featureText when nothing is adopted, and — because adoption is
//           atomic per branch — when errors is non-empty (a bad change lands nothing).
//   added   adopted task numbers in the branch table's order, e.g. ['T03']. Empty on any error.
//   errors  one human-readable message per rejected row; empty on success. Never
//           empty-and-silent: a dropped row always names why (DESIGN §2.5).
//   blockEdges  { task, target, state } per adopted `blocks` edge, state being the target's glyph
//           on the feature branch. Absent when nothing was adopted.
export function adoptNewTaskRows(featureText, branchText) {
  const feature = parseProgress(featureText);
  const branch = parseProgress(branchText);

  // A parse error on the branch means a row the coordinator cannot read — a task that would be
  // silently never built. Surface it and adopt nothing (DESIGN §2.5: never silently dropped).
  // Feature parse errors are not this branch's fault and are left alone.
  const errors = [...branch.errors];

  const featureByNum = new Map(feature.tasks.map((t) => [t.num, t]));

  // New = a branch row whose id is absent from the feature branch. Compute the full set first,
  // so a new task may depend on another new task landing in the same change (DESIGN §2.2).
  const newTasks = branch.tasks.filter((t) => !featureByNum.has(t.num));
  const knownIds = new Set([...featureByNum.keys(), ...newTasks.map((t) => t.num)]);

  const adopted = [];
  for (const t of branch.tasks) {
    const existing = featureByNum.get(t.num);
    if (existing) {
      // Id present on the feature branch. Compare slug and deps, NEVER state: the merging
      // task's own row differs from the feature's only by its glyph (⬜ → ✅), and comparing
      // state would misread every merge as an edit (DESIGN §2.2). A slug/deps difference is a
      // forbidden edit of an existing task, or a duplicate number colliding with one.
      // Compared on the row's own cell (ownDeps, blocks), never the folded deps: a branch forked
      // before a blocker landed on the feature is not editing the blocked task.
      if (existing.name !== t.name || !sameDeps(existing.ownDeps, t.ownDeps) || !sameDeps(existing.blocks, t.blocks)) {
        errors.push(
          `${t.num}: branch would change an existing task ("${existing.name}" deps [${depsCell(existing.ownDeps, existing.blocks)}]` +
            ` → "${t.name}" deps [${depsCell(t.ownDeps, t.blocks)}]); tasks are add-only, an existing task cannot be edited` +
            ` or its number reused (DESIGN §2.2)`,
        );
      }
      // Otherwise a pre-existing row (or the merging task's own): ignore, the feature's stands.
      continue;
    }

    // A genuinely new task. Every dependency must name a task that exists — on the feature
    // branch or among this change's other new rows — or the task could never be dispatched
    // (its dependency would never go ✅), so the whole change is rejected (DESIGN §2.5).
    for (const d of t.ownDeps) {
      if (!knownIds.has(d)) {
        errors.push(
          `${t.num}: new task depends on ${d}, which is not a task on the feature branch or a new task` +
            ` in this change; it could never be dispatched (DESIGN §2.5)`,
        );
      }
    }
    // A blocks target must exist too, or the edge gates nothing and the task it was meant to hold
    // back is dispatched without the new work (docs/task-state.md).
    for (const b of t.blocks) {
      if (!knownIds.has(b) || b === t.num) {
        errors.push(`${t.num}: new task blocks ${b}, which is not another task on the feature branch or in this change`);
      }
    }
    adopted.push(t);
  }

  // A new task that blocks one of its own prerequisites closes a cycle: every task on it would wait
  // for ever. Checked over the graph as it would stand after adoption, so the edge is judged in full.
  if (errors.length === 0) {
    const after = parseProgress(
      `| # | Task | Depends on | State |\n|---|---|---|---|\n` +
        [...feature.tasks, ...adopted].map((t) => `| ${t.num} | ${t.name} | ${depsCell(t.ownDeps, t.blocks)} | ${t.state} |`).join('\n'),
    );
    for (const t of adopted) {
      if (cyclesThrough(after.tasks, t.num)) {
        errors.push(`${t.num}: its dependencies and blocks form a cycle; every task on it would wait for ever`);
      }
    }
  }

  // Atomic per branch: if any row is an error, nothing from this branch lands, so a bad change
  // never half-applies and the person sees the whole problem at once (DESIGN §2.5, §3.3).
  if (errors.length > 0) {
    return { text: featureText, added: [], errors };
  }

  if (adopted.length === 0) {
    return { text: featureText, added: [], errors: [] };
  }

  const lines = featureText.split('\n');
  const table = locateTable(lines);
  if (!table) {
    // No table to append to. Cannot adopt without corrupting the file, so reject atomically.
    return {
      text: featureText,
      added: [],
      errors: [`cannot adopt ${adopted.map((t) => t.num).join(', ')}: the feature PROGRESS.md has no task table`],
    };
  }

  const { col, headerCellCount, dataEnd } = table;
  const newRows = adopted.map((t) => {
    const values = {};
    values[col.num] = t.num;
    if (col.name !== undefined) values[col.name] = t.name;
    // Reconstruct the Depends-on cell from the row's own deps and blocks clause.
    if (col.deps !== undefined) values[col.deps] = depsCell(t.ownDeps, t.blocks);
    // Force ⬜: the coordinator owns task state. A branch row marked 🔍/✅ must still be adopted
    // as not-started or the new task would skip its build (DESIGN §2.2).
    if (col.state !== undefined) values[col.state] = '⬜';
    // Notes left empty; the task doc and PLAN.md row carry the detail. Any other column (a
    // legacy Runs) renders empty via buildRow — parseProgress ignores it anyway.
    return buildRow(headerCellCount, values);
  });

  // Insert the new rows just after the last existing data row, before whatever ends the table
  // (a blank line or prose). Every other line, including the coordinator-managed single-line
  // fields, stays byte-for-byte identical (DESIGN §2.5).
  lines.splice(dataEnd, 0, ...newRows);

  // Every adopted blocks edge, with the target's glyph on the feature branch, so the shell can tell
  // the person when an edge landed on a task already started: the coordinator cannot stop a running
  // worker (no down-channel) and a finished task is not rebuilt. Only the shell knows which ⬜ rows a
  // live worker already holds, so the judgement is made there (loop.mjs recordAdoption).
  const featureState = new Map(feature.tasks.map((t) => [t.num, t.state]));
  const blockEdges = adopted.flatMap((t) => t.blocks.map((b) => ({ task: t.num, target: b, state: featureState.get(b) ?? '⬜' })));

  return { text: lines.join('\n'), added: adopted.map((t) => t.num), errors: [], blockEdges };
}
