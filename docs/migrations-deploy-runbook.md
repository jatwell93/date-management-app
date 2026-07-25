# Migrations Deploy Runbook — Production Migration + Worker Deploy Gate (Task 1.7)

## Purpose

This runbook is the **operator gate** for Phase 1 task 1.7: integrating the
authoritative PostgreSQL migration runner into the production deployment
workflow. The CI workflow (`.github/workflows/workers-deploy.yml` calling
`.github/workflows/migration-prep.yml`) automates the migration validation,
apply, seed, verify, Worker deploy, and canary sequence. This runbook covers
the operator responsibilities that **cannot be automated without production
credentials**: the pre-deploy PITR drill, canary observation thresholds,
rollback execution, and sign-off.

**Task 1.7.B-execute is not complete until this runbook has been exercised
end-to-end on a real production deploy and the sign-off section at the bottom
is filled with operator evidence.**

The automatable subtasks (CI workflow + scripts) may be merged independently;
the parent task 1.7 checkbox stays open until the operator evidence below is
recorded.

---

## Architecture

```
PR / push to main (touching workers/ or migrations/)
  │
  ├─ PR:  migration-prep (preview, validate-only: status + preflight)
  │       └─ deploy-development (preview Worker)
  │
  └─ push to main / workflow_dispatch:
          migration-prep (production, full: status → preflight → PITR → apply → seed → verify)
          └─ deploy-production (production Worker)
             └─ canary (smoke round 1 → wait 15m → smoke round 2 + Sentry check)
```

**Credential-level enforcement.** Production deployment credentials
(`DOPPLER_TOKEN`, `CLOUDFLARE_API_TOKEN`, `NEON_API_KEY`, `SENTRY_AUTH_TOKEN`)
are scoped to the protected `production` GitHub environment. That environment
has:

- **Branch policy**: only `main` can deploy to production
- **15-minute wait timer**: a human review window before any production job starts
- **`can_admins_bypass: false`**: admins cannot skip the protection rules

`workflow_dispatch` from `main` is the **supported manual deployment mechanism**.
Direct local `wrangler deploy --env production` requires separately controlled
break-glass access to production credentials (Doppler production token +
Cloudflare API token) — **documentation alone is not enforcement.** The
production GitHub environment is the enforcement boundary.

---

## Prerequisites

- [ ] `DOPPLER_TOKEN` GitHub secret configured (repo-level, used by all deploy jobs)
- [ ] `NEON_API_KEY` GitHub environment secret configured in `production`
      (read-only Neon API key for the PITR readiness check)
- [ ] `SENTRY_AUTH_TOKEN` GitHub environment secret configured in `production`
      (read-only Sentry API token for the canary check) — optional, canary
      fails open if unset
- [ ] `SENTRY_ORG` and `SENTRY_PROJECT` GitHub environment variables configured
      in `production` (not secrets — just identifiers)
- [ ] `CANARY_WAIT_MINUTES` GitHub environment variable configured in
      `production` (default 15 if unset)
- [ ] Doppler production config contains: `DATABASE_URL_UNPOOLED`,
      `MIGRATION_ALLOWED_HOST`, `MIGRATION_ALLOWED_DATABASE`,
      `MIGRATION_CONFIRM_PRODUCTION`, `MIGRATION_ROLE`, `MIGRATION_SEED_CONFIRMATION`,
      `NEON_CONNECTION_STRING`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
- [ ] Neon project ID known: `dawn-darkness-22587117` (region
      `aws-ap-southeast-2`, PostgreSQL 17)
- [ ] `npm run compile` passes locally
- [ ] The automated e2e suite passes in CI (green `Migrations E2E Gate` check)
- [ ] Operator has access to the Neon console for the PITR drill

---

## Step 1 — Pre-deploy PITR drill (operator gate)

Before any production migration, verify that Neon PITR (point-in-time recovery)
is functional by performing a restore-to-new-branch drill. This is separate
from the CI PITR readiness check (which only verifies a restore point exists);
this drill proves you can actually restore and the application works against
the restored data.

### 1a. Verify a recent restore point exists

```bash
# Via Neon CLI
neonctl snapshots list --project-id dawn-darkness-22587117 --branch main

# Or via the CI PITR check script locally (requires NEON_API_KEY)
NEON_API_KEY=<key> NEON_PROJECT_ID=dawn-darkness-22587117 node scripts/check-neon-pitr.js
```

**Expected:** at least one snapshot within the last 2 hours. If the newest
snapshot is older, **stop** — do not proceed with the migration. Wait for
Neon to create a new snapshot or create one manually:

```bash
neonctl snapshots create --project-id dawn-darkness-22587117 --branch main
```

### 1b. Restore-to-new-branch drill

```bash
export NEON_PROJECT_ID=dawn-darkness-22587117
export DRILL_BRANCH=pitr-drill-$(date +%Y%m%d%H%M)

# Create a branch restored to the latest state
neonctl branches create \
  --project-id "$NEON_PROJECT_ID" \
  --name "$DRILL_BRANCH" \
  --parent main

export DRILL_URL=$(neonctl connection-string "$DRILL_BRANCH" \
  --project-id "$NEON_PROJECT_ID" --role-name postgres)

# Verify the restored branch has the expected schema
psql "$DRILL_URL" -c \
  "SELECT count(*) AS table_count FROM information_schema.tables WHERE table_schema = 'public';"

# Run the migration verify command against the restored branch
DATABASE_URL_UNPOOLED="$DRILL_URL" \
MIGRATION_ALLOWED_HOST=<drill-host> \
MIGRATION_ALLOWED_DATABASE=<drill-db> \
MIGRATION_ENVIRONMENT=production \
MIGRATION_TARGET_KIND=restore-drill \
MIGRATION_ROLE=<ddl-role> \
npm run migrate:verify
```

**Expected:** `migrate:verify` reports PASS. If it fails, the production
schema has drift that must be investigated before migrating.

### 1c. Clean up the drill branch

```bash
neonctl branches delete \
  --project-id "$NEON_PROJECT_ID" \
  --branch "$DRILL_BRANCH"
```

**Record:**
- Restore point timestamp: `____________________________`
- Drill branch table count: `____________________________`
- `migrate:verify` result: [ ] PASS [ ] FAIL
- Drill branch deleted: [ ] yes
- RPO (restore point age): `____________________________`
- RTO (time to restore + verify): `____________________________`

---

## Step 2 — Trigger the production deploy

The production deploy is triggered by:

1. **Push to `main`** (after PR merge) — automatic
2. **`workflow_dispatch` from `main`** — manual, for rollbacks or emergency patches

Both paths run the full sequence:

```
migration-prep (production, full)
  → validate-history (migrate:status)
  → preflight (migrate:preflight)
  → pitr-check (check-neon-pitr.js)
  → apply (migrate:apply)
  → seed (migrate:seed)
  → verify (migrate:verify)
→ deploy-production (wrangler deploy --env production)
→ canary (smoke round 1 → wait → smoke round 2 + Sentry)
```

### 2a. Monitor the CI workflow

1. Go to the **Actions** tab in GitHub
2. Find the **Deploy Workers API** workflow run
3. Monitor each job:
   - **validate-history**: `migrate:status` output — check for checksum drift, interrupted rows, or pending migrations
   - **preflight**: `migrate:preflight` output — check `ready: true`
   - **pitr-check**: `pitr-evidence.json` artifact — check `ready: true`
   - **apply**: `migration-apply.txt` artifact — check `applied: [...]` lists the expected migrations
   - **seed**: `migration-seed.txt` artifact — check 48 rows upserted
   - **verify**: `migration-verify.txt` artifact — check PASS
   - **deploy-production**: Worker deployed successfully
   - **canary**: both smoke rounds pass, no new critical Sentry issues

### 2b. Download artifacts for audit

Each step uploads an artifact (retained 30 days). Download them and store
with the deployment record:

- `migration-status-<sha>`
- `migration-preflight-<sha>`
- `pitr-evidence-<sha>`
- `migration-apply-<sha>`
- `migration-seed-<sha>`
- `migration-verify-<sha>`
- `canary-evidence-<sha>`

**Record:**
- Workflow run URL: `____________________________`
- Git SHA deployed: `____________________________`
- Migrations applied: `____________________________`
- All migration-prep jobs passed: [ ] yes
- Worker deployed: [ ] yes

---

## Step 3 — Canary observation

The canary job runs automatically after deploy. It:

1. **Round 1**: immediate smoke test (`/health?deep=true` + `/api/subscription/current`)
2. **Wait**: 15 minutes (configurable via `CANARY_WAIT_MINUTES`)
3. **Round 2**: re-run smoke test + check Sentry for new critical issues

### Stop / rollback thresholds

**Abort the deploy (rollback) if ANY of the following occur during the canary window:**

| Signal | Threshold | Action |
|--------|-----------|--------|
| Smoke test failure (round 1 or 2) | Any endpoint non-2xx or DB readiness fail | Immediate rollback |
| Sentry new critical/fatal issues | > 0 new unresolved critical issues | Immediate rollback |
| Sentry error rate | > 5% of requests | Investigate, likely rollback |
| 5xx error rate | > 1% of requests | Investigate, likely rollback |
| p95 latency | > 2000ms (2x baseline) | Investigate, consider rollback |
| Neon compute suspended unexpectedly | Repeated cold starts | Investigate, not necessarily rollback |

### Manual canary observation

In addition to the automated canary, observe manually during the window:

```bash
# Watch Worker logs
npx wrangler tail --env production

# Check Sentry dashboard
open https://sentry.io/organizations/<org>/projects/<project>/

# Check Neon dashboard for compute health
open https://console.neon.tech/app/projects/dawn-darkness-22587117
```

**Record:**
- Canary round 1 result: [ ] PASS [ ] FAIL
- Canary round 2 result: [ ] PASS [ ] FAIL
- Sentry critical issues: `____________________________`
- Manual observation notes: `____________________________`
- Verdict: [ ] canary passed [ ] canary failed (rollback triggered)

---

## Step 4 — Rollback procedure (if canary fails)

Rollback is a **three-layer** decision. Do NOT default to a destructive down
migration — the Phase 1 design classifies all down migrations as
`manual-only / destructive`. The rollback order is:

### 4a. Worker rollback (first, fastest)

If the issue is in the Worker code (not the schema), roll back the Worker
without touching the database:

```bash
# Option 1: revert the merge commit and re-deploy
git revert <merge-sha>
git push origin main
# The push triggers workers-deploy.yml automatically

# Option 2: manual workflow_dispatch from a known-good SHA
# Go to Actions → Deploy Workers API → Run workflow
# Set "Use workflow from" to the known-good SHA
```

Because the migration runner enforces **expand-only** compatibility, the old
Worker is guaranteed to work against the expanded schema (expand migrations
are backward-compatible with old code). This is the default rollback path.

### 4b. Forward-fix (if the schema change itself is broken)

If the migration applied a schema change that is itself broken (e.g., a wrong
column type), the recovery path is a **forward fix** — a new migration that
corrects the problem. This is the Phase 1 design's primary recovery strategy
for non-transactional or partial migrations.

```bash
# 1. Write a new expand-compatible migration that fixes the issue
# 2. Add it to database/migrations/ and manifest.json
# 3. Run through the normal deploy workflow
```

### 4c. Neon PITR restore (catastrophic only)

If both the Worker rollback and forward-fix are not viable (e.g., data
corruption), restore the database to a pre-migration point in time:

```bash
export NEON_PROJECT_ID=dawn-darkness-22587117
export RESTORE_BRANCH=rollback-$(date +%Y%m%d%H%M)

# Restore to a new branch at the pre-migration timestamp
# (use the restore point timestamp from Step 1a)
neonctl branches create \
  --project-id "$NEON_PROJECT_ID" \
  --name "$RESTORE_BRANCH" \
  --parent main \
  --restore-to "<pre-migration-ISO-timestamp>"

# Verify the restored branch
export RESTORE_URL=$(neonctl connection-string "$RESTORE_BRANCH" \
  --project-id "$NEON_PROJECT_ID" --role-name postgres)
psql "$RESTORE_URL" -c "SELECT count(*) FROM tier_feature_flags;"

# Point the Worker at the restored branch
npx wrangler secret put NEON_CONNECTION_STRING --env production <<< "$RESTORE_URL"
npx wrangler deploy --env production

# Once verified, promote the restore branch to main via Neon console
# (or keep the restore branch and update the Worker's connection string)
```

**Warning:** PITR restore to a new branch means the original main branch's
data after the restore point is lost. This is a last resort.

**Record (if rollback was triggered):**
- Rollback method: [ ] Worker rollback [ ] Forward fix [ ] PITR restore
- Time to rollback: `____________________________`
- Data loss: [ ] none [ ] minimal [ ] significant
- Root cause: `____________________________`

---

## Step 5 — Post-deploy verification

After the canary passes, perform a final manual verification:

```bash
# Deep health check (verifies DB connectivity)
curl -sS "https://api.expirymate.com.au/health?deep=true" | jq .

# Subscription endpoint (verifies schema-dependent read)
curl -sS "https://api.expirymate.com.au/api/subscription/current" | jq . | head -20

# Run migrate:verify against production to confirm the deployed schema
# matches the fingerprint
DATABASE_URL_UNPOOLED=<prod-direct-url> \
MIGRATION_ALLOWED_HOST=<prod-host> \
MIGRATION_ALLOWED_DATABASE=<prod-db> \
MIGRATION_ENVIRONMENT=production \
MIGRATION_CONFIRM_PRODUCTION="APPLY <prod-host>/<prod-db>" \
MIGRATION_TARGET_KIND=primary \
MIGRATION_ROLE=<ddl-role> \
npm run migrate:verify
```

**Expected:** all checks PASS.

**Record:**
- Deep health: [ ] PASS [ ] FAIL
- Subscription read: [ ] PASS [ ] FAIL
- `migrate:verify`: [ ] PASS [ ] FAIL

---

## Sign-off

**Task 1.7.B-execute is not complete until this section is filled.**

| Field | Value |
|-------|-------|
| Operator name | `____________________________` |
| Date completed | `____________________________` |
| Git SHA deployed | `____________________________` |
| Workflow run URL | `____________________________` |
| Step 1 (PITR drill) | [ ] PASS |
| Step 2 (CI deploy) | [ ] PASS |
| Step 3 (canary) | [ ] PASS |
| Step 4 (rollback) | [ ] N/A [ ] executed |
| Step 5 (post-deploy verify) | [ ] PASS |

### Evidence attachments

Paste links to CI runs, artifacts, or commit output files to the PR:

- [ ] CI workflow run URL: `____________________________`
- [ ] PITR drill output: `____________________________`
- [ ] Migration artifacts (status/preflight/apply/seed/verify): `____________________________`
- [ ] Canary evidence artifact: `____________________________`
- [ ] Post-deploy verify output: `____________________________`

### Outstanding evidence

If any step could not be completed in this session, record what is missing
and why:

- `____________________________`

Once all steps are PASS and evidence is attached, update `tasks.md` to check
off task 1.7.B-execute and the parent 1.7 checkbox.

---

## New secrets and variables reference

### GitHub environment secrets (production)

| Secret | Purpose | Required |
|--------|---------|----------|
| `NEON_API_KEY` | Neon API read-only key for PITR readiness check | Yes |
| `SENTRY_AUTH_TOKEN` | Sentry API read-only token for canary check | No (canary fails open) |

### GitHub environment variables (production)

| Variable | Purpose | Default |
|----------|---------|---------|
| `SENTRY_ORG` | Sentry organization slug | — |
| `SENTRY_PROJECT` | Sentry project slug | — |
| `CANARY_WAIT_MINUTES` | Canary wait window in minutes | 15 |

### Doppler production config (existing + new)

The migration CLIs read these from the environment (injected by `doppler run`):

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL_UNPOOLED` | Direct (non-pooled) Neon connection for migrations |
| `MIGRATION_ALLOWED_HOST` | Allowlisted hostname |
| `MIGRATION_ALLOWED_DATABASE` | Allowlisted database name |
| `MIGRATION_CONFIRM_PRODUCTION` | `APPLY <host>/<database>` confirmation token |
| `MIGRATION_ROLE` | Dedicated DDL migration role name |
| `MIGRATION_SEED_CONFIRMATION` | `SEED <host>/<database>` confirmation token |
| `NEON_CONNECTION_STRING` | Worker's Neon connection (existing) |
| `CLOUDFLARE_API_TOKEN` | Worker deploy (existing) |
| `CLOUDFLARE_ACCOUNT_ID` | Worker deploy (existing) |

---

## Related documentation

- [Migrations E2E Runbook](migrations-e2e-runbook.md) — the operator Neon dev-branch gate (task 1.6)
- [Neon Backup & Restore](neon-backup-restore.md) — Neon PITR details
- [Workers Deployment](workers-deployment.md) — Worker deploy basics
- [Production Deployment Checklist](production-deployment-checklist.md) — general pre-launch checklist
- [Rollback Procedure](rollback-procedure.md) — existing rollback docs
