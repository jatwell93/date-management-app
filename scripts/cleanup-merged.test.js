const test = require('node:test');
const assert = require('node:assert/strict');

const { parseBranches, parseWorktrees, plan, main } = require('./cleanup-merged.js');

const BRANCHES = [
  'main\torigin/main\t',
  'feature/merged\torigin/feature/merged\t[gone]',
  'feature/open\torigin/feature/open\t[ahead 1]',
  'feature/local-only\t\t',
  'feature/in-worktree\torigin/feature/in-worktree\t[gone]',
  'feature/dirty-wt\torigin/feature/dirty-wt\t[gone]',
].join('\n');

const WORKTREES = [
  'worktree C:/repo\nHEAD aaa\nbranch refs/heads/main',
  'worktree C:/repo/.claude/worktrees/agent-1\nHEAD bbb\nbranch refs/heads/feature/in-worktree\nlocked claude agent',
  'worktree C:/repo/.claude/worktrees/agent-2\nHEAD ccc\nbranch refs/heads/feature/dirty-wt',
  'worktree C:/repo/.claude/worktrees/agent-3\nHEAD ddd\ndetached',
].join('\n\n');

test('parseBranches marks only [gone] upstreams', () => {
  const b = parseBranches(BRANCHES);
  assert.deepEqual(
    b.filter((x) => x.gone).map((x) => x.name),
    ['feature/merged', 'feature/in-worktree', 'feature/dirty-wt'],
  );
  assert.equal(b.find((x) => x.name === 'feature/local-only').upstream, '');
});

test('parseWorktrees reads path, branch, lock, and which entry is the main checkout', () => {
  const w = parseWorktrees(WORKTREES);
  assert.equal(w.length, 4);
  assert.equal(w[0].main, true);
  assert.equal(w[1].locked, true);
  assert.equal(w[1].branch, 'feature/in-worktree');
  assert.equal(w[3].branch, null);
});

test('plan deletes gone branches, keeps open, local-only and dirty ones', () => {
  const { actions, kept } = plan({
    branches: parseBranches(BRANCHES),
    worktrees: parseWorktrees(WORKTREES),
    current: 'main',
    dirty: new Set(['C:/repo/.claude/worktrees/agent-2']),
  });
  assert.deepEqual(actions, [
    { type: 'remove-worktree', path: 'C:/repo/.claude/worktrees/agent-1', locked: true },
    { type: 'delete-branch', branch: 'feature/merged' },
    { type: 'delete-branch', branch: 'feature/in-worktree' },
    { type: 'prune-worktrees' },
  ]);
  assert.deepEqual(kept, [
    {
      branch: 'feature/dirty-wt',
      reason: 'worktree C:/repo/.claude/worktrees/agent-2 has uncommitted changes',
    },
  ]);
});

test('a merged current branch is left for main first, unless the checkout is dirty', () => {
  const base = {
    branches: parseBranches(BRANCHES),
    worktrees: parseWorktrees('worktree C:/repo\nHEAD a\nbranch refs/heads/feature/merged'),
  };
  const clean = plan({ ...base, current: 'feature/merged', dirty: new Set() });
  assert.deepEqual(clean.actions[0], { type: 'switch-to-main', from: 'feature/merged' });
  assert.ok(clean.actions.some((a) => a.type === 'delete-branch' && a.branch === 'feature/merged'));

  const dirty = plan({ ...base, current: 'feature/merged', dirty: new Set(['C:/repo']) });
  assert.ok(!dirty.actions.some((a) => a.type === 'switch-to-main'));
  assert.ok(!dirty.actions.some((a) => a.branch === 'feature/merged'));
  assert.equal(dirty.kept[0].branch, 'feature/merged');
});

test('main and master are never deleted, even if their upstream is gone', () => {
  const { actions } = plan({
    branches: parseBranches('main\torigin/main\t[gone]\nmaster\torigin/master\t[gone]'),
    worktrees: parseWorktrees('worktree C:/repo\nHEAD a\nbranch refs/heads/feature/x'),
    current: 'feature/x',
    dirty: new Set(),
  });
  assert.deepEqual(actions, []);
});

test('--dry-run fetches and plans but runs no destructive git command', () => {
  const calls = [];
  const git = (args) => {
    calls.push(args.join(' '));
    if (args[0] === 'for-each-ref') return BRANCHES;
    if (args[0] === 'worktree' && args[1] === 'list') return WORKTREES;
    if (args[0] === 'rev-parse') return 'main\n';
    return '';
  };
  const lines = [];
  main(['--dry-run'], { git, log: (l) => lines.push(l) });
  assert.ok(calls[0].startsWith('fetch'));
  assert.ok(
    !calls.some((c) => /^(branch -D|worktree remove|worktree unlock|checkout|pull)/.test(c)),
  );
  assert.ok(lines.includes('would delete branch feature/merged (remote gone)'));
});

test('without --dry-run the planned actions run in order', () => {
  const calls = [];
  const git = (args) => {
    calls.push(args.join(' '));
    if (args[0] === 'for-each-ref') return 'feature/merged\torigin/feature/merged\t[gone]';
    if (args[0] === 'worktree' && args[1] === 'list')
      return 'worktree C:/repo\nHEAD a\nbranch refs/heads/feature/merged';
    if (args[0] === 'rev-parse') return 'feature/merged\n';
    return '';
  };
  main([], { git, log: () => {} });
  const destructive = calls.filter((c) => /^(checkout|pull|branch -D|worktree prune)/.test(c));
  assert.deepEqual(destructive, [
    'checkout -q main',
    'pull -q --ff-only',
    'branch -D feature/merged',
    'worktree prune',
  ]);
});
