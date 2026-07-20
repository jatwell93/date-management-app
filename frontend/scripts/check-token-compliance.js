#!/usr/bin/env node
/* global require, __dirname, console, process, module */

/**
 * Token Compliance Checker
 *
 * Scans frontend component files for non-token styling patterns:
 * - Hardcoded hex colors in style attributes or className strings
 * - Direct inventory-* class usage where semantic tokens exist
 * - Hardcoded Tailwind color utilities (should use semantic/shadcn tokens)
 *
 * Exit code 0 = no NEW violations (baseline violations are counted but allowed)
 * Exit code 1 = new violations found above baseline
 *
 * Usage:
 *   node scripts/check-token-compliance.js [--baseline] [--fix-suggestions]
 */

const fs = require('fs');
const path = require('path');

const SRC_DIR = path.resolve(__dirname, '..', 'src');
const BASELINE_FILE = path.resolve(__dirname, '..', '.token-compliance-baseline.json');

/* ── Patterns to detect ───────────────────────────────────────── */

const COLOR_UTILITY_PREFIXES = [
  'accent',
  'bg',
  'border',
  'caret',
  'decoration',
  'divide',
  'fill',
  'from',
  'outline',
  'placeholder',
  'ring',
  'shadow',
  'stroke',
  'text',
  'to',
  'via',
];
const COLOR_UTILITY_PATTERN = COLOR_UTILITY_PREFIXES.join('|');
const RAW_TAILWIND_COLOR_NAMES = [
  'black',
  'blue',
  'cyan',
  'green',
  'indigo',
  'neutral',
  'pink',
  'purple',
  'red',
  'rose',
  'sky',
  'slate',
  'stone',
  'teal',
  'violet',
  'white',
  'yellow',
  'zinc',
].join('|');
const TAILWIND_VARIANT_PATTERN =
  '(?:(?:active|dark|disabled|focus|focus-visible|group-hover|hover|lg|md|sm|xl|2xl):)*';

const RULES = [
  {
    id: 'hardcoded-hex-style',
    description: 'Hardcoded hex color in style attribute',
    // Matches style={{ color: '#xxx', backgroundColor: '#xxx' }} etc.
    pattern: /style\s*=\s*\{\{[^}]*#[0-9a-fA-F]{3,8}[^}]*\}\}/g,
    suggestion: 'Use a semantic token CSS variable instead (e.g., var(--semantic-primary))',
    severity: 'error',
  },
  {
    id: 'hardcoded-hex-classname',
    description: 'Hardcoded hex color in className or class string',
    // Matches className="... [#hex] ..." — rare in Tailwind but possible via arbitrary values
    pattern: /className\s*=\s*["'][^"']*\[#[0-9a-fA-F]{3,8}\][^"']*["']/g,
    suggestion: 'Use a semantic token Tailwind class instead (e.g., bg-semantic-primary)',
    severity: 'error',
  },
  {
    id: 'inventory-class-usage',
    description: 'Deprecated inventory-* Tailwind class',
    // Matches bg-inventory-*, text-inventory-*, border-inventory-*, etc.
    pattern: /(?:bg|text|border|ring|outline|from|to|via)-inventory-[a-z]+-\d+/g,
    suggestion:
      'Replace with semantic-* equivalent (e.g., text-inventory-error-500 → text-semantic-critical)',
    severity: 'warning',
  },
  {
    id: 'amber-restraint-usage',
    description: 'Raw amber utility or deprecated warning token bypasses semantic-warning policy',
    pattern: new RegExp(`(?:${COLOR_UTILITY_PATTERN})-(?:amber-\\d+|inventory-warning-\\d+)`, 'g'),
    suggestion:
      'Use semantic-warning tokens only in approved warning/emphasis contexts (see AMBER_USAGE_GUIDE.md)',
    severity: 'error',
  },
  {
    id: 'hardcoded-gray-class',
    description: 'Hardcoded Tailwind gray class (use semantic token)',
    // Matches bg-gray-*, text-gray-*, border-gray-* etc.
    pattern: /(?:bg|text|border|ring|outline|from|to|via)-gray-\d+/g,
    suggestion:
      'Replace with semantic token (e.g., bg-gray-100 → bg-background or bg-muted, text-gray-800 → text-foreground)',
    severity: 'warning',
  },
  {
    id: 'hardcoded-tailwind-color-class',
    description: 'Hardcoded Tailwind color utility (use semantic token)',
    pattern: new RegExp(
      `(?:^|[\\s"'\\\`])(${TAILWIND_VARIANT_PATTERN}(?:${COLOR_UTILITY_PATTERN})-(?:${RAW_TAILWIND_COLOR_NAMES})(?:-\\d{2,3}|\\/\\d{1,3})?)(?=[\\s"'\\\`])`,
      'g',
    ),
    suggestion:
      'Replace raw Tailwind color utilities with semantic tokens (e.g., bg-semantic-primary, text-semantic-critical, text-semantic-primary-foreground)',
    severity: 'error',
  },
];

/* ── File exclusions ──────────────────────────────────────────── */

const EXCLUDED_PATH_SEGMENTS = ['node_modules/', '__tests__/'];
const EXCLUDED_FILE_PATTERNS = [
  /\.(test|spec)\.[^/]+$/,
  /design-tokens/,
  /tailwind\.config/,
  /\.d\.ts$/,
];
const EXCLUDED_FILE_NAMES = new Set(['globals.css', 'index.css', 'tailwind-output.css']);

/* ── Scanner ──────────────────────────────────────────────────── */

function scanFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  return scanContent(content, path.relative(SRC_DIR, filePath));
}

function scanContent(content, file = '<inline>') {
  const lines = content.split('\n');
  const violations = [];

  for (const rule of RULES) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let match;
      // Reset regex lastIndex for global patterns
      rule.pattern.lastIndex = 0;
      while ((match = rule.pattern.exec(line)) !== null) {
        const matchedText = match[1] || match[0];
        const columnOffset = match[1] ? match[0].length - matchedText.length : 0;
        violations.push({
          file,
          line: i + 1,
          column: match.index + columnOffset + 1,
          ruleId: rule.id,
          severity: rule.severity,
          description: rule.description,
          match: matchedText,
          suggestion: rule.suggestion,
        });
      }
    }
  }

  return violations;
}

const VALID_EXTENSIONS = new Set(['.tsx', '.jsx', '.ts', '.css', '.html']);

function isExcluded(filePath) {
  const rel = path.relative(SRC_DIR, filePath).replace(/\\/g, '/');
  const isInExcludedSegment = EXCLUDED_PATH_SEGMENTS.some((segment) => rel.includes(segment));
  const matchesExcludedPattern = EXCLUDED_FILE_PATTERNS.some((pattern) => pattern.test(rel));

  return (
    isInExcludedSegment ||
    rel.startsWith('theme/') ||
    matchesExcludedPattern ||
    EXCLUDED_FILE_NAMES.has(rel)
  );
}

function walkDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return walkDir(fullPath);
    if (!entry.isFile()) return [];
    if (!VALID_EXTENSIONS.has(path.extname(entry.name))) return [];
    return isExcluded(fullPath) ? [] : [fullPath];
  });
}

function getComponentFiles() {
  return walkDir(SRC_DIR);
}

/* ── Reporting ────────────────────────────────────────────────── */

function formatViolation(v) {
  const icon = v.severity === 'error' ? '✖' : '⚠';
  return `  ${icon} ${v.file}:${v.line}:${v.column} — ${v.description}\n    Match: ${v.match}\n    Fix: ${v.suggestion}`;
}

function summarizeViolations(violations) {
  const errors = violations.filter((v) => v.severity === 'error');
  const warnings = violations.filter((v) => v.severity === 'warning');
  return { errors, warnings, total: violations.length };
}

function buildBaseline(violations) {
  const { errors, warnings, total } = summarizeViolations(violations);
  return {
    timestamp: new Date().toISOString(),
    totalViolations: total,
    errors: errors.length,
    warnings: warnings.length,
    byRule: violations.reduce((counts, violation) => {
      counts[violation.ruleId] = (counts[violation.ruleId] || 0) + 1;
      return counts;
    }, {}),
  };
}

function getBaselineDelta(baseline, violations) {
  return violations.length - baseline.totalViolations;
}

function parseBaselineContent(content) {
  try {
    return JSON.parse(content);
  } catch (error) {
    throw new Error(
      `Token compliance baseline is malformed JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function getComplianceFailure(baseline, violations) {
  const { errors } = summarizeViolations(violations);
  const delta = getBaselineDelta(baseline, violations);
  const baselineErrors = baseline.errors || 0;
  const newErrors = Math.max(0, errors.length - baselineErrors);
  const amberErrors = errors.filter((violation) => violation.ruleId === 'amber-restraint-usage');

  return {
    shouldFail: delta > 0 || newErrors > 0 || amberErrors.length > 0,
    delta,
    newErrors,
    amberErrors: amberErrors.length,
  };
}

function printReport(files, violations) {
  const { errors, warnings, total } = summarizeViolations(violations);

  console.log('\n🔍 Token Compliance Report');
  console.log('═'.repeat(50));
  console.log(`Files scanned: ${files.length}`);
  console.log(`Errors: ${errors.length}`);
  console.log(`Warnings: ${warnings.length}`);
  console.log(`Total violations: ${total}`);

  if (total === 0) return;

  console.log('\n── Violations ──\n');
  for (const violation of violations) {
    console.log(formatViolation(violation));
  }
}

function saveBaseline(violations) {
  const baseline = buildBaseline(violations);
  fs.writeFileSync(BASELINE_FILE, JSON.stringify(baseline, null, 2));
  console.log(`\n✅ Baseline saved to ${path.relative(process.cwd(), BASELINE_FILE)}`);
  console.log(`   Total baseline violations: ${baseline.totalViolations}`);
}

function printBaselineComparison(baseline, violations) {
  const delta = getBaselineDelta(baseline, violations);
  console.log(`\n── Baseline Comparison ──`);
  console.log(`Baseline: ${baseline.totalViolations} violations (${baseline.timestamp})`);
  console.log(`Current:  ${violations.length} violations`);
  console.log(`Delta:    ${delta > 0 ? '+' : ''}${delta}`);

  return delta;
}

function exitForComplianceFailure(failure) {
  if (failure.shouldFail) {
    if (failure.delta > 0) {
      console.log(`\n❌ FAIL: ${failure.delta} new violation(s) introduced above baseline.`);
    }
    if (failure.newErrors > 0) {
      console.log(`\n❌ FAIL: ${failure.newErrors} new error-level violation(s) introduced.`);
    }
    if (failure.amberErrors > 0) {
      console.log(`\n❌ FAIL: ${failure.amberErrors} amber restraint violation(s) found.`);
    }
    console.log(
      '   Fix new violations or update baseline with: node scripts/check-token-compliance.js --baseline',
    );
    process.exit(1);
  }

  console.log('\n✅ PASS: No new violations above baseline.');
  process.exit(0);
}

/* ── Main ─────────────────────────────────────────────────────── */

function main() {
  const args = process.argv.slice(2);
  const isBaseline = args.includes('--baseline');

  const files = getComponentFiles();
  const allViolations = files.flatMap((file) => scanFile(file));
  printReport(files, allViolations);

  if (isBaseline) {
    saveBaseline(allViolations);
    process.exit(0);
  }

  if (!fs.existsSync(BASELINE_FILE)) {
    console.log('\n⚠ No baseline found. Run with --baseline to set initial baseline.');
    console.log('  node scripts/check-token-compliance.js --baseline');
    process.exit(0);
  }

  const baseline = parseBaselineContent(fs.readFileSync(BASELINE_FILE, 'utf-8'));
  printBaselineComparison(baseline, allViolations);
  exitForComplianceFailure(getComplianceFailure(baseline, allViolations));
}

if (require.main === module) {
  main();
}

module.exports = {
  buildBaseline,
  getComplianceFailure,
  getBaselineDelta,
  parseBaselineContent,
  isExcluded,
  scanContent,
  summarizeViolations,
};
