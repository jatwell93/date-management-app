#!/usr/bin/env bash
#
# Task 3.4 — scheduled PostgreSQL backup to R2 (2.4 Finding 17, 2.3 Finding 12).
#
# Replaces the Express backup service, which copied a SQLite file and kept 30
# days of copies. Neon point-in-time recovery reaches back 6 hours on the
# current plan and allows one manual snapshot, so on its own it would shorten
# the recovery window from 30 days to 6 hours. This keeps the window: a daily
# `pg_dump`, stored in a private R2 bucket, retained for 30 days.
#
# It runs from .github/workflows/database-backup.yml, one subcommand per step,
# under `doppler run` so the secrets below arrive as environment variables.
#
# WHY A SCRIPT AND NOT INLINE WORKFLOW YAML: the same reason as
# scripts/pitr-drill.sh. Each step needs quoting that survives three shells
# (the runner's, `doppler run`'s, and the one inside the container), and a
# committed file can be read, reviewed and run by hand during an incident.
#
# `pg_dump` and `pg_restore` run inside the pinned PostgreSQL image rather than
# from the runner's packages: the client must not be older than the server, and
# the image digest is the same one migrations-e2e.yml pins to match production.
#
# SAFETY:
#   * The only statement sent to the source database is `pg_dump`'s read-only
#     snapshot. Nothing here writes to it.
#   * Connection strings and keys are passed to containers and to the AWS CLI
#     through the environment, never as arguments, and are never printed.
#   * `prune` deletes only keys that scripts/backup-retention.js both named
#     and selected. A key it does not recognise is left alone.
#
# Usage:
#   scripts/database-backup.sh dump     # pg_dump the source into $BACKUP_DUMP_FILE
#   scripts/database-backup.sh upload   # copy the dump to R2 and confirm its size
#   scripts/database-backup.sh verify   # restore the dump into a scratch database
#   scripts/database-backup.sh prune    # delete backups past retention
#
# Environment variables:
#   POSTGRES_IMAGE               — image providing pg_dump/pg_restore/psql (all but prune/upload)
#   BACKUP_DUMP_FILE             — dump path, default ./backup.dump
#   DATABASE_URL_UNPOOLED        — dump: direct (non-pooled) source connection string
#   RESTORE_CHECK_URL            — verify: scratch database to restore into; must be on localhost
#   BACKUP_R2_ACCOUNT_ID         — upload, prune: Cloudflare account id
#   BACKUP_R2_ACCESS_KEY_ID      — upload, prune: R2 API token id scoped to the backup bucket
#   BACKUP_R2_SECRET_ACCESS_KEY  — upload, prune: R2 API token secret
#   BACKUP_R2_BUCKET             — upload, prune: backup bucket name
#   BACKUP_RETENTION_DAYS, BACKUP_MINIMUM_KEPT — prune: see scripts/backup-retention.js
#   BACKUP_KEY_FILE              — upload: where to record the uploaded key, default ./backup-key.txt

set -euo pipefail

DUMP_FILE="${BACKUP_DUMP_FILE:-backup.dump}"
KEY_FILE="${BACKUP_KEY_FILE:-backup-key.txt}"

fail() {
  echo "::error::$*" >&2
  exit 1
}

require() {
  local name
  for name in "$@"; do
    [ -n "${!name:-}" ] || fail "$name is required"
  done
}

# The AWS CLI against R2's S3 endpoint. The two checksum settings are not
# optional: recent CLI versions send CRC32 trailers by default, which R2
# rejects, and the upload fails with an opaque signature error.
aws_r2() {
  AWS_ACCESS_KEY_ID="$BACKUP_R2_ACCESS_KEY_ID" \
    AWS_SECRET_ACCESS_KEY="$BACKUP_R2_SECRET_ACCESS_KEY" \
    AWS_DEFAULT_REGION=auto \
    AWS_REQUEST_CHECKSUM_CALCULATION=when_required \
    AWS_RESPONSE_CHECKSUM_VALIDATION=when_required \
    aws --endpoint-url "https://${BACKUP_R2_ACCOUNT_ID}.r2.cloudflarestorage.com" "$@"
}

dump() {
  require POSTGRES_IMAGE DATABASE_URL_UNPOOLED
  case "$DATABASE_URL_UNPOOLED" in
    *-pooler.*) fail "DATABASE_URL_UNPOOLED is a pooled connection; pg_dump needs a direct one" ;;
  esac

  # `-e PGURL` with no value forwards the variable from this shell's
  # environment, so the connection string never appears in an argument list.
  PGURL="$DATABASE_URL_UNPOOLED" docker run --rm -e PGURL "$POSTGRES_IMAGE" \
    sh -c 'exec pg_dump --dbname="$PGURL" --format=custom --no-owner --no-privileges' \
    > "$DUMP_FILE"

  [ -s "$DUMP_FILE" ] || fail "pg_dump produced an empty file"
  echo "Dump written: $(wc -c < "$DUMP_FILE") bytes"
}

upload() {
  require BACKUP_R2_ACCOUNT_ID BACKUP_R2_ACCESS_KEY_ID BACKUP_R2_SECRET_ACCESS_KEY BACKUP_R2_BUCKET
  [ -s "$DUMP_FILE" ] || fail "No dump at $DUMP_FILE to upload"

  local key local_size remote_size
  key="$(node scripts/backup-retention.js key)"
  aws_r2 s3 cp "$DUMP_FILE" "s3://${BACKUP_R2_BUCKET}/${key}" --only-show-errors

  # Read the object back rather than trusting the exit code of the copy.
  local_size="$(wc -c < "$DUMP_FILE" | tr -d '[:space:]')"
  remote_size="$(aws_r2 s3api head-object --bucket "$BACKUP_R2_BUCKET" --key "$key" \
    --query ContentLength --output text)"
  [ "$local_size" = "$remote_size" ] ||
    fail "Uploaded object is ${remote_size} bytes but the dump is ${local_size}"

  printf '%s\n' "$key" > "$KEY_FILE"
  echo "Uploaded ${key} (${remote_size} bytes)"
}

# Restores the dump into a scratch database and checks that what came back is
# this application's schema. A dump that has never been restored is a file, not
# a backup.
verify() {
  require POSTGRES_IMAGE RESTORE_CHECK_URL
  [ -s "$DUMP_FILE" ] || fail "No dump at $DUMP_FILE to verify"

  # The scratch database is always local. Allowlisting loopback is stronger
  # than comparing against the source URL: it holds when DATABASE_URL_UNPOOLED
  # is unset (as it is in this step in CI, and may be in a run by hand), and it
  # cannot be defeated by a differently spelled connection string for the same
  # server. Restoring into a real database is a deliberate `pg_restore`, per
  # docs/database-backup-runbook.md — not something this subcommand does.
  local restore_host
  restore_host="$(RESTORE_CHECK_URL="$RESTORE_CHECK_URL" node -e '
    try {
      process.stdout.write(new URL(process.env.RESTORE_CHECK_URL).hostname.toLowerCase());
    } catch {
      process.stdout.write("");
    }
  ')"
  case "$restore_host" in
    localhost | 127.0.0.1 | "[::1]") ;;
    "") fail "RESTORE_CHECK_URL is not a parseable connection URL" ;;
    *) fail "RESTORE_CHECK_URL must point at a local scratch database (localhost); refusing to restore into ${restore_host}" ;;
  esac

  # Docker needs an absolute host path for the mount; BACKUP_DUMP_FILE may be
  # either relative or absolute.
  local dump_path
  dump_path="$(cd "$(dirname "$DUMP_FILE")" && pwd)/$(basename "$DUMP_FILE")"

  PGURL="$RESTORE_CHECK_URL" docker run --rm --network host -e PGURL \
    -v "${dump_path}:/backup.dump:ro" "$POSTGRES_IMAGE" \
    sh -c 'exec pg_restore --dbname="$PGURL" --no-owner --no-privileges --exit-on-error /backup.dump'

  local restored_ids counts
  restored_ids="$(PGURL="$RESTORE_CHECK_URL" docker run --rm --network host -e PGURL "$POSTGRES_IMAGE" \
    sh -c "exec psql \"\$PGURL\" -At -v ON_ERROR_STOP=1 -c \"SELECT string_agg(id, ',' ORDER BY id) FROM schema_migrations WHERE state = 'applied'\"")"

  # The restored ledger must be a non-empty prefix of the repository's
  # migration history. Equality would be wrong: a migration merged but not yet
  # deployed makes the repository one ahead of production.
  node -e '
    const expected = require("./database/migrations/manifest.json").migrations.map((m) => m.id);
    const restored = process.argv[1].split(",").filter(Boolean);
    if (restored.length === 0) {
      console.error("::error::Restored database has no applied migrations");
      process.exit(1);
    }
    if (restored.some((id, index) => id !== expected[index])) {
      console.error(`::error::Restored ledger [${restored}] is not a prefix of the manifest [${expected}]`);
      process.exit(1);
    }
    console.log(`Restored ledger: ${restored.length} migration(s), latest ${restored[restored.length - 1]}`);
  ' "$restored_ids"

  counts="$(PGURL="$RESTORE_CHECK_URL" docker run --rm --network host -e PGURL "$POSTGRES_IMAGE" \
    sh -c "exec psql \"\$PGURL\" -At -v ON_ERROR_STOP=1 -c \"SELECT 'organizations=' || (SELECT COUNT(*) FROM organizations) || ' users=' || (SELECT COUNT(*) FROM users) || ' products=' || (SELECT COUNT(*) FROM products) || ' tier_feature_flags=' || (SELECT COUNT(*) FROM tier_feature_flags)\"")"
  echo "Restored row counts: ${counts}"
}

prune() {
  require BACKUP_R2_ACCOUNT_ID BACKUP_R2_ACCESS_KEY_ID BACKUP_R2_SECRET_ACCESS_KEY BACKUP_R2_BUCKET

  local listing doomed key
  listing="$(aws_r2 s3api list-objects-v2 --bucket "$BACKUP_R2_BUCKET" --prefix postgres/ --output json)"
  doomed="$(printf '%s' "$listing" | node scripts/backup-retention.js prune)"

  # A here-string, not a pipe: a `while` on the right of a pipe runs in a
  # subshell, where a failed delete would not stop this script.
  while IFS= read -r key; do
    [ -n "$key" ] || continue
    aws_r2 s3 rm "s3://${BACKUP_R2_BUCKET}/${key}" --only-show-errors
    echo "Deleted ${key}"
  done <<< "$doomed"
}

case "${1:-}" in
  dump) dump ;;
  upload) upload ;;
  verify) verify ;;
  prune) prune ;;
  *) fail "Usage: scripts/database-backup.sh <dump|upload|verify|prune>" ;;
esac
