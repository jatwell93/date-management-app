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

/** The command with heredoc bodies removed, so their text is not parsed. */
function stripHeredocs(command) {
  const lines = command.split('\n');
  const out = [];
  let end = null;
  for (const line of lines) {
    if (end !== null) {
      if (line.trim() === end) end = null;
      continue;
    }
    out.push(line);
    const m = line.match(/<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/);
    if (m) end = m[2];
  }
  return out.join('\n');
}

/** Each simple command's words, with the leading `git` globals dropped. */
function gitCalls(command) {
  return stripHeredocs(command)
    .split(/&&|\|\||[;|\n]/)
    .map((segment) => segment.trim().split(/\s+/).filter(Boolean))
    .map((words) => {
      const at = words.indexOf('git');
      if (at === -1 || (at > 0 && words[at - 1] !== 'rtk')) return null;
      const rest = words.slice(at + 1);
      while (rest[0] === '-c' || rest[0] === '-C') rest.splice(0, 2);
      return rest;
    })
    .filter(Boolean);
}

/** The branch a `git switch` or `git checkout` moves to, or ''. */
function switchTarget(args) {
  const [sub, ...rest] = args;
  if (sub !== 'switch' && sub !== 'checkout') return '';
  if (rest.includes('--')) return '';
  const create = rest.findIndex((a) => ['-c', '-C', '-b', '-B'].includes(a));
  if (create !== -1) return rest[create + 1] || '';
  return rest.find((a) => !a.startsWith('-')) || '';
}

const targetsMain = (refspec) => {
  const dest = refspec.replace(/^\+/, '').split(':').pop();
  return dest === MAIN || dest === `refs/heads/${MAIN}`;
};

/** Why a push lands on main from `branch`, or ''. */
function pushProblem(args, branch) {
  const positional = args.slice(1).filter((a) => !a.startsWith('-'));
  const refspecs = positional.slice(1);
  if (refspecs.some(targetsMain)) return 'pushes to main';
  const onMain = branch === MAIN;
  if (onMain && (refspecs.length === 0 || refspecs.includes('HEAD'))) {
    return 'pushes the current branch, which is main';
  }
  return '';
}

/** Why the command must not run, or '' to allow it. */
function verdict(command, branch) {
  let current = branch;
  for (const args of gitCalls(command)) {
    const moved = switchTarget(args);
    if (moved) current = moved;
    if (args[0] === 'commit' && current === MAIN) return 'git commit on main';
    if (args[0] === 'push') {
      const problem = pushProblem(args, current);
      if (problem) return `git push ${problem}`;
    }
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

function main() {
  let input = '';
  process.stdin.on('data', (d) => (input += d));
  process.stdin.on('end', () => {
    let payload = {};
    try {
      payload = JSON.parse(input);
    } catch {
      process.exit(0);
    }
    const command = payload.tool_input?.command || '';
    if (!/\bgit\b/.test(command)) process.exit(0);
    const reason = verdict(command, currentBranch(payload.cwd || process.cwd()));
    if (!reason) process.exit(0);
    process.stderr.write(
      `main-guard: blocked (${reason}). Work on a feature branch: ` +
        '`git switch -c feature/<name>`, then commit and push there (AGENTS.md: never push to main).\n',
    );
    process.exit(2);
  });
}

if (require.main === module) main();

module.exports = { gitCalls, stripHeredocs, switchTarget, verdict };
