# Database backup runbook

Production PostgreSQL (Neon) is backed up once a day by
`.github/workflows/database-backup.yml`. Each run takes a `pg_dump`, uploads it to a private R2
bucket, restores it into a scratch database to prove it is usable, and deletes backups older than
30 days.

This is the long-range recovery path. For anything in the last 6 hours, Neon point-in-time recovery
is faster and loses less — see `docs/migrations-deploy-runbook.md`. Reach for a dump when the data
you need is older than Neon can reach.

## What is stored

|            |                                                                                     |
| ---------- | ----------------------------------------------------------------------------------- |
| Schedule   | Daily at 16:00 UTC, and on demand from the Actions tab (**Run workflow**)           |
| Object key | `postgres/date-management-<YYYYMMDD>T<HHMMSS>Z.dump` (UTC)                          |
| Format     | `pg_dump --format=custom --no-owner --no-privileges`                                |
| Retention  | 30 days, and never fewer than the 10 newest backups                                 |
| Verified   | Each dump is restored into a scratch PostgreSQL 17 and its migration ledger checked |

The 10-backup floor matters when the job has been failing: if no backup has succeeded for a month,
the ones that predate the failure are all there is, and age alone does not delete them.

## One-time setup

1. Create a private R2 bucket for backups. Do not reuse the upload bucket: the Worker is bound to
   that one, and the Worker has no reason to be able to read database dumps.
2. Create an R2 API token with **Object Read & Write** on that bucket only.
3. Add to the Doppler production config:
   - `BACKUP_R2_ACCOUNT_ID` — the Cloudflare account id
   - `BACKUP_R2_ACCESS_KEY_ID`, `BACKUP_R2_SECRET_ACCESS_KEY` — from the token
   - `BACKUP_R2_BUCKET` — the bucket name
4. Run the workflow once by hand and confirm every step is green before relying on the schedule.

`DATABASE_URL_UNPOOLED` is already in Doppler. It must be the direct connection string; the script
refuses a pooled (`-pooler`) host.

## Restoring

Restore into a **new** Neon branch or database, never over production. Check the result, then
decide how to bring it into service.

```bash
# 1. Download the dump you want (list with `aws s3 ls`).
export AWS_ACCESS_KEY_ID=...            # BACKUP_R2_ACCESS_KEY_ID
export AWS_SECRET_ACCESS_KEY=...        # BACKUP_R2_SECRET_ACCESS_KEY
export AWS_DEFAULT_REGION=auto
export AWS_REQUEST_CHECKSUM_CALCULATION=when_required
export AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
ENDPOINT="https://<BACKUP_R2_ACCOUNT_ID>.r2.cloudflarestorage.com"

aws --endpoint-url "$ENDPOINT" s3 ls "s3://<BACKUP_R2_BUCKET>/postgres/"
aws --endpoint-url "$ENDPOINT" s3 cp \
  "s3://<BACKUP_R2_BUCKET>/postgres/date-management-<timestamp>.dump" restore.dump

# 2. Restore into an EMPTY target, using a direct (non-pooled) connection string.
pg_restore --dbname="<target connection string>" --no-owner --no-privileges --exit-on-error restore.dump

# 3. Confirm the schema is the one this revision expects.
npm run migrate:status
npm run migrate:verify
```

`pg_restore` must be version 17 or newer. `migrate:status` and `migrate:verify` take their target
from the `MIGRATION_*` variables described in `docs/migrations-deploy-runbook.md`; point them at the
restored database, with `MIGRATION_TARGET_KIND=restore-drill`.

A dump older than the current schema restores at the migration it was taken at. `migrate:status`
shows which migrations are pending; apply them with the normal deploy procedure once the data has
been checked.

## When the workflow fails

| Failing step | Meaning                                                                               | State of the bucket                                            |
| ------------ | ------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Dump         | Source unreachable, or the connection string is pooled                                | Unchanged                                                      |
| Upload       | R2 credentials or bucket wrong, or the size check failed                              | Unchanged, or one incomplete object                            |
| Verify       | The dump did not restore, or its migration ledger is not a prefix of the repository's | The new dump **is** in the bucket; treat it as suspect         |
| Prune        | Listing or delete failed                                                              | The new dump is stored and verified; old ones were not removed |

Pruning runs only after dump, upload and verify have all succeeded, so a failed run never deletes
an older backup.
