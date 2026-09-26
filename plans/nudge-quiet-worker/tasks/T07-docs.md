# T07 — docs

**Phase:** 2 · **Depends on:** T04, T05, T06 · **Weight:** light

## Goal

Make `/docs`, the canonical account of how parallel mode behaves, and `README.md`, how a new reader
learns what the method does, describe the nudge as built. `/docs` says the command sends a worker "two
things only"; that is now three. A reader debugging a stuck run needs to know what the coordinator
does about quiet workers, what the new log lines and labels mean, and that answering a parked worker
now returns its row to work.

## Design sections this implements

DESIGN §2.1–§2.7, as built. Where the build diverged from DESIGN, document the build and log the
divergence in FINDINGS.

## Files

- `docs/control-folder.md`: "The line down": from the command itself, three things (opening
  instruction, merge-conflict fix, the fixed nudge). Add `nudge`, `nudge-failed`, `stuck`, `unstuck`,
  `unpark` to the log-kinds list. Mention `PARALLEL_NUDGE_MS` beside `AWAIT_IDLE_TIMEOUT_MS`.
- `docs/run-lifecycle.md`: the observe/unpark/nudge step in "Each pass"; the `nudged N×` / `stuck`
  suffixes in "The live status display".
- `docs/human-flow.md`: say the nudge never involves the person and shows in the worker's conversation
  as a message from pir; say a worker parked on a question returns to `building`/`reviewing` when the
  person's message or question-set answer reaches it (in "Questions and decisions"). Update "Known
  limitation" to say what the nudge now covers (a worker held before its report) and what it still does
  not (a detached daemon outliving a closed worker; a leftover process that keeps writing a non-ignored
  file into the worktree, DESIGN §2.7).
- `docs/task-state.md` if it describes when a task leaves `awaiting-answer`.
- `README.md`: a sentence or two where the README describes watching a run (`## Watching a run`) or
  what a run looks like: a worker that goes quiet for about 15 minutes gets an automatic nudge, at most
  twice, then its row says `stuck`; nothing is killed and the person is not asked. Link to the docs page.
  Pitched at a user, not restating the spec (CLAUDE.md "The README follows every major feature").

Do not edit any finished plan's DESIGN.md.

## Tests

- [ ] `npm test` stays green (some tests read docs; update them if wording they pin has changed
      deliberately).
- [ ] `grep -rn "two things only\|that one message from \`pir\`\|The one message \`pir\` itself" docs skills`
      finds nothing.

## Done when

- [ ] The three docs describe the nudge, its eligibility, its labels, its log lines and the unpark as
      built.
- [ ] `README.md` has the user-facing sentence and a link.
- [ ] The grep above is empty.
- [ ] Every setting name, log kind and label in the docs matches the code exactly.
