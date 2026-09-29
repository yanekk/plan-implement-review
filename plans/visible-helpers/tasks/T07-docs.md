# T07 — docs

**Phase:** 3 · **Depends on:** T06 · **Weight:** light

## Goal

Carry the behaviour into the canonical docs and the README, describing what the drill saw, and make it
live with `./install.sh`.

## Design sections this implements

DESIGN §2.2–§2.7, §8; `CLAUDE.md § The README follows every major feature`.

## Files

- `docs/human-flow.md`: in the conversation and permission sections, the helper line, the Tab labels,
  a helper's permission request, the Esc warning and the note; in `When a row reads asking you`, one
  sentence that a running helper counts as work in progress (background or foreground). State the
  limits from DESIGN §8 (no warning or note for Remote Control input; no helper on the list row; a
  phone alert and the coordinator agent name the agent, not the helper).
- `docs/detached-runs.md` § The conversation view: the helper line and its Tab labels beside the
  background-work lines, the status line's `N helpers running`, and the Esc warning in the key-bindings
  table's Conversation row. It is where the conversation view is described today.
- `README.md`: a sentence under the conversation view on helpers being shown and the Esc warning, with a
  link to `docs/human-flow.md`.

## Tests

- [ ] `npm test` still passes (docs-reading tests such as `planning-skills.test.mjs` included).

## Done when

- [ ] `docs/human-flow.md`, `docs/detached-runs.md` and `README.md` say what DESIGN §2.2–§2.6 now do, and nothing the code does not.
- [ ] `./install.sh` run after the change, and the installed `~/.claude/pir-engine/src/core/helpers.mjs`
      exists (§5.3 `worker` bin; not while a run is live).
