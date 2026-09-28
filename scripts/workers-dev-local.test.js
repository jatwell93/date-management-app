'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  parseDevVars,
  parseDevVarValue,
  forwardChildExit,
  validateDevVars,
  redactConnectionString,
  buildChildEnv,
  hyperdrivePresetWarning,
  REQUIRED_KEY,
  HYPERDRIVE_LOCAL_ENV,
} = require('./workers-dev-local');

test('parseDevVars reads KEY=VALUE pairs', () => {
  const vars = parseDevVars('A=1\nB=two\n');
  assert.equal(vars.A, '1');
  assert.equal(vars.B, 'two');
});

test('parseDevVars strips matching single and double quotes', () => {
  const vars = parseDevVars('A="hello world"\nB=\'quoted\'\n');
  assert.equal(vars.A, 'hello world');
  assert.equal(vars.B, 'quoted');
});

test('parseDevVars skips comments and blank lines and strips inline comments', () => {
  const vars = parseDevVars('# a comment\n\nA=1 # trailing comment\nB=2\n');
  assert.deepEqual(vars, { A: '1', B: '2' });
});

test('parseDevVars keeps = inside values and # without preceding space', () => {
  const uri = 'postgres://u:p@host/db?sslmode=require&x=1';
  const vars = parseDevVars(`${REQUIRED_KEY}=${uri}\nHASH=a#b\n`);
  assert.equal(vars[REQUIRED_KEY], uri);
  assert.equal(vars.HASH, 'a#b');
});

test('parseDevVarValue strips an inline comment after a quoted value', () => {
  assert.equal(parseDevVarValue('"postgres://u:p@h/db" # note'), 'postgres://u:p@h/db');
  assert.equal(parseDevVarValue("'v' # note"), 'v');
});

test('parseDevVarValue keeps # inside quotes and stops before a quoted comment', () => {
  assert.equal(parseDevVarValue('"a # b"'), 'a # b');
  assert.equal(parseDevVarValue('"a" # "b"'), 'a');
});

test('parseDevVarValue falls back to unquoted parsing for unterminated quotes', () => {
  assert.equal(parseDevVarValue('"unterminated # c'), '"unterminated');
});

test('parseDevVars handles quoted values with trailing comments', () => {
  const vars = parseDevVars('K="postgres://u:p@h/db" # note\nJ=\'v\' # note\n');
  assert.equal(vars.K, 'postgres://u:p@h/db');
  assert.equal(vars.J, 'v');
});

test('validateDevVars accepts a real connection string', () => {
  assert.equal(
    validateDevVars({ [REQUIRED_KEY]: 'postgres://u:p@host-pooler.r.neon.tech/db' }, 'p'),
    null,
  );
});

test('validateDevVars rejects a missing key', () => {
  const err = validateDevVars({}, 'workers/.dev.vars');
  assert.match(err, /NEON_CONNECTION_STRING/);
  assert.match(err, /\.dev\.vars\.example/);
});

test('validateDevVars rejects an empty value', () => {
  const err = validateDevVars({ [REQUIRED_KEY]: '' }, 'workers/.dev.vars');
  assert.match(err, /NEON_CONNECTION_STRING/);
});

test('validateDevVars rejects placeholder values', () => {
  const err = validateDevVars(
    { [REQUIRED_KEY]: 'postgres://<user>:<password>@host/db' },
    'workers/.dev.vars',
  );
  assert.match(err, /placeholder/);
});

test('redactConnectionString hides credentials but keeps host:port', () => {
  const redacted = redactConnectionString(
    'postgres://alice:s3cret@ep-x-pooler.aws.neon.tech:5432/mydb',
  );
  assert.equal(redacted, 'postgres://ep-x-pooler.aws.neon.tech:5432/mydb');
  assert.ok(!redacted.includes('s3cret'));
  assert.ok(!redacted.includes('alice'));
});

test('redactConnectionString never leaks an unparseable value', () => {
  assert.equal(
    redactConnectionString('not a uri with p@ssword'),
    'postgres://<unparseable URI — redacted>',
  );
});

test('buildChildEnv maps NEON_CONNECTION_STRING onto the Hyperdrive local var', () => {
  const env = buildChildEnv({ [REQUIRED_KEY]: 'postgres://u:p@h/db' }, {});
  assert.equal(env[HYPERDRIVE_LOCAL_ENV], 'postgres://u:p@h/db');
  // .dev.vars values themselves are not overlaid — wrangler reads the file.
  assert.equal(env[REQUIRED_KEY], undefined);
});

test('buildChildEnv leaves an already-set Hyperdrive var alone', () => {
  const env = buildChildEnv(
    { [REQUIRED_KEY]: 'postgres://u:p@h/db' },
    { [HYPERDRIVE_LOCAL_ENV]: 'postgres://preset@other/db' },
  );
  assert.equal(env[HYPERDRIVE_LOCAL_ENV], 'postgres://preset@other/db');
});

test('buildChildEnv does not overlay .dev.vars secrets onto the child env', () => {
  const env = buildChildEnv(
    {
      [REQUIRED_KEY]: 'postgres://u:p@h/db',
      JWT_SECRET: 'should-not-leak',
      CLOUDFLARE_API_TOKEN: 'should-not-leak',
    },
    { KEEP: 'me' },
  );
  assert.equal(env.KEEP, 'me');
  assert.equal(env.JWT_SECRET, undefined);
  assert.equal(env.CLOUDFLARE_API_TOKEN, undefined);
  // NEON_CONNECTION_STRING itself is not forwarded either — wrangler reads
  // .dev.vars directly; only the Hyperdrive local var is injected.
  assert.equal(env[REQUIRED_KEY], undefined);
  assert.equal(env[HYPERDRIVE_LOCAL_ENV], 'postgres://u:p@h/db');
});

test('hyperdrivePresetWarning warns when the preset differs from .dev.vars', () => {
  const warning = hyperdrivePresetWarning(
    { [REQUIRED_KEY]: 'postgres://u:p@neon-a.tech/db' },
    { [HYPERDRIVE_LOCAL_ENV]: 'postgres://v:q@neon-b.tech/db' },
  );
  assert.match(warning, /already set/);
  assert.match(warning, /neon-b\.tech/);
  assert.match(warning, /neon-a\.tech/);
  assert.ok(!warning.includes('q@'));
  assert.ok(!warning.includes('p@'));
});

test('hyperdrivePresetWarning stays quiet when unset or equal', () => {
  assert.equal(hyperdrivePresetWarning({ [REQUIRED_KEY]: 'postgres://u:p@h/db' }, {}), null);
  assert.equal(
    hyperdrivePresetWarning(
      { [REQUIRED_KEY]: 'postgres://u:p@h/db' },
      { [HYPERDRIVE_LOCAL_ENV]: 'postgres://u:p@h/db' },
    ),
    null,
  );
});

/** Fake process that records kill/exit calls. */
function fakeProc(killImpl) {
  return {
    pid: 4242,
    calls: [],
    kill(pid, signal) {
      this.calls.push(['kill', pid, signal]);
      if (killImpl) killImpl(pid, signal);
    },
    exit(code) {
      this.calls.push(['exit', code]);
    },
  };
}

test('forwardChildExit exits with the child code', () => {
  const proc = fakeProc();
  forwardChildExit(0, null, proc);
  assert.deepEqual(proc.calls, [['exit', 0]]);
});

test('forwardChildExit exits 1 when code is null and no signal', () => {
  const proc = fakeProc();
  forwardChildExit(null, null, proc);
  assert.deepEqual(proc.calls, [['exit', 1]]);
});

test('forwardChildExit forwards the signal and does not exit', () => {
  const proc = fakeProc();
  forwardChildExit(null, 'SIGTERM', proc);
  assert.deepEqual(proc.calls, [['kill', 4242, 'SIGTERM']]);
});

test('forwardChildExit falls back to exit(1) when kill throws (unsupported signal)', () => {
  const proc = fakeProc(() => {
    throw new Error('not supported on Windows');
  });
  forwardChildExit(null, 'SIGUSR1', proc);
  assert.deepEqual(proc.calls, [
    ['kill', 4242, 'SIGUSR1'],
    ['exit', 1],
  ]);
});
