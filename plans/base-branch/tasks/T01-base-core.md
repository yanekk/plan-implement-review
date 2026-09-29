# T01 — base-core

**Phase:** 1 · **Depends on:** — · **Weight:** medium

## Goal

The pure rules of the base branch: parse and merge the two settings files, validate a branch name, decide
from gathered git facts which commit is the base and what to do with the local branch, and word every
refusal and hold. Everything after this task calls these functions, so the whole §2.1–§2.3 behaviour is
proven here in milliseconds.

## Design sections this implements

DESIGN §2.1, §2.2, §2.3 (the table), §2.5 (run record field), §2.9 (refusal texts), §3.3.

## Files

- `src/core/basebranch.mjs` (new), `src/core/basebranch.test.mjs` (new)
- `src/core/runrecord.mjs`, `src/core/runrecord.test.mjs`

## Interface

```js
// text: file contents or null (file absent). source: the path, used in errors.
parseSettings(text, source) → { ok: true, settings: { baseBranch?: string } } | { ok: false, reason: 'bad-settings', file: source, why: string }

// repo/user: parseSettings results. User overrides repo key by key; either one !ok → that error (repo checked first).
effectiveBase({ repo, user, repoFile, userFile }) →
  { ok: true, base, file } | { ok: false, reason: 'no-base-setting' } | { ok: false, reason: 'bad-settings', file, why }

validBranchName(name) → boolean   // §2.2 rules, including the pir/ prefix refusal

// facts, gathered by T02:
//   remote: string|null, reached: bool, remoteHas: bool, fetchError: string|null,
//   local: sha|null, tracking: sha|null,
//   localInTracking: bool (local is ancestor of tracking), trackingInLocal: bool,
//   checkout: null | { path, clean: bool }, aheadBehind: { local: n, remote: n } | null
decideBase(facts) →
  { ok: true, use: sha, local: 'keep'|'create'|'ff' }
  | { ok: false, reason: 'no-base-branch'|'fetch-failed'|'diverged', ... }
// 'ff' only when local is behind AND (checkout null OR checkout.clean); otherwise 'keep' with use = tracking.

refusalText(result, { repo, base, file, remote }) → string   // §2.9, one per reason
holdText(result, { base, remote }) → string                   // §2.8 preparing reasons, short
```

`runrecord.mjs`: optional `baseBranch` (non-empty string) serialized and parsed; absent stays absent.

## Tests

- [ ] parseSettings: null text → ok, empty settings; `{}` ok; `{"baseBranch":"dev","x":1}` keeps dev, ignores x
- [ ] parseSettings rejects: non-JSON, JSON array, JSON string, baseBranch number, empty string, invalid name
- [ ] effectiveBase: user overrides repo; repo only; user only; neither → no-base-setting; bad repo file with good user file → bad-settings
- [ ] validBranchName: each §2.2 rule has a rejecting case; `dev`, `release/2026-09`, `main` accepted; `pir/x` rejected
- [ ] decideBase: every row of the DESIGN §2.3 table, plus no remote with/without local, remote unreachable, ff blocked by dirty checkout still uses tracking
- [ ] refusalText: each reason names the file/branch/remote as §2.9 says; no-remote variant of no-base-branch
- [ ] runrecord round-trips baseBranch; a record without it parses unchanged

## Done when

- [ ] `basebranch.mjs` exports the interface above and the boundary test passes
- [ ] every §2.3 table row and §2.2 rule has a test
- [ ] `npm test` green
