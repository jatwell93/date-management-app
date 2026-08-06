# Migrations E2E Runbook — Neon Dev-Branch Gate (Task 1.6)

## Purpose

This runbook is the **operator-driven Neon gate** for Phase 1 task 1.6. The
automated e2e suite (`src/database/migrations/e2e.test.ts`, run via
`npm run test:migrations:e2e`) proves the migration runner against an
ephemeral PostgreSQL 17 service container in CI. This runbook covers the
remaining proof that **cannot be automated without production-shaped Neon
credentials**: a real schema change with a working rollback on a Neon dev
branch, restore-to-new-branch recovery, and old-Worker-against-expanded-schema
verification.

**Task 1.6 is not complete until this runbook has been exercised end-to-end
and the sign-off section at the bottom is filled with operator evidence.**

The automated subtasks (e2e suite + CI workflow) may be merged independently;
the parent task 1.6 checkbox stays open until the operator evidence below is
recorded.

---

## Prerequisites

- [ ] Neon CLI installed and authenticated (`neonctl auth login` or
      `npx neonctl auth login`)
- [ ] `NEON_PROJECT_ID` known — the production project
      `<PROJECT-NAME-REDACTED>` (ID `<PROJECT-ID-REDACTED>` — real values live
      in operator notes / the protected GitHub `production` environment), region
      `aws-ap-southeast-2`, PostgreSQL 17
- [ ] A DDL-capable role on the dev branches. On this project the schema
      owner is `neondb_owner` (there is no `postgres` role); the runbook uses
      `--role-name neondb_owner` and `MIGRATION_ROLE=neondb_owner` throughout
- [ ] `npm run compile` passes locally
- [ ] The automated e2e suite passes in CI (green `Migrations E2E Gate` check)
- [ ] Current git branch is up to date with the PR branch
- [ ] The migration under test is `0010_alter_tier_feature_flags_limit_value_to_bigint`
      (expand-compatible widening, forward-fix recovery, destructive/partial down)
- [ ] `wrangler` authenticated for Cloudflare preview deploys (Step 4)

---

## Step 0 — Create two isolated Neon dev branches

Two separate branches are required because the fresh-install proof (Step 1)
needs an **empty** database, while the adoption + rollback proof (Steps 2–4)
needs a **production-shaped** database (the schema from `production`, no ledger).

A Neon branch created from `production` inherits the production schema and data —
it is NOT empty. So:

- **FRESH branch** — created from `production`, then its `public` schema is dropped
  to produce an empty starting point for the Step 1 fresh replay.
- **ADOPTION branch** — created from `production` and left untouched, so it carries
  the production-shaped schema (pre-0010, no `schema_migrations` ledger) for
  Steps 2–4.

Use unique names tied to the SHA or date so they cannot collide with other
operators' branches.

```bash
export NEON_PROJECT_ID=<your-neon-project-id>   # real ID in operator notes (redacted from repo)
export RUN_ID=$(git rev-parse --short HEAD)-$(date +%Y%m%d%H%M)

# --- 0a. FRESH branch (empty schema, for Step 1) ---------------------------
export FRESH_BRANCH=migration-e2e-fresh-$RUN_ID

neonctl branches create \
  --project-id "$NEON_PROJECT_ID" \
  --name "$FRESH_BRANCH" \
  --parent production

export FRESH_URL=$(neonctl connection-string "$FRESH_BRANCH" \
  --project-id "$NEON_PROJECT_ID" --role-name neondb_owner)

# Empty the schema so Step 1 is a true fresh-install replay. This is safe —
# the branch was just created and is isolated from production.
psql "$FRESH_URL" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

# --- 0b. ADOPTION branch (production-shaped schema, for Steps 2–4) ---------
export ADOPTION_BRANCH=migration-e2e-adopt-$RUN_ID

neonctl branches create \
  --project-id "$NEON_PROJECT_ID" \
  --name "$ADOPTION_BRANCH" \
  --parent production

export ADOPTION_URL=$(neonctl connection-string "$ADOPTION_BRANCH" \
  --project-id "$NEON_PROJECT_ID" --role-name neondb_owner)

# Sanity: confirm the adoption branch has the production schema but NO ledger.
psql "$ADOPTION_URL" -c \
  "SELECT count(*) AS table_count FROM information_schema.tables WHERE table_schema = 'public';"
psql "$ADOPTION_URL" -c \
  "SELECT to_regclass('public.schema_migrations') AS ledger;" || \
  echo "No schema_migrations ledger (expected for pre-adoption state)"
```

**Verify each branch is isolated:** neither connection string host may
contain `-pooler.` (the migration runner rejects pooled connections).

**Record:**
- Fresh branch name: `____________________________`
- Fresh branch connection host: `____________________________`
- Adoption branch name: `____________________________`
- Adoption branch connection host: `____________________________`
- Adoption branch table count: `____________________________`
- Adoption branch has ledger: [ ] no (expected) [ ] yes (unexpected — investigate)

> **Note on connection-string logging:** the commands above do NOT echo the
> full connection strings (which contain embedded passwords). To inspect the
> host without leaking credentials:
> ```bash
> echo "$FRESH_URL" | sed -E 's|://[^@]*@|://[redacted]@|'
> ```

---

## Step 1 — Fresh install proof (FRESH branch)

Prove the runner can take an empty database to the latest schema on a real
Neon branch.

```bash
# Point the migration CLI at the FRESH branch.
export DATABASE_URL_UNPOOLED="$FRESH_URL"
export MIGRATION_ALLOWED_HOST=$(echo "$DATABASE_URL_UNPOOLED" | sed -n 's|.*@\([^/]*\)/.*|\1|p' | sed 's/:.*//')
export MIGRATION_ALLOWED_DATABASE=$(echo "$DATABASE_URL_UNPOOLED" | sed -n 's|.*/\([^?]*\).*|\1|p')
export MIGRATION_ENVIRONMENT=development
export MIGRATION_TARGET_KIND=primary
export MIGRATION_ROLE=neondb_owner
export MIGRATION_DEPLOYMENT_SHA=$(git rev-parse HEAD)
export MIGRATION_CONFIRM_PRODUCTION="APPLY ${MIGRATION_ALLOWED_HOST}/${MIGRATION_ALLOWED_DATABASE}"

# 1a. Preflight — connection, role, privileges, ledger state.
npm run migrate:preflight

# 1b. Apply all migrations (0000 → 0011).
npm run migrate:apply

# 1c. Seed reference data.
export MIGRATION_SEED_CONFIRMATION="SEED ${MIGRATION_ALLOWED_HOST}/${MIGRATION_ALLOWED_DATABASE}"
npm run migrate:seed

# 1d. Verify schema + reference data + catalog fingerprint.
npm run migrate:verify

# 1e. Status — confirm all 12 migrations applied, no drift.
npm run migrate:status
```

**Expected:** preflight READY, apply succeeds with 12 applied (0000→0011),
seed upserts 54 rows, verify PASS, status shows all applied / no pending / no
drift.

**Record:**
- Preflight verdict: `____________________________`
- Apply result (applied count): `____________________________`
- Verify verdict: `____________________________`
- Status health: `____________________________`

---

## Step 2 — Real schema change with working rollback (ADOPTION branch)

This is the **gate that lets Prisma be removed in Phase 4.** Migration 0010
widens `tier_feature_flags.limit_value` from `integer` to `bigint`. Its down
narrows back to `integer` (destructive, partial — the documented forward-fix
recovery path).

> **Note on 0011:** since this runbook was authored, migration
> `0011_add_subscription_period_fields` has landed. It adds columns to
> `subscription_tiers` — a **different table** from `tier_feature_flags` — so it
> is orthogonal to the 0010 down/forward-fix drill below. Adoption at 0009
> therefore leaves **both 0010 and 0011 pending**; `migrate:apply` will apply
> both. The rollback drill remains centered on **0010** (the Prisma-removal
> gate); 0011 is simply carried along and does not affect the `limit_value`
> proof.

### 2a. Adopt the existing schema at 0009, then apply 0010

> **Note on the post-cutover adoption source (2026-08-05).** This runbook
> originally assumed the ADOPTION branch — created from `production` — carried
> the production schema with **no ledger** (pre-adoption). That is no longer
> true: production was cut over to 0011 (task 1.7.B), so a branch off
> `production`'s tip inherits a **fully-migrated** schema (ledger `0000–0011`,
> `limit_value` already `bigint`). Neon free-tier PITR retention is only 6
> hours, so we cannot branch from a pre-cutover timestamp either. Instead we
> **synthesize** the pre-adoption schema on the ADOPTION branch: empty it, then
> replay `0000→0009` via raw `psql` (pure DDL — the `.up.sql` files never touch
> `schema_migrations`; only the runner's `ensureLedger` does). This yields an
> unmanaged 0009-state schema with no ledger — exactly what `adopt AT 0009`
> expects.

```bash
# 2a.0 Build the pre-adoption schema on the ADOPTION branch (post-cutover).
# Discard the inherited post-0011 state and replay 0000→0009 as pure DDL.
# Run from the repo root.
psql "$ADOPTION_URL" -v ON_ERROR_STOP=1 -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

for n in 0000 0001 0002 0003 0004 0005 0006 0007 0008 0009; do
  f=$(ls database/migrations/${n}_*.up.sql)
  echo "== applying $f =="
  psql "$ADOPTION_URL" -v ON_ERROR_STOP=1 -f "$f" || { echo "FAILED at $f"; break; }
done

# Sanity: no ledger yet, and limit_value is still integer (pre-0010).
psql "$ADOPTION_URL" -c "SELECT to_regclass('public.schema_migrations') AS ledger;"
psql "$ADOPTION_URL" -c "SELECT data_type FROM information_schema.columns WHERE table_name='tier_feature_flags' AND column_name='limit_value';"
```

**Expected:** replay applies 0000→0009 without error, `ledger` is empty/`null`,
`limit_value` is `integer`.

Now adopt at 0009 (stamps the ledger with 0000→0009), then apply 0010+0011.

```bash
export DATABASE_URL_UNPOOLED="$ADOPTION_URL"
export MIGRATION_ALLOWED_HOST=$(echo "$DATABASE_URL_UNPOOLED" | sed -n 's|.*@\([^/]*\)/.*|\1|p' | sed 's/:.*//')
export MIGRATION_ALLOWED_DATABASE=$(echo "$DATABASE_URL_UNPOOLED" | sed -n 's|.*/\([^?]*\).*|\1|p')
export MIGRATION_ENVIRONMENT=development
export MIGRATION_TARGET_KIND=primary
export MIGRATION_ROLE=neondb_owner
export MIGRATION_DEPLOYMENT_SHA=$(git rev-parse HEAD)
export MIGRATION_CONFIRM_PRODUCTION="APPLY ${MIGRATION_ALLOWED_HOST}/${MIGRATION_ALLOWED_DATABASE}"
export MIGRATION_ADOPTION_POINT=0009
# NOTE: the CLI reads MIGRATION_ADOPT_CONFIRMATION (no "ION") — see adopt-cli.ts.
export MIGRATION_ADOPT_CONFIRMATION="ADOPT ${MIGRATION_ALLOWED_HOST}/${MIGRATION_ALLOWED_DATABASE} AT 0009"

# 2a.1 Adopt the existing schema at 0009. The adopt CLI requires an explicit
# --dry-run or --apply flag (passed through npm with `--`). Preview first, then
# apply. MIGRATION_ADOPTION_POINT=0009 must be set or the dry-run compares
# against the latest migration and shows a misleading diff.
npm run migrate:adopt -- --dry-run
npm run migrate:adopt -- --apply

# 2a.2 Apply the pending migrations. After adoption at 0009 both 0010 and
# 0011 are pending; migrate:apply applies both. The down-drill below targets
# 0010 only.
npm run migrate:apply

# 2a.3 Seed + verify.
export MIGRATION_SEED_CONFIRMATION="SEED ${MIGRATION_ALLOWED_HOST}/${MIGRATION_ALLOWED_DATABASE}"
npm run migrate:seed
npm run migrate:verify
```

**Expected:** adoption READY + applied, apply succeeds with `0010` and `0011`
in the applied list, verify PASS.

### 2b. Confirm the current (post-0010) state

```bash
psql "$DATABASE_URL_UNPOOLED" -c \
  "SELECT column_name, data_type FROM information_schema.columns
   WHERE table_name = 'tier_feature_flags' AND column_name = 'limit_value';"
```

**Expected:** `data_type = bigint`.

### 2c. Execute the 0010 down migration (guarded psql procedure)

Down migrations are `manual-only / destructive` by design — there is no
`migrate:down` CLI. The operator executes the down SQL directly via `psql`
after verifying the manifest metadata AND passing an executable confirmation
guard.

**Pre-flight check — review the manifest entry before executing:**

```bash
node -e "
  const m = require('./database/migrations/manifest.json');
  const e = m.migrations.find(x => x.id === '0010');
  console.log('ID:', e.id);
  console.log('Recovery strategy:', e.recovery.strategy);
  console.log('Execution:', e.recovery.execution);
  console.log('Data loss:', e.recovery.dataLoss);
  console.log('Completeness:', e.recovery.completeness);
  console.log('Down file:', e.recovery.file);
"
```

**Confirm before proceeding:**
- [ ] `execution` is `manual-only` (no automated down)
- [ ] `dataLoss` is `destructive` (data may be lost)
- [ ] `completeness` is `partial` (forward-fix is the recovery path)

**Check for rows exceeding int4.** The current 54-row contract includes
10/100 GiB `storage_bytes` limits, so this check is expected to find rows:

```bash
psql "$DATABASE_URL_UNPOOLED" -c \
  "SELECT tier_level, feature_key, limit_value
   FROM tier_feature_flags
   WHERE limit_value > 2147483647
   ORDER BY limit_value DESC;"
```

**Expected on the current 54-row seed:** five rows (`starter`,
`professional`, `enterprise`, `premium`, and `concierge`). The first down
attempt must therefore fail with `integer out of range`, leaving the bigint
column unchanged. This is the intended proof that the partial/destructive
down fails safely instead of silently truncating reference data.

**Set the down confirmation env var.** This is NOT just an echo — the
executable guard below refuses to invoke `psql` unless the token is exact.

```bash
export MIGRATION_DOWN_CONFIRMATION="DOWN ${MIGRATION_ALLOWED_HOST}/${MIGRATION_ALLOWED_DATABASE} AT 0010"
```

**Execute the down SQL with the executable guard.** The guard is wrapped in a
subshell `( … )` so that an interactive operator's `exit 1` on a guard failure
only leaves the subshell — it does NOT close the login shell and destroy the
exported `$*_URL` vars needed for the rest of the drill.

```bash
# --- Executable guard: refuse to run psql unless the token is exact. -------
( set +e
  EXPECTED_DOWN_CONFIRMATION="DOWN ${MIGRATION_ALLOWED_HOST}/${MIGRATION_ALLOWED_DATABASE} AT 0010"
  if [ "${MIGRATION_DOWN_CONFIRMATION:-}" != "$EXPECTED_DOWN_CONFIRMATION" ]; then
    echo ">>> Refusing: MIGRATION_DOWN_CONFIRMATION must equal exactly \"$EXPECTED_DOWN_CONFIRMATION\"" >&2
    exit 1
  fi
  if psql "$DATABASE_URL_UNPOOLED" -v ON_ERROR_STOP=1 \
    -f database/migrations/0010_alter_tier_feature_flags_limit_value_to_bigint.down.sql; then
    echo ">>> UNEXPECTED: 0010 down accepted out-of-range storage limits." >&2
  else
    echo ">>> EXPECTED refusal: oversized storage limits prevented int4 narrowing."
  fi
)
```

**Expected first attempt:** `integer out of range`; the `ALTER` is atomic and
the column remains bigint.

To exercise the working rollback on this isolated adoption branch, make the
destructive preparation explicit. This deliberately removes the oversized
limits; never perform it on production as a default recovery path:

```bash
psql "$DATABASE_URL_UNPOOLED" -c \
  "UPDATE tier_feature_flags
      SET limit_value = NULL
    WHERE limit_value > 2147483647;"

psql "$DATABASE_URL_UNPOOLED" \
  -f database/migrations/0010_alter_tier_feature_flags_limit_value_to_bigint.down.sql
```

**Expected second attempt:** succeeds and narrows the column to integer.

### 2d. Verify the schema reverted

```bash
psql "$DATABASE_URL_UNPOOLED" -c \
  "SELECT column_name, data_type FROM information_schema.columns
   WHERE table_name = 'tier_feature_flags' AND column_name = 'limit_value';"
```

**Expected after the explicit preparation and second attempt:**
`data_type = integer`.

Run verify — it must FAIL (the catalog no longer matches the bigint
fingerprint):

```bash
npm run migrate:verify
```

**Expected:** verify FAIL with `catalogOk: false` (limit_value type diff).

### 2e. Forward fix — re-apply 0010

The forward-fix recovery path: delete the ledger row(s) so the runner sees the
reverted migration as pending, then re-apply.

> **Post-0011 adaptation.** The runner's `validateLedger` requires the applied
> set to be a **contiguous prefix** of history (`runner.ts` — "Applied
> migrations are not a contiguous prefix"). With 0011 sitting on top of 0010,
> deleting **only** the 0010 row leaves `{0000–0009, 0011}` — a gap — and the
> re-apply is refused. Because 0011 is orthogonal to 0010 and its up-migration
> is idempotent (`ADD COLUMN IF NOT EXISTS`), delete **both** 0010 and 0011
> from the tail and let the runner re-apply both: 0010 re-widens the column,
> 0011 is a harmless no-op. This keeps the forward-fix in the runner's hands
> (not hand-run SQL) while respecting the contiguity rule.

```bash
psql "$DATABASE_URL_UNPOOLED" -c \
  "DELETE FROM schema_migrations WHERE id IN ('0010','0011');"

npm run migrate:apply
npm run migrate:seed
```

**Expected:** apply re-applies `0010` and `0011`; seed restores the declared
`storage_bytes` values and the complete 54-row contract.

### 2f. Confirm the schema is restored

```bash
psql "$DATABASE_URL_UNPOOLED" -c \
  "SELECT column_name, data_type FROM information_schema.columns
   WHERE table_name = 'tier_feature_flags' AND column_name = 'limit_value';"

npm run migrate:verify
```

**Expected:** `data_type = bigint`, verify PASS.

**Record:**
- Oversized rows found (count): `5 (starter, professional, enterprise, premium, concierge)`
- Down SQL executed: [x] 1st attempt refused (integer out of range) [x] 2nd attempt succeeded after explicit lossy prep
- `limit_value` type after down: `integer`
- Verify verdict after down: `FAIL (ref-data MISMATCH + catalog DRIFT bigint→integer)`
- Forward fix applied: [x] yes (deleted 0010+0011 ledger rows, re-applied both)
- `limit_value` type after forward fix: `bigint`
- Verify verdict after forward fix: `PASS`

---

## Step 3 — Restore-to-new-branch drill

Prove that Neon PITR / branch-from-timestamp can recover the database to a
pre-migration state.

### 3a. Record the current timestamp (post-0010 state on the ADOPTION branch)

```bash
export POST_MIGRATION_TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
echo "Post-migration timestamp: $POST_MIGRATION_TS"
```

### 3b. Create a restore branch from a pre-migration timestamp

Use a timestamp BEFORE Step 2a.2 (the apply of 0010). If you don't have an
exact pre-migration timestamp, use the ADOPTION branch creation time from
Step 0b.

```bash
# Replace with your actual pre-migration timestamp (before 2a.2).
export PRE_MIGRATION_TS="<record from Step 0b / before 2a.2>"

neonctl branches create \
  --project-id "$NEON_PROJECT_ID" \
  --name "${ADOPTION_BRANCH}-restore-drill" \
  --parent production \
  --timestamp "$PRE_MIGRATION_TS"

export RESTORE_URL=$(neonctl connection-string "${ADOPTION_BRANCH}-restore-drill" \
  --project-id "$NEON_PROJECT_ID" --role-name neondb_owner)
```

### 3c. Verify the restored branch matches the pre-migration state

```bash
psql "$RESTORE_URL" -c \
  "SELECT column_name, data_type FROM information_schema.columns
   WHERE table_name = 'tier_feature_flags' AND column_name = 'limit_value';"

# Check if the schema_migrations ledger exists and what state it's in.
psql "$RESTORE_URL" -c \
  "SELECT id, state FROM schema_migrations ORDER BY id;" 2>&1 || \
  echo "No schema_migrations ledger (expected if restored to pre-adoption state)"
```

**Expected:** the restored branch reflects the pre-migration state. If the
restore point is before adoption, no `schema_migrations` ledger exists and
`limit_value` is `integer`. If after adoption but before 0010, the ledger
shows 0000–0009 as applied and `limit_value` is `integer`.

**Record (LSN restore-in-place variant — see Step 3 note):**
- Restore method: `neonctl branches restore <adopt> ^self@<LSN>` (LSN 0/4123ABF8)
- Backup branch (preserved pre-restore state): `<adopt>-with-marker-backup`
- Change rolled back: `pitr_drill_marker table (a DDL change after the LSN)`
- Post-restore marker present: `no (absent — recovered to before the change)`
- `limit_value` type on restored branch: `bigint` (schema otherwise intact)
- Ledger state on restored branch: `0000–0011 (count 12)`
- Restore RPO: `one DDL change (the marker) rolled back`
- Restore RTO: `a few seconds (single restore call; branch returned to ready)`

---

## Step 4 — Old-Worker-against-expanded-schema check (ADOPTION branch)

Prove that a pre-0010 Worker image can still operate against a post-0010
(expanded) schema. Migration 0010 is expand-compatible (widening int4 →
int8), so the old Worker should read/write without errors.

The ADOPTION branch is now post-0010 (after Step 2). The old Worker must be
built from a commit before 0010 was added, and pointed at the ADOPTION branch
via the env var the Worker actually reads (`NEON_CONNECTION_STRING`, not
`DATABASE_URL_UNPOOLED` — the Worker resolves `env.NEON_CONNECTION_STRING ||
env.DATABASE_URL`, see `workers/src/utils/db-connection.ts`).

### 4a. Build and deploy the pre-0010 Worker image

```bash
# Record the current SHA so we can return to it.
export CURRENT_SHA=$(git rev-parse HEAD)

# Check out the commit BEFORE 0010 was added. 4cef28f0 is the parent of
# 1af28c75 ("add ordered migration commands and target guards"), the commit
# that introduced 0010 — so it predates both 0010 and 0011.
export OLD_WORKER_SHA=4cef28f0
git checkout "$OLD_WORKER_SHA"

# Point the old Worker at the post-0010 ADOPTION branch. The Worker reads
# NEON_CONNECTION_STRING (preferred) or DATABASE_URL — NOT
# DATABASE_URL_UNPOOLED, which is the migration CLI's env var.
export NEON_CONNECTION_STRING="$ADOPTION_URL"

# Build and deploy the old Worker to a preview URL. Use a unique name so it
# does not collide with the production Worker.
cd workers
npm ci
npx wrangler deploy --name date-management-api-e2e-old-worker --env preview
export OLD_WORKER_URL=<the preview URL printed by wrangler>

# Return to the PR branch so the rest of the runbook uses the current code.
cd ..
git checkout "$CURRENT_SHA"
```

### 4b. Exercise the old Worker against the expanded schema

Run a basic smoke test using endpoints that actually exist in `workers/src`:
`/health` (DB connectivity) and `/api/subscription/current` (a real endpoint
registered in `workers/src/index-minimal.ts` that reads from `subscription_tiers`).

```bash
# Health check — proves the old Worker can connect to the post-0010 database.
curl -sS "$OLD_WORKER_URL/health" | jq .

# Subscription current — a real read endpoint that exercises the DB.
# (The old Worker reads limit_value as int4; the column is now int8, but
# int4 reads are compatible with int8 storage — PostgreSQL returns the value
# and the driver coerces it.)
curl -sS "$OLD_WORKER_URL/api/subscription/current" | jq . | head -20
```

**Expected:** the old Worker operates without errors. The int8 column is
readable by the old Worker (PostgreSQL implicit narrowing on read, or the
driver handles it). If the old Worker errors on `limit_value` reads, record
the error — this would indicate the expand-compatible claim is wrong and
0010 needs a contract deployment.

> **Executed approach (2026-08-05).** Rather than a full wrangler preview
> deploy, this drill used a **lightweight driver-level compat proof**: the
> Worker never reads `tier_feature_flags.limit_value` (0 matches in
> `workers/src`), so the only real compat surface is the pre-0011
> `/api/subscription/current` query — whose 4cef28f0 column list already selects
> `current_period_end`/`cancel_at_period_end` (the 0011 columns). That exact
> query was run against the post-0010/0011 branch via the Worker's real driver
> (`@neondatabase/serverless`), plus an int8 read of `limit_value`. Both
> succeeded. See `docs/evidence/2026-08-05-1.6b/step4-old-worker-smoke.txt`.

**Record:**
- Old Worker SHA: `4cef28f0` (parent of the 0010-introducing commit)
- Subscription query vs expanded schema: `all 6 columns resolve, no error (0 rows)`
- `limit_value` int8 read via serverless driver: `5 oversized rows read OK (pg=bigint)`
- Any errors: `none`
- Verdict: [x] old Worker compatible [ ] incompatible (record details)

---

## Step 5 — Teardown

Delete every branch created for this drill. `neonctl branches delete` takes the
branch name/id as a **positional** argument. Delete leaf branches (restore-drill
and the restore's `--preserve-under-name` backup) **before** the ADOPTION parent,
or Neon refuses the parent delete while it has children.

```bash
neonctl branches delete "$FRESH_BRANCH" --project-id "$NEON_PROJECT_ID"
neonctl branches delete "${ADOPTION_BRANCH}-restore-drill" --project-id "$NEON_PROJECT_ID"
neonctl branches delete "${ADOPTION_BRANCH}-with-marker-backup" --project-id "$NEON_PROJECT_ID"
neonctl branches delete "$ADOPTION_BRANCH" --project-id "$NEON_PROJECT_ID"

# Confirm only pre-existing branches (production, dev, any prior PITR branch) remain.
neonctl branches list --project-id "$NEON_PROJECT_ID"
```

No preview Worker was deployed (Step 4 used the lightweight driver-level proof),
so there is no `wrangler delete` to run.

**Record:**
- Fresh branch deleted: [x] yes
- Adoption branch deleted: [x] yes
- Restore-drill + with-marker-backup branches deleted: [x] yes
- Preview Worker deleted: [ ] yes [x] not applicable (no deploy)

---

## Sign-off

**Task 1.6 is not complete until this section is filled.**

| Field | Value |
|-------|-------|
| Operator name | `jatwell93` |
| Date completed | `2026-08-05` |
| Git SHA exercised | `f2255486` |
| CI `Migrations E2E Gate` check URL | `pending — recorded on PR open (1.6.A gate runs on PR)` |
| Step 1 (fresh install) | [x] PASS |
| Step 2 (schema change + rollback + forward fix) | [x] PASS |
| Step 3 (restore drill — LSN restore-in-place) | [x] PASS |
| Step 4 (old Worker against expanded schema) | [x] PASS |
| Step 5 (teardown) | [x] PASS |

### Evidence attachments

Redacted operator output captures are committed under
`docs/evidence/2026-08-05-1.6b/`:

- [ ] CI e2e run URL: `pending — added to PR after the Migrations E2E Gate runs`
- [x] Step 1 fresh install: `docs/evidence/2026-08-05-1.6b/step1-fresh-install.txt`
- [x] Step 2 psql output (down + forward fix): `docs/evidence/2026-08-05-1.6b/step2-down-forward-fix.txt`
- [x] Step 3 restore verification output: `docs/evidence/2026-08-05-1.6b/step3-restore-drill.txt`
- [x] Step 4 old Worker compat output: `docs/evidence/2026-08-05-1.6b/step4-old-worker-smoke.txt`

### Deviations from the original runbook (all documented inline above)

- Production is now at 0011 (post-1.7.B cutover) + free-tier PITR is 6h, so the
  ADOPTION branch was built **synthetically** (replay 0000→0009 via psql, then
  adopt at 0009) rather than sourced pre-adoption. See Step 2a note.
- Forward fix deletes **both** 0010 and 0011 ledger rows (contiguous-prefix rule)
  since 0011 sits on top of 0010. See Step 2e note.
- Step 3 used `neonctl branches restore <branch> ^self@<LSN>` (LSN-based
  restore-in-place) because this neonctl version cannot point-in-time branch a
  non-default branch, and timestamp precision was skew-prone. See Step 3 note.
- Step 4 used a lightweight driver-level compat proof instead of a full wrangler
  preview deploy (schema-compat fully covered; no Worker runtime wiring changed
  by 0010/0011). Accepted scope decision, not outstanding evidence.

### Outstanding evidence

- CI `Migrations E2E Gate` run URL — to be pasted into the PR once the gate runs
  on PR open (the automated e2e suite from 1.6.A).

Once all steps are PASS and evidence is attached, update `tasks.md` to check
off task 1.6 and record the completion date in `design.md`.
