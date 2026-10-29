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

test('pre-commit runs the git-secrets scan when git-secrets is installed', () => {
  const { git, repo } = makeRepo();
  git('config', 'core.hooksPath', HOOKS);
  git('switch', '-q', '-c', 'feature/x');
  const bin = path.join(repo, '..', 'bin');
  fs.mkdirSync(bin);
  const fake = path.join(bin, 'git-secrets');
  fs.writeFileSync(fake, '#!/bin/sh\necho "git-secrets: found a secret" >&2\nexit 1\n');
  fs.chmodSync(fake, 0o755);
  const r = spawnSync('git', ['commit', '-q', '--allow-empty', '-m', 'x'], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` },
  });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /found a secret/);
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

const unset = () => {
  throw new Error('unset');
};

const SECRETS_HOOK = '#!/usr/bin/env bash\ngit secrets --pre_commit_hook -- "$@"\n';
// setup-git-secrets.sh copies this script to .git/hooks/pre-commit.
const COPIED_SECRETS = fs.readFileSync(path.join(__dirname, 'pre-commit-secrets.sh'), 'utf8');

/**
 * Fake git, directory listing and file reads for the installer. Hooks named in
 * `secrets` hold what `git secrets --install` writes; the rest are someone's own.
 */
function installDeps({ hooksPath = '', files = [], secrets = [], own = '#!/bin/sh\nmine\n' } = {}) {
  const calls = [];
  // Like git: the hooks directory follows core.hooksPath when it is set.
  const answers = {
    'config --get': hooksPath ? () => hooksPath : unset,
    'rev-parse --git-path': () => hooksPath || '.git/hooks',
  };
  const git = (args) => {
    calls.push(args);
    return (answers[args.slice(0, 2).join(' ')] || (() => 'true'))();
  };
  const listings = { '.githooks': ['pre-commit', 'pre-push'] };
  const read = (file) => {
    if (file.endsWith('pre-commit-secrets.sh')) return COPIED_SECRETS;
    return secrets.includes(path.basename(file)) ? SECRETS_HOOK : own;
  };
  return { calls, git, list: (dir) => listings[dir] || [...files, ...secrets], read };
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

test('install replaces the git-secrets hooks, which .githooks runs itself', () => {
  const secrets = installDeps({ secrets: ['pre-commit', 'commit-msg', 'prepare-commit-msg'] });
  assert.match(install(secrets), /^git hooks installed/);
  const mixed = installDeps({ files: ['pre-push'], secrets: ['pre-commit'] });
  assert.match(install(mixed), /already has hooks \(pre-push\)/);
  const copied = installDeps({ files: ['pre-commit'], own: COPIED_SECRETS });
  assert.match(install(copied), /^git hooks installed/);
  // A hook that calls git-secrets but does more is someone's own: kept.
  const extended = `${SECRETS_HOOK}./run-my-linter\n`;
  assert.match(install(installDeps({ files: ['pre-commit'], own: extended })), /already has/);
  const edited = `${COPIED_SECRETS}\n./run-my-linter\n`;
  assert.match(install(installDeps({ files: ['pre-commit'], own: edited })), /already has/);
  for (const hook of ['pre-commit', 'commit-msg', 'prepare-commit-msg']) {
    const text = fs.readFileSync(path.join(HOOKS, hook), 'utf8');
    assert.match(text, /git-secrets --\w+_hook -- "\$@"/, hook);
  }
});
