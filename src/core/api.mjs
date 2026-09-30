// The pure rules of the local API (plans/api-service DESIGN §2.1, §2.2, §2.8, §3.4): what any request
// is answered with, the health body, what `api.json` holds, the file names, and the one rule that
// decides whether code is on the real machine or a scratch home. Pure: the environment, the OS home
// and the endpoint table arrive as arguments; the server, the files and the clock live in
// src/shell/api-service.mjs (T05). Enforced by boundary.test.mjs (DESIGN §3.1).

export const API_VERSION = 1;

// Below macOS's ephemeral range (49152 and up), so no outgoing connection is ever handed it (§2.2).
export const API_PORT = 47717;

// The service's exit code when the port is held. Not 78 (EX_CONFIG): launchd reports 78 itself when it
// cannot start the program at all, so 78 could not tell a held port from a moved `node` (§2.2).
export const EXIT_PORT_TAKEN = 47;

// One trailing slash is not a different folder: `HOME=/Users/me/` is the real home.
function stripSlash(path) {
  return path.endsWith('/') ? path.slice(0, -1) : path;
}

// homeKind(env, osHome) → 'real' | 'scratch' | 'test-real' (§2.8). The one rule behind all three
// seatbelts: the usage file, the port and the login item. `osHome` is os.userInfo().homedir, passed in
// by the shell: the user database, not `HOME`, because drills run `HOME=/tmp/... ./install.sh` and
// launchd's domain is per user whatever `HOME` says.
//
// The home is `PIR_HOME ?? HOME`, the same precedence as indexDir (src/shell/index-store.mjs), so this
// rule and the path the files are written under can never disagree.
export function homeKind(env, osHome) {
  const home = env.PIR_HOME ?? env.HOME;
  // With neither variable set indexDir falls back to the real home, so 'scratch' here would write the
  // real files. Refusing costs nothing: a real run always has HOME. An unknown OS home is refused for
  // the same reason: nothing could then tell the real home from a scratch one.
  if (typeof home !== 'string' || typeof osHome !== 'string') return 'test-real';
  if (stripSlash(home) !== stripSlash(osHome)) return 'scratch';
  // `node --test` sets NODE_TEST_CONTEXT in every test process and children inherit it. A test that
  // forgot its scratch home fails closed instead of feeding fake numbers to the person's cockpit.
  return env.NODE_TEST_CONTEXT === undefined ? 'real' : 'test-real';
}

// portFor(kind) → the port to bind: the fixed one on the real machine, 0 (OS-chosen) on a scratch home
// so tests and checks never bind the real port and several can run at once, and null when the service
// must refuse to start. An unknown kind is refused too.
export function portFor(kind) {
  if (kind === 'real') return API_PORT;
  if (kind === 'scratch') return 0;
  return null;
}

// apiFiles(pirDir) → the three files of §3.4. pirDir is `${PIR_HOME ?? HOME}/.pir`.
export function apiFiles(pirDir) {
  const dir = stripSlash(pirDir);
  return {
    discovery: `${dir}/api.json`,
    usage: `${dir}/usage.json`,
    off: `${dir}/api-service.off`,
  };
}

// discoveryRecord({ port, pid }) → what `api.json` holds (§2.1). `port` is the port actually bound,
// which on a scratch home is the OS-chosen one, never the 0 that was asked for. `pid` lets a reader
// tell a file left by a crash from a live service. Key order is the contract's.
export function discoveryRecord({ port, pid }) {
  return { version: API_VERSION, url: `http://127.0.0.1:${port}`, pid };
}

// healthBody({ pid }) → the `GET /health` body (§2.1), `pid` being the answering process.
export function healthBody({ pid }) {
  return { version: API_VERSION, status: 'ok', pid };
}

// The headers every response carries (§2.1). No `Access-Control-*` header, ever: there is no special
// rule for or against browsers, and a CORS grant would be a separate decision.
function respond(status, body, extra = {}) {
  return {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...extra,
    },
    body,
  };
}

function errorBody(error) {
  return JSON.stringify({ version: API_VERSION, error });
}

// route({ method, url }, { endpoints }) → { status, headers, body } — the whole request decision
// (§2.1), checked in the order path → method → handler. `endpoints` maps an exact path to a function
// returning the body object, so the router knows nothing about usage and a new endpoint is one more
// row (§3.2). The `Host` header is not an input: §2.1 checks none.
export function route({ method, url }, { endpoints }) {
  // The query string is ignored. Nothing else is normalised: `/health/` is an unknown path.
  const path = typeof url === 'string' ? url.split('?', 1)[0] : '';
  // hasOwn, not `in`: `/constructor`-style names must not resolve through the prototype chain.
  if (!Object.hasOwn(endpoints, path)) return respond(404, errorBody('not_found'));
  // HEAD and OPTIONS included: no preflight is answered, so no page is let in by accident.
  if (method !== 'GET') return respond(405, errorBody('method_not_allowed'), { Allow: 'GET' });
  try {
    const body = JSON.stringify(endpoints[path]());
    // stringify returns undefined, not a string, for a handler that returned nothing.
    if (typeof body !== 'string') throw new Error('endpoint returned no body');
    return respond(200, body);
  } catch {
    return respond(500, errorBody('internal'));
  }
}
