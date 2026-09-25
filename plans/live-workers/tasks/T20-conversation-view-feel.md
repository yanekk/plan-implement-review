# T20 — conversation-view-feel

**Phase:** 4 · **Depends on:** T19 · **Weight:** medium · **Blocks:** T18

Added 2026-09-25 by the T13 implementer with the user's approval. It replaces T13's "the person's verdict
on the feel" (user 2026-09-25: "You drive, not me"): a worker drives the view and judges it, and the final
paid run (T18) waits for it, so what it finds is fixed before the person sits through that run.

## Goal

Drive the conversation view through T19's rig as the person would, judge it against DESIGN §2.11 and the
approved prototype (`prototype/`, the feel, not a spec), fix what is small, and write down what was seen.

## Files

- `src/shell/conversation-view.mjs`, `src/core/conversation.mjs` and their tests, only where a fix lands
- the captured screens go to the task's scratch folder, not the repo

## Interface

None new: T20 drives T19's `conversation-rig.mjs` and `driveScreen`, and changes no signature.

## Tests

- [ ] every fix comes with a test that fails without it

## What to drive (every item, by the T19 driver, at 80×24 and at 120×40)

- open a live worker from the run view; the conversation reads one line per step and updates live; Tab
  shows full detail and back
- type and Enter: the message shows as `you ▸ …` once delivered
- Esc interrupts a busy worker; Ctrl+C clears a non-empty box, else interrupts
- a permission request: y, n, a each answer it; `a` absent when flagged; a `defaultToNo` request needs y
  twice and shows the arming hint; a typed reply refuses with the text
- a question set: ↑↓ space Enter; Other takes typed text; a typed reply declines the set
- `/` opens the slash menu with `/context` and without `/doctor`
- PgUp/PgDn scroll and new lines do not move a scrolled-up view; a > 256 KB log opens at once
- a finished worker opens read-only; ← returns to the run with the task still selected
- the run not running: nothing is sent and the view says so

## Judge, and what stays the person's

Record for each item: seen working, or what reads badly (clipped hints, colours, layout at 24 rows,
anything slow or confusing). Fix what has one right answer. A change to what the person sees or does that
has two defensible answers is a decision for the person, asked in the session, never chosen silently:
among them, the known quirk that while a permission is pending y/n/a answer at once, so a typed reply
cannot begin with those letters (T13 FINDINGS row).

## Done when

- [ ] every item above driven, with the captured screens saved to the task's scratch folder
- [ ] a dated 📌 (or 🐞) row in FINDINGS saying what the worker saw; it is not a hand-verification (✅)
- [ ] `npm test` green with any fix and its test

## Outside actions

- Install the locked packages — `worker` (`npm ci` in the worktree)
