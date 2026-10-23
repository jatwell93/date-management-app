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
 *     file's previous_filename, with `--change all`: every active change's list,
 *     read from main's checkout. So a PR can neither edit the check, shrink a
 *     list, nor pick which list applies (labels are editable by the factory).
 *
 * Usage:
 *   node scripts/check-no-go.js [--change <id|all>] [--base <ref>]   # diff mode
 *   node scripts/check-no-go.js [--change <id|all>] --files <path|->  # list mode, one path per line
 *   node scripts/check-no-go.js scope   # guard: is $AUTHOR/$LABELS a factory PR
 *
 * Exit codes: 0 no match, 1 matches (printed one per line), 2 usage error or an
 * unreadable no_go list. Callers must treat any non-zero exit as a failure.
 * The scope mode lives here, not in its own script, so it is protected by the
 * same baseline entry.
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
  // The lint gates the factory is judged by: adding itself to the complexity
  // baseline, or loosening the rules, would switch the check off.
  'eslint.config.js',
  'eslint.ignores.js',
  'eslint.complexity-baseline.js',
  'scripts/complexity-baseline.test.js',
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
  // `s`: a path may contain a newline, and `.*` must still span it.
  return new RegExp(`^${full.split('**/').map(spans).join('(?:.*/)?')}$`, 's');
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

class NoGoFormatError extends Error {}

/**
 * The `no_go` list from the first yaml fence under `## Autonomy`, or [].
 * Reads a block list (`  - path`, with blank and comment lines between items)
 * or a one-line flow list (`no_go: [a, b]`). Any other shape throws
 * NoGoFormatError instead of being read partly: a misread list would silently
 * drop protected paths, so an unrecognised one fails the check.
 */
function parseNoGo(proposal) {
  const yaml = autonomyYaml(proposal.split(/\r?\n/));
  const key = yaml.findIndex((l) => /^no_go:/.test(l));
  if (key === -1) return [];
  const inline = scalar(yaml[key].slice('no_go:'.length));
  if (inline) return flowList(inline, yaml[key]);
  return blockList(yaml.slice(key + 1));
}

/** `[a, b]` to its items; any other inline value is unrecognised. */
function flowList(inline, line) {
  const flow = inline.match(/^\[(.*)\]$/);
  if (!flow) throw new NoGoFormatError(`unrecognised no_go value: ${line.trim()}`);
  return flow[1].split(',').map(scalar).filter(Boolean);
}

/** `- item` lines up to the next top-level key; an indented non-item is unrecognised. */
function blockList(rest) {
  // Items may be indented or not: YAML allows `- path` at the key's own column.
  const end = rest.findIndex((l) => !isFiller(l) && !/^\s*-\s/.test(l));
  if (end !== -1 && /^\s/.test(rest[end])) {
    throw new NoGoFormatError(`unrecognised line in no_go list: ${rest[end].trim()}`);
  }
  return (end === -1 ? rest : rest.slice(0, end))
    .filter((l) => !isFiller(l))
    .map((l) => scalar(l.replace(/^\s*-\s+/, '')))
    .filter(Boolean);
}

const CHANGE_ID = /^[a-z0-9][a-z0-9-]{0,99}$/;
const FACTORY_AUTHOR = 'claude[bot]';

const ALL_CHANGES = 'all';

/**
 * Whether a PR is a factory PR: authored by the Claude GitHub App, or labelled
 * `factory:*`. A line for $GITHUB_OUTPUT. Labels only widen the check (they can
 * mark a PR as a factory PR, never unmark one) and never choose which change's
 * list applies: the factory can edit its own PR's labels.
 */
function factoryScope(labels, author) {
  const factory = author === FACTORY_AUTHOR || labels.some((l) => l.startsWith('factory:'));
  return `factory=${factory}\n`;
}

function changeNoGo(changeId, root) {
  const file = path.join(root, 'openspec', 'changes', changeId, 'proposal.md');
  return fs.existsSync(file) ? parseNoGo(fs.readFileSync(file, 'utf8')) : [];
}

function activeChanges(root) {
  const dir = path.join(root, 'openspec', 'changes');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== 'archive' && CHANGE_ID.test(d.name))
    .map((d) => d.name);
}

/**
 * BASELINE plus one change's no_go list, or with `--change all` every active
 * change's list (the guard's mode: the PR cannot pick a narrower list).
 */
function patternsFor(changeId, root) {
  let ids = [];
  if (changeId === ALL_CHANGES) ids = activeChanges(root);
  else if (CHANGE_ID.test(changeId)) ids = [changeId];
  return [...new Set([...BASELINE, ...ids.flatMap((id) => changeNoGo(id, root))])];
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

function main(argv, io = defaultIo, root = process.cwd(), env = process.env) {
  if (argv[0] === 'scope') {
    io.log(factoryScope(JSON.parse(env.LABELS || '[]'), env.AUTHOR || '').trimEnd());
    return 0;
  }
  const opts = parseArgs(argv);
  if (!opts) {
    io.error(USAGE);
    return 2;
  }
  let patterns;
  try {
    patterns = patternsFor(opts.change, root);
  } catch (err) {
    if (!(err instanceof NoGoFormatError)) throw err;
    io.error(`no_go: ${err.message}; use a block list of "  - path" lines`);
    return 2;
  }
  const matches = findMatches(changedPaths(opts, io), patterns);
  if (matches.length === 0) {
    io.log('no_go: no protected path touched');
    return 0;
  }
  io.error(`no_go: ${matches.length} protected path(s) touched`);
  for (const m of matches) io.log(`${m.path}\t(${m.pattern})`);
  return 1;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = {
  BASELINE,
  factoryScope,
  globToRegExp,
  parseNoGo,
  patternsFor,
  findMatches,
  parseArgs,
  main,
};
