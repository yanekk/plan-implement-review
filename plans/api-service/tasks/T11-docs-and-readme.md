# T11 — docs-and-readme

**Phase:** 4 · **Depends on:** T07, T09, T10 · **Weight:** light

## Goal

Make the service exist for someone who has never opened this repo: a canonical page in `/docs` saying
what the code does today, and a README section pitched at a user, with a link.

## Design sections this implements

DESIGN §2 as built; `CLAUDE.md § The README follows every major feature`.

## Files

- `docs/api-service.md` (new)
- `docs/README.md`: the opening list of what the folder covers, and the components section
- `README.md`: a section for the service and the command, a line in `## Install`, the command list near line 54

## Interface

`docs/api-service.md`, in this order: what it is for; the contract (discovery file, `GET /v1/usage`,
the 403, 404, 405 and 500 answers, the headers) copied from the code's behaviour, not from DESIGN;
the port and what happens when it is taken; where a reading comes from and the `usage.json` hand-off;
who reports and who does not; the login item, the plist and what `install.sh` does; `pir service`,
`on`, `off`, with each printed text; scratch homes and what tests may not touch; **Known limitations**
(a run on the old engine, a run not started by `pir`, no events off a claude.ai subscription,
`unifiedWindows` undocumented in the SDK, macOS only, a moved `node`).

The README section says what the person gets (the cockpit footer stays current during a pir run; any
local program can read the numbers), the one command to look at it, the curl line, and links to the
docs page.

## Tests

- [ ] every printed text quoted in `docs/api-service.md` is asserted against `statusText` and `servicePlan` by a test that reads the doc (add to `src/core/service.test.mjs`), so the page cannot drift from the code
- [ ] the JSON examples in the doc parse, and the usage example equals `usageBody` of the reading it shows
- [ ] `docs/README.md` links `api-service.md`; `README.md` links it and names `pir service`

## Done when

- [ ] `npm test` is green with the cases above.
- [ ] The doc states what T09 and T10 actually measured, read from their FINDINGS rows, and lists what is still unverified until the after-merge checklist (PLAN § After the merge).
- [ ] Nothing in `README.md` or `/docs` claims the log-out check or the real install was seen.
