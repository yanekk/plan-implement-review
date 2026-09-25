// What the person tells pir (DESIGN §2.5, §2.6). Pure: it validates one inbox drop and holds the
// rules of the per-worker "do not ask this worker again" grant list. The forwarder (T07) and the
// conversation view (T13) both use it, so the rules live once.
//
// Grant matching follows Claude's own permission-rule form, as documented at
// https://code.claude.com/docs/en/permissions (§ Wildcard patterns, § Compound commands; read
// 2026-09-25). pir's matcher is a deliberate subset of Claude's: wherever Claude would need machinery
// pir does not have (splitting a compound command, checking a redirect target against Edit rules,
// stripping `timeout`/`nice`/env-assignment wrappers, gitignore-style path globs), pir does not match
// and the request goes to the person. So pir may ask where Claude would not, and never allows by grant
// where Claude's rule would not. Asking is the safe side: the person sees the request and answers it.
//
// Bash (`ruleContent` matched against `input.command`, whole text):
// - `*` stands in for any text, at any position; everything else is literal.
// - A trailing ` *` that is the rule's only wildcard also matches the bare command: `npm test *`
//   matches `npm test`. The space is part of the rule, so it does not match `npm testx`.
// - A trailing `:*` is the same as ` *` (`npm test:*` ≡ `npm test *`); a `:*` anywhere else is literal.
// - No `*` means exact: `touch a.txt` matches `touch a.txt` only.
// - A command holding a shell separator (`&&`, `||`, `;`, `|`, `&`, newline), a command substitution
//   (`$(`, backtick) or a redirect other than to /dev/null or `2>&1` never matches: Claude splits or
//   extra-checks those, pir does not.
// Other tools: a rule with no `ruleContent` matches every request of that tool (Claude's bare tool
// rule); `WebFetch` `domain:<host>` matches the URL's hostname exactly, case-insensitive, no wildcard;
// any other `ruleContent` must equal the tool's primary field (file_path, path, notebook_path, url),
// reading its anchor as Claude does (§ Read and Edit): `//path` names `/path`; a `/path` (relative to the
// settings source) or `~/path` rule never matches, since pir does not know those roots.

const KINDS = ['message', 'interrupt', 'permission', 'answers', 'decline-questions'];
const DECISIONS = ['allow', 'deny', 'allow-always'];

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const nonEmpty = (v) => typeof v === 'string' && v.trim() !== '';

// validateDrop(obj) → { ok: true, input } | { ok: false, error }. `obj` is one parsed inbox drop
// (DESIGN §2.5). The normalised input keeps only the fields its kind defines. Never throws.
export function validateDrop(obj) {
  if (!isObject(obj)) return fail('a drop must be a JSON object');
  if (!nonEmpty(obj.to)) return fail('missing `to`: the worker the input is for');
  if (!KINDS.includes(obj.kind)) return fail(`unknown kind ${JSON.stringify(obj.kind)}; expected one of ${KINDS.join(', ')}`);
  const base = { to: obj.to, kind: obj.kind };
  switch (obj.kind) {
    case 'message':
      if (!nonEmpty(obj.text)) return fail('a message needs non-empty `text`');
      return ok({ ...base, text: obj.text });
    case 'interrupt':
      return ok(base);
    case 'permission': {
      if (!nonEmpty(obj.requestId)) return fail('missing `requestId`');
      if (!DECISIONS.includes(obj.decision)) return fail(`unknown decision ${JSON.stringify(obj.decision)}; expected one of ${DECISIONS.join(', ')}`);
      const input = { ...base, requestId: obj.requestId, decision: obj.decision };
      // A refusal may carry the person's typed reply as its message (DESIGN §2.6).
      if (obj.text !== undefined) {
        if (typeof obj.text !== 'string') return fail('`text` must be a string');
        if (obj.decision !== 'deny') return fail('only a `deny` carries `text`');
        input.text = obj.text;
      }
      return ok(input);
    }
    case 'answers': {
      if (!nonEmpty(obj.requestId)) return fail('missing `requestId`');
      if (!isObject(obj.answers)) return fail('`answers` must be an object of question → label');
      for (const [q, a] of Object.entries(obj.answers)) {
        if (typeof a !== 'string') return fail(`the answer to ${JSON.stringify(q)} must be a string`);
      }
      return ok({ ...base, requestId: obj.requestId, answers: { ...obj.answers } });
    }
    case 'decline-questions':
      if (!nonEmpty(obj.requestId)) return fail('missing `requestId`');
      if (typeof obj.text !== 'string') return fail('a decline-questions needs `text`');
      return ok({ ...base, requestId: obj.requestId, text: obj.text });
  }
}

const ok = (input) => ({ ok: true, input });
const fail = (error) => ({ ok: false, error });

// ---- The grant list (DESIGN §2.6). One list per worker, held by the coordinator in memory. ----

// grantFrom(request) → Grant | null. `request` is a permission request as stream.mjs reads it
// (`toolName`, `input`, `suggestions`, `suppressAlwaysAllowRule`). The grant is the allow `addRules`
// Claude itself suggested, every rule of it; other suggestion types (`setMode`, `addDirectories`) are
// never taken. null — and so no `a` key — when there is no such suggestion, or when Claude flagged
// that the rule would grant more than this request (`suppressAlwaysAllowRule`).
// Grant = { rules: [{ toolName, ruleContent? }] }
export function grantFrom(request) {
  if (!isObject(request) || request.suppressAlwaysAllowRule === true) return null;
  const suggestions = Array.isArray(request.suggestions) ? request.suggestions : [];
  const rules = [];
  for (const s of suggestions) {
    if (!isObject(s) || s.type !== 'addRules' || s.behavior !== 'allow' || !Array.isArray(s.rules)) continue;
    for (const r of s.rules) {
      if (!isObject(r) || !nonEmpty(r.toolName)) continue;
      if (r.ruleContent !== undefined && typeof r.ruleContent !== 'string') continue;
      rules.push(r.ruleContent === undefined ? { toolName: r.toolName } : { toolName: r.toolName, ruleContent: r.ruleContent });
    }
  }
  return rules.length ? { rules } : null;
}

// grantMatches(grant, request) → true when one of the grant's rules covers the request.
export function grantMatches(grant, request) {
  if (!isObject(grant) || !Array.isArray(grant.rules) || !isObject(request)) return false;
  const input = isObject(request.input) ? request.input : {};
  return grant.rules.some((r) => isObject(r) && r.toolName === request.toolName && ruleMatches(r, input));
}

// decidePermission(grants, request) → 'allow-by-grant' | 'ask'.
export function decidePermission(grants, request) {
  return Array.isArray(grants) && grants.some((g) => grantMatches(g, request)) ? 'allow-by-grant' : 'ask';
}

const PRIMARY_FIELD = { Read: 'file_path', Edit: 'file_path', Write: 'file_path', NotebookEdit: 'notebook_path', Grep: 'path', Glob: 'path', WebFetch: 'url' };

function ruleMatches(rule, input) {
  const content = rule.ruleContent;
  // A bare tool rule, or `Bash(*)`, which Claude treats as the same.
  if (content === undefined || (rule.toolName === 'Bash' && content === '*')) {
    return rule.toolName !== 'Bash' || commandIsSimple(input.command);
  }
  if (rule.toolName === 'Bash') return typeof input.command === 'string' && bashMatches(content, input.command);
  if (rule.toolName === 'WebFetch' && content.startsWith('domain:')) {
    const host = hostname(input.url);
    return host !== null && !content.includes('*') && host === content.slice('domain:'.length).toLowerCase().replace(/\.$/, '');
  }
  const field = PRIMARY_FIELD[rule.toolName];
  return field !== undefined && typeof input[field] === 'string' && input[field] === pathRuleTarget(content);
}

// The literal path a path rule names, or null when its anchor is one pir cannot resolve. Claude reads
// `//path` as absolute, `/path` as relative to the settings source and `~/path` as relative to home;
// only the first names a path pir can compare. A plain `path` is relative to the working directory.
function pathRuleTarget(content) {
  if (content.startsWith('//')) return content.slice(1);
  if (content.startsWith('/') || content.startsWith('~')) return null;
  return content;
}

function bashMatches(pattern, command) {
  if (!commandIsSimple(command)) return false;
  if (pattern.endsWith(':*')) pattern = pattern.slice(0, -2) + ' *';
  const stars = pattern.split('*').length - 1;
  if (stars === 0) return command === pattern;
  // A trailing ` *` that is the only wildcard also matches the bare command (`npm test *` ↔ `npm test`).
  if (stars === 1 && pattern.endsWith(' *') && command === pattern.slice(0, -2)) return true;
  const re = new RegExp('^' + pattern.split('*').map(escapeRegExp).join('[\\s\\S]*') + '$');
  return re.test(command);
}

// A command pir can match whole: no separator, no substitution, no redirect beyond the harmless ones.
function commandIsSimple(command) {
  if (typeof command !== 'string') return false;
  // Each harmless redirect must end the word: bash reads `>&1foo` as a write to the file `1foo`, and
  // `/dev/null.txt` is a path of its own.
  const rest = command.replace(/\s*\d?>&1(?!\S)/g, ' ').replace(/\s*\d?>>?\s*\/dev\/null(?!\S)/g, ' ');
  return !/[;&|<>`\n\r]|\$\(/.test(rest);
}

function hostname(url) {
  if (typeof url !== 'string') return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return null;
  }
}

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
