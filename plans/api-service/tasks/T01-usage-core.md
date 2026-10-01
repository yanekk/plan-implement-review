# T01 — usage-core

**Phase:** 1 · **Depends on:** — · **Weight:** medium

## Goal

The pure rules for a usage reading: how an SDK `rate_limit_event` becomes a reading, the format of the
file a run saves it in, how the service validates that file, and the body `GET /v1/usage` returns.

## Design sections this implements

DESIGN §2.1 (the usage body), §2.3, §2.4 (the file format), §2.5 (validation).

## Files

- `src/core/usage.mjs` (new)
- `src/core/usage.test.mjs` (new)

## Interface

```js
// Reading = { observedAt: number /* ms */, fiveHour: Window | null, sevenDay: Window | null }
// Window  = { utilization: number /* >= 0 */, resetsAt: number /* epoch seconds, > 0 */ }

export const FUTURE_SLACK_MS = 60_000;

// An SDK message and the log entry's `t`. null unless type is 'rate_limit_event' and
// rate_limit_info.unifiedWindows holds at least one valid window (§2.3). Never throws.
export function readingFromEvent(message, observedAt) // → Reading | null

// The usage.json text (§2.4), newline-terminated:
// {"version":1,"observed_at":…,"five_hour":{"utilization":…,"resets_at":…}|null,"seven_day":…|null}
export function serializeReading(reading) // → string

// null for anything that is not a valid version-1 file, or whose observed_at is more than
// FUTURE_SLACK_MS ahead of `now` (§2.5). Never throws.
export function parseReading(text, now) // → Reading | null

// The /v1/usage body (§2.1). null in → observed_at and rate_limits both null.
export function usageBody(reading) // → { version: 1, observed_at, rate_limits }
```

`used_percentage` is `Math.round(Math.min(utilization, 1) * 10000) / 100`.

## Tests

- [ ] the recorded event in `src/core/fixtures/stream-sample.ndjson` → both windows, `observedAt` as given
- [ ] `unifiedWindows` absent, null, a string, an array → null
- [ ] one window invalid (utilization a string, NaN, negative; `resetsAt` 0, missing) → that window null, the other kept
- [ ] both windows invalid → null
- [ ] a message of another type, `null`, a number, an object with no `rate_limit_info` → null, no throw
- [ ] extra keys in `unifiedWindows` are ignored
- [ ] `parseReading(serializeReading(r), now)` deep-equals `r`
- [ ] `parseReading`: empty text, invalid JSON, an array, version 2, `observed_at` missing, 0, a string, both windows null → null
- [ ] `parseReading`: `observed_at` exactly `now + 60000` is kept, `now + 60001` is null
- [ ] `usageBody(null)` → `{ version: 1, observed_at: null, rate_limits: null }`
- [ ] `usageBody`: utilization 0.11 → 11, 0.965 → 96.5, 1.2 → 100, 0 → 0; one null window stays null
- [ ] `usageBody` key names and order match DESIGN §2.1 exactly

## Done when

- [ ] `npm test` is green with the cases above.
- [ ] `src/core/boundary.test.mjs` passes for `usage.mjs`.
