const assert = require('node:assert/strict');
const test = require('node:test');

const { quoteArg, runMemvid } = require('./memvid-exec');

const isWindows = process.platform === 'win32';

test('a value containing spaces becomes a single quoted argument', () => {
  // The whole bug in one assertion: `--title Project Overview` reached memvid as
  // two arguments and it answered "unexpected argument 'Overview' found".
  const quoted = quoteArg('Project Overview');
  assert.match(quoted, /^["'].*["']$/);
  assert.ok(quoted.includes('Project Overview'));
});

test('an embedded quote is escaped with the platform convention', () => {
  const quoted = quoteArg('has "quote" in it');

  if (isWindows) {
    // cmd.exe doubles the quote; a backslash is NOT an escape character there,
    // which is what the original POSIX-only helper in mem-recall.js got wrong.
    assert.equal(quoted, '"has ""quote"" in it"');
    assert.doesNotMatch(quoted, /\\"/);
  } else {
    // Single-quoted POSIX form: a double quote needs no escaping inside it.
    assert.equal(quoted, `'has "quote" in it'`);
  }
});

test('POSIX quoting closes and reopens for an embedded single quote', { skip: isWindows }, () => {
  assert.equal(quoteArg("don't"), `'don'\\''t'`);
});

test('shell metacharacters stay inert rather than being interpreted', () => {
  for (const value of ['a&b', 'a|b', 'a;b', 'a>b', '$(whoami)', '`whoami`']) {
    const quoted = quoteArg(value);
    // Whatever the platform, the payload is inside quotes rather than sitting
    // bare in the command string. This is the property that matters: these
    // scripts build a shell string because Node cannot spawn the Windows npm
    // shim without a shell, so quoting is the only thing standing between a
    // memory title and the shell.
    assert.ok(quoted.startsWith(isWindows ? '"' : "'"));
    assert.ok(quoted.endsWith(isWindows ? '"' : "'"));
  }
});

test('an empty argument survives as an empty quoted string', () => {
  assert.equal(quoteArg(''), isWindows ? '""' : `''`);
});

test('a percent sign is dropped on Windows, with a warning', { skip: !isWindows }, () => {
  const warnings = [];
  const original = console.warn;
  console.warn = (message) => warnings.push(String(message));
  try {
    // cmd.exe expands %USERPROFILE% even inside double quotes, and `%%` is a
    // batch-file construct that stays literal in a `cmd /c` string — so there is
    // nothing to escape it with. Dropping the character loses a little of the
    // title; expanding it would silently substitute a path, or an empty string.
    assert.equal(quoteArg('50% done'), '"50 done"');
  } finally {
    console.warn = original;
  }

  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Removed '%'/);
});

test('a percent sign is preserved on POSIX, where it is not special', { skip: isWindows }, () => {
  assert.equal(quoteArg('50% done'), `'50% done'`);
});

test('runMemvid reports the failing command when memvid is absent', () => {
  // Guards the shape of the error path the callers depend on: mem-log.js
  // downgrades a failure to a warning (memory.jsonl is already written), while
  // mem-rebuild.js turns it into a fatal error. Both need a throw.
  assert.throws(
    () =>
      runMemvid(['--version'], {
        env: { PATH: '' },
        stdio: ['ignore', 'ignore', 'ignore'],
      }),
    /memvid|ENOENT|not recognized|not found/i,
  );
});
