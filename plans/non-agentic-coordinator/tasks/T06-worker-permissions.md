# T06 — worker-permissions

**Phase:** 3 · **Runs:** auto · **Depends on:** — · **Weight:** light

## Goal

A worker is still an agentic session, so the machine's auto-mode safety classifier can second-guess
its ordinary commands (its own `git add`/`commit`, `npm test`). Ship a narrow, honest
`permissions.allow` list with the framework so a clean, bare worker command resolves before the
classifier runs. Removing the coordinator session already removed the hard part of the classifier
problem (an agent keeping itself awake, refused as self-modification); this is the small remainder.

**`install.sh` also applies the per-user `autoMode.allow` rule** (PM decision, 2026-09-19), so parallel
mode needs no separate manual setup step for most users. Two honest constraints on that:

- The rule lives in the *user-global* `~/.claude/settings.json` (the classifier ignores `autoMode` in a
  project file, by design), so the installer merges it there, preserving `"$defaults"` and not
  clobbering existing rules. It is pir-specific (it names pir's own branch patterns), so a global entry
  is scoped, not broad.
- The write clears when a **person** runs `install.sh` in their own terminal. A Claude session running
  the installer can be blocked from writing auto-mode config (self-modification), so the installer must
  also **print the exact manual step** as a fallback, and never silently skip it. Whether the shipped
  `permissions.allow` alone already clears a worker's own commands — making the `autoMode` rule
  belt-and-suspenders — is confirmed live in T09.

## Design sections this implements

DESIGN §7 (the classifier fix folded in) and §5.2 (worker seatbelts). Background:
`PARALLEL-CLASSIFIER-BRIEF.md` §4a and §7.

## Files

- `.claude/settings.json` (project) — add a narrow `permissions.allow` for worker commands.
- `install.sh` — (a) ship/merge that `permissions.allow` into a target project's
  `.claude/settings.json` (merge, do not clobber an existing list); (b) merge the pir `autoMode.allow`
  rule into the user-global `~/.claude/settings.json` (preserve `"$defaults"`, do not clobber,
  idempotent), and print the exact manual step as a fallback when the write cannot be made. Confirm with
  `claude auto-mode config` in the printed guidance.
- A short note in `/docs` (or README) — parallel mode's one-time setup is `install.sh`; the `autoMode`
  rule is applied by the installer when a person runs it, with the manual `/permissions` → Auto mode
  step as the fallback.
- A light test guarding the settings shape (see Tests).

## Interface

```
// .claude/settings.json — narrow, bare-command rules (prefix-matched, resolve before the classifier).
// No SendMessage (the down-channel is gone) and no `git merge` (the program does merges via
// child-process git, which is not classifier-gated; a worker never merges a peer branch).
"permissions": { "allow": [
  "Bash(npm test:*)", "Bash(node --test:*)",
  "Bash(git status:*)", "Bash(git log:*)", "Bash(git show:*)", "Bash(git diff:*)",
  "Bash(git branch:*)", "Bash(git rev-parse:*)", "Bash(git merge-base:*)",
  "Bash(git add:*)", "Bash(git commit:*)"
] }
```

## Tests

- [ ] A test reads the project `.claude/settings.json`, asserts it is valid JSON and that
      `permissions.allow` contains the worker command rules above and does not contain `SendMessage`
      or `Bash(git merge:*)`.
- [ ] `install.sh` merges (does not clobber) an existing `permissions.allow` in a target, and merges
      the `autoMode.allow` rule into `~/.claude/settings.json` idempotently while preserving `"$defaults"`
      — cover with a shell-level or fixture check if install logic is testable; otherwise assert the
      intended merge behaviour and the printed manual fallback are present, and leave the live proof to
      T09.

## Done when

- [ ] The project ships the narrow worker `permissions.allow` (no `SendMessage`, no `git merge`), and
      `install.sh` carries it into a target project by merging.
- [ ] `install.sh` merges the per-user `autoMode.allow` rule into `~/.claude/settings.json` when a
      person runs it, and prints the exact manual step as a fallback when it cannot write it.
- [ ] `npm test` is green. (That a real worker command clears the classifier live — and whether the
      `autoMode` rule is even needed on top of `permissions.allow` — is confirmed in T09.)
