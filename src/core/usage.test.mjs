import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FUTURE_SLACK_MS, readingFromEvent, serializeReading, parseReading, usageBody } from './usage.mjs';

// The committed recording of one real SDK conversation; its one rate_limit_event carries both windows.
const SAMPLE_PATH = new URL('./fixtures/stream-sample.ndjson', import.meta.url);
const sample = readFileSync(SAMPLE_PATH, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const recorded = sample.filter((e) => e.dir === 'in' && e.event?.type === 'rate_limit_event');

const T = 1790669288699;
const FIVE = { utilization: 0.97, resetsAt: 1790673000 };
const SEVEN = { utilization: 0.77, resetsAt: 1790830800 };
const event = (unifiedWindows, extra = {}) => ({
  type: 'rate_limit_event',
  rate_limit_info: { status: 'allowed', resetsAt: 1790673000, rateLimitType: 'five_hour', unifiedWindows, ...extra },
});
const both = () => event({ five_hour: { ...FIVE }, seven_day: { ...SEVEN } });
const reading = (over = {}) => ({ observedAt: T, fiveHour: { ...FIVE }, sevenDay: { ...SEVEN }, ...over });
const file = (over = {}) => JSON.stringify({
  version: 1,
  observed_at: T,
  five_hour: { utilization: 0.97, resets_at: 1790673000 },
  seven_day: { utilization: 0.77, resets_at: 1790830800 },
  ...over,
});

// ---- readingFromEvent ----

test('readingFromEvent: the recorded event yields both windows and the given time', () => {
  assert.equal(recorded.length, 1, 'the recording holds exactly one rate_limit_event');
  const [entry] = recorded;
  assert.deepEqual(readingFromEvent(entry.event, entry.t), {
    observedAt: 1790324689581,
    fiveHour: { utilization: 0.2, resetsAt: 1790334600 },
    sevenDay: { utilization: 0.11, resetsAt: 1790830800 },
  });
});

test('readingFromEvent: no other message in the recording yields a reading', () => {
  const others = sample.filter((e) => e.event && e.event.type !== 'rate_limit_event');
  assert.ok(others.length > 0);
  for (const entry of others) assert.equal(readingFromEvent(entry.event, entry.t), null);
});

test('readingFromEvent: unifiedWindows absent, null, a string or an array is no reading', () => {
  const absent = event(undefined);
  delete absent.rate_limit_info.unifiedWindows;
  assert.equal(readingFromEvent(absent, T), null);
  assert.equal(readingFromEvent(event(null), T), null);
  assert.equal(readingFromEvent(event('five_hour'), T), null);
  assert.equal(readingFromEvent(event([{ ...FIVE }, { ...SEVEN }]), T), null);
});

test('readingFromEvent: the single-window fields are never a fallback', () => {
  // status, resetsAt and rateLimitType are all present on this event; only unifiedWindows is missing.
  const e = event(undefined);
  assert.equal(e.rate_limit_info.resetsAt, 1790673000);
  assert.equal(readingFromEvent(e, T), null);
});

const INVALID_WINDOWS = {
  'utilization a string': { utilization: '0.5', resetsAt: 1790673000 },
  'utilization NaN': { utilization: NaN, resetsAt: 1790673000 },
  'utilization negative': { utilization: -0.01, resetsAt: 1790673000 },
  'utilization Infinity': { utilization: Infinity, resetsAt: 1790673000 },
  'utilization missing': { resetsAt: 1790673000 },
  'resetsAt 0': { utilization: 0.5, resetsAt: 0 },
  'resetsAt missing': { utilization: 0.5 },
  'resetsAt negative': { utilization: 0.5, resetsAt: -1 },
  'resetsAt a string': { utilization: 0.5, resetsAt: '1790673000' },
  'resetsAt Infinity': { utilization: 0.5, resetsAt: Infinity },
  'the window null': null,
  'the window a number': 0.5,
  'the window an array': [0.5, 1790673000],
};

for (const [name, bad] of Object.entries(INVALID_WINDOWS)) {
  test(`readingFromEvent: ${name} → that window null, the other kept`, () => {
    assert.deepEqual(
      readingFromEvent(event({ five_hour: bad, seven_day: { ...SEVEN } }), T),
      { observedAt: T, fiveHour: null, sevenDay: SEVEN },
    );
    assert.deepEqual(
      readingFromEvent(event({ five_hour: { ...FIVE }, seven_day: bad }), T),
      { observedAt: T, fiveHour: FIVE, sevenDay: null },
    );
  });

  test(`readingFromEvent: ${name} in both windows → null`, () => {
    assert.equal(readingFromEvent(event({ five_hour: bad, seven_day: bad }), T), null);
  });
}

test('readingFromEvent: a window that is absent is null, the other kept', () => {
  assert.deepEqual(readingFromEvent(event({ seven_day: { ...SEVEN } }), T), { observedAt: T, fiveHour: null, sevenDay: SEVEN });
  assert.deepEqual(readingFromEvent(event({ five_hour: { ...FIVE } }), T), { observedAt: T, fiveHour: FIVE, sevenDay: null });
  assert.equal(readingFromEvent(event({}), T), null);
});

test('readingFromEvent: utilization 0 and above 1 are valid', () => {
  const r = readingFromEvent(event({ five_hour: { utilization: 0, resetsAt: 1 }, seven_day: { utilization: 1.2, resetsAt: 2 } }), T);
  assert.deepEqual(r, { observedAt: T, fiveHour: { utilization: 0, resetsAt: 1 }, sevenDay: { utilization: 1.2, resetsAt: 2 } });
});

test('readingFromEvent: another type, null, a number, or no rate_limit_info → null, no throw', () => {
  const others = [
    { type: 'assistant', rate_limit_info: both().rate_limit_info },
    { type: 'result', subtype: 'success' },
    { rate_limit_info: both().rate_limit_info },
    { type: 'rate_limit_event' },
    { type: 'rate_limit_event', rate_limit_info: null },
    { type: 'rate_limit_event', rate_limit_info: 'allowed' },
    { type: 'rate_limit_event', rate_limit_info: [] },
    null, undefined, 7, 'rate_limit_event', true, [], [both()],
  ];
  for (const message of others) {
    assert.doesNotThrow(() => readingFromEvent(message, T));
    assert.equal(readingFromEvent(message, T), null);
  }
});

test('readingFromEvent: extra keys in unifiedWindows and in a window are ignored', () => {
  const e = event({
    five_hour: { ...FIVE, status: 'allowed', surpassedThreshold: 0.9 },
    seven_day: { ...SEVEN },
    seven_day_opus: { utilization: 0.4, resetsAt: 1790830800 },
    overage: 'rejected',
  });
  assert.deepEqual(readingFromEvent(e, T), { observedAt: T, fiveHour: FIVE, sevenDay: SEVEN });
});

test('readingFromEvent: a time that is not a positive finite number is no reading', () => {
  for (const t of [0, -1, NaN, Infinity, null, undefined, '1790669288699']) {
    assert.equal(readingFromEvent(both(), t), null);
  }
});

test('readingFromEvent: the reading does not alias the event', () => {
  const e = both();
  const r = readingFromEvent(e, T);
  e.rate_limit_info.unifiedWindows.five_hour.utilization = 0;
  assert.equal(r.fiveHour.utilization, 0.97);
});

// ---- serializeReading ----

test('serializeReading: the file text of DESIGN §2.4, one line, newline-terminated', () => {
  assert.equal(
    serializeReading(reading()),
    '{"version":1,"observed_at":1790669288699,'
      + '"five_hour":{"utilization":0.97,"resets_at":1790673000},'
      + '"seven_day":{"utilization":0.77,"resets_at":1790830800}}\n',
  );
});

test('serializeReading: a null window is written as null', () => {
  assert.equal(
    serializeReading(reading({ fiveHour: null })),
    '{"version":1,"observed_at":1790669288699,"five_hour":null,'
      + '"seven_day":{"utilization":0.77,"resets_at":1790830800}}\n',
  );
  assert.equal(
    serializeReading(reading({ sevenDay: null })),
    '{"version":1,"observed_at":1790669288699,'
      + '"five_hour":{"utilization":0.97,"resets_at":1790673000},"seven_day":null}\n',
  );
});

// ---- parseReading ----

test('parseReading: a serialized reading parses back to the same reading', () => {
  const cases = [
    reading(),
    reading({ fiveHour: null }),
    reading({ sevenDay: null }),
    reading({ fiveHour: { utilization: 0, resetsAt: 1 }, sevenDay: { utilization: 1.2, resetsAt: 1790830800.5 } }),
    readingFromEvent(recorded[0].event, recorded[0].t),
  ];
  for (const r of cases) assert.deepEqual(parseReading(serializeReading(r), r.observedAt), r);
});

test('parseReading: the file of DESIGN §2.4, spread over lines, is read', () => {
  const text = `{ "version": 1, "observed_at": 1790669288699,
  "five_hour": { "utilization": 0.97, "resets_at": 1790673000 },
  "seven_day": { "utilization": 0.77, "resets_at": 1790830800 } }`;
  assert.deepEqual(parseReading(text, T), reading());
});

const BAD_FILES = {
  'empty text': '',
  'whitespace': ' \n',
  'invalid JSON': '{"version":1,"observed_at":',
  'a truncated file': file().slice(0, 40),
  'an array': '[1]',
  'a number': '1',
  'a string': '"usage"',
  'JSON null': 'null',
  'version 2': file({ version: 2 }),
  'version a string': file({ version: '1' }),
  'version missing': file({ version: undefined }),
  'observed_at missing': file({ observed_at: undefined }),
  'observed_at 0': file({ observed_at: 0 }),
  'observed_at negative': file({ observed_at: -5 }),
  'observed_at a string': file({ observed_at: '1790669288699' }),
  'observed_at null': file({ observed_at: null }),
  'both windows null': file({ five_hour: null, seven_day: null }),
  'both windows missing': file({ five_hour: undefined, seven_day: undefined }),
  'one window missing': file({ five_hour: undefined }),
  'one window invalid, the other valid': file({ five_hour: { utilization: '0.97', resets_at: 1790673000 } }),
  'a window with the SDK key name': file({ seven_day: { utilization: 0.77, resetsAt: 1790830800 } }),
  'a window with resets_at 0': file({ seven_day: { utilization: 0.77, resets_at: 0 } }),
  'a window with negative utilization': file({ five_hour: { utilization: -1, resets_at: 1790673000 } }),
  'a window that is a number': file({ five_hour: 0.97 }),
  'a window that is an array': file({ five_hour: [] }),
};

for (const [name, text] of Object.entries(BAD_FILES)) {
  test(`parseReading: ${name} → null`, () => {
    assert.doesNotThrow(() => parseReading(text, T));
    assert.equal(parseReading(text, T), null);
  });
}

test('parseReading: text that is not a string → null, no throw', () => {
  for (const text of [null, undefined, 7, {}, [], Buffer.from(file())]) {
    assert.doesNotThrow(() => parseReading(text, T));
    assert.equal(parseReading(text, T), null);
  }
});

test('parseReading: extra keys in the file and in a window are ignored', () => {
  const text = file({ writer: 'pir', five_hour: { utilization: 0.97, resets_at: 1790673000, note: 'x' } });
  assert.deepEqual(parseReading(text, T), reading());
});

test('parseReading: observed_at exactly now + 60000 is kept, now + 60001 is null', () => {
  assert.equal(FUTURE_SLACK_MS, 60_000);
  const now = 1790669000000;
  assert.deepEqual(parseReading(file({ observed_at: now + 60_000 }), now), reading({ observedAt: now + 60_000 }));
  assert.equal(parseReading(file({ observed_at: now + 60_001 }), now), null);
});

test('parseReading: a reading from long ago is kept', () => {
  assert.deepEqual(parseReading(file({ observed_at: 1 }), T), reading({ observedAt: 1 }));
});

test('parseReading: a clock that is not a number reads as no reading', () => {
  for (const now of [undefined, NaN, null, 'soon']) assert.equal(parseReading(file(), now), null);
});

test('parseReading: a clock that coerces to a number still reads as no reading', () => {
  // `observed_at <= now + slack` alone lets these through: null and [] add as 0, true as 1, and a
  // numeric string concatenates with the slack into a far larger number than the clock it names.
  const old = file({ observed_at: 1 });
  for (const now of [null, true, [], '5', Infinity]) assert.equal(parseReading(old, now), null);
  const ahead = file({ observed_at: T + 10 * FUTURE_SLACK_MS });
  assert.equal(parseReading(ahead, T), null);
  assert.equal(parseReading(ahead, String(T)), null);
});

// ---- usageBody ----

test('usageBody: no reading → observed_at and rate_limits both null', () => {
  assert.deepEqual(usageBody(null), { version: 1, observed_at: null, rate_limits: null });
  assert.equal(JSON.stringify(usageBody(null)), '{"version":1,"observed_at":null,"rate_limits":null}');
  assert.deepEqual(usageBody(undefined), { version: 1, observed_at: null, rate_limits: null });
});

test('usageBody: utilization becomes a percentage of at most two decimals, capped at 100', () => {
  const pct = (utilization) => usageBody(reading({ fiveHour: { utilization, resetsAt: 1790673000 } })).rate_limits.five_hour.used_percentage;
  assert.equal(pct(0.11), 11);
  assert.equal(pct(0.965), 96.5);
  assert.equal(pct(1.2), 100);
  assert.equal(pct(0), 0);
  assert.equal(pct(1), 100);
  assert.equal(pct(0.97), 97);
  assert.equal(pct(0.123456), 12.35);
  assert.equal(pct(0.00004), 0);
});

test('usageBody: one null window stays null', () => {
  assert.deepEqual(usageBody(reading({ fiveHour: null })).rate_limits, {
    five_hour: null,
    seven_day: { used_percentage: 77, resets_at: 1790830800 },
  });
  assert.deepEqual(usageBody(reading({ sevenDay: null })).rate_limits, {
    five_hour: { used_percentage: 97, resets_at: 1790673000 },
    seven_day: null,
  });
});

test('usageBody: key names and order match DESIGN §2.1 exactly', () => {
  const expected = {
    version: 1,
    observed_at: 1790669288699,
    rate_limits: {
      five_hour: { used_percentage: 97, resets_at: 1790673000 },
      seven_day: { used_percentage: 77, resets_at: 1790830800 },
    },
  };
  // JSON.stringify keeps insertion order, so equal text means equal names in equal order.
  assert.equal(JSON.stringify(usageBody(reading())), JSON.stringify(expected));
});

test('usageBody: the recorded event, end to end through the file', () => {
  const [entry] = recorded;
  const text = serializeReading(readingFromEvent(entry.event, entry.t));
  assert.deepEqual(usageBody(parseReading(text, entry.t)), {
    version: 1,
    observed_at: 1790324689581,
    rate_limits: {
      five_hour: { used_percentage: 20, resets_at: 1790334600 },
      seven_day: { used_percentage: 11, resets_at: 1790830800 },
    },
  });
});

// ---- docs/api-service.md (api-service T11) ----
// The page's examples are one reading shown three ways: the event, the file, the answer. Each is
// derived here from the one before, so an example edited by hand fails until the chain agrees again.

const DOC = readFileSync(new URL('../../docs/api-service.md', import.meta.url), 'utf8');
const README = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
const jsonBlocks = (text) => [...text.matchAll(/^```json\n([\s\S]*?)\n```$/gm)].map((m) => m[1]);
const DOC_JSON = jsonBlocks(DOC);

test('docs/api-service.md: every JSON example parses', () => {
  assert.ok(DOC_JSON.length >= 6, `found ${DOC_JSON.length} examples`);
  for (const block of DOC_JSON) assert.doesNotThrow(() => JSON.parse(block), block);
});

test('docs/api-service.md: the file example is the event example saved, and the usage example is its answer', () => {
  const parsed = DOC_JSON.map((block) => ({ block, value: JSON.parse(block) }));
  const eventExample = parsed.find((e) => e.value.type === 'rate_limit_event');
  const fileExample = parsed.find((e) => e.value.five_hour !== undefined);
  const answers = parsed.filter((e) => 'rate_limits' in e.value);
  assert.ok(eventExample && fileExample, 'the page shows the event and the file');
  assert.equal(answers.length, 2, 'the page shows the answer with a reading and the answer without');

  const heard = readingFromEvent(eventExample.value, fileExample.value.observed_at);
  assert.deepEqual(JSON.parse(serializeReading(heard)), fileExample.value);
  // Key order is part of what a reader sees, so the texts are compared, not only the values.
  assert.equal(JSON.stringify(fileExample.value), serializeReading(heard).trimEnd());

  // Read back the way the service does, from the text the page shows.
  const read = parseReading(fileExample.block, fileExample.value.observed_at);
  assert.deepEqual(read, heard);
  const [withReading, without] = answers[0].value.rate_limits ? answers : [answers[1], answers[0]];
  assert.equal(JSON.stringify(withReading.value), JSON.stringify(usageBody(read)));
  assert.equal(JSON.stringify(without.value), JSON.stringify(usageBody(null)));
});

test('README.md: the usage answer it shows is the one the docs page shows', () => {
  const [shown] = jsonBlocks(README).filter((block) => block.includes('rate_limits'));
  const inDoc = DOC_JSON.map((block) => JSON.parse(block)).find((value) => value.rate_limits);
  assert.equal(shown, JSON.stringify(inDoc));
});
