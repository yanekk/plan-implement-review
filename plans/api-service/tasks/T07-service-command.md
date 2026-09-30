# T07 — service-command

**Phase:** 3 · **Depends on:** T06 · **Weight:** medium

## Goal

Put the service in the person's hands: `pir service`, `pir service on`, `pir service off`, and an
`./install.sh` that registers the service and restarts it on every install.

## Design sections this implements

DESIGN §2.7.

## Files

- `src/shell/pir.mjs`: the `service` verb and one `USAGE` line; `src/shell/pir.test.mjs`
- `install.sh`: a `refresh_service` step; `src/shell/launcher.test.mjs`: its static checks

## Interface

```
pir service         → serviceStatus   prints text, exits its code (0 only when running)
pir service on      → serviceOn
pir service off     → serviceOff
pir service <other> → USAGE on stderr, exit 2

USAGE gains:  '       pir service [on|off]   the local API service: state, start, stop\n'
```

`run()` takes `serviceOn`, `serviceOff` and `serviceStatus` as injectable collaborators defaulting to
`service-ctl.mjs`'s, and returns their promise, as `pir notify` does for its sends.

```bash
# install.sh, called at the end of install_skills, after install_launcher:
refresh_service() {
    node "$ENGINE_DEST/src/shell/service-ctl.mjs" refresh \
        || echo "  could not start the API service (see: pir service)" >&2
}
```

It runs the installed copy, never `$SRC`'s. Reason: the plist must name the installed engine (§2.6),
and `service-ctl` refuses any other. Its failure does not change `install.sh`'s exit code. It runs
even when `npm ci` failed, since the service needs no packages. The closing message of both install
modes gains `pir service          # the local API service: is it up`.

No test and no step of this task runs `install.sh`: it may not run while a run is live (DESIGN §5.1),
and the static checks are the evidence, as they are for the launcher today.

## Tests

- [ ] `pir service` → calls `serviceStatus`, writes its text and a newline to stdout, returns its code
- [ ] `pir service on` and `off` → the matching collaborator, text printed, code returned
- [ ] `pir service restart`, `pir service on extra` → `USAGE` on stderr, 2, no collaborator called
- [ ] bare `pir`, `pir plan`, `pir start`, `pir notify` behave as before (the existing tests pass unchanged)
- [ ] `USAGE` names `pir service [on|off]`
- [ ] static, `install.sh`: `refresh_service` is defined, is called after `install_launcher`, runs `$ENGINE_DEST/src/shell/service-ctl.mjs refresh`, and never `$SRC/src/shell/service-ctl.mjs`
- [ ] static, `install.sh`: the `refresh_service` line cannot fail the script (`||` fallback present) and both closing messages name `pir service`

## Done when

- [ ] `npm test` is green with the cases above.
- [ ] `PIR_HOME=$(mktemp -d) node src/shell/pir.mjs service` prints a §2.7 text and `pir service on` there prints `skipped the API service (not the real home)`.
- [ ] `bash -n install.sh` passes.
