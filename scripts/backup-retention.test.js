const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');

const {
  backupKey,
  parseBackupKey,
  selectBackupsToDelete,
  keysFromListing,
  main,
} = require('./backup-retention.js');

const NOW = new Date('2026-10-02T16:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

/** The key of a backup taken `days` before NOW. */
function keyDaysAgo(days) {
  return backupKey(new Date(NOW.getTime() - days * DAY_MS));
}

function sink() {
  const chunks = [];
  return { write: (chunk) => chunks.push(chunk), text: () => chunks.join('') };
}

async function run(argv, env, stdinText = '') {
  const stdout = sink();
  const stderr = sink();
  const code = await main(argv, env, {
    stdin: Readable.from([stdinText]),
    stdout,
    stderr,
    now: NOW,
  });
  return { code, stdout: stdout.text(), stderr: stderr.text() };
}

test('backupKey names a backup by its UTC second and parseBackupKey reads it back', () => {
  const key = backupKey(new Date('2026-01-05T03:04:09.999Z'));

  assert.equal(key, 'postgres/date-management-20260105T030409Z.dump');
  assert.equal(parseBackupKey(key).toISOString(), '2026-01-05T03:04:09.000Z');
});

test('parseBackupKey rejects any key this script could not have produced', () => {
  for (const key of [
    'postgres/date-management-20261302T000000Z.dump',
    'postgres/date-management-20260230T000000Z.dump',
    'postgres/date-management-20260105T250000Z.dump',
    'postgres/date-management-20260105T030409Z.dump.partial',
    'postgres/other-20260105T030409Z.dump',
    'uploads/date-management-20260105T030409Z.dump',
    'postgres/',
  ]) {
    assert.equal(parseBackupKey(key), null, key);
  }
});

test('deletes backups past retention and keeps the ones inside it', () => {
  const keys = Array.from({ length: 40 }, (_, index) => keyDaysAgo(index));

  const result = selectBackupsToDelete(keys, { now: NOW, retentionDays: 30, minimumKept: 10 });

  // Day 30 is exactly at the cutoff and is kept; days 31 to 39 are past it.
  assert.deepEqual(
    result.toDelete,
    Array.from({ length: 9 }, (_, index) => keyDaysAgo(31 + index)),
  );
  assert.equal(result.kept.length, 31);
  assert.ok(result.kept.includes(keyDaysAgo(30)));
  assert.deepEqual(result.ignored, []);
});

test('keeps the newest backups whatever their age when the job has been failing', () => {
  // No backup for 45 days: every stored backup is past retention.
  const keys = Array.from({ length: 12 }, (_, index) => keyDaysAgo(45 + index));

  const result = selectBackupsToDelete(keys, { now: NOW, retentionDays: 30, minimumKept: 10 });

  assert.deepEqual(result.toDelete, [keyDaysAgo(55), keyDaysAgo(56)]);
  assert.deepEqual(
    result.kept,
    Array.from({ length: 10 }, (_, index) => keyDaysAgo(45 + index)),
  );
});

test('never deletes a key it did not name, and does not count it toward the minimum', () => {
  const foreign = ['postgres/manual-export.sql', 'postgres/date-management-latest.dump'];
  const keys = [...foreign, keyDaysAgo(1), keyDaysAgo(40), keyDaysAgo(50)];

  const result = selectBackupsToDelete(keys, { now: NOW, retentionDays: 30, minimumKept: 2 });

  assert.deepEqual(result.ignored, foreign);
  assert.deepEqual(result.kept, [keyDaysAgo(1), keyDaysAgo(40)]);
  assert.deepEqual(result.toDelete, [keyDaysAgo(50)]);
});

test('is independent of listing order', () => {
  const keys = [keyDaysAgo(50), keyDaysAgo(1), keyDaysAgo(40), keyDaysAgo(35)];

  const result = selectBackupsToDelete(keys, { now: NOW, retentionDays: 30, minimumKept: 2 });

  assert.deepEqual(result.toDelete, [keyDaysAgo(40), keyDaysAgo(50)]);
});

test('keysFromListing reads an S3 listing and treats an empty bucket as no keys', () => {
  assert.deepEqual(keysFromListing(JSON.stringify({ Contents: [{ Key: 'a' }, { Key: 'b' }] })), [
    'a',
    'b',
  ]);
  assert.deepEqual(keysFromListing(JSON.stringify({})), []);
  assert.deepEqual(keysFromListing(''), []);
  assert.throws(() => keysFromListing('not json'));
  assert.throws(() => keysFromListing('null'), /not a JSON object/);
  assert.throws(() => keysFromListing(JSON.stringify({ Contents: [{}] })), /no Key/);
});

test('key command prints the key for now', async () => {
  const result = await run(['key'], {});

  assert.equal(result.code, 0);
  assert.equal(result.stdout, 'postgres/date-management-20261002T160000Z.dump\n');
});

test('prune command prints only the keys to delete and reports the rest on stderr', async () => {
  const listing = JSON.stringify({
    Contents: [
      { Key: keyDaysAgo(1) },
      { Key: keyDaysAgo(8) },
      { Key: keyDaysAgo(9) },
      { Key: 'postgres/notes.txt' },
    ],
  });

  const result = await run(
    ['prune'],
    { BACKUP_RETENTION_DAYS: '7', BACKUP_MINIMUM_KEPT: '1' },
    listing,
  );

  assert.equal(result.code, 0);
  assert.equal(result.stdout, `${keyDaysAgo(8)}\n${keyDaysAgo(9)}\n`);
  assert.match(result.stderr, /1 kept, 2 to delete, 1 ignored \(retention 7 days, minimum 1\)/);
  assert.match(result.stderr, /Ignored \(not a backup key\): postgres\/notes\.txt/);
});

test('prune command deletes nothing from an empty bucket and uses the defaults', async () => {
  const result = await run(['prune'], {}, '');

  assert.equal(result.code, 0);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /0 kept, 0 to delete, 0 ignored \(retention 30 days, minimum 10\)/);
});

test('prune command fails closed on an unreadable listing or invalid configuration', async () => {
  const listing = JSON.stringify({ Contents: [{ Key: keyDaysAgo(400) }] });

  for (const [env, stdin] of [
    [{}, '<Error>AccessDenied</Error>'],
    [{ BACKUP_RETENTION_DAYS: '0' }, listing],
    [{ BACKUP_RETENTION_DAYS: 'thirty' }, listing],
    [{ BACKUP_MINIMUM_KEPT: '0' }, listing],
    [{ BACKUP_MINIMUM_KEPT: '1.5' }, listing],
  ]) {
    const result = await run(['prune'], env, stdin);
    assert.equal(result.code, 1, JSON.stringify(env));
    assert.equal(result.stdout, '', JSON.stringify(env));
    assert.match(result.stderr, /^::error::/);
  }
});

test('an unknown command prints usage and fails', async () => {
  const result = await run(['delete-everything'], {});

  assert.equal(result.code, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /Usage/);
});
