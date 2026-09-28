// The ntfy HTTP client (plans/reliable-notifications DESIGN §2.8, §3.1): one publish with retries, one
// clear without. `fetch` and `sleep` are injected so no test reaches the network or waits real time.
//
// Neither function ever rejects. An alert is a convenience on top of `pir`, which still shows
// `asking you`; the coordinator fires these without awaiting them, and a rejection there would be an
// unhandled one. Every outcome, the network error included, comes back as a value.

const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function trimServer(server) {
  return String(server).replace(/\/+$/, '');
}

// A 5xx or 429 may pass; a network error may pass. Any other 4xx is a malformed request that will not
// improve on retry (DESIGN §2.8).
function retryable(result) {
  return result.status === null || result.status === 429 || result.status >= 500;
}

async function attempt(fetchFn, url, init) {
  try {
    const res = await fetchFn(url, init);
    if (res.ok) return { ok: true, status: res.status };
    return { ok: false, status: res.status, error: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, status: null, error: err?.message ?? String(err) };
  }
}

// publish(fields, { fetch, delays, sleep }) → { ok: true, status } | { ok: false, status|null, error }.
// A JSON publish to the server root, the topic in the body. Why JSON rather than ntfy's header form:
// fetch rejects non-Latin-1 header values, and titles carry '·'. Optional fields that are null or
// undefined are left out of the body. `delays` are the waits before each retry, so the default makes at
// most three attempts, 5 s and 30 s apart.
export async function publish(
  { server, topic, title, message, click, seq, icon, priority = 4, tags = ['bell'] },
  { fetch: fetchFn = globalThis.fetch, delays = [5000, 30000], sleep = realSleep } = {},
) {
  const body = { topic, title, message, priority, tags };
  if (click != null) body.click = click;
  if (icon != null) body.icon = icon;
  if (seq != null) body.sequence_id = seq;
  const init = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
  const url = trimServer(server);
  let result = await attempt(fetchFn, url, init);
  for (const delay of delays) {
    if (result.ok || !retryable(result)) break;
    await sleep(delay);
    result = await attempt(fetchFn, url, init);
  }
  return result;
}

// clear({ server, topic, seq }, { fetch }) → { ok, status|null, error? }. PUT {server}/{topic}/{seq}/clear,
// one attempt: a failed clear is not retried and not noted (DESIGN §2.8).
export async function clear({ server, topic, seq }, { fetch: fetchFn = globalThis.fetch } = {}) {
  const url = `${trimServer(server)}/${encodeURIComponent(topic)}/${encodeURIComponent(seq)}/clear`;
  return attempt(fetchFn, url, { method: 'PUT' });
}
