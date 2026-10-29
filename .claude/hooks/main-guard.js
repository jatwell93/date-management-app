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
 * A `git switch`/`git checkout` earlier in the same command line counts, so
 * `git switch -c feature/x && git commit ...` on main is allowed.
 */
const { execFileSync } = require('child_process');

const MAIN = 'main';
const HEREDOC = /<<-?\s*(['"]?)([A-Za-z_]\w*)\1/;
const GLOBALS = new Set(['-c', '-C']);
const SWITCHES = new Set(['switch', 'checkout']);
const CREATE = new Set(['-c', '-C', '-b', '-B']);

const heredocEnd = (line) => line.match(HEREDOC)?.[2] ?? null;

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

/** Where `git` starts the words (directly or after `rtk`), or -1. */
function gitIndex(words) {
  const at = words.indexOf('git');
  if (at <= 0) return at;
  return words[at - 1] === 'rtk' ? at : -1;
}

/** The words after `git`, without its `-c`/`-C` globals, or null. */
function gitArgs(words) {
  const at = gitIndex(words);
  if (at === -1) return null;
  const rest = words.slice(at + 1);
  while (GLOBALS.has(rest[0])) rest.splice(0, 2);
  return rest;
}

/** Each simple command's git arguments, in order. */
function gitCalls(command) {
  return stripHeredocs(command)
    .split(/&&|\|\||[;|\n]/)
    .map((segment) => gitArgs(segment.trim().split(/\s+/).filter(Boolean)))
    .filter(Boolean);
}

/** The branch a `git switch` or `git checkout` moves to, or ''. */
function switchTarget(args) {
  const [sub, ...rest] = args;
  if (!SWITCHES.has(sub) || rest.includes('--')) return '';
  const create = rest.findIndex((a) => CREATE.has(a));
  if (create !== -1) return rest[create + 1] || '';
  return rest.find((a) => !a.startsWith('-')) || '';
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

/** Why the command must not run, or '' to allow it. */
function verdict(command, branch) {
  let current = branch;
  for (const args of gitCalls(command)) {
    current = switchTarget(args) || current;
    const problem = callProblem(args, current);
    if (problem) return problem;
  }
  return '';
}

function currentBranch(cwd) {
  try {
    return execFileSync('git', ['branch', '--show-current'], { cwd, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
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
  const reason = verdict(command, currentBranch(payload.cwd || process.cwd()));
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

module.exports = { gitCalls, stripHeredocs, switchTarget, verdict };
