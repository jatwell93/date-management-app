const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { main } = require('./route-map.js');

const REPO = path.resolve(__dirname, '..');

function run(root) {
  const out = [];
  const err = [];
  const code = main(['--root', root], { log: (l) => out.push(l), error: (l) => err.push(l) });
  return { code, out, err };
}

function fixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'route-map-'));
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  }
  return root;
}

const INDEX = (table) =>
  [
    "import { handleImported } from './mod/imported';",
    "import { handleDecoy } from './mod/decoy';",
    'const RE_ITEM = /^\\/api\\/items\\/\\d+$/;',
    'async function handleInline(): Promise<void> {}',
    'const handleArrow = async () => {};',
    'export const MINIMAL_API_ROUTES: MinimalApiRoute[] = [',
    table,
    '];',
    '',
  ].join('\n');

test('real index-minimal.ts: one line per entry, every file:line declares the handler', () => {
  const { code, out } = run(REPO);
  assert.equal(code, 0);
  const src = fs.readFileSync(path.join(REPO, 'workers/src/index-minimal.ts'), 'utf8');
  const start = src.indexOf('export const MINIMAL_API_ROUTES');
  const table = src.slice(start, src.indexOf('\n];', start));
  const expected = (table.match(/^ {2}\[(?:'[A-Z]+',|$)/gm) || []).length;
  assert.ok(expected > 50);
  assert.equal(out.length, expected);
  for (const line of out) {
    const [method, route, handler, loc] = line.split('\t');
    assert.match(method, /^[A-Z]+$/);
    assert.ok(route);
    const [file, n] = loc.split(/:(\d+)$/);
    const text = fs.readFileSync(path.join(REPO, file), 'utf8').split('\n')[Number(n) - 1];
    assert.match(text, new RegExp(`(function|const)\\s+${handler}\\b`));
  }
  const products = out.find((l) => l.startsWith('GET\t/api/products\t'));
  assert.match(products, /\thandleGetProducts\tworkers\/src\/index-minimal\.ts:\d+$/);
});

test('fixture: inline path, RE_ pattern, inline regex, multi-line entry, imported handler', () => {
  const root = fixture({
    'workers/src/index-minimal.ts': INDEX(
      [
        "  ['GET', '/api/a', handleInline],",
        "  ['PUT', RE_ITEM, handleArrow, 'path'],",
        "  ['GET', /^\\/api\\/x\\/[^/]+$/, handleInline, 'path'],",
        '  [',
        "    'POST',",
        "    '/api/multi',",
        '    handleInline,',
        '  ],',
        "  ['POST', '/api/imp', handleImported],",
      ].join('\n'),
    ),
    'workers/src/mod/imported.ts': '// x\nexport async function handleImported() {}\n',
  });
  const { code, out } = run(root);
  assert.equal(code, 0);
  assert.deepEqual(out, [
    'GET\t/api/a\thandleInline\tworkers/src/index-minimal.ts:4',
    'PUT\t^\\/api\\/items\\/\\d+$\thandleArrow\tworkers/src/index-minimal.ts:5',
    'GET\t^\\/api\\/x\\/[^/]+$\thandleInline\tworkers/src/index-minimal.ts:4',
    'POST\t/api/multi\thandleInline\tworkers/src/index-minimal.ts:4',
    'POST\t/api/imp\thandleImported\tworkers/src/mod/imported.ts:2',
  ]);
});

test('fixture: a test file with the handler name is never reported', () => {
  const root = fixture({
    'workers/src/index-minimal.ts': INDEX("  ['GET', '/api/d', handleDecoy],"),
    'workers/src/mod/decoy.test.ts': 'export function handleDecoy() {}\n',
    'workers/src/mod/decoy.ts': 'export const other = 1;\n',
  });
  const { code, out, err } = run(root);
  assert.equal(code, 1);
  assert.deepEqual(out, []);
  assert.match(err.join('\n'), /handleDecoy/);
  assert.doesNotMatch(err.join('\n'), /decoy\.test/);
});

test('fixture: an unparseable entry exits non-zero and is named', () => {
  const root = fixture({
    'workers/src/index-minimal.ts': INDEX(
      ["  ['GET', '/api/ok', handleInline],", "  ['GET', `/api/${x}`, handleInline],"].join('\n'),
    ),
  });
  const { code, err } = run(root);
  assert.equal(code, 1);
  assert.match(err.join('\n'), /index-minimal\.ts:8:.*unrecognised path/);
});

test('fixture: a handler that cannot be located exits non-zero and is named', () => {
  const root = fixture({
    'workers/src/index-minimal.ts': INDEX("  ['GET', '/api/ghost', handleGhost],"),
  });
  const { code, err } = run(root);
  assert.equal(code, 1);
  assert.match(err.join('\n'), /cannot locate handleGhost/);
});

test('the script does not modify any file', () => {
  const root = fixture({
    'workers/src/index-minimal.ts': INDEX("  ['GET', '/api/a', handleInline],"),
  });
  const file = path.join(root, 'workers/src/index-minimal.ts');
  const before = fs.readFileSync(file, 'utf8');
  run(root);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.deepEqual(fs.readdirSync(root), ['workers']);
});
