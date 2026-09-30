# T06 — finisher-alerts

**Phase:** 2 · **Depends on:** T05 · **Weight:** medium

## Goal

The person's phone hears from the finisher when it is ready for the go, when it is stuck, when it
needs a yes for a reserved action, when it gave up, and when it is finished, through the existing
ntfy machinery, and today's `ready to merge` alert is not sent for runs it takes over.

## Design sections this implements

DESIGN §2.9, §2.12 (gave up).

## Files

- `src/core/notify.mjs`: `finisherAlert({ slug, phase, summary, steps, rulesSource })` → the §2.9 texts;
  finisher episodes in `notifyStep` (keyed `finisher`), reminder for `awaiting-go` and `stuck`, clear on
  leaving them; `done` and gave-up as one-shot alerts without reminder.
- `src/core/notify.test.mjs`
- `src/shell/coordinate.mjs`: feed the finisher's view into the notify step; skip `endAlertPass` when the
  finisher takes over; click link = the finisher's Remote Control URL, 20 s wait as for workers.
- `src/shell/notify-wiring.test.mjs`

## Tests

- [ ] `awaiting-go` → one alert `{slug} · ready for your go`, message starts with the step count and
      the rules source; a reminder at 15 min; cleared on `finishing`.
- [ ] `stuck` → `{slug} · finisher stuck` with the summary cut to 150 characters; reminder; cleared.
- [ ] Reserved request in `finishing` → the existing `Needs your yes: ` wording, title `{slug} · finisher`.
- [ ] `done` → `{slug} · finished`, no reminder; gave up → `{slug} · finisher gave up`.
- [ ] A run the finisher takes over sends no `ready to merge` alert; a red run still sends `not ready`.
- [ ] `pir notify off` → nothing sent (settings read per send, unchanged).

## Done when

- [ ] The tests above pass.
- [ ] `control.log` gets `notify send|reminder|clear finisher …` lines, never the topic.
