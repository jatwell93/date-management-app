const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  BASELINE,
  globToRegExp,
  parseNoGo,
  patternsFor,
  findMatches,
  main,
} = require('./check-no-go.js');

const PROPOSAL = [
  '# Proposal',
  '',
  '## Autonomy',
  '',
  '```yaml',
  'merge: human',
  'no_go:',
  '  - frontend/src/legacy/** # retired screens',
  "  - 'workers/wrangler.toml'",
  'other: x',
  '```',
].join('\n');

function tempRoot(changes) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'no-go-'));
  for (const [id, body] of Object.entries(changes)) {
    fs.mkdirSync(path.join(root, 'openspec', 'changes', id), { recursive: true });
    fs.writeFileSync(path.join(root, 'openspec', 'changes', id, 'proposal.md'), body);
  }
  return root;
}

function fakeIo({ diff = '', files = '' } = {}) {
  const out = { log: [], error: [], gitArgs: null };
  return {
    out,
    readFile: () => files,
    git: (args) => {
      out.gitArgs = args;
      return diff;
    },
    log: (s) => out.log.push(s),
    error: (s) => out.error.push(s),
  };
}

test('globToRegExp: ** spans directories, * stays inside one segment', () => {
  assert.ok(globToRegExp('.github/**').test('.github/workflows/factory.yml'));
  assert.ok(globToRegExp('scripts/*.sh').test('scripts/database-backup.sh'));
  assert.ok(!globToRegExp('scripts/*.sh').test('scripts/sub/x.sh'));
  assert.ok(globToRegExp('AGENTS.md').test('AGENTS.md'));
  assert.ok(!globToRegExp('AGENTS.md').test('docs/AGENTS.md'));
  assert.ok(!globToRegExp('AGENTS.md').test('AGENTSxmd'), 'a dot is literal');
});

test('parseNoGo reads the Autonomy yaml list, dropping comments and quotes', () => {
  assert.deepEqual(parseNoGo(PROPOSAL), ['frontend/src/legacy/**', 'workers/wrangler.toml']);
  assert.deepEqual(parseNoGo('# Proposal\n\nno Autonomy block'), []);
  assert.deepEqual(parseNoGo(PROPOSAL.replace(/\n/g, '\r\n')), [
    'frontend/src/legacy/**',
    'workers/wrangler.toml',
  ]);
});

test('patternsFor adds the change list to the baseline and never drops it', () => {
  const root = tempRoot({ shrink: PROPOSAL });
  const patterns = patternsFor('shrink', root);
  for (const p of BASELINE) assert.ok(patterns.includes(p), `baseline ${p} kept`);
  assert.ok(patterns.includes('frontend/src/legacy/**'));
  assert.deepEqual(patternsFor('', root), BASELINE);
  assert.deepEqual(patternsFor('missing-change', root), BASELINE);
});

test('findMatches reports protected paths only, once each', () => {
  const m = findMatches(
    [
      'frontend/src/App.tsx',
      '.claude/skills/run-spec/SKILL.md',
      '.claude/skills/run-spec/SKILL.md',
      '',
    ],
    BASELINE,
  );
  assert.deepEqual(m, [{ path: '.claude/skills/run-spec/SKILL.md', pattern: '.claude/**' }]);
});

test('diff mode diffs the merge base with --no-renames and passes clean branches', () => {
  const io = fakeIo({ diff: 'scripts/route-map.js\nscripts/route-map.test.js\n' });
  assert.equal(main([], io, tempRoot({})), 0);
  assert.deepEqual(io.out.gitArgs, ['diff', '--name-only', '--no-renames', 'origin/main...HEAD']);
});

test('a rename out of a protected path still fails (both sides are listed)', () => {
  const io = fakeIo({ diff: '.claude/skills/run-spec/SKILL.md\ndocs/run-spec.md\n' });
  assert.equal(main([], io, tempRoot({})), 1);
  assert.match(io.out.log.join('\n'), /^\.claude\/skills\/run-spec\/SKILL\.md\t/);
});

test('a change whose own list omits .github/** still fails on a workflow edit', () => {
  const root = tempRoot({ pilot: PROPOSAL });
  const io = fakeIo({ files: '.github/workflows/factory.yml\nfrontend/src/legacy/Old.tsx\n' });
  assert.equal(main(['--change', 'pilot', '--files', 'list.txt'], io, root), 1);
  assert.deepEqual(
    io.out.log.map((l) => l.split('\t')[0]),
    ['.github/workflows/factory.yml', 'frontend/src/legacy/Old.tsx'],
  );
});

test('bad arguments print usage and exit 2', () => {
  const io = fakeIo();
  assert.equal(main(['--change'], io, tempRoot({})), 2);
  assert.equal(main(['--bogus', 'x'], io, tempRoot({})), 2);
  assert.match(io.out.error[0], /^usage:/);
});
