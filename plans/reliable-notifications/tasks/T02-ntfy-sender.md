# T02 — ntfy-sender

**Phase:** 1 · **Depends on:** — · **Weight:** medium

## Goal

The two shell pieces that touch the outside: the ntfy HTTP client, with its retries, and the per-account
config plus the presence marker. Both are small and injected, so the coordinator and `pir notify` can
use them without reaching the network in tests.

## Design sections this implements

DESIGN §2.4 (config), §2.5 (marker), §2.6 (retries), §3.4.

## Files

- `src/shell/ntfy.mjs` (new), `src/shell/ntfy.test.mjs` (new).
- `src/shell/notify-config.mjs` (new), `src/shell/notify-config.test.mjs` (new).

## Interface

```
// ntfy.mjs
publish({ server, topic, title, message, click, seq, priority = 4, tags = ['bell'] },
        { fetch = globalThis.fetch, delays = [5000, 30000], sleep } = {})
  → Promise<{ ok: true, status } | { ok: false, status|null, error }>
  // JSON publish: POST {server} body { topic, title, message, click?, priority, tags, sequence_id? }.
  // Why JSON: fetch rejects non-Latin-1 header values, and titles carry '·'.
clear({ server, topic, seq }, { fetch }) → Promise<{ ok, status|null, error? }>
  // PUT {server}/{topic}/{seq}/clear, no retry.

// notify-config.mjs
notifyPaths(env = process.env) → { dir, config, presence }   // {PIR_HOME ?? HOME}/.pir/…
readNotifyConfig(env) → { server, topic } | null | { corrupt: true }
writeNotifyConfig(config, env)          // temp file + rename, mode 0600, creates dir
removeNotifyConfig(env)                 // config and presence marker; missing files are fine
newTopic(randomBytes = crypto.randomBytes) → 'pir-' + 24 lowercase base32 chars
ensurePresenceMarker(env) → path        // creates the empty marker if absent
```

## Tests

- [ ] `publish` sends one JSON POST with the fields above; omits `click`/`sequence_id` when null.
- [ ] Non-2xx then 2xx: retried once, returns ok. Three failures (throw or 5xx): returns the last error
      after exactly the injected delays. A 4xx is not retried.
- [ ] `clear` sends one PUT to the right path; a failure resolves `{ ok: false }`, never rejects.
- [ ] Config round-trips; file mode 0600; a crash between temp write and rename leaves the old file.
- [ ] Unparseable file and a file with no topic both read `{ corrupt: true }`; missing reads `null`.
- [ ] `newTopic` from fixed bytes gives a fixed, 28-char, `^pir-[a-z2-7]{24}$` result.
- [ ] `removeNotifyConfig` removes both files and succeeds when neither exists.

## Done when

- [ ] Tests above pass under `npm test` with no request leaving the process.
- [ ] No other file changed.
