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
      `date-management-prod` (ID: `dawn-darkness-22587117`, region
      `aws-ap-southeast-2`, PostgreSQL 17)
- [ ] A dedicated DDL migration role created on the dev branches (or the
      `postgres` superuser role if the dev branches are ephemeral)
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
needs a **production-shaped** database (the schema from `main`, no ledger).

A Neon branch created from `main` inherits the production schema and data —
it is NOT empty. So:

- **FRESH branch** — created from `main`, then its `public` schema is dropped
  to produce an empty starting point for the Step 1 fresh replay.
- **ADOPTION branch** — created from `main` and left untouched, so it carries
  the production-shaped schema (pre-0010, no `schema_migrations` ledger) for
  Steps 2–4.

Use unique names tied to the SHA or date so they cannot collide with other
operators' branches.

```bash
export NEON_PROJECT_ID=dawn-darkness-22587117
export RUN_ID=$(git rev-parse --short HEAD)-$(date +%Y%m%d%H%M)

# --- 0a. FRESH branch (empty schema, for Step 1) ---------------------------
export FRESH_BRANCH=migration-e2e-fresh-$RUN_ID

neonctl branches create \
  --project-id "$NEON_PROJECT_ID" \
  --name "$FRESH_BRANCH" \
  --parent main

export FRESH_URL=$(neonctl connection-string "$FRESH_BRANCH" \
  --project-id "$NEON_PROJECT_ID" --role-name postgres)

# Empty the schema so Step 1 is a true fresh-install replay. This is safe —
# the branch was just created and is isolated from production.
psql "$FRESH_URL" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

# --- 0b. ADOPTION branch (production-shaped schema, for Steps 2–4) ---------
export ADOPTION_BRANCH=migration-e2e-adopt-$RUN_ID

neonctl branches create \
  --project-id "$NEON_PROJECT_ID" \
  --name "$ADOPTION_BRANCH" \
  --parent main

export ADOPTION_URL=$(neonctl connection-string "$ADOPTION_BRANCH" \
  --project-id "$NEON_PROJECT_ID" --role-name postgres)

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
export MIGRATION_ROLE=postgres
export MIGRATION_DEPLOYMENT_SHA=$(git rev-parse HEAD)
export MIGRATION_CONFIRM_PRODUCTION="APPLY ${MIGRATION_ALLOWED_HOST}/${MIGRATION_ALLOWED_DATABASE}"

# 1a. Preflight — connection, role, privileges, ledger state.
npm run migrate:preflight

# 1b. Apply all migrations (0000 → 0010).
npm run migrate:apply

# 1c. Seed reference data.
export MIGRATION_SEED_CONFIRMATION="SEED ${MIGRATION_ALLOWED_HOST}/${MIGRATION_ALLOWED_DATABASE}"
npm run migrate:seed

# 1d. Verify schema + reference data + catalog fingerprint.
npm run migrate:verify

# 1e. Status — confirm all 11 migrations applied, no drift.
npm run migrate:status
```

**Expected:** preflight READY, apply succeeds with 11 applied, seed upserts
54 rows, verify PASS, status shows all applied / no pending / no drift.

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

### 2a. Adopt the existing schema at 0009, then apply 0010

The adoption branch has the production schema but no ledger. Adopt at 0009
(stamps the ledger with 0000→0009), then apply 0010.

```bash
export DATABASE_URL_UNPOOLED="$ADOPTION_URL"
export MIGRATION_ALLOWED_HOST=$(echo "$DATABASE_URL_UNPOOLED" | sed -n 's|.*@\([^/]*\)/.*|\1|p' | sed 's/:.*//')
export MIGRATION_ALLOWED_DATABASE=$(echo "$DATABASE_URL_UNPOOLED" | sed -n 's|.*/\([^?]*\).*|\1|p')
export MIGRATION_ENVIRONMENT=development
export MIGRATION_TARGET_KIND=primary
export MIGRATION_ROLE=postgres
export MIGRATION_DEPLOYMENT_SHA=$(git rev-parse HEAD)
export MIGRATION_CONFIRM_PRODUCTION="APPLY ${MIGRATION_ALLOWED_HOST}/${MIGRATION_ALLOWED_DATABASE}"
export MIGRATION_ADOPTION_POINT=0009
export MIGRATION_ADOPTION_CONFIRMATION="ADOPT ${MIGRATION_ALLOWED_HOST}/${MIGRATION_ALLOWED_DATABASE} AT 0009"

# 2a.1 Adopt the existing schema at 0009.
npm run migrate:adopt

# 2a.2 Apply 0010 (the only pending migration after adoption).
npm run migrate:apply

# 2a.3 Seed + verify.
export MIGRATION_SEED_CONFIRMATION="SEED ${MIGRATION_ALLOWED_HOST}/${MIGRATION_ALLOWED_DATABASE}"
npm run migrate:seed
npm run migrate:verify
```

**Expected:** adoption READY + applied, apply succeeds with `0010` in the
applied list, verify PASS.

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

**Execute the down SQL with the executable guard:**

```bash
# --- Executable guard: refuse to run psql unless the token is exact. -------
EXPECTED_DOWN_CONFIRMATION="DOWN ${MIGRATION_ALLOWED_HOST}/${MIGRATION_ALLOWED_DATABASE} AT 0010"
if [ "${MIGRATION_DOWN_CONFIRMATION:-}" != "$EXPECTED_DOWN_CONFIRMATION" ]; then
  echo "::error::MIGRATION_DOWN_CONFIRMATION must equal exactly \"$EXPECTED_DOWN_CONFIRMATION\"" >&2
  echo "::error::Refusing to execute down SQL without a matching confirmation token." >&2
  exit 1
fi

if psql "$DATABASE_URL_UNPOOLED" \
  -f database/migrations/0010_alter_tier_feature_flags_limit_value_to_bigint.down.sql; then
  echo "::error::0010 down unexpectedly accepted out-of-range storage limits." >&2
  exit 1
else
  echo "Expected refusal: oversized storage limits prevented int4 narrowing."
fi
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

The forward-fix recovery path: delete the 0010 ledger row so the runner sees
it as pending, then re-apply.

```bash
psql "$DATABASE_URL_UNPOOLED" -c \
  "DELETE FROM schema_migrations WHERE id = '0010';"

npm run migrate:apply
npm run migrate:seed
```

**Expected:** apply succeeds with `0010` in the applied list; seed restores
the six declared `storage_bytes` values and the complete 54-row contract.

### 2f. Confirm the schema is restored

```bash
psql "$DATABASE_URL_UNPOOLED" -c \
  "SELECT column_name, data_type FROM information_schema.columns
   WHERE table_name = 'tier_feature_flags' AND column_name = 'limit_value';"

npm run migrate:verify
```

**Expected:** `data_type = bigint`, verify PASS.

**Record:**
- Oversized rows found (count): `____________________________`
- Down SQL executed: [ ] yes (succeeded) [ ] yes (failed — record error) [ ] not run
- `limit_value` type after down: `____________________________`
- Verify verdict after down: `____________________________`
- Forward fix applied: [ ] yes
- `limit_value` type after forward fix: `____________________________`
- Verify verdict after forward fix: `____________________________`

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
  --parent main \
  --timestamp "$PRE_MIGRATION_TS"

export RESTORE_URL=$(neonctl connection-string "${ADOPTION_BRANCH}-restore-drill" \
  --project-id "$NEON_PROJECT_ID" --role-name postgres)
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

**Record:**
- Restore branch name: `____________________________`
- Pre-migration timestamp used: `____________________________`
- `limit_value` type on restored branch: `____________________________`
- Ledger state on restored branch: `____________________________`
- Restore RPO (time between migration and restore point): `____________________________`
- Restore RTO (time from `neonctl branches create` to verified): `____________________________`

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

# Check out the commit BEFORE 0010 was added. Replace with the actual parent
# of the Phase 1.5 commit, or the last main commit before this PR.
export OLD_WORKER_SHA=<git ref before 0010>
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

**Record:**
- Old Worker SHA: `____________________________`
- Health check result: `____________________________`
- `/api/subscription/current` read result: `____________________________`
- Any errors: `____________________________`
- Verdict: [ ] old Worker compatible [ ] incompatible (record details)

---

## Step 5 — Teardown

Delete the dev branches and preview Worker created for this drill.

```bash
neonctl branches delete \
  --project-id "$NEON_PROJECT_ID" \
  --branch "$FRESH_BRANCH"

neonctl branches delete \
  --project-id "$NEON_PROJECT_ID" \
  --branch "$ADOPTION_BRANCH"

neonctl branches delete \
  --project-id "$NEON_PROJECT_ID" \
  --branch "${ADOPTION_BRANCH}-restore-drill"

# If you deployed a preview Worker, delete it.
npx wrangler delete --name date-management-api-e2e-old-worker --env preview
```

**Record:**
- Fresh branch deleted: [ ] yes
- Adoption branch deleted: [ ] yes
- Restore branch deleted: [ ] yes
- Preview Worker deleted: [ ] yes / not applicable

---

## Sign-off

**Task 1.6 is not complete until this section is filled.**

| Field | Value |
|-------|-------|
| Operator name | `____________________________` |
| Date completed | `____________________________` |
| Git SHA exercised | `____________________________` |
| CI `Migrations E2E Gate` check URL | `____________________________` |
| Step 1 (fresh install) | [ ] PASS |
| Step 2 (schema change + rollback + forward fix) | [ ] PASS |
| Step 3 (restore-to-new-branch drill) | [ ] PASS |
| Step 4 (old Worker against expanded schema) | [ ] PASS |
| Step 5 (teardown) | [ ] PASS |

### Evidence attachments

Paste links to CI runs, screenshots, psql output captures, or commit the
output files to the PR:

- [ ] CI e2e run URL: `____________________________`
- [ ] Step 2 psql output (down + forward fix): `____________________________`
- [ ] Step 3 restore branch verification output: `____________________________`
- [ ] Step 4 old Worker smoke test output: `____________________________`

### Outstanding evidence

If any step could not be completed in this session, record what is missing
and why:

- `____________________________`

Once all steps are PASS and evidence is attached, update `tasks.md` to check
off task 1.6 and record the completion date in `design.md`.
