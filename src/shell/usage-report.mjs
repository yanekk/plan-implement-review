// The run-side writer of subscription usage (plans/api-service DESIGN §2.4, §2.8, §3.4). Every session
// pir holds goes through startWorker (worker-proc.mjs), which hands each SDK message to the reporter
// built here; a `rate_limit_event` with a reading becomes `${PIR_HOME ?? HOME}/.pir/usage.json`, whole
// and temp-then-rename. The service (api-service.mjs) reads that file and the two never talk, so a run
// cannot be slowed or failed by the service. What counts as a reading and the file's text are
// src/core/usage.mjs; whether this process may write at all is homeKind (src/core/api.mjs).

import { userInfo } from 'node:os';
import { dirname } from 'node:path';
import { readingFromEvent, serializeReading } from '../core/usage.mjs';
import { apiFiles, homeKind } from '../core/api.mjs';
import { indexDir } from './index-store.mjs';
import { writeFileAtomic } from './atomic-write.mjs';

// The OS account's home as the user database has it, unaltered: homeKind compares strings, so a
// normalised or resolved spelling could read the real home as a scratch one (FINDINGS 2026-09-30).
// userInfo() throws when the uid has no entry (a bare container); undefined then makes homeKind answer
// 'test-real', so the reporter is off instead of startWorker failing on its default parameter.
function accountHome() {
  try {
    return userInfo().homedir;
  } catch {
    return undefined;
  }
}

// usageReporterFromEnv(env, { osHome, write }) → ((message, observedAt) => void) | null.
//
// null unless `env.PIR_RUN === '1'`, the switch `pir` sets on every run process it launches, and the
// home is 'real' or 'scratch' (§2.8). A unit test that calls startWorker directly, or a test process
// that forgot its scratch home, therefore writes nothing.
//
// The returned function never throws: a run never suffers for the service (§2.4). A missing `.pir` is
// created by the writer; every other failure (the home is a file, a full disk, no permission) is
// swallowed and the previous file stands. The write is synchronous on purpose: about 3 % of a worker's
// messages are usage events, and a synchronous whole-file rename is what keeps "newest wins by write
// order" true across several run processes.
export function usageReporterFromEnv(env, { osHome = accountHome(), write = writeFileAtomic } = {}) {
  if (env.PIR_RUN !== '1') return null;
  const kind = homeKind(env, osHome);
  if (kind !== 'real' && kind !== 'scratch') return null;
  // Resolved once, the way notify-config.mjs finds `.pir`, so the file sits beside the run index.
  const path = apiFiles(dirname(indexDir({ env }))).usage;
  return (message, observedAt) => {
    try {
      const reading = readingFromEvent(message, observedAt);
      // No reading (another message type, no unifiedWindows, no valid window): the last one stands.
      if (!reading) return;
      write(path, serializeReading(reading));
    } catch {
      // deliberately nothing: the reading is lost, the run is not
    }
  };
}

// defaultUsageReporter() → usageReporterFromEnv(process.env), computed once per process: it is
// startWorker's default parameter, evaluated on every call, and the answer cannot change while the
// process lives. Never throws, for the same reason the reporter does not.
let cached;
export function defaultUsageReporter() {
  if (cached === undefined) {
    try {
      cached = usageReporterFromEnv(process.env);
    } catch {
      cached = null;
    }
  }
  return cached;
}
