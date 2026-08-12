#!/usr/bin/env node
/**
 * Phase 2 — audit-matrix column distribution check.
 *
 * The Phase 2 audit deliverables are large markdown tables (route matrix, test
 * manifest, schedule matrix, script inventory). Their failure mode is not a
 * malformed table — it is a **column whose value does not depend on the thing it
 * claims to measure**. Two real instances, both found by hand in Wave B:
 *
 *   1. `2.2-test-manifest-part1.md` carried 417 rows reading
 *      "unknown - not yet searched" in the evidence column while proposing a
 *      target that presumes the search came back empty. The target did not
 *      follow from its own evidence.
 *   2. A route row was classified `mounted+consumed` citing a real file that
 *      never calls the route.
 *
 * This script catches the first class mechanically. It reports, per column:
 * distinct value count and the share held by the most common value, then fails
 * on the patterns that indicate a column nobody actually filled in.
 *
 * WHAT THIS CANNOT CATCH — stated plainly so the gate is not mistaken for more
 * than it is: a column with a healthy distribution of values, every one of which
 * is wrong, passes. Defect (2) above passes this check. Distribution analysis
 * finds unfilled columns; only reading the cited source finds false ones.
 *
 * Usage:
 *   node scripts/check-audit-columns.js [file...]
 *
 * With no arguments, checks every *.md under
 * `openspec/changes/<change>/audit/`.
 *
 * Exit codes: 0 = no failures (warnings allowed), 1 = at least one failure.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

/** Columns with fewer rows than this are too small for distribution analysis. */
const MIN_ROWS = 20;

/** Share of a single value above which a column is suspicious but not failed. */
const DOMINANCE_WARN = 0.95;

/**
 * Cell values that admit the column was never actually filled in.
 *
 * `TODO`/`FIXME` are fenced with `(?<![\w-])`/`(?![\w-])` rather than `\b` so
 * they only match as standalone tokens. `\b` is not enough: in a legitimate
 * citation like `todo-list-spec.md` the word boundary falls on the hyphen and
 * the pattern would fire on real content.
 */
const UNMEASURED =
  /not yet searched|not checked|(?<![\w-])TODO(?![\w-])|(?<![\w-])FIXME(?![\w-])|<fill/i;

/** A decision cell that asserts something specific rather than deferring. */
const ASSERTED_DECISION = /PROPOSED:\s*(?!unknown)[a-z-]+/i;

/**
 * An evidence cell that admits it has no evidence.
 *
 * Deliberately anchored: a bare "none found" matches, but "none found (searched:
 * workers/src/upload/csv-parser.test.ts)" does not. An unqualified negative does
 * not say what was looked at, so it cannot support a decision; a negative that
 * names the search does.
 *
 * **An empty cell matches this pattern, and that is deliberate.** Every group is
 * optional, so `''` is a member of the language. A blank evidence cell paired
 * with an asserted decision is the purest form of the defect this gate exists to
 * catch — a conclusion with literally nothing behind it. Tightening the pattern
 * to require a token (making the first group non-optional) would let
 * `| | PROPOSED: retire |` through. Do not "fix" that; `blank evidence cannot
 * support an asserted decision` is pinned by a test.
 */
const NO_EVIDENCE =
  /^(unknown|none found|n\/a|-|—)?\s*(unknown|not searched|not yet searched)?\s*$/i;

function parseTables(markdown) {
  const lines = markdown.split(/\r?\n/);
  const tables = [];
  let current = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    const isRow = line.startsWith('|') && line.endsWith('|');
    if (!isRow) {
      if (current && current.rows.length) tables.push(current);
      current = null;
      continue;
    }
    const cells = splitRow(line);
    const isSeparator = cells.every((c) => /^:?-{2,}:?$/.test(c.trim()));
    if (isSeparator) continue;
    if (!current) {
      current = { headers: cells, rows: [], startLine: i + 1 };
      continue;
    }
    // Ragged rows are a formatting problem, not a distribution problem; pad.
    while (cells.length < current.headers.length) cells.push('');
    current.rows.push(cells);
  }
  if (current && current.rows.length) tables.push(current);
  return tables;
}

function splitRow(line) {
  // Drop the leading and trailing pipe, then split on unescaped pipes.
  const inner = line.slice(1, -1);
  const out = [];
  let buf = '';
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i];
    if (ch === '\\' && inner[i + 1] === '|') {
      buf += '|';
      i += 1;
    } else if (ch === '|') {
      out.push(buf.trim());
      buf = '';
    } else {
      buf += ch;
    }
  }
  out.push(buf.trim());
  return out;
}

/**
 * Analyse a whole document, aggregating each column by header name across every
 * table in it. Audit matrices are one logical matrix split into per-subject
 * sections; a column that is uniform *within* a section is usually correct and
 * informative (every route under one mount sharing an auth type, say). The
 * meaningful question is whether the column varies across the document.
 */
function analyseTables(tables, file) {
  const findings = [];
  const byColumn = new Map();

  for (const table of tables) {
    table.headers.forEach((header, col) => {
      const key = header.trim();
      if (!key) return;
      const values = table.rows.map((r) => (r[col] || '').trim()).filter((v) => v.length > 0);
      const existing = byColumn.get(key) || [];
      byColumn.set(key, existing.concat(values));
    });
  }

  byColumn.forEach((values, header) => {
    if (values.length < MIN_ROWS) return;

    const counts = new Map();
    for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
    const distinct = counts.size;
    const [topValue, topCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    const share = topCount / values.length;

    if (distinct === 1) {
      findings.push({
        level: 'fail',
        file,
        column: header,
        message:
          `column is constant across ${values.length} rows (every cell is "${truncate(topValue)}") — ` +
          'a column with one value measures nothing',
      });
    } else if (share >= DOMINANCE_WARN) {
      findings.push({
        level: 'warn',
        file,
        column: header,
        message:
          `${(share * 100).toFixed(1)}% of ${values.length} rows share one value ` +
          `("${truncate(topValue)}") across ${distinct} distinct values`,
      });
    }
  });

  const unmeasured = [];
  let totalRows = 0;
  let inferenceCount = 0;

  for (const table of tables) {
    totalRows += table.rows.length;
    table.rows.forEach((row) => {
      row.forEach((cell, col) => {
        if (UNMEASURED.test(cell)) {
          unmeasured.push(table.headers[col] || `col${col}`);
        }
      });
    });
    inferenceCount += countUnsupportedDecisions(table);
  }

  if (unmeasured.length) {
    findings.push({
      level: 'fail',
      file,
      column: [...new Set(unmeasured)].join(', '),
      message:
        `${unmeasured.length} cell(s) admit the value was never determined ` +
        `(matched /${UNMEASURED.source}/) — resolve them or record an explicit unknown decision`,
    });
  }

  if (inferenceCount > 0) {
    findings.push({
      level: 'fail',
      file,
      column: 'evidence -> decision',
      message:
        `${inferenceCount} of ${totalRows} rows assert a specific decision while recording no ` +
        'evidence — the conclusion does not follow from its own premise',
    });
  }

  return findings;
}

/**
 * Flag rows whose decision asserts a specific verdict while the row's own
 * evidence cell records that no evidence was gathered. This is the generalised
 * form of the 2.2 defect: a conclusion that does not depend on its premise.
 */
function countUnsupportedDecisions(table) {
  const decisionCol = table.headers.findIndex((h) => /decision/i.test(h));
  const evidenceCol = table.headers.findIndex((h) => /evidence|equivalent|consumer/i.test(h));
  if (decisionCol === -1 || evidenceCol === -1) return 0;

  let count = 0;
  for (const row of table.rows) {
    const decision = (row[decisionCol] || '').trim();
    const evidence = (row[evidenceCol] || '').trim();
    if (
      ASSERTED_DECISION.test(decision) &&
      (NO_EVIDENCE.test(evidence) || UNMEASURED.test(evidence))
    ) {
      count += 1;
    }
  }
  return count;
}

function truncate(value, max = 60) {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function defaultTargets() {
  const base = path.join('openspec', 'changes');
  if (!fs.existsSync(base)) return [];
  const out = [];
  for (const change of fs.readdirSync(base)) {
    const dir = path.join(base, change, 'audit');
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.md')) out.push(path.join(dir, f));
    }
  }
  return out;
}

function checkFile(file) {
  let markdown;
  try {
    markdown = fs.readFileSync(file, 'utf8');
  } catch (err) {
    // A path that cannot be read is reported as an ordinary failure rather than
    // thrown. This runs as a CI gate, where an unhandled stack trace reads
    // identically to a real audit failure and sends the reader hunting through
    // the matrix for a defect that is really a typo in the file list.
    return {
      tables: 0,
      findings: [
        { level: 'fail', file, column: '—', message: `could not read file: ${err.message}` },
      ],
    };
  }
  const tables = parseTables(markdown);
  const findings = analyseTables(tables, file);
  return { tables: tables.length, findings };
}

function main(argv) {
  const targets = argv.length ? argv : defaultTargets();
  if (!targets.length) {
    console.log('No audit matrices found; nothing to check.');
    return 0;
  }

  let failures = 0;
  let warnings = 0;

  for (const file of targets) {
    const { tables, findings } = checkFile(file);
    const fails = findings.filter((f) => f.level === 'fail');
    const warns = findings.filter((f) => f.level === 'warn');
    failures += fails.length;
    warnings += warns.length;

    const status = fails.length ? 'FAIL' : warns.length ? 'WARN' : 'OK';
    console.log(`${status}  ${file}  (${tables} table(s))`);
    for (const f of [...fails, ...warns]) {
      console.log(`      [${f.level}] ${f.column}: ${f.message}`);
    }
  }

  console.log(`\n${failures} failure(s), ${warnings} warning(s) across ${targets.length} file(s).`);
  return failures ? 1 : 0;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = { parseTables, splitRow, analyseTables, checkFile, main };
