# T09 — docs

**Phase:** 3 · **Depends on:** T08 · **Weight:** light

## Goal

Carry the behaviour into `/docs` and the README, as it was seen working in T08, so a new reader learns
that pir alerts their phone through ntfy when a question is theirs or a run is ready, and how to switch it
on.

## Design sections this implements

DESIGN §2 (as built), CLAUDE.md "The README follows every major feature".

## Files

- `docs/human-flow.md`: the "Answering away from the terminal" section; the Notifications bullet
  becomes the ntfy alert (trigger by reason, wording, reminder, clear on Android only, icon, Claude app
  silenced), with Remote Control still the reply path.
- `docs/coordinator-agent.md`: "Passing on", the hold limit and "Ready to merge" each gain one line on the
  alert; the agent's session is started with the Claude app silenced when ntfy is on.
- `docs/run-lifecycle.md`: the per-pass paragraph gains the alert step; the end gains the end alert.
- `docs/control-folder.md`: note kinds `notified`, `notify-failed`.
- `docs/planning-runs.md`: one line that planning sessions do not alert.
- `README.md`: the "Or answer from your phone" bullet and the command list gain `pir notify`, with a
  link to `docs/human-flow.md`.

## Done when

- [ ] Every statement matches the code and T08's FINDINGS rows, including what the iPhone did.
- [ ] `grep -n "notify" README.md docs/*.md` shows `pir notify`, `notified`, `notify-failed`.
- [ ] `npm test` green.
