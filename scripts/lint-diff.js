#!/usr/bin/env node
'use strict';

/**
 * Lint only the files this branch changed.
 *
 * **Why.** Root `npm run lint` is `eslint .` over the whole monorepo and takes
 * **over ten minutes** — past the 600s tool timeout an agent runs commands
 * under, so it gets backgrounded and reads as a hang rather than as work in
 * progress. ESLint over two files takes about twelve seconds. For the common
 * case (gate the change I just made) that is the difference between a check you
 * run every time and one you skip.
 *
 * This is a pre-commit gate, not a replacement for the full run: a change here
 * can break a file it does not touch (a renamed export, a shared type), and only
 * `eslint .` sees that. CI is unaffected either way — there is no ESLint job.
 *
 * **Base defaults to `origin/main`**, matching `test:backend:diff` and
 * `test:frontend:diff`, which both pass `--changed origin/main`. Override with an
 * argument or `LINT_DIFF_BASE`:
 *
 *     npm run lint:diff
 *     npm run lint:diff -- HEAD~3
 *     npm run lint:diff -- --fix
 *     LINT_DIFF_BASE=main npm run lint:diff
 *
 * Anything starting with `-` is forwarded to ESLint rather than read as a base.
 */

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..');

/** Extensions the root ESLint config actually handles. */
const LINTABLE = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts']);

/**
 * Windows caps a command line near 32k characters. Chunking keeps a large branch
 * from failing with a truncated-argument error that looks nothing like its cause.
 */
const CHUNK_SIZE = 100;

function git(args, { allowFailure = false } = {}) {
  const result = spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });
  if (result.status !== 0) {
    if (allowFailure) return null;
    const detail = (result.stderr || result.stdout || '').trim();
    throw new Error(`git ${args.join(' ')} failed: ${detail}`);
  }
  return result.stdout;
}

/**
 * Keep only lintable, still-present files, deduplicated and in a stable order.
 *
 * `exists` is injectable so the selection logic can be tested without a git tree
 * or a filesystem.
 */
function selectLintableFiles(
  paths,
  { exists = (p) => fs.existsSync(path.join(REPO_ROOT, p)) } = {},
) {
  const seen = new Set();

  for (const raw of paths) {
    const file = String(raw).trim();
    // No separate blank-string guard: a blank entry has no extension, and
    // `path.extname('')` is `''`, which is not in LINTABLE. An explicit
    // `if (!file) continue` was here first and a mutation proved it dead — every
    // test still passed without it, because this line was already doing the work.
    if (!LINTABLE.has(path.extname(file).toLowerCase())) continue;
    // A file staged and then deleted still appears in one of the git listings.
    // Passing it to ESLint is a hard error, not a skipped file.
    if (!exists(file)) continue;
    seen.add(file);
  }

  return [...seen].sort();
}

/**
 * Resolve the comparison point, degrading rather than failing.
 *
 * A fresh clone with no `origin/main`, or a detached checkout, should still lint
 * something useful instead of erroring — so the fallbacks are `main`, then the
 * previous commit.
 */
function resolveBase(requested) {
  const candidates = [requested, 'origin/main', 'main', 'HEAD~1'].filter(Boolean);

  for (const candidate of candidates) {
    if (
      git(['rev-parse', '--verify', '--quiet', `${candidate}^{commit}`], { allowFailure: true })
    ) {
      if (candidate !== requested && requested) {
        console.warn(`⚠ '${requested}' is not a commit; comparing against '${candidate}' instead.`);
      }
      return candidate;
    }
  }

  return null;
}

/** Changed files versus `base`, including staged, unstaged and untracked. */
function collectChangedFiles(base) {
  const mergeBase = base
    ? (git(['merge-base', base, 'HEAD'], { allowFailure: true }) || '').trim() || base
    : null;

  const listings = [];

  if (mergeBase) {
    // Two-dot against the merge base compares the WORKING TREE to it, so this one
    // command already covers committed, staged and unstaged changes. Using
    // three-dot or `--cached` instead would miss the files most likely to be
    // wrong: the ones just edited and not yet committed.
    listings.push(git(['diff', '--name-only', '--diff-filter=ACMR', mergeBase]));
  }

  // Untracked files are not in any diff, and a brand-new file is exactly what a
  // pre-commit gate should catch.
  listings.push(git(['ls-files', '--others', '--exclude-standard']));

  return listings.flatMap((out) => (out || '').split('\n'));
}

function resolveEslintBin() {
  const bin = path.join(
    REPO_ROOT,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'eslint.cmd' : 'eslint',
  );
  return fs.existsSync(bin) ? bin : null;
}

function runEslint(files, forwardedArgs) {
  const bin = resolveEslintBin();
  if (!bin) {
    console.error('❌ eslint is not installed. Run `npm install` at the repository root.');
    return 1;
  }

  let worstStatus = 0;

  for (let index = 0; index < files.length; index += CHUNK_SIZE) {
    const chunk = files.slice(index, index + CHUNK_SIZE);
    const result = spawnSync(bin, ['--no-warn-ignored', ...forwardedArgs, ...chunk], {
      cwd: REPO_ROOT,
      stdio: 'inherit',
      // A `.cmd` shim cannot be spawned without a shell on Windows. Arguments are
      // passed as an array, so spawnSync quotes them rather than us building a
      // command string (see scripts/memvid-exec.js for where that goes wrong).
      shell: process.platform === 'win32',
    });

    if (result.error) {
      console.error(`❌ Failed to run eslint: ${result.error.message}`);
      return 1;
    }
    if (typeof result.status === 'number' && result.status > worstStatus) {
      worstStatus = result.status;
    }
  }

  return worstStatus;
}

function main(argv) {
  const forwardedArgs = argv.filter((arg) => arg.startsWith('-'));
  const positional = argv.filter((arg) => !arg.startsWith('-'));
  const requestedBase = positional[0] || process.env.LINT_DIFF_BASE || 'origin/main';

  const base = resolveBase(requestedBase);
  if (!base) {
    console.warn('⚠ No usable git base found; linting untracked files only.');
  }

  const files = selectLintableFiles(collectChangedFiles(base));

  if (files.length === 0) {
    console.log(`No changed JS/TS files versus ${base || 'HEAD'} — nothing to lint.`);
    return 0;
  }

  console.log(`Linting ${files.length} changed file(s) versus ${base}:`);
  for (const file of files) console.log(`  ${file}`);

  return runEslint(files, forwardedArgs);
}

module.exports = { selectLintableFiles, LINTABLE };

if (require.main === module) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (error) {
    console.error(`❌ ${error.message}`);
    process.exit(1);
  }
}
