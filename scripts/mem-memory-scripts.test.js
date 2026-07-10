const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.join(__dirname, '..');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mem-scripts-'));
}

function writeFakeMemvid(dir, body) {
  const scriptPath = path.join(dir, process.platform === 'win32' ? 'memvid.cmd' : 'memvid');
  const content =
    process.platform === 'win32'
      ? `@echo off\r\nnode "${path.join(dir, 'fake-memvid.js')}" %*\r\n`
      : `#!/bin/sh\nnode "${path.join(dir, 'fake-memvid.js')}" "$@"\n`;

  fs.writeFileSync(path.join(dir, 'fake-memvid.js'), body);
  fs.writeFileSync(scriptPath, content);
  fs.chmodSync(scriptPath, 0o755);
}

function runNode(scriptName, args, env) {
  return spawnSync(process.execPath, [path.join(repoRoot, 'scripts', scriptName), ...args], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

test('mem-log appends JSONL even when local memvid index update fails', () => {
  const tempDir = makeTempDir();
  const memoryJsonl = path.join(tempDir, 'memory.jsonl');
  const memoryFile = path.join(tempDir, 'project-memory.mv2');

  writeFakeMemvid(
    tempDir,
    `
if (process.argv[2] === '--version') {
  console.log('memvid test');
  process.exit(0);
}
if (process.argv[2] === 'put') {
  process.stderr.write('simulated put failure');
  process.exit(7);
}
process.exit(1);
`,
  );

  const result = runNode(
    'mem-log.js',
    ['FIX', 'Dual Write Test', 'preserve source of truth on index failure'],
    {
      PATH: `${tempDir}${path.delimiter}${process.env.PATH}`,
      MEMORY_JSONL_PATH: memoryJsonl,
      MEMORY_FILE_PATH: memoryFile,
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const lines = fs.readFileSync(memoryJsonl, 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  const record = JSON.parse(lines[0]);
  assert.equal(record.kind, 'FIX');
  assert.equal(record.title, 'Dual Write Test');
  assert.equal(record.message, 'preserve source of truth on index failure');
  assert.match(record.ts, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(result.stderr, /Failed to update local memvid index/);
});

test('mem-rebuild regenerates the local mv2 index from memory.jsonl records', () => {
  const tempDir = makeTempDir();
  const memoryJsonl = path.join(tempDir, 'memory.jsonl');
  const memoryFile = path.join(tempDir, 'project-memory.mv2');
  const callsFile = path.join(tempDir, 'calls.jsonl');

  fs.writeFileSync(
    memoryJsonl,
    `${JSON.stringify({
      ts: '2026-01-26T05:28:56.000Z',
      kind: 'PATTERN',
      title: 'Auth Pattern',
      message: 'Authentication uses JWT tokens',
    })}\n`,
  );

  writeFakeMemvid(
    tempDir,
    `
const fs = require('node:fs');
const callsFile = process.env.CALLS_FILE;
const stdin = fs.readFileSync(0, 'utf8');
fs.appendFileSync(callsFile, JSON.stringify({ args: process.argv.slice(2), stdin }) + '\\n');
if (process.argv[2] === '--version') process.exit(0);
if (process.argv[2] === 'create') {
  fs.writeFileSync(process.argv[3], '');
  process.exit(0);
}
if (process.argv[2] === 'put') process.exit(0);
process.exit(1);
`,
  );

  const result = runNode('mem-rebuild.js', [], {
    PATH: `${tempDir}${path.delimiter}${process.env.PATH}`,
    MEMORY_JSONL_PATH: memoryJsonl,
    MEMORY_FILE_PATH: memoryFile,
    CALLS_FILE: callsFile,
  });

  assert.equal(result.status, 0, result.stderr);
  const calls = fs
    .readFileSync(callsFile, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));

  assert.deepEqual(calls[1].args, ['create', memoryFile]);
  assert.equal(calls[2].args[0], 'put');
  assert.equal(calls[2].args[1], memoryFile);
  assert.equal(calls[2].stdin, '[PATTERN] Authentication uses JWT tokens');
  const timestampIndex = calls[2].args.indexOf('--timestamp');
  assert.notEqual(timestampIndex, -1);
  assert.equal(
    calls[2].args[timestampIndex + 1],
    String(Math.floor(Date.parse('2026-01-26T05:28:56.000Z') / 1000)),
  );
  assert.match(result.stdout, /Rebuilt 1 memor/);
});

test('mem-backfill writes captions without the generated kind prefix', () => {
  const tempDir = makeTempDir();
  const memoryJsonl = path.join(tempDir, 'memory.jsonl');
  const memoryFile = path.join(tempDir, 'project-memory.mv2');

  writeFakeMemvid(
    tempDir,
    `
if (process.argv[2] === '--version') process.exit(0);
if (process.argv[2] === 'stats') {
  console.log('Frames: 1 total (1 active)');
  process.exit(0);
}
if (process.argv[2] === 'view') {
  console.log(JSON.stringify({
    frame: {
      timestamp: 1769405336,
      kind: 'fix',
      title: 'Prefix Test',
      metadata: { caption: '[FIX] remove only generated prefix' }
    }
  }));
  process.exit(0);
}
process.exit(1);
`,
  );

  const result = runNode('mem-backfill.js', [], {
    PATH: `${tempDir}${path.delimiter}${process.env.PATH}`,
    MEMORY_JSONL_PATH: memoryJsonl,
    MEMORY_FILE_PATH: memoryFile,
  });

  assert.equal(result.status, 0, result.stderr);
  const record = JSON.parse(fs.readFileSync(memoryJsonl, 'utf8').trim());
  assert.equal(record.kind, 'FIX');
  assert.equal(record.message, 'remove only generated prefix');
});
