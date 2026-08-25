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
 *   4. **Tautological equivalents.** Eight Worker test files contain 90 tests
 *      whose body is a prose scenario followed by `expect(true).toBe(true)`.
 *      Citing one as proof that a Worker equivalent *exists* would retire a real
 *      backend gate against a test that cannot fail. See {@link tautologicalLines}.
 *
 * This script runs those four checks plus the column guard, so verifying a
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

/** A cited Worker test path *with* its line number, e.g. `...:129`. */
const WORKER_CITE = /workers\/src\/[A-Za-z0-9._/-]+\.test\.ts:(\d+)/g;

/** Line-anchored form of {@link TEST_CASE}, for locating block boundaries. */
const TEST_CASE_LINE = /^[ \t]*(?:it|test)(?:\.[a-zA-Z]+)?\s*(?:\(|`)/;

/** Any assertion at all. */
const ANY_EXPECT = /expect\s*\(/g;

/**
 * A tautological assertion: `expect(true).toBe(true)`, or the `const expected =
 * true; expect(expected).toBe(true)` variant that this repo's Worker suite uses.
 * Both are true regardless of what the code under test does.
 */
const TAUTOLOGY = /expect\(\s*(?:true|expected)\s*\)\s*\.toBe\(\s*true\s*\)/g;

/**
 * Line numbers inside Worker test blocks that assert nothing.
 *
 * Eight files in `workers/src` contain 90 tests whose body is a prose comment
 * describing a scenario followed by `expect(true).toBe(true)`. They pass, they
 * are counted by the runner, and they constrain no behaviour. Two are entirely
 * of this form — `__tests__/multi-tenant-isolation.test.ts` (8/8) and
 * `handlers/handlers.test.ts` (20/20) — and the first is by far the most
 * plausible thing to cite as the Worker equivalent of the backend's
 * tenant-isolation gate.
 *
 * Citing one as a *negative* ("searched X, none found") is correct and common;
 * every such citation in the merged manifests is of that kind. Citing one as
 * positive proof that an equivalent **exists** would retire a real gate against
 * a test that cannot fail. Only the latter is flagged, in {@link verify}.
 *
 * A block counts as tautological only if it has at least one assertion and
 * *every* assertion in it is a tautology, so a file that is partly placebo
 * (e.g. 4 of 13) yields findings only on its placebo lines.
 */
function tautologicalLines(file) {
  // Comments must be stripped before assertions are counted. These blocks
  // document the test they are standing in for, and that prose contains lines
  // like `// - Assert: expect(productsA).toHaveLength(10)`. Counting those as
  // real assertions makes a pure-placebo block look mixed, and the check
  // silently misses it — which is precisely how the first test in
  // `multi-tenant-isolation.test.ts` escaped the first version of this function.
  const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const starts = [];
  lines.forEach((line, i) => {
    if (TEST_CASE_LINE.test(line)) starts.push(i);
  });

  const flagged = new Set();
  starts.forEach((start, n) => {
    const end = n + 1 < starts.length ? starts[n + 1] : lines.length;
    const body = stripComments(lines.slice(start, end).join('\n'));
    const total = (body.match(ANY_EXPECT) || []).length;
    const taut = (body.match(TAUTOLOGY) || []).length;
    if (total === 0 || taut !== total) return;
    // Line numbers are 1-based in citations; `end` is an exclusive 0-based
    // index, so it is already the last 1-based line of this block.
    for (let l = start + 1; l <= Math.min(end, lines.length); l += 1) flagged.add(l);
  });
  return flagged;
}

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
  const coverage = checkSectionCoverage(markdown, backendIndex);
  findings.push(...coverage.findings);

  // 5. No row may claim an equivalent EXISTS on the strength of a test that
  //    asserts nothing.
  const tautology = checkTautologicalCitations(markdown);
  findings.push(...tautology.findings);

  return {
    findings,
    stats: {
      tautRows: tautology.tautRows,
      sections: coverage.sections,
      covered: coverage.covered,
      rows: coverage.rows,
      citations: cited.length,
      tables: column.tables,
    },
  };
}

/**
 * Resolves a section heading to the backend test file it describes.
 *
 * A heading may be a bare basename (`foo.test.ts`, as Parts 1-3 use, where every
 * file lives in `unit/`) or a path relative to `backend/src/tests`
 * (`integration/foo.test.ts`). Part 4 needs the second form because basenames
 * genuinely collide across directories — `upload.controller.test.ts` and
 * `storage-factory.test.ts` each exist in two places, and a bare name would
 * silently count a section against the wrong file's test count.
 *
 * Returns `{ file }` on success or `{ error }` describing why not.
 */
function resolveSectionFile(heading, backendIndex) {
  const paths = heading.includes('/')
    ? [path.join(BACKEND_TESTS, heading)].filter(fs.existsSync)
    : backendIndex.get(heading);

  if (!paths || !paths.length) {
    return { error: `[scope] section "${heading}" matches no file under ${BACKEND_TESTS}` };
  }
  if (paths.length > 1) {
    // Hard failure, not a warning. Guessing picks a file with a different test
    // count, so the coverage check then reports a defect that does not exist
    // (or, worse, misses one that does) — `storage-factory.test.ts` has 5 tests
    // under `unit/` and 16 under `integration/`. The heading must say which, and
    // the fix is to qualify it: `unit/storage-factory.test.ts`.
    return {
      error:
        `[scope] "${heading}" is ambiguous — ${paths.length} files share that name ` +
        `(${paths.join(', ')}); qualify the heading with its directory`,
    };
  }
  return { file: paths[0] };
}

/** Check 4: no section may cover fewer behaviours than its file has test cases. */
function checkSectionCoverage(markdown, backendIndex) {
  const findings = [];
  const sections = parseSections(markdown);
  let covered = 0;
  let rows = 0;

  for (const section of sections) {
    rows += section.rows;

    const resolved = resolveSectionFile(section.heading, backendIndex);
    if (resolved.error) {
      findings.push({ level: 'fail', message: resolved.error });
      continue;
    }

    const tests = countTestCases(resolved.file);
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

  return { findings, sections: sections.length, covered, rows };
}

/**
 * Check 5: a `worker-equivalent-exists` row may not rest on a test that cannot
 * fail.
 *
 * Scoped to that target because it is the only one where the citation is
 * load-bearing: a `retire` or `worker-shaped-rewrite` row cites these files to
 * record what was searched, which is correct use.
 */
function checkTautologicalCitations(markdown) {
  const findings = [];
  const tautCache = new Map();
  let tautRows = 0;

  for (const line of markdown.split(/\r?\n/)) {
    const row = line.trim();
    if (!row.startsWith('|')) continue;
    const cells = row.split('|').map((c) => c.trim());
    // Behaviour | file:line | gate | equivalent? | Target | Evidence | Decision
    if (cells.length < 8 || cells[5] !== 'worker-equivalent-exists') continue;

    for (const match of cells[4].matchAll(WORKER_CITE)) {
      const [cite, lineNo] = [match[0], Number(match[1])];
      const file = cite.slice(0, cite.lastIndexOf(':'));
      if (!fs.existsSync(file)) continue; // already reported by check 2
      if (!tautCache.has(file)) tautCache.set(file, tautologicalLines(file));
      if (!tautCache.get(file).has(lineNo)) continue;

      tautRows += 1;
      findings.push({
        level: 'fail',
        message:
          `[tautology] a worker-equivalent-exists row cites ${cite}, which is inside a test ` +
          'whose only assertion is `expect(true).toBe(true)` — it cannot fail, so it cannot ' +
          `evidence an equivalent (behaviour: "${cells[1].slice(0, 70)}")`,
      });
    }
  }

  return { findings, tautRows };
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
      'Note: this proves no citation is missing, no negative is unqualified, no section\n' +
        'under-covers its file, and no equivalence rests on a test that cannot fail. It does\n' +
        'NOT prove a cited line supports the claim attached to it — that still takes reading\n' +
        'the source.',
    );
  }
  return failures ? 1 : 0;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = {
  parseSections,
  countTestCases,
  indexBackendTests,
  tautologicalLines,
  verify,
  main,
};
