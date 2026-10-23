// The complexity baseline may only shrink: every entry must still exist, so a
// deleted or renamed file cannot leave a stale exemption behind for whatever
// later takes its path.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const BASELINE = require('../eslint.complexity-baseline.js');

test('every complexity-baseline entry is an existing file', () => {
  const missing = BASELINE.filter((f) => !fs.existsSync(path.join(ROOT, f)));
  assert.deepEqual(missing, [], 'remove these from eslint.complexity-baseline.js');
});

test('the baseline has no duplicates and is sorted', () => {
  assert.deepEqual(BASELINE, [...new Set(BASELINE)].sort());
});
