const assert = require('node:assert/strict');
const test = require('node:test');

const { selectLintableFiles } = require('./lint-diff');

// `exists` is injected so these cases describe the filtering rules rather than
// the state of the working tree.
const allExist = () => true;

test('keeps only extensions the root ESLint config handles', () => {
  const files = selectLintableFiles(
    [
      'scripts/a.js',
      'src/b.ts',
      'src/c.tsx',
      'src/d.mjs',
      'src/e.cjs',
      'src/f.mts',
      'src/g.cts',
      'src/h.jsx',
      'package.json',
      'README.md',
      'database/migrations/0000_baseline.up.sql',
      'workers/wrangler.toml',
      'assets/logo.png',
      'scripts/pitr-drill.sh',
    ],
    { exists: allExist },
  );

  assert.deepEqual(files, [
    'scripts/a.js',
    'src/b.ts',
    'src/c.tsx',
    'src/d.mjs',
    'src/e.cjs',
    'src/f.mts',
    'src/g.cts',
    'src/h.jsx',
  ]);
});

test('matches the extension case-insensitively', () => {
  assert.deepEqual(selectLintableFiles(['src/A.TS', 'src/B.Js'], { exists: allExist }), [
    'src/A.TS',
    'src/B.Js',
  ]);
});

test('deduplicates a file listed by more than one git listing', () => {
  // A staged-and-then-edited file appears in both the diff and the untracked
  // listing in some states; passing it twice makes ESLint lint it twice.
  assert.deepEqual(
    selectLintableFiles(['src/a.ts', 'src/a.ts', 'src/b.ts'], { exists: allExist }),
    ['src/a.ts', 'src/b.ts'],
  );
});

test('drops a path that no longer exists', () => {
  // A file staged and then deleted still shows up in a git listing. Handing it to
  // ESLint is a hard error ("No files matching the pattern were found"), not a
  // skipped file — so it must be filtered, not merely tolerated.
  const files = selectLintableFiles(['src/gone.ts', 'src/here.ts'], {
    exists: (file) => file !== 'src/gone.ts',
  });
  assert.deepEqual(files, ['src/here.ts']);
});

test('ignores blank entries from splitting git output', () => {
  // `git diff --name-only` output ends with a newline, so a naive split yields a
  // trailing empty string. ESLint treats an empty argument as the current
  // directory and would lint the entire repository — the exact cost this script
  // exists to avoid.
  //
  // The extension filter is what excludes these: `path.extname('')` is `''`.
  // Worth stating, because the obvious reading is that an explicit blank-string
  // guard does it — one was written here first, and a mutation showed every test
  // still passed without it. This test is regression cover for the property, not
  // evidence for a particular line.
  assert.deepEqual(selectLintableFiles(['src/a.ts', '', '   ', '\n'], { exists: allExist }), [
    'src/a.ts',
  ]);
});

test('returns an empty list when nothing lintable changed', () => {
  assert.deepEqual(selectLintableFiles(['README.md', 'package.json'], { exists: allExist }), []);
});

test('sorts output so runs are reproducible', () => {
  assert.deepEqual(
    selectLintableFiles(['src/z.ts', 'src/a.ts', 'src/m.ts'], { exists: allExist }),
    ['src/a.ts', 'src/m.ts', 'src/z.ts'],
  );
});
