---
name: pir-e2e
description: Reference for proving a surface (web page, terminal UI, desktop or mobile screen) end to end in a PIR project — find and reuse the project's existing end-to-end tooling, otherwise drive a real browser with Playwright or a real pseudo-terminal through a rig, and run a worker drill that judges the screen against DESIGN and the prototype. Loaded by pir-plan, pir-review-plan, pir-implement, pir-review and pir-worker whenever a task has a surface; not a command a person types.
---

# pir-e2e — surfaces are proven by a worker, never by "does it feel right"

A worker drives every surface it builds. It launches the real program, sends real input through the
real input path (a browser, a pseudo-terminal, a window), captures what is drawn and checks it. **"A
screen has to be looked at" is not a person-only check**: the person is never asked whether a screen
reads or feels right. What stays with the person is in *What the person still owns* below.

There are two layers, and a surface gets both:

- **End-to-end tests** — scripted, asserted, and part of the project's test command, so they run on
  every change for the life of the project. They are the default and they carry the weight: most of
  what a person would have "noticed" (a dead key, text clipped at 80 columns, a view that jumps, a
  button off the bottom of a phone screen) is an assertion once someone writes it down.
- **A drill** — a worker uses the running thing the way a person would, across the whole flow, at the
  sizes the design names, saves every screen, and judges it against `DESIGN.md` and the approved
  `prototype/` (the feel, not a spec). It catches what nobody thought to assert. Every defect a drill
  finds that a machine can decide becomes an end-to-end test; the rest becomes a decision for the
  person or a finding.

Both run against a **free backend**: a fake server, fixtures, a scripted pretend worker, a local
database seeded per run. A drill that needs a paid service or a real run is a drill nobody runs; plan
the fake instead.

## 1. Find what is already there — before planning or building any of it

A project with end-to-end tooling gets its tests added to that tooling. A second runner, a second
browser driver or a second fake backend is the rebuild `pir-plan § Stage 4` exists to stop, and it
leaves two suites nobody knows which to extend. Look, by behaviour and not by name:

- **Dependencies and scripts**: `@playwright/test`, `playwright`, `cypress`, `puppeteer`,
  `webdriverio`, `selenium`, `pytest-playwright`, `testcafe`, `detox`, `appium`, `node-pty`,
  `@xterm/headless`, `pexpect`, `expect`, `vhs`, `teatest`; `e2e`, `test:e2e`, `integration`,
  `smoke` scripts in `package.json`, a `Makefile`, `justfile`, `tox.ini`, `pyproject.toml`.
- **Config and folders**: `playwright.config.*`, `cypress.config.*`, `wdio.conf.*`, `e2e/`,
  `tests/e2e/`, `integration/`, `__screenshots__/`, `*.snap` of rendered screens, UI test targets
  (`*UITests`, `androidTest/`).
- **Rigs and fakes**: a fake or mock server (`msw`, `nock`, `wiremock`, a `fake/` folder, a stub
  binary), seed or fixture scripts, a helper that spawns the program under a pseudo-terminal, a
  screen model that parses its output. In this repository: `src/shell/conversation-rig.mjs`
  (`driveScreen`, a pretend run behind the real `pir` screen) and `src/shell/fake/`.
- **CI**: a workflow job that runs a browser or a device; it names the real command and its setup.

Place what you find exactly as `pir-plan § Stage 4` does: it covers the job (plan tests in it, no rig
task), it covers most of it (plan the extension: a new fixture, a new scenario, a new viewport), or
it cannot carry this (say concretely why, and the close call goes to the person). New tests follow
the existing suite's folder, naming, fixtures, locator style and runner. Record what was found in
`DESIGN.md § Environment`, including the command and whether it is in the test block.

**The test block.** An end-to-end suite that is free, bounded and quiet goes in the `test` lines of
the `DESIGN.md` block like any other suite, so every review and every parallel run's end gate runs
it. One that is slow or flaky today is still run by the worker on its task and recorded; say in
§ Environment why it is not in the block and what it would take.

## 2. When nothing is there: the default tools

Adding any of these is a dependency decision (`DESIGN.md` dependency policy) and, where it downloads
a browser or a binary, a §5.3 install row. Plan it as a **rig task** that comes before the first task
with a surface, so feature tasks write tests instead of infrastructure.

**Web: Playwright.** `@playwright/test`, Chromium only unless the design names more browsers
(`npx playwright install chromium`). Headless, a fixed viewport per size the design names (at least
the smallest it supports and a common desktop one), `reducedMotion: 'reduce'`, the app started by
the config's `webServer` against the fake backend, the network outside it blocked (`page.route`) so
a test cannot reach a real service. Locate by role and text, the way a person finds things, not by
CSS class. Screenshot each state to the scratch folder during a drill; on failure keep the trace. A
quiet reporter (`--reporter=dot`) and no colour, as the test command requires.

**Terminal UI: a pseudo-terminal rig.** The real program under a real pseudo-terminal of a fixed
size (at least 80×24 and one larger), fed real key bytes (`\x1b[A` for ↑, `\x1b[5~` for PgUp,
`\x03` for Ctrl+C), its output fed to a screen model that yields the text of each row. Prefer what
the repo has; otherwise `node-pty` or `@xterm/headless` if the dependency policy allows, else
python3's `pty` module or `/usr/bin/script` with a minimal screen model. The rig starts the program
against a pretend backend, returns the screen after each key, and tears every child down on exit.
Keys must go through the program's real input path: a test that calls the key reducer directly
proves the reducer, not that the key reaches it (live-workers T13 passed such tests while PgUp/PgDn
never reached the view).

**Desktop or mobile.** The platform's UI test driver against a simulator or emulator (XCUITest,
Espresso, Detox, a screenshot of a window by id). Same rules: free backend, fixed sizes, real
input, screens saved. A physical device, a real camera or a store build is the person's (below).

**Every surface, whatever the tool, asserts at least:** each size renders without clipped or
overflowing text (every line within the width, every control on screen); every interaction in the
task's list does what `DESIGN.md` says through the real input path; the states the design names
(empty, loading, error, long content) render; nothing reaches a real service.

## 3. The drill

A drill is one task at the end of a plan that builds a surface (named `drill`, depending on every
surface task and preceding anything the person will sit through, such as a paid live run), and a
short pass in `pir-review` on any task that changes a surface. It has a list of interactions, the
sizes, and what to judge against. The worker:

1. Brings up the rig or the app on the free backend (its Environment section), with a time limit.
2. Drives every listed interaction at every size, and the unlisted ones a person would try (Tab,
   Esc, resize, back, a very long input, a very large dataset), saving each screen to the task's
   scratch folder, never the repo.
3. Judges each against `DESIGN.md` and the prototype: clipped or wrapped text, hints that do not
   fit, layout at the smallest size, wording, anything slow, focus lost, a key that does nothing,
   a state that is confusing.
4. Fixes what has one right answer, each fix with an end-to-end test that fails without it.
   Anything with two defensible answers (wording the design did not fix, a key that could mean two
   things) is a decision for the person, asked in the session like any other.
5. Tears down and confirms it is down, then writes a dated 🐞 or 📌 row in `FINDINGS.md` saying what
   was driven and what was seen, marked worker-driven. It is not a hand-verification (✅).

## What the person still owns

- **The direction**, before anything is designed: the throwaway mock in `pir-plan § Stage 2`. That is
  the person deciding what gets built, not a check on something built.
- **Decisions a drill surfaces** that have two defensible answers.
- **What no tool on this machine can reach**: a physical device, a login only they hold, a second
  account, a camera, a reboot, a real person's reaction, and a paid live run in its §5.3 bin.

Never plan, and never ask for, a person driving a screen "to see how it feels". If a check seems to
need that, the missing piece is a rig or a fake; plan it (a planner) or ask for the task that builds
it (a worker), as live-workers T19 and T20 did after T13 handed exactly that check to the person.
