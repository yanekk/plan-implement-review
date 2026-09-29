# T01 — group-steps-core

**Phase:** 1 · **Depends on:** — · **Weight:** medium

## Goal

Make `buildConversation` fold each run of consecutive tool steps into one group line that counts them per
kind, keep running steps on their own lines, draw an open group's steps under its line, and tag every group
line so the view can click it. All of it is pure and tested here (the one shell change is logging a
request's `toolUseId`, so a refused step can be told from a failed one), so T02 only wires a surface to rules
already proven.

## Design sections this implements

DESIGN §2.1 (what forms a group, the id), §2.2 (the label, kinds, failed and refused suffixes, marker, clipping), §2.3
(running steps), §2.4 (how an open group is drawn), §2.6 (full mode unchanged), §3.2 (interface).

## Files

- `src/core/conversation.mjs`
- `src/core/conversation.test.mjs`
- `src/shell/worker-proc.mjs`, `src/shell/worker-proc.test.mjs`: `canUseTool` logs `toolUseId: opts.toolUseID` on
  the `request` entry (DESIGN §2.2); `src/core/stream.mjs` carries it onto the `permission` and `questions`
  events, tested in `src/core/stream.test.mjs`.
- `src/shell/conversation-view.test.mjs`, `src/shell/conversation-rig.test.mjs`: only the existing
  assertions on a default-mode `⎿` step line that this change breaks, rewritten per DESIGN §4. No new view
  behaviour here.

## Interface

```js
// open: Set of group ids (the toolUseId of a group's first step). Default: empty, every group folded.
buildConversation(entries, { full, width, taskId, readOnly, open }) → { lines, pinned, background }
// A group line is a span array with a property: line.hit = { kind: 'group', id }.
// No other line has a hit; in full mode none does.

// Exported for tests and for T02/T03 wording checks.
stepKind(toolName) → { key, verb, one, many }   // DESIGN §2.2 table; unknown → verb `used ${name}`, 'time'/'times'
groupLabel(finishedSteps) → { text, failed, refused }  // finishedSteps: [{ name, isError, refused }] in log order
                                                // text: "Ran 2 shell commands, read 1 file"; failed, refused: counts
                                                // a refused step counts in `refused`, never in `failed`
```

Group line spans: `[span('  ▸ ' | '  ▾ ' + text, 'step'), span(' · N failed', 'step-error')?, span(' · N refused', 'dim')?]`,
clipped to width with the label cut first so the suffixes survive. Open group: finished steps as `stepLines`
one-liners with the head indented to `    ⎿ `. Running steps: today's `  ⎿ ` line, after the group line
(and after the open steps).

## Tests

- [ ] Four consecutive finished steps (Read, Grep, Bash, Edit) → one line `  ▸ Read 1 file, searched 1 time, ran 1 shell command, edited 1 file`; capitalisation only on the first word.
- [ ] One finished Bash → `  ▸ Ran 1 shell command`; two → `Ran 2 shell commands`.
- [ ] Every row of the §2.2 table, singular and plural; Edit + MultiEdit share `edited 2 files`; an unknown tool `mcp__x__y` → `used mcp__x__y 1 time`.
- [ ] Kinds listed in order of first appearance (Bash, Read, Bash → `Ran 2 shell commands, read 1 file`).
- [ ] A failed step → ` · 1 failed` span in `step-error`; at width 30 the label is clipped with `…` and ` · 1 failed` is whole.
- [ ] A refused permission (reply `deny`, with and without a typed message) and a question set answered in text instead → ` · 1 refused` span in `dim`, not counted as failed; with a real failure too → ` · 1 failed · 1 refused`; the request tied by `toolUseId`, and by `requestId` equal to the step's `toolUseId` when the entry has none; a request tied to no step leaves its `isError` step reading failed. Open, the refused step's one-liner is `step-error` as today.
- [ ] `worker-proc.mjs`'s `canUseTool` logs `toolUseId` from `opts.toolUseID`; `stream.mjs` reads it onto the event (absent → no field).
- [ ] Each §2.1 breaker between two steps (worker text, person `sent`, pir `sent`, a drawn permission, a drawn question set, interrupt, failed result, note, background `↳` start and end, raw line) → two groups.
- [ ] Non-drawing events between steps (tool results, init, synthetic text, empty text, success result, non-background system event, the pinned request) → one group.
- [ ] A step with no result → no group line if alone, its own `  ⎿` line; with a finished step before it → group line `Ran 1 …` then the running line; after its result arrives in a later build → `Ran 2 …`, no running line.
- [ ] Running step before a finished one in the same group (parallel tool uses) → group line counts the finished one, running line after it.
- [ ] `open` holding the group's id → `  ▾ ` line followed by one indented `    ⎿` line per finished step (last result line dim, failed in `step-error`), running lines after.
- [ ] `hit` is on group lines only, `{ kind: 'group', id: <first toolUseId> }`; the id is unchanged after more steps are appended to the same group and after a later group starts.
- [ ] `full: true` → output identical to today's full mode for the same log (no group lines, no hits).
- [ ] Read-only view with a step that never got a result → it stays its own line.
- [ ] Existing default-mode tests rewritten per DESIGN §4; none deleted.

## Done when

- [ ] Every test above is in `conversation.test.mjs` and `npm test` is green.
- [ ] `buildConversation` without `open` draws every group folded; with `full` it is byte-identical to before.
- [ ] `boundary.test.mjs` still passes (no new import in core).
