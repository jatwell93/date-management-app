#!/usr/bin/env node
/**
 * PreToolUse hook (Bash): refuse `git commit` and `git push` that would land on
 * `main` (OpenSpec change factory-tickets-and-autostart, task 2.1).
 *
 * A session once committed and pushed to main because something switched the
 * checkout back between `git switch -c` and the commit, and the owner's ruleset
 * bypass let the push through. This replaces the memory note as the guard.
 *
 * Blocks (exit 2, reason on stderr):
 *   - `git commit` while the branch is main
 *   - `git push` with no refspec, or `HEAD`, while the branch is main
 *   - `git push` whose refspec targets main (`main`, `x:main`, `:main`,
 *     `refs/heads/main`, `+main`)
 * The branch is read where the command runs: after a `cd`, in a `git -C <dir>`
 * directory, and after a `git switch`/`git checkout` earlier in the same line
 * (so `git switch -c feature/x && git commit ...` on main is allowed). A plain
 * `git checkout <name>` counts only when <name> is a branch or commit, not a
 * file. It is a guard against accidents, not a sandbox: it does not expand
 * variables, aliases or subshells.
 */
const { execFileSync } = require('child_process');
const path = require('path');

const MAIN = 'main';
const HEREDOC = /(?<!<)<<-?\s*(['"]?)([A-Za-z_]\w*)\1/;
const WRAPPERS = new Set(['rtk', 'command', 'env', 'exec', 'sudo', 'time', 'nohup']);
const ASSIGNMENT = /^\w+=/;
const VALUE_GLOBALS = new Set(['-c', '-C', '--git-dir', '--work-tree', '--namespace']);
const SWITCHES = new Set(['switch', 'checkout']);
const CREATE = new Set(['-c', '-C', '-b', '-B']);

const heredocEnd = (line) => line.match(HEREDOC)?.[2] ?? null;
const unquote = (word) => word.replace(/^(['"])(.*)\1$/, '$2');
const wordsOf = (segment) => segment.trim().split(/\s+/).filter(Boolean).map(unquote);

/** The command with heredoc bodies removed, so their text is not parsed. */
function stripHeredocs(command) {
  const out = [];
  let end = null;
  for (const line of command.split('\n')) {
    if (end === null) {
      out.push(line);
      end = heredocEnd(line);
    } else if (line.trim() === end) {
      end = null;
    }
  }
  return out.join('\n');
}

/** Where `git` starts the words, after env assignments and wrappers, or -1. */
function gitIndex(words) {
  const at = words.findIndex((w) => !WRAPPERS.has(w) && !ASSIGNMENT.test(w));
  return words[at] === 'git' ? at : -1;
}

/** The git subcommand and its arguments, with the `-C` directory if given. */
function splitGlobals(rest) {
  let dir = null;
  let i = 0;
  while (rest[i]?.startsWith('-')) {
    if (rest[i] === '-C') dir = rest[i + 1];
    i += VALUE_GLOBALS.has(rest[i]) ? 2 : 1;
  }
  return { dir, args: rest.slice(i) };
}

/** One step of the command line: `{ cd }`, `{ dir, args }` for git, or null. */
function stepOf(words) {
  if (words[0] === 'cd') return { cd: words[1] || '~' };
  const at = gitIndex(words);
  return at === -1 ? null : splitGlobals(words.slice(at + 1));
}

/** The command's `cd` and git steps, in order. */
function steps(command) {
  return stripHeredocs(command)
    .split(/&&|\|\||[;|\n]/)
    .map((segment) => stepOf(wordsOf(segment)))
    .filter(Boolean);
}

/** The branch a `git switch` or `git checkout` moves to, or ''. */
function switchTarget(args, isBranch) {
  const [sub, ...rest] = args;
  if (!SWITCHES.has(sub) || rest.includes('--')) return '';
  const create = rest.findIndex((a) => CREATE.has(a));
  if (create !== -1) return rest[create + 1] || '';
  const name = rest.find((a) => !a.startsWith('-')) || '';
  return name && isBranch(name) ? name : '';
}

const targetsMain = (refspec) => {
  const dest = refspec.replace(/^\+/, '').split(':').pop();
  return dest === MAIN || dest === `refs/heads/${MAIN}`;
};

const pushesCurrent = (refspecs) => refspecs.length === 0 || refspecs.includes('HEAD');

/** Why a push lands on main from `branch`, or ''. */
function pushProblem(args, branch) {
  const refspecs = args
    .slice(1)
    .filter((a) => !a.startsWith('-'))
    .slice(1);
  if (refspecs.some(targetsMain)) return 'pushes to main';
  if (branch === MAIN && pushesCurrent(refspecs)) return 'pushes the current branch, which is main';
  return '';
}

/** Why one git call lands on main from `branch`, or ''. */
function callProblem(args, branch) {
  if (args[0] === 'commit') return branch === MAIN ? 'git commit on main' : '';
  if (args[0] !== 'push') return '';
  const problem = pushProblem(args, branch);
  return problem && `git push ${problem}`;
}

/** Apply one step to `state` ({ cwd, branch }); why it lands on main, or ''. */
function advance(state, step, ctx) {
  if (step.cd) {
    state.cwd = path.resolve(state.cwd, step.cd);
    state.branch = ctx.branchOf(state.cwd);
    return '';
  }
  const dir = step.dir ? path.resolve(state.cwd, step.dir) : state.cwd;
  const here = step.dir ? ctx.branchOf(dir) : state.branch;
  const moved = switchTarget(step.args, (name) => ctx.isBranch(name, dir));
  if (!step.dir) state.branch = moved || state.branch;
  return callProblem(step.args, moved || here);
}

/**
 * Why the command must not run, or '' to allow it. `ctx` gives the starting
 * `cwd`, `branchOf(dir)` and `isBranch(name, dir)`.
 */
function verdict(command, ctx) {
  const state = { cwd: ctx.cwd, branch: ctx.branchOf(ctx.cwd) };
  let problem = '';
  steps(command).some((step) => (problem = advance(state, step, ctx)));
  return problem;
}

const git = (args, cwd) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

function branchOf(cwd) {
  try {
    return git(['branch', '--show-current'], cwd).trim();
  } catch {
    return '';
  }
}

/** True when `name` is a commit, a local branch or an origin branch. */
function isBranch(name, cwd) {
  return [name, `origin/${name}`].some((rev) => {
    try {
      git(['rev-parse', '--verify', '--quiet', `${rev}^{commit}`], cwd);
      return true;
    } catch {
      return false;
    }
  });
}

/** The hook's exit code for one PreToolUse payload (2 blocks). */
function guard(input) {
  let payload;
  try {
    payload = JSON.parse(input);
  } catch {
    return 0;
  }
  const command = payload.tool_input?.command || '';
  if (!/\bgit\b/.test(command)) return 0;
  const reason = verdict(command, { cwd: payload.cwd || process.cwd(), branchOf, isBranch });
  if (!reason) return 0;
  process.stderr.write(
    `main-guard: blocked (${reason}). Work on a feature branch: ` +
      '`git switch -c feature/<name>`, then commit and push there (AGENTS.md: never push to main).\n',
  );
  return 2;
}

if (require.main === module) {
  let input = '';
  process.stdin.on('data', (d) => (input += d));
  process.stdin.on('end', () => process.exit(guard(input)));
}

module.exports = { steps, stripHeredocs, switchTarget, verdict };
