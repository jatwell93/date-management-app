#!/usr/bin/env node
/**
 * Task 3.4 — retention for the scheduled PostgreSQL backups in R2.
 *
 * `.github/workflows/database-backup.yml` uploads one `pg_dump` per run. This
 * script owns the two decisions that workflow must not get wrong in shell: the
 * object key a backup is stored under, and which stored backups may be
 * deleted. Both live here so they share one definition of the key format —
 * retention can only ever delete objects it can prove it named.
 *
 * The posture being preserved is the Express backup service's: 30 days of
 * restore points. Two rules, in this order:
 *
 *   1. The newest BACKUP_MINIMUM_KEPT backups are kept whatever their age. If
 *      the backup job has been failing for a month, the backups that predate
 *      the failure are the only ones there are; age alone must not delete
 *      them.
 *   2. Of the rest, a backup older than BACKUP_RETENTION_DAYS is deleted.
 *
 * Age is read from the timestamp in the key, not from the object's
 * LastModified, which changes if an object is copied. A key this script did
 * not produce is never deleted — it is reported as ignored instead.
 *
 * Usage:
 *   node scripts/backup-retention.js key
 *       Prints the object key for a backup taken now.
 *   aws s3api list-objects-v2 --bucket "$BUCKET" --prefix postgres/ --output json \
 *     | node scripts/backup-retention.js prune
 *       Prints the keys to delete, one per line. Prints nothing when there is
 *       nothing to delete.
 *
 * Environment variables (prune only):
 *   BACKUP_RETENTION_DAYS — days a backup is kept (default 30)
 *   BACKUP_MINIMUM_KEPT   — newest backups kept regardless of age (default 10)
 *
 * Exit codes:
 *   0 — success
 *   1 — unknown command, unreadable listing, or invalid configuration
 */

const KEY_PREFIX = 'postgres/';
const KEY_PATTERN =
  /^postgres\/date-management-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z\.dump$/;
const DEFAULT_RETENTION_DAYS = 30;
const DEFAULT_MINIMUM_KEPT = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

function pad(value) {
  return String(value).padStart(2, '0');
}

/** The object key for a backup taken at `now` (UTC, second precision). */
function backupKey(now) {
  const stamp =
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
    `T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
  return `${KEY_PREFIX}date-management-${stamp}.dump`;
}

/** The instant encoded in a backup key, or null if this script did not name it. */
function parseBackupKey(key) {
  const match = KEY_PATTERN.exec(key);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  const takenAt = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  // Date.UTC normalises out-of-range fields (month 13, day 32), so a key that
  // does not round-trip is not one `backupKey` could have produced.
  return backupKey(takenAt) === key ? takenAt : null;
}

/**
 * Splits stored keys into those to delete, those kept, and those ignored
 * because they are not backups this script named.
 */
function selectBackupsToDelete(keys, options) {
  const { now, retentionDays, minimumKept } = options;
  const backups = [];
  const ignored = [];
  for (const key of keys) {
    const takenAt = parseBackupKey(key);
    if (takenAt === null) ignored.push(key);
    else backups.push({ key, takenAt });
  }
  backups.sort((a, b) => b.takenAt.getTime() - a.takenAt.getTime() || a.key.localeCompare(b.key));

  const cutoff = now.getTime() - retentionDays * DAY_MS;
  const toDelete = [];
  const kept = [];
  backups.forEach((backup, index) => {
    if (index >= minimumKept && backup.takenAt.getTime() < cutoff) toDelete.push(backup.key);
    else kept.push(backup.key);
  });
  return { toDelete, kept, ignored };
}

function parseWholeNumber(name, raw, fallback, minimum) {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`${name} must be a whole number of at least ${minimum} (got "${raw}")`);
  }
  return value;
}

/** Keys from `aws s3api list-objects-v2 --output json`; an empty listing has no Contents. */
function keysFromListing(text) {
  if (text.trim() === '') return [];
  const listing = JSON.parse(text);
  if (listing === null || typeof listing !== 'object') {
    throw new Error('Bucket listing is not a JSON object');
  }
  const contents = listing.Contents ?? [];
  if (!Array.isArray(contents)) throw new Error('Bucket listing has a non-array Contents');
  return contents.map((object) => {
    if (typeof object?.Key !== 'string')
      throw new Error('Bucket listing has an object with no Key');
    return object.Key;
  });
}

async function readAll(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8');
}

async function main(argv, env, io) {
  const { stdin, stdout, stderr, now } = io;
  const command = argv[0];
  try {
    if (command === 'key') {
      stdout.write(`${backupKey(now)}\n`);
      return 0;
    }
    if (command === 'prune') {
      const retentionDays = parseWholeNumber(
        'BACKUP_RETENTION_DAYS',
        env.BACKUP_RETENTION_DAYS,
        DEFAULT_RETENTION_DAYS,
        1,
      );
      const minimumKept = parseWholeNumber(
        'BACKUP_MINIMUM_KEPT',
        env.BACKUP_MINIMUM_KEPT,
        DEFAULT_MINIMUM_KEPT,
        1,
      );
      const keys = keysFromListing(await readAll(stdin));
      const result = selectBackupsToDelete(keys, { now, retentionDays, minimumKept });
      for (const key of result.toDelete) stdout.write(`${key}\n`);
      stderr.write(
        `Backups: ${result.kept.length} kept, ${result.toDelete.length} to delete, ` +
          `${result.ignored.length} ignored (retention ${retentionDays} days, minimum ${minimumKept}).\n`,
      );
      for (const key of result.ignored) stderr.write(`Ignored (not a backup key): ${key}\n`);
      return 0;
    }
    stderr.write('Usage: node scripts/backup-retention.js <key|prune>\n');
    return 1;
  } catch (error) {
    stderr.write(`::error::${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

module.exports = {
  backupKey,
  parseBackupKey,
  selectBackupsToDelete,
  keysFromListing,
  main,
  DEFAULT_RETENTION_DAYS,
  DEFAULT_MINIMUM_KEPT,
};

if (require.main === module) {
  void main(process.argv.slice(2), process.env, {
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    now: new Date(),
  }).then((code) => {
    process.exitCode = code;
  });
}
