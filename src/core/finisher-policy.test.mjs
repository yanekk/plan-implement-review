import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PHASES, LOOK_ONLY, isLookOnly, finisherVerdict, readStatus, checkStatus, isGoAnswer, afterRestart,
  RESTARTED_MID_FINISH, chooseRules, finisherServes,
} from './finisher-policy.mjs';

// ---- isLookOnly ----

// One command per LOOK_ONLY entry, in the list's order, so a new entry without an example fails here.
const EXAMPLES = {
  'git status': 'git status --short',
  'git log': 'git log --oneline -5 main..pir/x',
  'git diff': 'git diff --stat main...pir/x',
  'git show': 'git show HEAD:src/a.mjs',
  'git rev-parse': 'git rev-parse --abbrev-ref HEAD',
  'git merge-base': 'git merge-base --is-ancestor pir/x main',
  'git merge-tree': 'git merge-tree --write-tree main pir/x',
  'git branch (listing)': 'git branch --list',
  'git remote -v': 'git remote -v',
  'git worktree list': 'git worktree list --porcelain',
  'git ls-files': 'git ls-files src',
  'git ls-tree': 'git ls-tree -r HEAD',
  'git cat-file': 'git cat-file -p HEAD',
  ls: 'ls -la',
  cat: 'cat README.md',
  head: 'head -n 5 a',
  tail: 'tail -n 5 a',
  wc: 'wc -l a',
  grep: 'grep -rn "on-finish" src',
  diff: 'diff -r a b',
  cmp: 'cmp a b',
  shasum: 'shasum -a 256 a',
  test: 'test -f ~/.pir/notify.json',
  '[': '[ -d src ]',
  which: 'which node',
  pwd: 'pwd',
  echo: 'echo hello',
  'command -v': 'command -v gh',
  'node --version': 'node --version',
  'npm --version': 'npm --version',
  'gh auth status': 'gh auth status',
  'gh pr list': 'gh pr list --head pir/x',
  'gh pr view': 'gh pr view 12',
  'cd <path>': 'cd /repo',
};

test('isLookOnly: every LOOK_ONLY entry has an accepted example', () => {
  assert.deepEqual(LOOK_ONLY.map((e) => e.name), Object.keys(EXAMPLES));
  for (const [name, cmd] of Object.entries(EXAMPLES)) assert.equal(isLookOnly(cmd), true, `${name}: ${cmd}`);
});

test('isLookOnly: commands that act are rejected', () => {
  for (const cmd of ['git merge pir/x', 'git commit -m x', 'git push', 'rm a', 'npm i', './install.sh',
    'npm test', 'node x.mjs', 'command rm a', 'tee b', 'git remote add o u', 'git worktree add x', 'cd a b']) {
    assert.equal(isLookOnly(cmd), false, cmd);
  }
});

test('isLookOnly: redirects, pipes into actors, chains and substitutions are rejected', () => {
  for (const cmd of ['git status > x', 'git log >> x', 'git status 2>&1', 'ls &> x', 'cat a <> b', 'cat a | tee b',
    'ls; git merge x', 'ls && rm a', 'ls & rm a', 'ls || git push', 'ls\ngit merge x',
    'echo $(git merge x)', 'echo `rm -rf /`', 'echo $(echo $(rm x))', 'echo $((1+2))', 'echo "$(rm x)"',
    'diff <(ls) x', 'diff x >(cat)', 'echo $(ls', 'echo `ls', "echo 'unclosed",
    'GIT_EXTERNAL_DIFF=x git diff', 'ls && PAGER=sh git log', '(rm a)', '$X status', '']) {
    assert.equal(isLookOnly(cmd), false, JSON.stringify(cmd));
  }
  assert.equal(isLookOnly(undefined), false);
  assert.equal(isLookOnly(42), false);
});

test('isLookOnly: look-only pipes, chains and substitutions are accepted; quoted > is literal', () => {
  for (const cmd of ['git log --oneline | head -3', 'cd /repo && git status', 'echo $(git rev-parse HEAD)',
    'echo `pwd`', 'git log --format="%h > %s"', "grep '=>' src/a.mjs", 'ls; pwd', 'cat a | grep b | wc -l',
    'echo "$(git rev-parse HEAD)"', 'cat < a']) {
    assert.equal(isLookOnly(cmd), true, cmd);
  }
});

test('isLookOnly: git branch only in its listing forms', () => {
  for (const cmd of ['git branch', 'git branch --list', 'git branch -a -v', 'git branch --show-current',
    'git branch --contains abc123', 'git branch --contains=abc123', 'git branch --list "pir/*"']) {
    assert.equal(isLookOnly(cmd), true, cmd);
  }
  for (const cmd of ['git branch -D x', 'git branch newname', 'git branch -d x', 'git branch -m a b',
    'git branch --list -D x', 'git branch -f x HEAD']) {
    assert.equal(isLookOnly(cmd), false, cmd);
  }
});

test('isLookOnly: git -C is allowed, other git global options and writing options are not', () => {
  for (const cmd of ['git -C /repo status', 'git -C "/my repo" log -1', 'git -C /a -C b status', 'git log -c']) {
    assert.equal(isLookOnly(cmd), true, cmd);
  }
  for (const cmd of ['git -C /repo merge x', 'git -c core.pager=x log', 'git --exec-path=/x status',
    'git --git-dir=/x status', 'git -C', 'git -C /repo', 'git log --output=f', 'git show --output f',
    'git diff --ext-diff', 'git']) {
    assert.equal(isLookOnly(cmd), false, cmd);
  }
});

// Review T01: a git option can arrive through an expansion the word check never sees, and it runs as
// written (`git log $(echo --output=/tmp/x) -1` wrote /tmp/x, reproduced 2026-09-29). Any unquoted `$`,
// substitution or brace expansion in a git part is refused; other look-only commands keep them.
test('isLookOnly: a git option smuggled in through an expansion is rejected', () => {
  for (const cmd of ['git log $(echo --output=/tmp/x) -1', 'git diff `echo --ext-diff`',
    'git -C $(echo /repo -c core.pager=x) log', 'git log ${X:=--output=/tmp/x}', "git log $'--output=/tmp/x'",
    'echo --output=/tmp/x; git log $_', 'git log {--output=/tmp/x,-1}', 'git diff --ext-{diff,diff}',
    'git log {--output=/tmp/x..y}', 'git branch --list $(echo -D) x', 'git log "$(echo --output=/tmp/x)"']) {
    assert.equal(isLookOnly(cmd), false, cmd);
  }
  for (const cmd of ['ls $(pwd)', 'cat "$(git rev-parse --show-toplevel)/a"', 'git rev-parse HEAD@{1}',
    'git log main@{upstream}..HEAD', "git log --grep='$x'", 'cd $HOME && git status']) {
    assert.equal(isLookOnly(cmd), true, cmd);
  }
});

// ---- finisherVerdict ----

const TOOLS = {
  Read: { file_path: '/repo/a' },
  Glob: { pattern: '*' },
  Grep: { pattern: 'x' },
  Write: { file_path: '/ctl/finisher/status/1.json', content: '{}' },
  Skill: { skill: 'pir-finisher' },
};

test('finisherVerdict: look-only phases', () => {
  for (const phase of ['preparing', 'awaiting-go', 'stuck']) {
    for (const [toolName, input] of Object.entries(TOOLS)) {
      assert.equal(finisherVerdict({ phase, toolName, input, fileVerdict: 'allow' }), 'allow', `${phase} ${toolName}`);
      assert.equal(finisherVerdict({ phase, toolName, input, fileVerdict: 'deny' }), 'deny', `${phase} ${toolName}`);
      assert.equal(finisherVerdict({ phase, toolName, input }), 'deny', `${phase} ${toolName} no fileVerdict`);
    }
    assert.equal(finisherVerdict({ phase, toolName: 'Bash', input: { command: 'git status' } }), 'allow');
    assert.equal(finisherVerdict({ phase, toolName: 'Bash', input: { command: 'git merge pir/x' } }), 'deny');
    assert.equal(finisherVerdict({ phase, toolName: 'Bash', input: {} }), 'deny');
    assert.equal(finisherVerdict({ phase, toolName: 'Edit', input: { file_path: '/repo/a' }, fileVerdict: 'allow' }), 'deny');
    assert.equal(finisherVerdict({ phase, toolName: 'AskUserQuestion', input: { questions: [] } }), 'person');
    assert.equal(finisherVerdict({ phase, toolName: 'WebFetch', input: { url: 'https://x' }, fileVerdict: 'allow' }), 'deny');
  }
});

test('finisherVerdict: finishing allows all but reserved requests and questions', () => {
  const phase = 'finishing';
  for (const [toolName, input] of Object.entries(TOOLS)) {
    assert.equal(finisherVerdict({ phase, toolName, input, fileVerdict: 'deny' }), 'allow', toolName);
  }
  assert.equal(finisherVerdict({ phase, toolName: 'Bash', input: { command: 'git status' } }), 'allow');
  assert.equal(finisherVerdict({ phase, toolName: 'Bash', input: { command: 'git merge pir/x' } }), 'allow');
  assert.equal(finisherVerdict({ phase, toolName: 'Bash', input: { command: 'rm -rf build' } }), 'person');
  assert.equal(finisherVerdict({ phase, toolName: 'Bash', input: { command: 'git push origin main' }, askRules: ['Bash(git push:*)'] }), 'person');
  assert.equal(finisherVerdict({ phase, toolName: 'Bash', input: { command: 'git push origin main' }, askRules: [] }), 'allow');
  assert.equal(finisherVerdict({ phase, toolName: 'Edit', input: { file_path: '/repo/a' } }), 'allow');
  assert.equal(finisherVerdict({ phase, toolName: 'WebFetch', input: { url: 'https://x' } }), 'allow');
  assert.equal(finisherVerdict({ phase, toolName: 'AskUserQuestion', input: { questions: [] } }), 'person');
  assert.equal(finisherVerdict({ phase, toolName: 'WebFetch', input: { url: 'https://x' }, askRules: ['WebFetch'] }), 'person');
});

test('finisherVerdict: done and unknown phases deny everything', () => {
  for (const phase of ['done', 'bogus', undefined]) {
    for (const [toolName, input] of Object.entries({ ...TOOLS, Bash: { command: 'git status' }, Edit: {}, AskUserQuestion: {}, WebFetch: {} })) {
      assert.equal(finisherVerdict({ phase, toolName, input, fileVerdict: 'allow' }), 'deny', `${phase} ${toolName}`);
    }
  }
});

// ---- readStatus ----

test('readStatus: each valid shape, normalised to its own fields', () => {
  assert.deepEqual(readStatus({ kind: 'ready', rules: '/r.md', summary: 's', steps: ['git merge pir/x'], extra: 1 }),
    { ok: true, status: { kind: 'ready', rules: '/r.md', summary: 's', steps: ['git merge pir/x'] } });
  assert.deepEqual(readStatus({ kind: 'stuck', summary: 's', proposal: 'retry', steps: ['./install.sh'] }),
    { ok: true, status: { kind: 'stuck', summary: 's', proposal: 'retry', steps: ['./install.sh'] } });
  assert.deepEqual(readStatus({ kind: 'done', summary: 'merged' }), { ok: true, status: { kind: 'done', summary: 'merged' } });
  assert.deepEqual(readStatus({ kind: 'close', reason: 'not today' }), { ok: true, status: { kind: 'close', reason: 'not today' } });
});

test('readStatus: refused shapes', () => {
  for (const obj of [null, [], 'ready', {}, { kind: 'nope' },
    { kind: 'ready', summary: 's', steps: ['a'] }, { kind: 'ready', rules: 'r', steps: ['a'] },
    { kind: 'ready', rules: 'r', summary: 's', steps: [] }, { kind: 'ready', rules: 'r', summary: 's' },
    { kind: 'ready', rules: 'r', summary: 's', steps: ['a', 3] }, { kind: 'ready', rules: 'r', summary: 's', steps: [' '] },
    { kind: 'stuck', summary: 's', steps: ['a'] }, { kind: 'stuck', summary: 's', proposal: 'p', steps: [] },
    { kind: 'done' }, { kind: 'done', summary: '' }, { kind: 'close' }]) {
    const r = readStatus(obj);
    assert.equal(r.ok, false, JSON.stringify(obj));
    assert.equal(typeof r.why, 'string');
  }
});

// ---- checkStatus ----

test('checkStatus: the whole accepted-in-phase table', () => {
  const table = {
    ready: { preparing: 'awaiting-go', 'awaiting-go': 'awaiting-go' },
    stuck: { finishing: 'stuck', 'awaiting-go': 'stuck' },
    done: { finishing: 'done' },
    close: { preparing: 'preparing', 'awaiting-go': 'awaiting-go', finishing: 'finishing', stuck: 'stuck', done: 'done' },
  };
  for (const [kind, accepted] of Object.entries(table)) {
    for (const phase of PHASES) {
      const r = checkStatus({ kind }, phase);
      if (phase in accepted) assert.deepEqual(r, { ok: true, next: accepted[phase] }, `${kind} in ${phase}`);
      else {
        assert.equal(r.ok, false, `${kind} in ${phase}`);
        assert.match(r.why, new RegExp(phase));
      }
    }
  }
  assert.equal(checkStatus({ kind: 'done' }, 'awaiting-go').ok, false);
  assert.equal(checkStatus({ kind: 'nope' }, 'preparing').ok, false);
  assert.equal(checkStatus({ kind: 'close' }, 'bogus').ok, false);
});

// ---- isGoAnswer ----

const Q = 'Run the 2 steps from project rules?';
const goInput = { questions: [{ question: Q, header: 'Go', options: [{ label: 'Go' }, { label: 'Not yet' }] }] };
const go = (over = {}) => ({ phase: 'awaiting-go', toolName: 'AskUserQuestion', input: goInput, answers: { [Q]: 'Go' }, ...over });

test('isGoAnswer: Go in awaiting-go and stuck', () => {
  assert.equal(isGoAnswer(go()), true);
  assert.equal(isGoAnswer(go({ phase: 'stuck' })), true);
});

test('isGoAnswer: everything else is not the go', () => {
  for (const phase of ['preparing', 'finishing', 'done', undefined]) assert.equal(isGoAnswer(go({ phase })), false, phase);
  assert.equal(isGoAnswer(go({ answers: { [Q]: 'Not yet' } })), false);
  assert.equal(isGoAnswer(go({ answers: { [Q]: 'go' } })), false);
  assert.equal(isGoAnswer(go({ answers: { other: 'Go' } })), false);
  assert.equal(isGoAnswer(go({ answers: undefined })), false);
  assert.equal(isGoAnswer(go({ input: { questions: [{ ...goInput.questions[0], header: 'go' }] } })), false);
  assert.equal(isGoAnswer(go({ input: { questions: [goInput.questions[0], { question: 'b', header: 'Go' }] } })), false);
  assert.equal(isGoAnswer(go({ input: { questions: [] } })), false);
  assert.equal(isGoAnswer(go({ toolName: 'Bash' })), false);
  assert.equal(isGoAnswer(), false);
});

// ---- afterRestart ----

test('afterRestart: finishing drops to stuck; others kept; unknown reads as preparing', () => {
  assert.deepEqual(afterRestart('finishing'), { phase: 'stuck', stuckSummary: RESTARTED_MID_FINISH });
  for (const phase of ['preparing', 'awaiting-go', 'stuck', 'done']) assert.deepEqual(afterRestart(phase), { phase, stuckSummary: null });
  assert.deepEqual(afterRestart(undefined), { phase: 'preparing', stuckSummary: null });
  assert.deepEqual(afterRestart('bogus'), { phase: 'preparing', stuckSummary: null });
});

test('finisherServes: only a run whose base is main gets a finisher', () => {
  assert.equal(finisherServes('main'), true);
  for (const base of ['dev', 'master', '', null, undefined]) assert.equal(finisherServes(base), false, String(base));
});

// ---- chooseRules ----

const base = { featurePath: '/w/feat', home: '/h', repo: 'proj', engineDir: '/h/.claude/pir-engine' };
const P = {
  project: '/w/feat/.pir/rules/on-finish.md',
  yours: '/h/.pir/proj/rules/on-finish.md',
  default: '/h/.pir/default/rules/on-finish.md',
  'built-in': '/h/.claude/pir-engine/rules/default/on-finish.md',
};
const having = (...paths) => (p) => paths.includes(p);

test('chooseRules: each of the four outcomes, first existing wins', () => {
  assert.deepEqual(chooseRules({ ...base, exists: having(P.project, P.yours, P.default) }), { path: P.project, source: 'project' });
  assert.deepEqual(chooseRules({ ...base, exists: having(P.yours, P.default) }), { path: P.yours, source: 'yours' });
  assert.deepEqual(chooseRules({ ...base, exists: having(P.default) }), { path: P.default, source: 'default' });
  assert.deepEqual(chooseRules({ ...base, exists: having() }), { path: P['built-in'], source: 'built-in' });
});

test('chooseRules: a project file wins over an existing personal one; a repo path is reduced to its name', () => {
  assert.equal(chooseRules({ ...base, exists: having(P.project, P.yours) }).source, 'project');
  assert.deepEqual(chooseRules({ ...base, repo: '/src/proj', exists: having(P.yours) }), { path: P.yours, source: 'yours' });
});
