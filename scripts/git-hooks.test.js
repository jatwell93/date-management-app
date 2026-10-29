const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HOOKS = path.join(__dirname, '..', '.githooks');
const { main: install } = require('./install-git-hooks.js');

/** A temp repo using this repository's hooks, with a bare remote. */
function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'git-hooks-'));
  const repo = path.join(root, 'work');
  const remote = path.join(root, 'remote.git');
  const git = (...args) => spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  spawnSync('git', ['init', '-q', '--bare', remote]);
  spawnSync('git', ['init', '-q', '-b', 'main', repo]);
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('remote', 'add', 'origin', remote);
  return { git, repo };
}

test('pre-commit refuses a commit on main and allows one on a feature branch', () => {
  const { git } = makeRepo();
  git('config', 'core.hooksPath', HOOKS);
  const onMain = git('commit', '-q', '--allow-empty', '-m', 'x');
  assert.notEqual(onMain.status, 0);
  assert.match(onMain.stderr, /refusing to commit on main/);
  git('switch', '-q', '-c', 'feature/x');
  assert.equal(git('commit', '-q', '--allow-empty', '-m', 'x').status, 0);
});

test('pre-push refuses any push that updates main, however it is spelled', () => {
  const { git } = makeRepo();
  git('switch', '-q', '-c', 'feature/x');
  git('commit', '-q', '--allow-empty', '-m', 'x');
  git('config', 'core.hooksPath', HOOKS);
  for (const spec of ['HEAD:main', 'feature/x:main', 'HEAD:refs/heads/main']) {
    const r = git('push', '-q', 'origin', spec);
    assert.notEqual(r.status, 0, spec);
    assert.match(r.stderr, /refusing to push to main/, spec);
  }
  assert.equal(git('push', '-q', 'origin', 'feature/x').status, 0);
});

/** Fake git and directory listing for the installer. */
function installDeps({ hooksPath = '', files = [] } = {}) {
  const calls = [];
  const git = (args) => {
    calls.push(args);
    if (args[0] === 'config' && args[1] === '--get') {
      if (!hooksPath) throw new Error('unset');
      return hooksPath;
    }
    // Like git: the hooks directory follows core.hooksPath when it is set.
    const hooksDir = hooksPath || '.git/hooks';
    return args[0] === 'rev-parse' && args[1] === '--git-path' ? hooksDir : 'true';
  };
  return { calls, git, list: (dir) => (dir === '.githooks' ? ['pre-commit', 'pre-push'] : files) };
}

test('install sets core.hooksPath in a checkout and skips outside one', () => {
  const deps = installDeps({ files: ['pre-commit.sample'] });
  assert.match(install(deps), /^git hooks installed/);
  assert.deepEqual(deps.calls.at(-1), ['config', 'core.hooksPath', '.githooks']);
  assert.match(install(installDeps({ hooksPath: '.githooks' })), /^git hooks installed/);
  const skipped = install({
    git: () => {
      throw new Error('not a repo');
    },
    list: () => [],
  });
  assert.match(skipped, /not a git checkout/);
});

test('install never replaces hooks someone set up already', () => {
  const elsewhere = installDeps({ hooksPath: '.husky' });
  assert.match(install(elsewhere), /already \.husky/);
  assert.ok(!elsewhere.calls.some((a) => a[0] === 'config' && a[1] === 'core.hooksPath'));
  const local = installDeps({ files: ['pre-commit', 'pre-push.sample'] });
  assert.match(install(local), /already has hooks \(pre-commit\)/);
  assert.ok(!local.calls.some((a) => a[0] === 'config' && a[1] === 'core.hooksPath'));
});
