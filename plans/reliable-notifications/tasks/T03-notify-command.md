# T03 — notify-command

**Phase:** 2 · **Depends on:** T02 · **Weight:** light

## Goal

The one command a person runs to switch alerts on, test them, or turn them off. It is how the phone
gets subscribed, so its output is what the person follows with the phone in hand.

## Design sections this implements

DESIGN §2.4, §2.6 (corrupt config), §5 dependencies.

## Files

- `src/shell/pir.mjs` (the `notify` verb, `USAGE`), `src/shell/pir.test.mjs`.
- `package.json`, `package-lock.json`: add `uqr` 0.1.3 as a dependency.

## Interface

```
pir notify         → set up or show; prints topic, QR (uqr renderUnicodeCompact of https://ntfy.sh/{topic}),
                     steps: install ntfy, "Subscribe to topic", type or scan; sends a test alert on first setup
pir notify test    → sends "pir test alert"; exit 0 on ok, 1 with the error otherwise
pir notify off     → removeNotifyConfig; prints that alerts are off
run(argv, { env, stdout, publish, readNotifyConfig, writeNotifyConfig, removeNotifyConfig, newTopic, qr })
```

Collaborators are injected as the other verbs' are, so the tests never publish.

## Tests

- [ ] First `pir notify`: writes a config with the injected topic, prints topic and QR, publishes once.
- [ ] Second `pir notify`: same topic printed, no write, no publish.
- [ ] `test` with no config: exit 1 and a line naming `pir notify`. With config and a failing publish:
      exit 1 with the error.
- [ ] `off` then `notify`: a new topic.
- [ ] Corrupt config: `pir notify` says so and names `pir notify off`; exits 1; nothing overwritten.
- [ ] Unknown `pir notify foo`: usage error.

## Done when

- [ ] Tests pass; `USAGE` lists `pir notify [test|off]`.
- [ ] `node src/shell/pir.mjs notify` with `PIR_HOME=$(mktemp -d)` prints a scannable QR in the terminal
      (the worker runs it and checks the output renders; it sends one real test alert to a throwaway
      topic, which is the §5.3 `worker` action).
