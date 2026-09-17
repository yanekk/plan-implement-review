# T03 — Coordinator-name guard

**Phase:** 1 · **Runs:** auto · **Depends on:** — · **Weight:** light

## Goal

Provide a pure check that tells whether a session name is a valid coordinator name for a given
repo and plan, so an off-convention launch (a `/` separator, the wrong shape, the wrong slug) can
be caught at startup rather than becoming a latent addressing trap. The coordinator in the failed
run was launched as `my-ender / print-vision-refactor`; the `/` is the exact character
`SendMessage` rejects. This is the engine half of DESIGN §2.7; the startup gate that calls it is
T05.

## Design sections this implements

DESIGN §2.7. Reuses `coordinatorName` and `parseAgentName` already in `naming.mjs`.

## Files

- `src/core/naming.mjs` — add the validator beside the existing name helpers.
- `src/core/naming.test.mjs` — its cases.

## Interface

```
// validateCoordinatorName(name, { repo, plan }) → { ok: boolean, reason: string|null, expected: string }
//   - ok: true  when `name` parses to a coordinator name (§2.8: {repo} · {plan}, no task/role)
//         whose repo and plan match the given ones.
//   - ok: false with a reason otherwise: contains "/", wrong shape (a worker name, extra
//         segments), or a repo/plan that does not match this run.
//   - expected: always the correct name for this run — coordinatorName({ repo, plan }) — so the
//         caller can tell the user exactly what to relaunch under.
```

`parseAgentName` already returns `matches: false` for a name containing `/` (it splits on `·`, so
a `/` name is one segment). Build the validator on it rather than re-parsing; the value it adds
over `parseAgentName` is the repo/plan match and the `expected` name to show the user. A slash is
worth calling out by name in `reason` because it is the specific, known-rejected character (DESIGN
§2.7).

## Tests

- [ ] `my-ender · print-vision` with matching repo/plan → ok.
- [ ] `my-ender / print-vision-refactor` → not ok; reason names the `/`; `expected` is the `·` form.
- [ ] A worker name (`… · T01 · review`) → not ok (wrong shape for a coordinator).
- [ ] A coordinator name for a different repo or plan → not ok, with a reason.
- [ ] `expected` is always `coordinatorName({ repo, plan })`, whatever the input.
- [ ] A non-string / empty name → not ok, no throw.

## Done when

- `validateCoordinatorName` exists in `naming.mjs`, pure, and its cases pass.
- It reuses the existing helpers rather than duplicating the parse.
- `npm test` is green.
