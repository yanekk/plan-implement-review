// The program launchd runs (plans/api-service DESIGN §2.1, §2.2, §2.5, §2.6, §2.9): an HTTP server on
// 127.0.0.1 that answers the contract from `usage.json`, keeps `api.json` current and exits cleanly.
// Every decision is core's (../core/api.mjs, ../core/usage.mjs); this file binds the port, reads the
// file and owns the clock.
//
// This module and everything it imports, transitively, uses only `node:` built-ins and relative paths.
// It must start when an install's `npm ci` failed (§2.6), so a package import here would turn a broken
// install into a service that never comes up. api-service.test.mjs walks the import graph.
//
// It prints nothing in normal operation: there is no log file, and a failure is read by `pir service`
// off launchd's last exit code (§2.6, §2.7).

import { createServer } from 'node:http';
import { readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { userInfo } from 'node:os';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXIT_PORT_TAKEN,
  apiFiles,
  discoveryRecord,
  healthBody,
  homeKind,
  portFor,
  route,
} from '../core/api.mjs';
import { parseReading, usageBody } from '../core/usage.mjs';
import { writeFileAtomic } from './atomic-write.mjs';
import { indexDir } from './index-store.mjs';

// usageCache(path) → a function returning the file's current text. The text is re-read only when stat
// shows a different size, mtime or inode (§2.5), so a poll every few seconds costs one stat. A missing
// or unreadable file is empty text, which parseReading reads as no reading.
//
// The inode is in the key beside the size and mtime the design names: a run replaces the file by
// rename, which always changes the inode, so two readings of the same length written within one mtime
// tick are still told apart.
function usageCache(path) {
  let key = null;
  let text = '';
  return () => {
    let stat;
    try {
      stat = statSync(path);
    } catch {
      key = null;
      text = '';
      return text;
    }
    const next = `${stat.size}:${stat.mtimeMs}:${stat.ino}`;
    if (next === key) return text;
    try {
      text = readFileSync(path, 'utf8');
      key = next;
    } catch {
      // Not remembered: the next request tries again rather than serving nulls until the file changes.
      key = null;
      text = '';
    }
    return text;
  };
}

// startApiService(opts) → Promise<{ url, port, close(): Promise<void> }>. Listens on 127.0.0.1:{port}
// and writes `api.json` once listening. Rejects with an error whose `code` is 'EADDRINUSE' when the
// port is taken and 'TEST_REAL' when the home is one the service must not serve (§2.8).
//
// `env` and `osHome` go to homeKind unaltered: it compares strings, so a normalised path here could
// read the real home as a scratch one and defeat the test-runner guard (FINDINGS 2026-09-30).
export function startApiService({
  env = process.env,
  osHome = userInfo().homedir,
  now = Date.now,
  port,
  pid = process.pid,
  reassertMs = 30_000,
} = {}) {
  return new Promise((resolve, reject) => {
    const kindPort = portFor(homeKind(env, osHome));
    // Refused even when a port was passed in: the guard protects the real `api.json` as much as the
    // real port, and an explicit port would otherwise walk a test straight past it.
    if (kindPort === null) {
      const err = new Error('refusing to start: the real home under the test runner, or no home set');
      err.code = 'TEST_REAL';
      reject(err);
      return;
    }

    const files = apiFiles(dirname(indexDir({ env })));
    const cachedText = usageCache(files.usage);
    const endpoints = {
      // Touches no file, so it answers whatever state usage.json is in (§2.1).
      '/health': () => healthBody({ pid }),
      '/v1/usage': () => usageBody(parseReading(cachedText(), now())),
    };

    // The request body is never read. Node discards what is left of it once the response is finished,
    // so a large POST costs nothing and the connection stays usable.
    const server = createServer((req, res) => {
      const { status, headers, body } = route({ method: req.method, url: req.url }, { endpoints });
      // An explicit length keeps the answer one plain, unchunked message for the simplest reader.
      res.writeHead(status, { ...headers, 'Content-Length': Buffer.byteLength(body) });
      res.end(body);
    });

    let recordText = '';
    // Best effort, and never a throw: with `~/.pir` unwritable the service still answers (§2.9), and
    // the timer below writes the file as soon as it can. A throw from the timer would kill the process.
    const assertDiscovery = () => {
      try {
        let current = null;
        try {
          current = readFileSync(files.discovery, 'utf8');
        } catch {
          // Missing or unreadable: rewritten below.
        }
        if (current !== recordText) writeFileAtomic(files.discovery, recordText);
      } catch {
        // Tried again at the next tick.
      }
    };

    let timer = null;
    let closing = null;
    const close = () => {
      closing ??= new Promise((done) => {
        clearInterval(timer);
        // Removed only when the file names this process: after a crash-and-restart race, or on a
        // scratch home, it may belong to a live service that is not this one.
        try {
          if (JSON.parse(readFileSync(files.discovery, 'utf8'))?.pid === pid) {
            rmSync(files.discovery, { force: true });
          }
        } catch {
          // Missing or not JSON: not ours to remove.
        }
        server.close(() => done());
        // close() alone waits for every keep-alive connection to go idle; a poller holding one open
        // would otherwise stall the exit until launchd's SIGKILL.
        server.closeAllConnections();
      });
      return closing;
    };

    // Until it is listening the only error is a failed bind: EADDRINUSE when the port is held.
    server.once('error', reject);
    // 127.0.0.1 only, never a routable address (§2.1).
    server.listen(port ?? kindPort, '127.0.0.1', () => {
      server.off('error', reject);
      // A listening server has no error worth dying for; without a listener one would be thrown.
      server.on('error', () => {});
      // The port actually bound: on a scratch home the OS chose it.
      const bound = server.address().port;
      const record = discoveryRecord({ port: bound, pid });
      recordText = `${JSON.stringify(record)}\n`;
      // Written only now, after the bind: a second service that cannot bind never touches the first
      // one's file.
      assertDiscovery();
      // "Keeps it current" must survive somebody deleting `~/.pir` (§2.6).
      timer = setInterval(assertDiscovery, reassertMs);
      timer.unref();
      resolve({ url: record.url, port: bound, close });
    });
  });
}

// main(opts) → the program: start, then stop cleanly on SIGTERM (launchd's bootout) or SIGINT.
// `opts` are startApiService's; the program itself passes none. It is exported so a test can run the
// exit paths in a child process with the port forced, without the program growing a port setting
// (a configurable port is out of scope, DESIGN §8).
export async function main(opts = {}) {
  let service;
  try {
    service = await startApiService(opts);
  } catch (err) {
    // Nothing printed: launchd keeps no log, and the code alone tells `pir service` the port is held.
    if (err?.code === 'EADDRINUSE') process.exit(EXIT_PORT_TAKEN);
    process.stderr.write(`pir api-service: ${err?.message ?? err}\n`);
    process.exit(1);
  }
  const stop = () => {
    service.close().then(
      () => process.exit(0),
      () => process.exit(0),
    );
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

// Run as a program, not imported. Node resolves symlinks for a module's own URL but leaves argv[1] as
// typed, so the two are compared as real paths: `/tmp` is a symlink on macOS, and `~/.claude` may be.
function isMain() {
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isMain()) main();
