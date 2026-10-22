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

/**
 * Glob to an anchored RegExp: `**` spans directories (and `**` plus a slash
 * also matches zero directories), `*` and `?` stay inside one segment, and a
 * trailing `/` means everything under that directory.
 */
function globToRegExp(glob) {
  const escape = (s) => s.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const segment = (s) =>
    s
      .split('*')
      .map((part) => part.split('?').map(escape).join('[^/]'))
      .join('[^/]*');
  const spans = (s) => s.split('**').map(segment).join('.*');
  const full = glob.endsWith('/') ? `${glob}**` : glob;
  return new RegExp(`^${full.split('**/').map(spans).join('(?:.*/)?')}$`);
}

/** Lines of the first yaml fence under `## Autonomy`, or []. */
function autonomyYaml(lines) {
  const heading = lines.findIndex((l) => /^##\s+Autonomy\s*$/.test(l));
  const fence = lines.findIndex((l, i) => heading !== -1 && i > heading && /^```ya?ml\s*$/.test(l));
  if (fence === -1) return [];
  const body = lines.slice(fence + 1);
  const end = body.findIndex((l) => /^```/.test(l));
  return end === -1 ? body : body.slice(0, end);
}

/** A yaml scalar without its comment and quotes. */
function scalar(text) {
  return text
    .replace(/\s+#.*$/, '')
    .trim()
    .replace(/^['"]|['"]$/g, '');
}

const isFiller = (line) => /^\s*(#.*)?$/.test(line);

/**
 * The `no_go` list from the first yaml fence under `## Autonomy`, or [].
 * Reads a block list (`  - path`, with blank and comment lines between items)
 * or a flow list (`no_go: [a, b]`).
 */
function parseNoGo(proposal) {
  const yaml = autonomyYaml(proposal.split(/\r?\n/));
  const key = yaml.findIndex((l) => /^no_go:/.test(l));
  if (key === -1) return [];
  const flow = yaml[key].match(/^no_go:\s*\[(.*)\]/);
  if (flow) return flow[1].split(',').map(scalar).filter(Boolean);
  const rest = yaml.slice(key + 1);
  const end = rest.findIndex((l) => !isFiller(l) && !/^\s+-\s/.test(l));
  return (end === -1 ? rest : rest.slice(0, end))
    .filter((l) => !isFiller(l))
    .map((l) => scalar(l.replace(/^\s+-\s+/, '')))
    .filter(Boolean);
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

const FLAGS = ['--change', '--base', '--files'];

/** Flag/value pairs to options, or null on an unknown flag or a missing value. */
function parseArgs(argv) {
  const opts = { change: '', base: 'origin/main', files: null };
  const pairs = argv.length % 2 === 0 ? argv.filter((_, i) => i % 2 === 0) : null;
  if (!pairs || !pairs.every((k) => FLAGS.includes(k))) return null;
  pairs.forEach((key, i) => {
    opts[key.slice(2)] = argv[i * 2 + 1];
  });
  return opts;
}

function changedPaths(opts, io) {
  if (opts.files !== null) {
    return io.readFile(opts.files === '-' ? 0 : opts.files).split(/\r?\n/);
  }
  // -z: git would otherwise quote a path with non-ASCII or special characters
  // ("\"caf\\303\\251\""), and a quoted path matches no pattern.
  return io.git(['diff', '--name-only', '--no-renames', '-z', `${opts.base}...HEAD`]).split('\0');
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
