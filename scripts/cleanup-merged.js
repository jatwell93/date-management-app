#!/usr/bin/env node
/**
 * Tidy the local checkout after PRs merge: delete local branches whose remote
 * branch is gone, remove their clean worktrees, and move off a merged branch
 * back onto an up-to-date main.
 *
 * "Gone" is the only deletion signal. GitHub deletes the head branch when a
 * PR merges (repo setting `delete_branch_on_merge`), and `git fetch --prune`
 * then marks the local branch's upstream `[gone]`. A branch that was never
 * pushed has no upstream and is never touched, so local-only work survives.
 * `git branch -d` cannot be the check here: squash merges leave the branch
 * "unmerged" as far as git can tell.
 *
 * A worktree with uncommitted changes is never removed, and its branch is kept.
 *
 * Usage:
 *   node scripts/cleanup-merged.js            # act, and print what was done
 *   node scripts/cleanup-merged.js --dry-run  # print the plan only
 */

const { execFileSync } = require('node:child_process');
const path = require('node:path');

const PROTECTED = new Set(['main', 'master']);

function defaultGit(args, opts = {}) {
  return execFileSync('git', args, { encoding: 'utf8', ...opts });
}

/** Parse `git for-each-ref --format=%(refname:short)%09%(upstream:short)%09%(upstream:track)`. */
function parseBranches(text) {
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [name, upstream = '', track = ''] = line.split('\t');
      return { name, upstream, gone: track.trim() === '[gone]' };
    });
}

/** Parse `git worktree list --porcelain`. The first entry is the main checkout. */
function parseWorktrees(text) {
  return text
    .split(/\n\n+/)
    .filter((block) => block.trim())
    .map((block, index) => {
      const wt = { path: '', branch: null, locked: false, main: index === 0 };
      for (const line of block.split('\n')) {
        if (line.startsWith('worktree ')) wt.path = line.slice('worktree '.length);
        else if (line.startsWith('branch refs/heads/'))
          wt.branch = line.slice('branch refs/heads/'.length);
        else if (line === 'locked' || line.startsWith('locked ')) wt.locked = true;
      }
      return wt;
    });
}

/** Free a gone branch from the worktree holding it: the main checkout moves to main, others go. */
function releaseAction(wt, branch) {
  return wt.main
    ? { type: 'switch-to-main', from: branch }
    : { type: 'remove-worktree', path: wt.path, locked: wt.locked };
}

/**
 * Decide what to do. Pure: `dirty` is the set of worktree paths with
 * uncommitted changes, and `current` is the main checkout's branch.
 */
function plan({ branches, worktrees, current, dirty }) {
  const actions = [];
  const kept = [];
  const goneNames = new Set(
    branches.filter((b) => b.gone && !PROTECTED.has(b.name)).map((b) => b.name),
  );

  // A gone branch checked out somewhere must be released before it can be
  // deleted. The main checkout is listed first, so a switch precedes removals.
  for (const wt of worktrees) {
    const branch = wt.main ? current : wt.branch;
    if (!goneNames.has(branch)) continue;
    if (dirty.has(wt.path)) {
      const where = wt.main ? 'current branch' : `worktree ${wt.path}`;
      kept.push({ branch, reason: `${where} has uncommitted changes` });
      goneNames.delete(branch);
    } else {
      actions.push(releaseAction(wt, branch));
    }
  }

  for (const name of goneNames) actions.push({ type: 'delete-branch', branch: name });
  if (actions.length) actions.push({ type: 'prune-worktrees' });
  return { actions, kept };
}

function isDirty(git, wtPath) {
  try {
    return git(['-C', wtPath, 'status', '--porcelain']).trim() !== '';
  } catch {
    // A worktree directory that no longer exists has nothing to lose.
    return false;
  }
}

const ACTIONS = {
  'switch-to-main': {
    describe: (a) => `switch ${a.from} -> main and pull --ff-only`,
    commands: () => [
      ['checkout', '-q', 'main'],
      ['pull', '-q', '--ff-only'],
    ],
  },
  'remove-worktree': {
    describe: (a) => `remove worktree ${a.path}${a.locked ? ' (unlock first)' : ''}`,
    commands: (a) => [
      ...(a.locked ? [['worktree', 'unlock', a.path]] : []),
      ['worktree', 'remove', a.path],
    ],
  },
  'delete-branch': {
    describe: (a) => `delete branch ${a.branch} (remote gone)`,
    commands: (a) => [['branch', '-D', a.branch]],
  },
  'prune-worktrees': {
    describe: () => 'git worktree prune',
    commands: () => [['worktree', 'prune']],
  },
};

function execute(actions, git) {
  for (const a of actions) ACTIONS[a.type].commands(a).forEach((args) => git(args));
}

function describe(a) {
  return ACTIONS[a.type].describe(a);
}

function main(argv, { git = defaultGit, log = console.log } = {}) {
  const dryRun = argv.includes('--dry-run');
  git(['fetch', '-q', '--prune', 'origin']);
  const branches = parseBranches(
    git([
      'for-each-ref',
      '--format=%(refname:short)%09%(upstream:short)%09%(upstream:track)',
      'refs/heads',
    ]),
  );
  const worktrees = parseWorktrees(git(['worktree', 'list', '--porcelain']));
  const current = git(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  const dirty = new Set(worktrees.filter((w) => isDirty(git, w.path)).map((w) => w.path));

  const { actions, kept } = plan({ branches, worktrees, current, dirty });
  for (const k of kept) log(`keep ${k.branch}: ${k.reason}`);
  if (!actions.length) {
    log('nothing to clean');
    return 0;
  }
  for (const a of actions) log(`${dryRun ? 'would ' : ''}${describe(a)}`);
  if (!dryRun) execute(actions, git);
  return 0;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2), {
    git: (args) => defaultGit(args, { cwd: path.resolve(__dirname, '..') }),
  });
}

module.exports = { parseBranches, parseWorktrees, plan, main };
