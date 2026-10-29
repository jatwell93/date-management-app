#!/usr/bin/env node
/**
 * Point git at the repository's hooks in .githooks/ (OpenSpec change
 * factory-tickets-and-autostart, task 2.1): pre-commit refuses a commit on
 * main and pre-push refuses a push to main. Run by the root `prepare` script,
 * so `npm install` / `npm ci` installs them. Outside a git checkout (a
 * tarball install) it does nothing, and it never fails the install.
 *
 * It never replaces hooks someone set up already: when `core.hooksPath` points
 * elsewhere, or the default hooks directory holds a real (non-sample) hook,
 * it leaves git alone and says how to chain the repository's hooks instead.
 * The git-secrets hooks are the exception: .githooks/ runs the same checks.
 *
 * Usage: node scripts/install-git-hooks.js
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');

const HOOKS_PATH = '.githooks';

const defaultDeps = {
  git: (args) => execFileSync('git', args, { encoding: 'utf8', stdio: 'pipe' }).trim(),
  list: (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir) : []),
  read: (file) => fs.readFileSync(file, 'utf8'),
};

/**
 * True for a hook scripts/setup-git-secrets.sh installed: one `git secrets
 * --install` wrote (`git secrets --<name>_hook`), or its copy of
 * scripts/pre-commit-secrets.sh (`git secrets --scan`). .githooks/ runs the
 * same git-secrets checks, so replacing either loses nothing.
 */
const isGitSecretsHook = (text) => /^\s*(if )?git secrets --(\w+_hook|scan)\b/m.test(text);

/** The configured core.hooksPath, or ''. */
function configuredPath(git) {
  try {
    return git(['config', '--get', 'core.hooksPath']);
  } catch {
    return '';
  }
}

/** Why installing would replace someone's hooks, or ''. */
function existingHooks(deps) {
  const current = configuredPath(deps.git);
  if (current === HOOKS_PATH) return '';
  if (current) return `core.hooksPath is already ${current}`;
  const dir = deps.git(['rev-parse', '--git-path', 'hooks']);
  const real = deps
    .list(dir)
    .filter((name) => !name.endsWith('.sample'))
    .filter((name) => !isGitSecretsHook(deps.read(`${dir}/${name}`)));
  return real.length ? `${dir} already has hooks (${real.join(', ')})` : '';
}

function main(deps = defaultDeps) {
  try {
    deps.git(['rev-parse', '--is-inside-work-tree']);
  } catch {
    return 'not a git checkout: hooks not installed';
  }
  const existing = existingHooks(deps);
  if (existing) {
    return `git hooks not installed: ${existing}. Call ${HOOKS_PATH}/pre-commit and ${HOOKS_PATH}/pre-push from your own hooks.`;
  }
  deps.git(['config', 'core.hooksPath', HOOKS_PATH]);
  return `git hooks installed (core.hooksPath=${HOOKS_PATH})`;
}

if (require.main === module) {
  try {
    console.log(main());
  } catch (error) {
    console.warn(`git hooks not installed: ${error.message}`);
  }
}

module.exports = { main };
