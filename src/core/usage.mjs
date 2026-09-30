// The rules for a subscription usage reading (api-service DESIGN §2.1, §2.3–§2.5). Pure: how an SDK
// `rate_limit_event` becomes a reading, the text of the file a run saves it in, how the service
// validates that text, and the body `GET /v1/usage` answers with. The clock arrives as `now`; writing
// and reading the file are the shell's (src/shell/usage-report.mjs, api-service.mjs).
//
// Reading = { observedAt: number /* ms */, fiveHour: Window | null, sevenDay: Window | null }
// Window  = { utilization: number /* >= 0 */, resetsAt: number /* epoch seconds, > 0 */ }
//
// readingFromEvent and parseReading take input this code did not make, and throw on none of it. The
// run must never suffer for the service, and the service must never fail on a bad file, so every
// malformed value reads as "no reading" instead. serializeReading takes a Reading and nothing else.

// How far ahead of the service's clock a file's `observed_at` may be and still count (§2.5). The
// cockpit keeps the newer of this reading and its own, so a stamp from the future would beat every
// real reading for ever; a minute allows for clock steps between the write and the read.
export const FUTURE_SLACK_MS = 60_000;

const VERSION = 1;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isTime = (v) => Number.isFinite(v) && v > 0;

// One window, read through the two key names it goes by: `resetsAt` on the SDK event, `resets_at` in
// the file. null unless utilization is a finite number >= 0 and the reset a finite number > 0 (§2.3).
// Number.isFinite is false for a numeric string, so "0.5" is invalid rather than coerced. The window
// is rebuilt from the two fields, which is what drops any other key.
function windowFrom(raw, resetKey) {
  if (!isObject(raw)) return null;
  const { utilization } = raw;
  const resetsAt = raw[resetKey];
  if (!Number.isFinite(utilization) || utilization < 0) return null;
  if (!isTime(resetsAt)) return null;
  return { utilization, resetsAt };
}

// readingFromEvent(message, observedAt) → Reading | null. `message` is what the SDK yielded and
// `observedAt` the `t` of the conversation-log entry that carried it, so the API's value can be matched
// against the log exactly (§2.4). null unless the message is a `rate_limit_event` whose
// `rate_limit_info.unifiedWindows` holds at least one valid window. The documented single-window
// fields beside it (`resetsAt`, `rateLimitType`) are deliberately not a fallback: a one-window reading
// would replace a two-window one and blank the other window in the footer (§2.3).
export function readingFromEvent(message, observedAt) {
  if (!isObject(message) || message.type !== 'rate_limit_event') return null;
  // A reading with no usable time could never be read back (parseReading refuses it), so it is not one.
  if (!isTime(observedAt)) return null;
  const info = message.rate_limit_info;
  const windows = isObject(info) ? info.unifiedWindows : null;
  if (!isObject(windows)) return null;
  const fiveHour = windowFrom(windows.five_hour, 'resetsAt');
  const sevenDay = windowFrom(windows.seven_day, 'resetsAt');
  if (!fiveHour && !sevenDay) return null;
  return { observedAt, fiveHour, sevenDay };
}

const fileWindow = (w) => (w ? { utilization: w.utilization, resets_at: w.resetsAt } : null);

// serializeReading(reading) → the usage.json text (§2.4): one JSON line, newline-terminated. The file
// keeps utilization as the fraction it was heard as; the percentage is worked out when it is served.
export function serializeReading(reading) {
  return `${JSON.stringify({
    version: VERSION,
    observed_at: reading.observedAt,
    five_hour: fileWindow(reading.fiveHour),
    seven_day: fileWindow(reading.sevenDay),
  })}\n`;
}

// A window as the file holds it. `undefined` means the file is not a valid one: a window must be
// present and either null or valid (§2.5), so a missing key or a half-written window rejects the whole
// file rather than being read as "this window is unknown".
function parsedWindow(raw) {
  if (raw === null) return null;
  return windowFrom(raw, 'resets_at') ?? undefined;
}

// parseReading(text, now) → Reading | null. `text` is the file's content and `now` the service's
// clock in ms. null for anything that is not a valid version-1 file with at least one valid window, or
// whose `observed_at` is more than FUTURE_SLACK_MS ahead of `now` (§2.5).
export function parseReading(text, now) {
  if (typeof text !== 'string') return null;
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(data) || data.version !== VERSION) return null;
  const observedAt = data.observed_at;
  if (!isTime(observedAt)) return null;
  // A `now` that is not a finite number fails closed. The comparison alone does not: `+` coerces, so
  // null adds as 0 and a numeric string concatenates with the slack, and either lets a file through.
  if (!Number.isFinite(now) || observedAt > now + FUTURE_SLACK_MS) return null;
  const fiveHour = parsedWindow(data.five_hour);
  const sevenDay = parsedWindow(data.seven_day);
  if (fiveHour === undefined || sevenDay === undefined) return null;
  if (!fiveHour && !sevenDay) return null;
  return { observedAt, fiveHour, sevenDay };
}

// The percentage the contract carries: 0–100, two decimals (§2.3). Utilization above 1 reads as 100
// rather than dropping the reading, which would hide being over the limit. The rounding is done on
// ten-thousandths because 0.11 × 100 is 11.000000000000002 in floating point.
const usedPercentage = (utilization) => Math.round(Math.min(utilization, 1) * 10000) / 100;

const bodyWindow = (w) => (w ? { used_percentage: usedPercentage(w.utilization), resets_at: w.resetsAt } : null);

// usageBody(reading) → the /v1/usage body (§2.1), in the shape of Claude Code's statusline
// `rate_limits` so the cockpit feeds it to code it already has. No reading answers with both
// `observed_at` and `rate_limits` null, never an error: a reader must be able to tell a service that
// is up with nothing to report apart from a service that is absent. The key order is the contract's.
// (No quoted phrase after the word "from" in this file: boundary.test.mjs reads that as an import.)
export function usageBody(reading) {
  if (!reading) return { version: VERSION, observed_at: null, rate_limits: null };
  return {
    version: VERSION,
    observed_at: reading.observedAt,
    rate_limits: {
      five_hour: bodyWindow(reading.fiveHour),
      seven_day: bodyWindow(reading.sevenDay),
    },
  };
}
