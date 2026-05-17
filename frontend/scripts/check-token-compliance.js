#!/usr/bin/env node

/**
 * Token Compliance Checker
 *
 * Scans frontend component files for non-token styling patterns:
 * - Hardcoded hex colors in style attributes or className strings
 * - Direct inventory-* class usage where semantic tokens exist
 * - Hardcoded Tailwind gray-* classes (should use semantic/shadcn tokens)
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
    suggestion: 'Replace with semantic-* equivalent (e.g., text-inventory-error-500 → text-semantic-critical)',
    severity: 'warning',
  },
  {
    id: 'hardcoded-gray-class',
    description: 'Hardcoded Tailwind gray class (use semantic token)',
    // Matches bg-gray-*, text-gray-*, border-gray-* etc.
    pattern: /(?:bg|text|border|ring|outline|from|to|via)-gray-\d+/g,
    suggestion: 'Replace with semantic token (e.g., bg-gray-100 → bg-background or bg-muted, text-gray-800 → text-foreground)',
    severity: 'warning',
  },
  {
    id: 'hardcoded-white-class',
    description: 'Hardcoded bg-white class (use semantic token)',
    pattern: /\bbg-white\b/g,
    suggestion: 'Replace with bg-background, bg-card, or bg-popover depending on context',
    severity: 'warning',
  },
];

/* ── File exclusions ──────────────────────────────────────────── */

const EXCLUDED_PATTERNS = [
  '**/node_modules/**',
  '**/__tests__/**',
  '**/*.test.*',
  '**/*.spec.*',
  '**/theme/**',           // Token definition files are allowed to use raw values
  '**/design-tokens.*',
  '**/tailwind.config.*',
  '**/globals.css',
  '**/index.css',
  '**/*.d.ts',
];

/* ── Scanner ──────────────────────────────────────────────────── */

function scanFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const violations = [];

  for (const rule of RULES) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let match;
      // Reset regex lastIndex for global patterns
      rule.pattern.lastIndex = 0;
      while ((match = rule.pattern.exec(line)) !== null) {
        violations.push({
          file: path.relative(SRC_DIR, filePath),
          line: i + 1,
          column: match.index + 1,
          ruleId: rule.id,
          severity: rule.severity,
          description: rule.description,
          match: match[0],
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
  if (rel.includes('node_modules/')) return true;
  if (rel.includes('__tests__/')) return true;
  if (/\.(test|spec)\.[^/]+$/.test(rel)) return true;
  if (rel.startsWith('theme/')) return true;
  if (rel.includes('design-tokens')) return true;
  if (rel.includes('tailwind.config')) return true;
  if (rel === 'globals.css' || rel === 'index.css' || rel === 'tailwind-output.css') return true;
  if (rel.endsWith('.d.ts')) return true;
  return false;
}

function walkDir(dir) {
  let results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(walkDir(fullPath));
    } else if (entry.isFile() && VALID_EXTENSIONS.has(path.extname(entry.name))) {
      if (!isExcluded(fullPath)) {
        results.push(fullPath);
      }
    }
  }
  return results;
}

function getComponentFiles() {
  return walkDir(SRC_DIR);
}

/* ── Reporting ────────────────────────────────────────────────── */

function formatViolation(v) {
  const icon = v.severity === 'error' ? '✖' : '⚠';
  return `  ${icon} ${v.file}:${v.line}:${v.column} — ${v.description}\n    Match: ${v.match}\n    Fix: ${v.suggestion}`;
}

function groupBySeverity(violations) {
  const errors = violations.filter((v) => v.severity === 'error');
  const warnings = violations.filter((v) => v.severity === 'warning');
  return { errors, warnings };
}

/* ── Main ─────────────────────────────────────────────────────── */

function main() {
  const args = process.argv.slice(2);
  const isBaseline = args.includes('--baseline');
  const showSuggestions = args.includes('--fix-suggestions');

  const files = getComponentFiles();
  let allViolations = [];

  for (const file of files) {
    const violations = scanFile(file);
    allViolations = allViolations.concat(violations);
  }

  const { errors, warnings } = groupBySeverity(allViolations);

  // Output report
  console.log('\n🔍 Token Compliance Report');
  console.log('═'.repeat(50));
  console.log(`Files scanned: ${files.length}`);
  console.log(`Errors: ${errors.length}`);
  console.log(`Warnings: ${warnings.length}`);
  console.log(`Total violations: ${allViolations.length}`);

  if (allViolations.length > 0) {
    console.log('\n── Violations ──\n');
    for (const v of allViolations) {
      console.log(formatViolation(v));
    }
  }

  // Baseline mode: save current count
  if (isBaseline) {
    const baseline = {
      timestamp: new Date().toISOString(),
      totalViolations: allViolations.length,
      errors: errors.length,
      warnings: warnings.length,
      byRule: {},
    };
    for (const v of allViolations) {
      baseline.byRule[v.ruleId] = (baseline.byRule[v.ruleId] || 0) + 1;
    }
    fs.writeFileSync(BASELINE_FILE, JSON.stringify(baseline, null, 2));
    console.log(`\n✅ Baseline saved to ${path.relative(process.cwd(), BASELINE_FILE)}`);
    console.log(`   Total baseline violations: ${allViolations.length}`);
    process.exit(0);
    return;
  }

  // CI mode: compare against baseline
  if (fs.existsSync(BASELINE_FILE)) {
    const baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf-8'));
    const newViolations = allViolations.length - baseline.totalViolations;
    console.log(`\n── Baseline Comparison ──`);
    console.log(`Baseline: ${baseline.totalViolations} violations (${baseline.timestamp})`);
    console.log(`Current:  ${allViolations.length} violations`);
    console.log(`Delta:    ${newViolations > 0 ? '+' : ''}${newViolations}`);

    if (newViolations > 0) {
      console.log(`\n❌ FAIL: ${newViolations} new violation(s) introduced above baseline.`);
      console.log('   Fix new violations or update baseline with: node scripts/check-token-compliance.js --baseline');
      process.exit(1);
    } else {
      console.log('\n✅ PASS: No new violations above baseline.');
      process.exit(0);
    }
  } else {
    console.log('\n⚠ No baseline found. Run with --baseline to set initial baseline.');
    console.log('  node scripts/check-token-compliance.js --baseline');
    // Don't fail without a baseline — just report
    process.exit(0);
  }
}

main();
