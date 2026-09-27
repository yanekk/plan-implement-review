# T07 — docs

**Phase:** 3 · **Depends on:** T06 · **Weight:** light

## Goal

Carry the behaviour into `/docs` and the README, as it was seen working in T06, so a new reader learns
that pir alerts their phone through ntfy and how to switch it on.

## Design sections this implements

DESIGN §2 (as built), CLAUDE.md "The README follows every major feature".

## Files

- `docs/human-flow.md`: the "Answering away from the terminal" section; the Notifications bullet
  becomes the ntfy alert (trigger, wording, reminder, clear on Android only, Claude app silenced), with
  Remote Control still the reply path.
- `docs/run-lifecycle.md`: the per-pass paragraph gains the alert step.
- `docs/control-folder.md`: note kinds `notified`, `notify-failed`.
- `docs/planning-runs.md`: one line that planning sessions do not alert.
- `README.md`: the "Or answer from your phone" bullet and the command list gain `pir notify`, with a
  link to `docs/human-flow.md`.

## Done when

- [ ] Every statement matches the code and T06's FINDINGS rows, including what the iPhone did.
- [ ] `grep -n "notify" README.md docs/*.md` shows `pir notify`, `notified`, `notify-failed`.
- [ ] `npm test` green.
