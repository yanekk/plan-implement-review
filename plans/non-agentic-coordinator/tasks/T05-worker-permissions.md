# T05 — Ship the worker classifier pre-approval + prereq note

**Phase:** 3 · **Runs:** auto · **Depends on:** — · **Weight:** light

## Goal

A worker is still an agentic session, so the machine's auto-mode safety classifier can second-guess
its ordinary commands (its own `git add`/`commit`, `npm test`). Ship a narrow, honest
`permissions.allow` list with the framework so a clean worker command resolves before the classifier
runs, and document the one-time per-user step for the one rule the project settings cannot carry.
Removing the coordinator session already removed the hard part of the classifier problem (an agent
keeping itself awake was refused); this is the small remainder.

## Design sections this implements

DESIGN §7 (the classifier fix folded in) and §5.2 (worker seatbelts). Background:
`PARALLEL-CLASSIFIER-BRIEF.md` §4a and §7.

## Files

- `.claude/settings.json` (project) — add a narrow `permissions.allow` for worker commands.
- `install.sh` — ship/merge that `permissions.allow` into a target project's `.claude/settings.json`
  when the framework is installed.
- A short prereq note in `/docs` (or README) — the one-time `autoMode.allow` step is a per-user
  setting the project cannot ship (an agent writing its own settings is refused as self-modification),
  applied via `/permissions` → Auto mode, and confirmed with `claude auto-mode config`.
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
- [ ] `install.sh` merges (does not clobber) an existing `permissions.allow` in a target — cover with
      a small shell-level or fixture check if install logic is testable; otherwise assert the intended
      merge behaviour is documented and leave the live proof to T08.

## Done when

- [ ] The project ships the narrow worker `permissions.allow` (no `SendMessage`, no `git merge`), and
      `install.sh` carries it into a target project.
- [ ] The one-time per-user `autoMode` step is documented as a prerequisite.
- [ ] `npm test` is green. (That a real worker command clears the classifier live is confirmed in
      T08.)
