#!/usr/bin/env node
/**
 * Phase 2 — test-manifest verification sweep.
 *
 * `check-audit-columns.js` answers one question: is any column unfilled, and
 * does any decision outrun its own evidence? That is necessary but nowhere near
 * sufficient. Producing the task 2.2 manifests surfaced three further defect
 * classes, each found by hand, each cheap to catch mechanically:
 *
 *   1. **Invented citations.** Part 1 cited three Worker test files that do not
 *      exist (`database/dashboard...` where the real path is `database.dashboard...`).
 *      A path typed from memory looks exactly like a path that was read.
 *   2. **Unqualified negatives.** 280 cells read a bare "none found", which does
 *      not say what was looked at and so cannot support a decision.
 *   3. **Silent under-coverage.** A section can pass every other check while
 *      simply omitting half its file's tests. Nothing downstream notices, because
 *      the rows that are present are all fine.
 *
 * This script runs those three checks plus the column guard, so verifying a
 * batch is one command instead of a dozen shell pipelines.
 *
 * WHAT THIS STILL CANNOT CATCH — the same blind spot the column guard has, and
 * worth restating because a green run here is more persuasive than it should be:
 * a citation that exists, is well-formed, and is attached to a claim it does not
 * support passes every check below. Both substantive defects found while writing
 * these manifests were of that kind, and both were found by reading the cited
 * source. This narrows where you have to look; it does not replace looking.
 *
 * Usage:
 *   node scripts/verify-audit-manifest.js [manifest.md...]
 *
 * With no arguments, checks every `*-test-manifest-*.md` under
 * `openspec/changes/<change>/audit/`.
 *
 * Exit codes: 0 = no failures, 1 = at least one failure.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { checkFile } = require('./check-audit-columns');

/** Where backend test files live, for resolving `### <filename>` headings. */
const BACKEND_TESTS = path.join('backend', 'src', 'tests');

/** A cited Worker test path. */
const WORKER_PATH = /workers\/src\/[A-Za-z0-9._/-]+\.test\.ts/g;

/**
 * A bare negative — "none found" not followed by a parenthesised search list.
 * `none found (searched: ...)` is the acceptable form and must not match.
 */
const BARE_NEGATIVE = /none found\s*(?=\||$)/gim;

/**
 * Heuristic count of test cases in a spec file: `it(`, `test(`, `it.each(`,
 * `it.only(`, and the tagged-template `it.each\`...\`(` form.
 *
 * This is a deliberate floor, not an exact parse. It is compared against the row
 * count with `rows >= tests`, because the manifest is one row per *behaviour*
 * and a single test may assert several. Only under-coverage is a defect.
 */
const TEST_CASE = /^[ \t]*(?:it|test)(?:\.[a-zA-Z]+)?\s*(?:\(|`)/gm;

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** Index every backend test file by basename, so headings resolve to a path. */
function indexBackendTests() {
  const index = new Map();
  for (const file of walk(BACKEND_TESTS)) {
    if (!file.endsWith('.test.ts')) continue;
    const name = path.basename(file);
    // A duplicate basename across directories is itself worth knowing about:
    // keep every path so the caller can report the ambiguity.
    const existing = index.get(name) || [];
    index.set(name, existing.concat(file));
  }
  return index;
}

/** Split a manifest into `### <heading>` sections with their table rows. */
function parseSections(markdown) {
  const lines = markdown.split(/\r?\n/);
  const sections = [];
  let current = null;

  for (const line of lines) {
    const heading = /^###\s+(.+?)\s*$/.exec(line);
    if (heading) {
      if (current) sections.push(current);
      current = { heading: heading[1], rows: 0 };
      continue;
    }
    if (!current) continue;
    const trimmed = line.trim();
    if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) continue;
    if (/^\|[\s:|-]+\|$/.test(trimmed)) continue; // separator
    if (/^\|\s*Behaviour\s*\|/i.test(trimmed)) continue; // header
    current.rows += 1;
  }
  if (current) sections.push(current);
  return sections;
}

function countTestCases(file) {
  const src = fs.readFileSync(file, 'utf8');
  return (src.match(TEST_CASE) || []).length;
}

function verify(manifest, backendIndex) {
  const findings = [];
  let markdown;
  try {
    markdown = fs.readFileSync(manifest, 'utf8');
  } catch (err) {
    return { findings: [{ level: 'fail', message: `could not read manifest: ${err.message}` }] };
  }

  // 1. Column guard, so one command covers everything.
  const column = checkFile(manifest);
  for (const f of column.findings) {
    findings.push({ level: f.level, message: `[columns] ${f.column}: ${f.message}` });
  }

  // 2. Every cited Worker path must exist.
  const cited = [...new Set(markdown.match(WORKER_PATH) || [])];
  const missing = cited.filter((p) => !fs.existsSync(p));
  for (const p of missing) {
    findings.push({
      level: 'fail',
      message: `[citation] cited Worker test does not exist: ${p}`,
    });
  }

  // 3. No unqualified negatives.
  const bare = (markdown.match(BARE_NEGATIVE) || []).length;
  if (bare > 0) {
    findings.push({
      level: 'fail',
      message:
        `[evidence] ${bare} cell(s) read a bare "none found" with no search recorded — ` +
        'an unqualified negative does not say what was looked at',
    });
  }

  // 4. No section may cover fewer behaviours than its file has tests.
  const sections = parseSections(markdown);
  let covered = 0;
  let rowTotal = 0;
  for (const section of sections) {
    rowTotal += section.rows;
    const paths = backendIndex.get(section.heading);
    if (!paths) {
      findings.push({
        level: 'fail',
        message: `[scope] section "${section.heading}" matches no file under ${BACKEND_TESTS}`,
      });
      continue;
    }
    if (paths.length > 1) {
      findings.push({
        level: 'warn',
        message:
          `[scope] "${section.heading}" is ambiguous — ${paths.length} files share that name ` +
          `(${paths.join(', ')}); counted against the first`,
      });
    }
    const tests = countTestCases(paths[0]);
    covered += 1;
    if (section.rows < tests) {
      findings.push({
        level: 'fail',
        message:
          `[coverage] ${section.heading}: ${section.rows} row(s) for ${tests} test case(s) — ` +
          `${tests - section.rows} behaviour(s) unaccounted for`,
      });
    }
  }

  return {
    findings,
    stats: {
      sections: sections.length,
      covered,
      rows: rowTotal,
      citations: cited.length,
      tables: column.tables,
    },
  };
}

function defaultTargets() {
  const base = path.join('openspec', 'changes');
  if (!fs.existsSync(base)) return [];
  const out = [];
  for (const change of fs.readdirSync(base)) {
    const dir = path.join(base, change, 'audit');
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (/-test-manifest-.*\.md$/.test(f)) out.push(path.join(dir, f));
    }
  }
  return out;
}

function main(argv) {
  const targets = argv.length ? argv : defaultTargets();
  if (!targets.length) {
    console.log('No test manifests found; nothing to verify.');
    return 0;
  }

  const backendIndex = indexBackendTests();
  let failures = 0;
  let warnings = 0;

  for (const manifest of targets) {
    const { findings, stats } = verify(manifest, backendIndex);
    const fails = findings.filter((f) => f.level === 'fail');
    const warns = findings.filter((f) => f.level === 'warn');
    failures += fails.length;
    warnings += warns.length;

    const status = fails.length ? 'FAIL' : warns.length ? 'WARN' : 'OK';
    const summary = stats
      ? `${stats.sections} section(s), ${stats.rows} row(s), ${stats.citations} cited path(s)`
      : '';
    console.log(`${status}  ${manifest}  ${summary}`);
    for (const f of [...fails, ...warns]) {
      console.log(`      [${f.level}] ${f.message}`);
    }
  }

  console.log(
    `\n${failures} failure(s), ${warnings} warning(s) across ${targets.length} manifest(s).`,
  );
  if (!failures) {
    console.log(
      'Note: this proves no citation is missing, no negative is unqualified, and no section\n' +
        'under-covers its file. It does NOT prove a cited line supports the claim attached to\n' +
        'it — that still takes reading the source.',
    );
  }
  return failures ? 1 : 0;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = { parseSections, countTestCases, indexBackendTests, verify, main };
