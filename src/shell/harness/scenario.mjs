// The scenario spec (DESIGN §4.1, T15): a scenario's expected behaviour turned into checkable data.
// A spec names the scenario, the fixture it runs (a scratch plan the T16 fixtures produce), the
// seatbelts the live runner (T17) must apply (§5.2), and the FACTS the run must show — pure predicates
// over a captured bundle (assertions.mjs). checkScenario(spec, bundle) runs those facts and returns a
// verdict; the runner never decides pass/fail itself, it declares facts here and the data answers.
//
// This module is pure spec plumbing (no clock, no I/O, no live agent — DESIGN §3.1): it only shapes
// and validates a spec object. Running the facts is assertions.checkScenario; producing the bundle is
// the T17 live runner; building the fixture a spec points at is T16.

// The seatbelt defaults every live scenario inherits unless it overrides them (§5.2). Kept low on
// purpose: a scenario spawns real paid agents, so the ceiling is the smallest the scenario needs and a
// wall-clock timeout auto-touches HALT so a hung real worker cannot run — or cost — unboundedly. The
// kill switch is always wired. The T17 runner reads these; nothing here acts on them.
export const DEFAULT_SEATBELTS = Object.freeze({
  ceiling: 1, // the smallest ceiling; a parallel scenario raises it deliberately
  timeoutMs: 10 * 60 * 1000, // 10 min wall-clock cap → auto-HALT
  killSwitch: true, // the HALT control flag is always available
});

// defineScenario(spec) → a normalized, validated scenario spec. Throws on the mistakes that would make
// a scenario meaningless: no id, no fixture, or no facts (a scenario that asserts nothing proves
// nothing). facts are Fact objects from assertions.mjs — each `{ id, label, check }`; this module does
// not run them, so it only checks they are shaped like a fact (a callable `check`).
export function defineScenario(spec = {}) {
  const { id, title, fixture, seatbelts = {}, facts = [] } = spec;

  if (!id || typeof id !== 'string') {
    throw new Error('defineScenario: a scenario needs a string id');
  }
  if (!fixture) {
    throw new Error(`defineScenario(${id}): a scenario needs a fixture reference`);
  }
  if (!Array.isArray(facts) || facts.length === 0) {
    throw new Error(`defineScenario(${id}): a scenario must declare at least one fact`);
  }
  for (const f of facts) {
    if (!f || typeof f.check !== 'function') {
      throw new Error(`defineScenario(${id}): every fact must be a { id, label, check } from assertions.mjs`);
    }
  }

  return {
    id,
    title: title ?? id,
    fixture,
    // Explicit override wins per field; the rest fall back to the low defaults.
    seatbelts: { ...DEFAULT_SEATBELTS, ...seatbelts },
    facts,
  };
}
