#!/usr/bin/env node
/**
 * Fail when a factory branch or PR touches a path the factory must never edit.
 *
 * The patterns are a fixed BASELINE plus the change's own `no_go` entries from
 * the `## Autonomy` block of openspec/changes/<id>/proposal.md. A change can add
 * patterns but never remove a baseline one, so no proposal can unprotect the
 * workflows, the migrations or the agent's own rules.
 *
 * Two callers:
 *   * run-spec and babysit-pr, before every push (diff mode). The diff is taken
 *     against the merge base (`origin/main...HEAD`), so files that changed only
 *     on main never count, and with --no-renames, so a renamed file is listed
 *     under both its old and its new path.
 *   * .github/workflows/no-go-guard.yml (list mode). It runs main's copy of this
 *     script on the PR's file list from the pulls files API, including each
 *     file's previous_filename, and reads the proposal from main's checkout, so a
 *     PR can neither edit the check nor shrink its own change's list.
 *
 * Usage:
 *   node scripts/check-no-go.js [--change <id>] [--base <ref>]   # diff mode
 *   node scripts/check-no-go.js [--change <id>] --files <path|->  # list mode, one path per line
 *
 * Exit codes: 0 no match, 1 matches (printed one per line), 2 usage error.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const BASELINE = [
  '.github/**',
  'database/migrations/**',
  'scripts/database-backup.sh',
  'scripts/check-no-go.js',
  '.claude/**',
  'AGENTS.md',
  'CLAUDE.md',
];

const USAGE = 'usage: check-no-go.js [--change <id>] [--base <ref>] [--files <path|->]';

/** Glob to an anchored RegExp: `**` spans directories, `*` and `?` do not. */
function globToRegExp(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i];
    if (ch === '*' && glob[i + 1] === '*') {
      out += '.*';
      i += 1;
    } else if (ch === '*') {
      out += '[^/]*';
    } else if (ch === '?') {
      out += '[^/]';
    } else {
      out += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${out}$`);
}

/** The `no_go` list from the first yaml fence under `## Autonomy`, or []. */
function parseNoGo(proposal) {
  const lines = proposal.split(/\r?\n/);
  const heading = lines.findIndex((l) => /^##\s+Autonomy\s*$/.test(l));
  if (heading === -1) return [];
  const fence = lines.findIndex((l, i) => i > heading && /^```ya?ml\s*$/.test(l));
  if (fence === -1) return [];
  const entries = [];
  let inList = false;
  for (const line of lines.slice(fence + 1)) {
    if (/^```/.test(line)) break;
    if (/^no_go:\s*$/.test(line)) {
      inList = true;
    } else if (inList) {
      const item = line.match(/^\s+-\s+(.*)$/);
      if (!item) break;
      const value = item[1]
        .replace(/\s+#.*$/, '')
        .trim()
        .replace(/^['"]|['"]$/g, '');
      if (value) entries.push(value);
    }
  }
  return entries;
}

function patternsFor(changeId, root) {
  if (!changeId) return [...BASELINE];
  const file = path.join(root, 'openspec', 'changes', changeId, 'proposal.md');
  const own = fs.existsSync(file) ? parseNoGo(fs.readFileSync(file, 'utf8')) : [];
  return [...new Set([...BASELINE, ...own])];
}

/** Paths that match any pattern, each with the first pattern it matched. */
function findMatches(paths, patterns) {
  const compiled = patterns.map((p) => [p, globToRegExp(p)]);
  const matches = [];
  for (const p of new Set(paths.map((x) => x.trim()).filter(Boolean))) {
    const hit = compiled.find(([, re]) => re.test(p));
    if (hit) matches.push({ path: p, pattern: hit[0] });
  }
  return matches;
}

function parseArgs(argv) {
  const opts = { change: '', base: 'origin/main', files: null };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!['--change', '--base', '--files'].includes(key) || value === undefined) {
      return null;
    }
    opts[key.slice(2)] = value;
    i += 1;
  }
  return opts;
}

function changedPaths(opts, io) {
  if (opts.files !== null) {
    return io.readFile(opts.files === '-' ? 0 : opts.files).split(/\r?\n/);
  }
  return io.git(['diff', '--name-only', '--no-renames', `${opts.base}...HEAD`]).split(/\r?\n/);
}

const defaultIo = {
  readFile: (f) => fs.readFileSync(f, 'utf8'),
  git: (args) => execFileSync('git', args, { encoding: 'utf8' }),
  log: (s) => console.log(s),
  error: (s) => console.error(s),
};

function main(argv, io = defaultIo, root = process.cwd()) {
  const opts = parseArgs(argv);
  if (!opts) {
    io.error(USAGE);
    return 2;
  }
  const matches = findMatches(changedPaths(opts, io), patternsFor(opts.change, root));
  if (matches.length === 0) {
    io.log('no_go: no protected path touched');
    return 0;
  }
  io.error(`no_go: ${matches.length} protected path(s) touched`);
  for (const m of matches) io.log(`${m.path}\t(${m.pattern})`);
  return 1;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { BASELINE, globToRegExp, parseNoGo, patternsFor, findMatches, parseArgs, main };
