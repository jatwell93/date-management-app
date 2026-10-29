#!/usr/bin/env node
/**
 * Point git at the repository's hooks in .githooks/ (OpenSpec change
 * factory-tickets-and-autostart, task 2.1): pre-commit refuses a commit on
 * main and pre-push refuses a push to main. Run by the root `prepare` script,
 * so `npm install` / `npm ci` installs them. Outside a git checkout (a
 * tarball install) it does nothing, and it never fails the install.
 *
 * Usage: node scripts/install-git-hooks.js
 */
const { execFileSync } = require('node:child_process');

function main(git = (args) => execFileSync('git', args, { encoding: 'utf8', stdio: 'pipe' })) {
  try {
    git(['rev-parse', '--is-inside-work-tree']);
  } catch {
    return 'not a git checkout: hooks not installed';
  }
  git(['config', 'core.hooksPath', '.githooks']);
  return 'git hooks installed (core.hooksPath=.githooks)';
}

if (require.main === module) {
  try {
    console.log(main());
  } catch (error) {
    console.warn(`git hooks not installed: ${error.message}`);
  }
}

module.exports = { main };
