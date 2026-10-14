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

test('mem-log passes a multi-word title to memvid as one argument', () => {
  // The companion to the rebuild assertion below. mem-log downgrades an index
  // failure to a warning, so this bug was invisible here: memory.jsonl kept every
  // entry while the local index — the thing mem-recall.js searches — silently
  // stopped receiving them.
  const tempDir = makeTempDir();
  const memoryJsonl = path.join(tempDir, 'memory.jsonl');
  const memoryFile = path.join(tempDir, 'project-memory.mv2');
  const callsFile = path.join(tempDir, 'calls.jsonl');

  writeFakeMemvid(
    tempDir,
    `
const fs = require('node:fs');
const callsFile = process.env.CALLS_FILE;
const stdin = process.argv[2] === 'put' ? fs.readFileSync(0, 'utf8') : '';
fs.appendFileSync(callsFile, JSON.stringify({ args: process.argv.slice(2), stdin }) + '\\n');
process.exit(0);
`,
  );

  const result = runNode('mem-log.js', ['FIX', 'Quoted Title With Spaces', 'body text'], {
    PATH: `${tempDir}${path.delimiter}${process.env.PATH}`,
    MEMORY_JSONL_PATH: memoryJsonl,
    MEMORY_FILE_PATH: memoryFile,
    CALLS_FILE: callsFile,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /Failed to update local memvid index/);

  const put = fs
    .readFileSync(callsFile, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
    .find((call) => call.args[0] === 'put');

  assert.ok(put, 'expected a put call');
  const titleIndex = put.args.indexOf('--title');
  assert.notEqual(titleIndex, -1);
  assert.equal(put.args[titleIndex + 1], 'Quoted Title With Spaces');
  // And the argument after the title is the next flag, not a stray fragment of it.
  assert.equal(put.args[titleIndex + 2], '--kind');
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
  // The title must arrive as ONE argument. This test already used a title with a
  // space and asserted only args[0] and args[1], so it passed for months while
  // `--title Auth Pattern` was reaching memvid as two arguments and every real
  // rebuild died on "unexpected argument". Asserting the value is what makes the
  // quoting in scripts/memvid-exec.js testable.
  const titleIndex = calls[2].args.indexOf('--title');
  assert.notEqual(titleIndex, -1);
  assert.equal(calls[2].args[titleIndex + 1], 'Auth Pattern');
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

test('mem-redact names the pattern for a secret and passes plain prose', () => {
  const { findSensitive } = require('./mem-redact');
  // Assembled at runtime so this file never contains a literal that the
  // repository secrets scan would flag.
  const stripeKey = ['sk', 'live', 'a1B2c3D4e5F6g7H8i9J0k1L2'].join('_');

  assert.deepEqual(findSensitive('rotate', `key is ${stripeKey}`), ['Stripe or Clerk secret key']);
  assert.deepEqual(findSensitive('db', 'postgres://user:hunter2@host.example/db'), [
    'database URL with credentials',
  ]);
  assert.deepEqual(
    findSensitive('Bug fix', 'Use process.env.STRIPE_SECRET_KEY, not a literal'),
    [],
  );
});

test('mem-log refuses a secret and writes nothing', () => {
  const tempDir = makeTempDir();
  const memoryJsonl = path.join(tempDir, 'memory.jsonl');
  const stripeKey = ['sk', 'live', 'a1B2c3D4e5F6g7H8i9J0k1L2'].join('_');

  const result = runNode('mem-log.js', ['FIX', 'Leaky entry', `used ${stripeKey} in test`], {
    MEMORY_JSONL_PATH: memoryJsonl,
    MEMORY_FILE_PATH: path.join(tempDir, 'project-memory.mv2'),
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Refusing to log/);
  assert.ok(!result.stderr.includes(stripeKey), 'refusal must not echo the secret');
  assert.equal(fs.existsSync(memoryJsonl), false);
});

function hasCommand(command) {
  return spawnSync(command, ['--version'], { encoding: 'utf8' }).status === 0;
}

function runRecallHook(projectDir) {
  return spawnSync('bash', [path.join(repoRoot, '.claude', 'hooks', 'recall-on-start.sh')], {
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
    encoding: 'utf8',
  });
}

function makeRecallRepo(branch, entries) {
  const dir = makeTempDir();
  const git = (...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  git('init', '-q');
  git('checkout', '-q', '-b', branch);
  git(
    '-c',
    'user.email=t@example.com',
    '-c',
    'user.name=t',
    'commit',
    '-q',
    '--allow-empty',
    '-m',
    'init',
  );
  fs.writeFileSync(
    path.join(dir, 'memory.jsonl'),
    `${entries.map((entry) => JSON.stringify({ ts: '2026-01-01T00:00:00Z', ...entry })).join('\n')}\n`,
  );
  return dir;
}

const recallHookSkip =
  hasCommand('bash') && hasCommand('jq') && hasCommand('git')
    ? false
    : 'bash, jq and git are required';

test(
  'recall hook falls back to keyword match when the local index is missing',
  { skip: recallHookSkip },
  () => {
    const dir = makeRecallRepo('feature/expired-writeoff-rollup', [
      {
        kind: 'FIX',
        title: 'Expired write-off rollup',
        message: 'cap not applied to scanned stock',
      },
      { kind: 'PATTERN', title: 'Unrelated entry', message: 'nothing to see' },
    ]);

    const result = runRecallHook(dir);

    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    const context = output.hookSpecificOutput.additionalContext;
    assert.match(context, /Expired write-off rollup/);
    assert.match(context, /mem:rebuild/);
    assert.doesNotMatch(context, /Unrelated entry/);
  },
);

test('recall hook stays silent when nothing matches or on main', { skip: recallHookSkip }, () => {
  const noMatch = makeRecallRepo('feature/zzzz-yyyy', [
    { kind: 'FIX', title: 'Expired write-off rollup', message: 'cap not applied' },
  ]);
  assert.equal(runRecallHook(noMatch).stdout, '');

  const onMain = makeRecallRepo('main', [
    { kind: 'FIX', title: 'Main branch entry', message: 'main entry text' },
  ]);
  assert.equal(runRecallHook(onMain).stdout, '');
});
