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

test('install sets core.hooksPath in a checkout and skips outside one', () => {
  const calls = [];
  assert.match(
    install((args) => calls.push(args)),
    /installed/,
  );
  assert.deepEqual(calls.at(-1), ['config', 'core.hooksPath', '.githooks']);
  const skipped = install(() => {
    throw new Error('not a repo');
  });
  assert.match(skipped, /not a git checkout/);
});
