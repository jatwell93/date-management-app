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
  └─ push to main (only if PRODUCTION_AUTO_DEPLOY_ENABLED == 'true')
     / workflow_dispatch from main (always available):
          migration-prep (production, full: ONE job with sequential steps
            → status → preflight → PITR → apply → seed → verify)
          └─ deploy-production (production Worker)
             └─ canary (smoke round 1 → wait 15m → smoke round 2 + Sentry check)
```

> **Production safety switch.** Push-to-main production deploys are
> gated by the repository variable `PRODUCTION_AUTO_DEPLOY_ENABLED`. It
> defaults to disabled (unset), so a push to main does **not** trigger a
> production deploy until the operator explicitly sets it to `'true'`.
> Manual `workflow_dispatch` from `main` always works regardless of the
> variable — this is the supported break-glass / rollback path and is
> never gated. Disable the variable to freeze production deploys without
> losing the manual dispatch capability.

**Single-job migration prep.** The `migration-prep.yml` reusable workflow
runs the entire status → preflight → PITR → apply → seed → verify sequence
as **one job with sequential steps** (not six separate jobs). This ensures:
- the protected production environment gate (15-min wait timer + branch
  policy + required reviewers) is applied **exactly once**, not six times;
- the Doppler CLI is installed once;
- checkout, dependency install, and TypeScript compile happen once on a
  single checked-out revision.
Each step uploads its own artifact with `if: always()` so partial evidence
is preserved even on mid-sequence failure.

**Concurrency serialization.** All production deploys (push to `main` or
manual `workflow_dispatch` from `main`) share a single fixed concurrency
group (`workers-deploy-production`) with `cancel-in-progress: false`. A
subsequent push or dispatch **cannot** cancel or overlap an in-flight
apply/seed/verify sequence — it queues behind the running deploy. PR
(preview) deploys keep ref-specific concurrency groups with
`cancel-in-progress: true` so superseded preview runs are cancelled.

**Credential-level enforcement.** Production deployment credentials
(`DOPPLER_TOKEN`, `CLOUDFLARE_API_TOKEN`, `NEON_API_KEY`,
`SENTRY_AUTH_TOKEN`) are scoped to the protected `production` GitHub
environment. `CLERK_SECRET_KEY` and `SMOKE_USER_ID` are **not** GitHub
secrets — they live in Doppler production config and are injected at run
time via `doppler run` so the canary can mint short-lived Clerk session
tokens. That environment has:

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
- [ ] `PRODUCTION_AUTO_DEPLOY_ENABLED` GitHub **repository** variable
      configured (Settings → Secrets and variables → Actions → Variables).
      Set to `'true'` to enable automatic production deploys on push to
      `main`. **Defaults to disabled** (unset / any value other than
      `'true'`) — when disabled, push to main does NOT trigger a
      production deploy; use `workflow_dispatch` from `main` to deploy
      manually. This is the production safety switch: disable it to
      freeze production deploys without losing the manual dispatch
      rollback path.
- [ ] Doppler production config contains: `DATABASE_URL_UNPOOLED`,
      `MIGRATION_ALLOWED_HOST`, `MIGRATION_ALLOWED_DATABASE`,
      `MIGRATION_CONFIRM_PRODUCTION`, `MIGRATION_ROLE`, `MIGRATION_SEED_CONFIRMATION`,
      `NEON_CONNECTION_STRING`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`,
      `CLERK_SECRET_KEY`, `SMOKE_USER_ID`
- [ ] Dedicated smoke-test identity provisioned (see
      [Smoke-test identity provisioning](#smoke-test-identity-provisioning) below)
- [ ] Neon project ID known: `dawn-darkness-22587117` (region
      `aws-ap-southeast-2`, PostgreSQL 17)
- [ ] `npm run compile` passes locally
- [ ] The automated e2e suite passes in CI (green `Migrations E2E Gate` check)
- [ ] Operator has access to the Neon console for the PITR drill

### Smoke-test identity provisioning

A dedicated smoke-test identity must be provisioned **once** in production
before the first canary run. This is cross-system operational state (Clerk
identity + application database rows), not deterministic reference data —
do **not** add it to `migrate:seed`.

> **Why two users, not one:** the normal organization bootstrap path
> (`workers/src/clerk/bootstrap-handler.ts:302-314`) makes the **first**
> active user in a new organization an `admin`. A single smoke user
> provisioned through bootstrap would therefore be an admin — which
> violates the lowest-privilege requirement. The provisioning flow below
> uses a **custodian admin** to create and administer the smoke
> organization, then adds the **smoke identity second** so it lands as
> `team_member`.

Provision it through the normal application bootstrap path:

1. **Custodian admin (operator-only, not the smoke identity).** Create a
   dedicated operator user in the **production** Clerk dashboard
   (instance `ins_3C1uCdrvUbtBaw2zG5gPmeqSwCV`). This user administers
   the smoke organization but is **never** used by the canary. Record
   its Clerk user ID in the sign-off section as "custodian".
2. **Dedicated smoke-test organization.** Create a **dedicated
   smoke-test organization** in Clerk (not a customer org — a canary
   failure against a customer org could pollute their
   `subscription_tiers` reads).
3. **Bootstrap the org with the custodian.** Run the normal
   organization/bootstrap flow as the **custodian** user so the
   application creates the `organizations` row and the custodian's
   `users` row via production logic. The custodian becomes the org's
   `admin` (first active user). Do **not** manually insert database
   rows unless the normal bootstrap path cannot support these
   identities.
4. **Add the smoke identity second, as `team_member`.** Create a
   **separate** dedicated smoke user in the production Clerk dashboard
   and invite it into the smoke organization with the
   `team_member` membership role. Run the bootstrap flow as this second
   user. Because the custodian is already an active admin, the bootstrap
   handler assigns `team_member` to the second user
   (`normalizeBootstrapRole` is used instead of the first-admin path).
   This is the lowest role that can read `/api/subscription/current`.
5. **Ensure the organization has a real `subscription_tiers` row** (so
   the canary query returns data, not an empty 200). Insert or activate
   one via the normal application flow.
6. **Ensure neither identity has production billing privileges.** The
   smoke identity must have **no** administration or billing
   privileges. The custodian may retain admin on the smoke org only.
7. **Verify the smoke identity's application DB state** before storing
   its Clerk ID. Run this query against production (read-only) and
   confirm exactly one row is returned with the expected values:

   ```bash
   # Substitute <smoke-clerk-user-id> with the Clerk user ID of the
   # SECOND (team_member) user — not the custodian.
   psql "$DATABASE_URL_UNPOOLED" -c "
     SELECT u.id           AS app_user_id,
            u.clerk_user_id,
            u.role,
            u.deleted_at,
            u.organization_id,
            o.name         AS org_name,
            st.id          AS subscription_id,
            st.status      AS subscription_status,
            st.tier_level
     FROM users u
     JOIN organizations o ON o.id = u.organization_id
     LEFT JOIN subscription_tiers st ON st.organization_id = u.organization_id
     WHERE u.clerk_user_id = '<smoke-clerk-user-id>'
       AND u.deleted_at IS NULL
       AND u.role = 'team_member'
       AND st.id IS NOT NULL;
   "
   ```

   **Expected:** exactly one row, with `role = team_member`,
   `deleted_at` NULL, and a non-null `subscription_id`. If the query
   returns zero rows or a role other than `team_member`, **stop** — the
   canary would either fail to authenticate or exercise an
   over-privileged identity. Re-provision before proceeding.
8. **Store only the smoke identity's Clerk user ID** as `SMOKE_USER_ID`
   in Doppler production config. Do **not** store the custodian's Clerk
   ID — the canary never mints sessions for the custodian.
9. **Record both identities** in the sign-off section below: custodian
   Clerk user ID + application user ID, smoke identity Clerk user ID +
   application user ID, organization ID, creator, date, and purpose.

> **Blast radius note:** the canary job receives the full production
> `CLERK_SECRET_KEY` (via `doppler run`) to mint session tokens. Clerk
> does not offer a suitably restricted Backend API credential that can
> mint session tokens for one user only — the secret key has full
> Backend API access. Blast radius is controlled by the protected GitHub
> `production` environment (branch policy + 15-min wait timer +
> `can_admins_bypass: false`) and the reviewed `main` branch, **and**
> by provisioning the smoke identity as `team_member` (not admin) so a
> leaked minted session can only read subscription state, not mutate
> org or billing configuration. The `SMOKE_USER_ID` is not secret but
> is kept in Doppler alongside the Clerk key so the canary
> configuration lives in one place.

---

## Step 1 — Pre-deploy PITR drill (operator gate)

Before any production migration, verify that Neon PITR (point-in-time recovery)
is functional by performing a restore-to-new-branch drill. This is separate
from the CI PITR readiness check (which only verifies a restore point exists);
this drill proves you can actually restore and the application works against
the restored data.

### 1a. Verify a recent restore point exists

```bash
set -euo pipefail

# Via the CI PITR check script locally (requires NEON_API_KEY).
# This is the same script CI runs; it resolves the main branch, filters
# snapshots by branch_id, and fails closed if no recent snapshot exists.
NEON_API_KEY=<key> NEON_PROJECT_ID=dawn-darkness-22587117 node scripts/check-neon-pitr.js

# Or query the Neon REST API directly (same endpoint the script uses):
#   curl --fail-with-body --silent --show-error \
#     -H "Authorization: Bearer $NEON_API_KEY" \
#     "https://console.neon.tech/api/v2/projects/dawn-darkness-22587117/snapshots" \
#     | jq '.snapshots[0]'
```

**Expected:** at least one snapshot within the last 2 hours. If the newest
snapshot is older, **stop** — do not proceed with the migration. Wait for
Neon to create a new snapshot or create one manually via the REST API:

```bash
set -euo pipefail

# Create a snapshot of the main branch via the Neon REST API.
# (neonctl@2.27.0 has no `snapshots` subcommand, so use the API directly.)
# The branch ID is a path parameter; `name` is a QUERY parameter per the
# Neon create-snapshot API (https://api-docs.neon.tech/reference/createsnapshot).
# --fail-with-body makes curl exit non-zero on 4xx/5xx (otherwise an error
# response would be piped into jq as if it were a success body).
# jq's first(...) is used instead of `| head -1` so the pipeline does not
# abort under `set -o pipefail` (head closing the pipe early would surface
# SIGPIPE as a non-zero exit and trip `set -e`).
MAIN_BRANCH_ID=$(curl --fail-with-body --silent --show-error \
  -H "Authorization: Bearer $NEON_API_KEY" \
  "https://console.neon.tech/api/v2/projects/dawn-darkness-22587117/branches?search=main" \
  | jq -r 'first(.branches[] | select(.name=="main") | .id) // empty')
if [ -z "$MAIN_BRANCH_ID" ]; then
  echo "::error::Could not resolve main branch ID. Aborting."
  exit 1
fi
curl --fail-with-body --silent --show-error --request POST \
  -H "Authorization: Bearer $NEON_API_KEY" \
  --get \
  --data-urlencode "name=pre-migration-manual" \
  "https://console.neon.tech/api/v2/projects/dawn-darkness-22587117/branches/$MAIN_BRANCH_ID/snapshot" \
  | jq '.'
```

### 1b. Restore-to-new-branch drill

This step must restore a **specific snapshot** into a new preview branch —
creating an ordinary child branch from current main does **not** prove
PITR. The drill verifies that a snapshot can be materialized via Neon's
snapshot-restore REST API and the application works against the restored
data.

> **Tooling note (verified 2026-07-26):** `neonctl@2.27.0` does **not**
> expose a `snapshots` subcommand (its `branches` command has no
> snapshot-restore path either), so this drill uses the Neon REST API
> directly — the same API the CI PITR check
> (`scripts/check-neon-pitr.js`) uses to list snapshots. The endpoint is
> `POST /api/v2/projects/{project_id}/snapshots/{snapshot_id}/restore`
> with `finalize_restore: false` to create a preview branch without
> touching main. Do not connect to the restored branch until every
> operation returned by the restore call reaches a terminal state
> (`finished`, `skipped`, `cancelled`, or `failed`); connecting earlier
> will either fail or hit the pre-restore state. See
> https://neon.com/docs/ai/ai-database-versioning for the official
> snapshot-restore documentation.

```bash
set -euo pipefail

export NEON_PROJECT_ID=dawn-darkness-22587117
export NEON_API_KEY="<your-neon-api-key>"
export DRILL_BRANCH=pitr-drill-$(date +%Y%m%d%H%M)

# 1. Pick the newest snapshot ID for the main branch from Step 1a.
#    Step 1a already confirmed it is within 2 hours. If you only have the
#    timestamp, list snapshots via the REST API to resolve the ID:
#   curl --fail-with-body --silent --show-error \
#     -H "Authorization: Bearer $NEON_API_KEY" \
#     "https://console.neon.tech/api/v2/projects/$NEON_PROJECT_ID/snapshots" \
#     | jq '.snapshots[0].id'
export SNAPSHOT_ID="<newest-snapshot-id>"
if [ -z "$SNAPSHOT_ID" ]; then
  echo "::error::SNAPSHOT_ID is empty. Resolve it from Step 1a before continuing."
  exit 1
fi

# 2. Restore the snapshot into a NEW preview branch (un-finalized).
#    finalize_restore: false means main is NOT touched — the restore
#    materializes a separate preview branch we can inspect and delete.
#    --fail-with-body makes curl exit non-zero on 4xx/5xx so an error
#    response is not silently captured as the "restore response".
RESTORE_RESPONSE=$(curl --fail-with-body --silent --show-error --request POST \
  -H "Authorization: Bearer $NEON_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"$DRILL_BRANCH\",\"finalize_restore\":false}" \
  "https://console.neon.tech/api/v2/projects/$NEON_PROJECT_ID/snapshots/$SNAPSHOT_ID/restore")
echo "$RESTORE_RESPONSE" | jq '.' > pitr-drill-restore-response.json

# 3. Poll every returned operation ID to a terminal state before
#    connecting. The restore API returns an `operations` array; each
#    operation must reach finished/skipped/cancelled (success) or failed
#    (abort) before the branch is connectable. Connecting earlier will
#    hit the pre-restore state.
#
#    This step uses scripts/neon-poll-operations.js instead of a Bash
#    `while read` loop. A pipeline-side `while read` loop runs in a
#    subshell, so `exit 1` on a failed operation exits only the subshell
#    and execution can continue past "All restore operations complete."
#    The Node script reads the restore response on stdin, extracts the
#    operation IDs itself (failing closed if there are none), and polls
#    with a bounded deadline (default 15 min, configurable via
#    NEON_POLL_DEADLINE_MINUTES) so an unknown status cannot loop
#    forever. Control flow lives in-process, so a failure aborts the
#    whole command. See scripts/neon-poll-operations.test.js (29 tests).
if ! echo "$RESTORE_RESPONSE" | \
  NEON_API_KEY="$NEON_API_KEY" \
  NEON_PROJECT_ID="$NEON_PROJECT_ID" \
  node scripts/neon-poll-operations.js > pitr-drill-poll-evidence.json; then
  echo "::error::Restore operation polling failed. Aborting drill."
  exit 1
fi
# Exit code propagates: a failed/deadline operation exits non-zero and
# stops the drill before any connection attempt.

# 4. Resolve the restored branch's connection string via Neon's official
#    connection-URI endpoint. Do NOT hand-construct
#    postgres://postgres@<host>:5432/neondb — that URI has no password
#    and hardcodes the postgres role, so psql/migrate:verify will fail
#    authentication and the dedicated DDL role is not necessarily
#    postgres. The connection_uri endpoint returns a complete, callable
#    PostgreSQL URI (.uri) for the restored branch. It REQUIRES both
#    database_name AND role_name (the request returns HTTP 400 without
#    role_name). Use the same DDL role here that migrate:verify will use
#    below — the URI embeds the role so psql and the migration runner
#    authenticate as the same identity.
#    https://api-docs.neon.tech/reference/getconnectionuri
export DRILL_ROLE="<ddl-role>"
if [ -z "$DRILL_ROLE" ]; then
  echo "::error::DRILL_ROLE is empty. Set it to the dedicated DDL role before continuing."
  exit 1
fi
DRILL_BRANCH_ID=$(curl --fail-with-body --silent --show-error \
  -H "Authorization: Bearer $NEON_API_KEY" \
  "https://console.neon.tech/api/v2/projects/$NEON_PROJECT_ID/branches?search=$DRILL_BRANCH" \
  | jq -r 'first(.branches[] | select(.name=="'"$DRILL_BRANCH"'") | .id) // empty')
if [ -z "$DRILL_BRANCH_ID" ]; then
  echo "::error::Could not resolve restored drill branch ID. Aborting."
  exit 1
fi
export DRILL_URL=$(curl --fail-with-body --silent --show-error \
  -H "Authorization: Bearer $NEON_API_KEY" \
  --get \
  --data-urlencode "branch_id=$DRILL_BRANCH_ID" \
  --data-urlencode "database_name=neondb" \
  --data-urlencode "role_name=$DRILL_ROLE" \
  --data-urlencode "pooled=false" \
  "https://console.neon.tech/api/v2/projects/$NEON_PROJECT_ID/connection_uri" \
  | jq -r '.uri // empty')
if [ -z "$DRILL_URL" ]; then
  echo "::error::connection_uri endpoint returned an empty URI. Aborting."
  exit 1
fi

# 5. Verify the restored branch has the expected schema
psql "$DRILL_URL" -c \
  "SELECT count(*) AS table_count FROM information_schema.tables WHERE table_schema = 'public';"

# 6. Run the migration verify command against the restored branch.
#    MIGRATION_ROLE matches DRILL_ROLE so the runner authenticates as
#    the same identity the connection_uri was minted for.
DATABASE_URL_UNPOOLED="$DRILL_URL" \
MIGRATION_ALLOWED_HOST=<drill-host> \
MIGRATION_ALLOWED_DATABASE=<drill-db> \
MIGRATION_ENVIRONMENT=production \
MIGRATION_TARGET_KIND=restore-drill \
MIGRATION_ROLE="$DRILL_ROLE" \
npm run migrate:verify
```

**Expected:** `migrate:verify` reports PASS. If it fails, the production
schema has drift that must be investigated before migrating.

> **Why the snapshot-restore API and not `neonctl branches create
> --parent main`:** `--parent main` creates a child branch from the
> current tip of main — that is a copy of the live branch, not a
> restore from a saved snapshot. PITR proves you can recover a
> **captured point-in-time state**. The snapshot-restore REST endpoint
> with `finalize_restore: false` materializes a new preview branch from
> the named snapshot and leaves main untouched — which is exactly the
> recovery primitive the drill must exercise. The accompanying
> operation-polling step is the same discipline a real rollback
> requires.

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

1. **Push to `main`** (after PR merge) — automatic **only if** the
   repository variable `PRODUCTION_AUTO_DEPLOY_ENABLED == 'true'`.
   Defaults to disabled (unset); see the Architecture section above.
2. **`workflow_dispatch` from `main`** — manual, for rollbacks or
   emergency patches. Always available regardless of the variable.

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
- All migration-prep steps passed: [ ] yes
- Worker deployed: [ ] yes

---

## Step 3 — Canary observation

The canary job runs automatically after deploy. It:

1. **Round 1**: mint a fresh Clerk session token for the smoke-test
   identity, run the authenticated smoke test
   (`/health?deep=true` + `/api/subscription/current`), revoke the session
   in a `finally` block. The `/api/subscription/current` probe sends
   `Authorization: Bearer <minted-JWT>` because the endpoint requires
   authentication via `authenticateApiRequest` → `verifyToken` — an
   unauthenticated request would return 401 and the gate would fail
   spuriously. A 401 is **not** treated as success. The JWT is short-lived
   (~60s) and never stored; a fresh session is minted immediately before
   each round.
2. **Wait**: 15 minutes (configurable via `CANARY_WAIT_MINUTES`)
3. **Round 2**: mint a **new** fresh session token (never carried across
   the wait window), re-run the authenticated smoke test, check Sentry
   for new fatal/critical issues, revoke the session

### Stop / rollback thresholds

**Abort the deploy (rollback) if ANY of the following occur during the canary window:**

| Signal | Threshold | Action |
|--------|-----------|--------|
| Smoke test failure (round 1 or 2) | Any endpoint non-2xx or DB readiness fail | Immediate rollback |
| Sentry new fatal/critical issues | > 0 new unresolved fatal or critical issues | Immediate rollback |
| Sentry error rate | > 5% of requests | Investigate, likely rollback |
| 5xx error rate | > 1% of requests | Investigate, likely rollback |
| p95 latency | > 2000ms (2x baseline) | Investigate, consider rollback |
| Neon compute suspended unexpectedly | Repeated cold starts | Investigate, not necessarily rollback |

> **Sentry query scope:** the canary Sentry check queries
> `level:[fatal,critical]` (Sentry's multiple-value OR syntax). `fatal` is
> Sentry's standard highest severity level; `critical` is included
> defensively in case of custom level configurations. The check fails open
> (warns but does not block) if `SENTRY_AUTH_TOKEN`/`SENTRY_ORG`/
> `SENTRY_PROJECT` are unset or the Sentry API returns a non-200 response.

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
# Option 1: revert the merge commit and re-deploy.
# Only triggers workers-deploy.yml automatically if the repository
# variable PRODUCTION_AUTO_DEPLOY_ENABLED == 'true'. If it is not set
# (the default), use Option 2 instead.
git revert <merge-sha>
git push origin main

# Option 2: manual workflow_dispatch from a known-good SHA.
# This always works regardless of PRODUCTION_AUTO_DEPLOY_ENABLED —
# it is the supported rollback path and is never gated by the variable.
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

### 4c. Neon snapshot restore (catastrophic only)

If both the Worker rollback and forward-fix are not viable (e.g., data
corruption), restore the database from a pre-migration snapshot. This
uses the Neon snapshot-restore REST API with `finalize_restore: true`
and `target_branch_id` set to main's branch ID, so the restored branch
**swaps in for main and preserves the production connection string** —
the Worker does not need to be repointed. The pre-restore main branch is
preserved by Neon under an auto-generated `main (old)` name.

> **Tooling:** same REST API as the Step 1b drill
> (`POST /api/v2/projects/{project_id}/snapshots/{snapshot_id}/restore`).
> `finalize_restore: true` moves the compute endpoint onto the restored
> branch so the connection string stays stable. You **must** poll every
> returned operation ID to a terminal state before the Worker will serve
> from the restored branch.

```bash
set -euo pipefail

export NEON_PROJECT_ID=dawn-darkness-22587117
export NEON_API_KEY="<your-neon-api-key>"

# 1. Resolve main's branch ID (the restore target).
#    jq's first(...) is used instead of `| head -1` so the pipeline does
#    not abort under `set -o pipefail` (head closing the pipe early would
#    surface SIGPIPE as a non-zero exit and trip `set -e`).
MAIN_BRANCH_ID=$(curl --fail-with-body --silent --show-error \
  -H "Authorization: Bearer $NEON_API_KEY" \
  "https://console.neon.tech/api/v2/projects/$NEON_PROJECT_ID/branches?search=main" \
  | jq -r 'first(.branches[] | select(.name=="main") | .id) // empty')
if [ -z "$MAIN_BRANCH_ID" ]; then
  echo "::error::Could not resolve main branch ID. Aborting rollback."
  exit 1
fi

# 2. Pick the pre-migration snapshot to restore from Step 1a.
#    If no suitable snapshot exists, fall back to the newest available
#    snapshot and accept the data loss between it and the failure point.
export SNAPSHOT_ID="<pre-migration-snapshot-id>"
if [ -z "$SNAPSHOT_ID" ]; then
  echo "::error::SNAPSHOT_ID is empty. Aborting rollback."
  exit 1
fi

# 3. Restore the snapshot onto main, finalizing immediately so the
#    production connection string is preserved. Neon renames the old
#    main to "main (old)" automatically. --fail-with-body makes curl
#    exit non-zero on 4xx/5xx so an error response is not silently
#    captured as the "restore response".
RESTORE_RESPONSE=$(curl --fail-with-body --silent --show-error --request POST \
  -H "Authorization: Bearer $NEON_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"target_branch_id\":\"$MAIN_BRANCH_ID\",\"finalize_restore\":true}" \
  "https://console.neon.tech/api/v2/projects/$NEON_PROJECT_ID/snapshots/$SNAPSHOT_ID/restore")
echo "$RESTORE_RESPONSE" | jq '.' > rollback-restore-response.json

# 4. Poll every returned operation ID to a terminal state. The
#    connection string is stable, but the branch ID changes after a
#    finalized restore — re-resolve main's branch ID after completion
#    if you need it for subsequent API calls.
#
#    This step uses scripts/neon-poll-operations.js instead of a Bash
#    `while read` loop. A pipeline-side `while read` loop runs in a
#    subshell, so `exit 1` on a failed operation exits only the
#    subshell — without `set -o pipefail`, execution can continue to
#    "All restore operations complete." and then operate against
#    production. The Node script reads the restore response on stdin,
#    extracts the operation IDs itself (failing closed if there are
#    none), and polls with a bounded deadline (default 15 min) so an
#    unknown status cannot loop forever. Control flow lives in-process,
#    so a failure aborts the whole command. See
#    scripts/neon-poll-operations.test.js (29 tests).
if ! echo "$RESTORE_RESPONSE" | \
  NEON_API_KEY="$NEON_API_KEY" \
  NEON_PROJECT_ID="$NEON_PROJECT_ID" \
  node scripts/neon-poll-operations.js > rollback-poll-evidence.json; then
  echo "::error::Restore operation polling failed. Aborting rollback."
  exit 1
fi
# Exit code propagates: a failed/deadline operation exits non-zero and
# stops the rollback before any production query.

# 5. Record the EXACT orphaned branch ID. A finalized restore renames
#    the PRE-RESTORE main branch to "main (old)" and swaps in the
#    restored branch as the new active main. The orphaned branch is
#    therefore the pre-restore MAIN_BRANCH_ID captured in step 1 — NOT
#    .branch.id from the restore response (that is the newly restored
#    branch, i.e. the NEW active main; deleting it would delete
#    production). Do NOT delete it yet. Do NOT use a name-based fallback
#    (a prior restore may have left a different "main (old)" branch).
OLD_MAIN_ID="$MAIN_BRANCH_ID"
printf '%s\n' "$OLD_MAIN_ID" > rollback-old-main-id.txt
echo "Orphaned main (old) branch ID (RETAIN until step 8): $OLD_MAIN_ID"

# 6. Verify the restored data using the existing connection string
#    (unchanged because finalize_restore preserved it).
psql "$DATABASE_URL_UNPOOLED" -c "SELECT count(*) FROM tier_feature_flags;"

# 7. Redeploy the Worker so it reconnects to the restored main.
#    The connection string is unchanged, but the Worker's pooled
#    connections may be stale — a redeploy forces a clean reconnect.
#    Use the known-good SHA (the pre-migration Worker), not the
#    post-migration one.
git revert <merge-sha>   # or dispatch from the known-good SHA
git push origin main     # triggers workers-deploy.yml (if auto-deploy is enabled)
# Or, if PRODUCTION_AUTO_DEPLOY_ENABLED is not 'true', dispatch manually:
#   Actions → Deploy Workers API → Run workflow → known-good SHA

# 8. ONLY after recovery is explicitly verified (canary passes, Sentry
#    clean, business data confirmed), delete the orphaned main (old)
#    branch recorded in step 5. This is a separate, deliberate action —
#    not part of the restore. Do not run it in the same script run.
#    Retaining the orphaned branch preserves the pre-restore state in
#    case the restored data is itself bad and a second restore is needed.
#
#    Four safety checks BEFORE the DELETE — all must pass:
#    (a) the recorded old ID is non-empty;
#    (b) the recorded old ID differs from the CURRENT post-restore main
#        branch ID (re-resolved live — if they match, the restore did
#        not swap branches and deleting would kill production);
#    (c) the branch at the recorded old ID still exists and its name
#        begins with "main (old)" (confirms Neon actually renamed it);
#    (d) the operator supplies an explicit confirmation containing the
#        exact old branch ID (typed, not a y/N prompt).
OLD_MAIN_ID=$(cat rollback-old-main-id.txt 2>/dev/null)
if [ -z "$OLD_MAIN_ID" ]; then
  echo "::error::No recorded orphaned branch ID. Resolve it manually from the Neon console before deleting."
  exit 1
fi

# (b) Re-resolve the current main branch ID and confirm it differs.
CURRENT_MAIN_ID=$(curl --fail-with-body --silent --show-error \
  -H "Authorization: Bearer $NEON_API_KEY" \
  "https://console.neon.tech/api/v2/projects/$NEON_PROJECT_ID/branches?search=main" \
  | jq -r 'first(.branches[] | select(.name=="main") | .id) // empty')
if [ -z "$CURRENT_MAIN_ID" ]; then
  echo "::error::Could not re-resolve the current main branch ID. Aborting delete — production state is uncertain."
  exit 1
fi
if [ "$OLD_MAIN_ID" = "$CURRENT_MAIN_ID" ]; then
  echo "::error::Recorded old branch ID equals the current main branch ID ($OLD_MAIN_ID). Aborting delete — this would delete the active production branch."
  exit 1
fi

# (c) Confirm the branch at OLD_MAIN_ID still exists and is named "main (old)...".
OLD_BRANCH_INFO=$(curl --fail-with-body --silent --show-error \
  -H "Authorization: Bearer $NEON_API_KEY" \
  "https://console.neon.tech/api/v2/projects/$NEON_PROJECT_ID/branches/$OLD_MAIN_ID" \
  | jq -r '.branch.name // empty')
if [ -z "$OLD_BRANCH_INFO" ]; then
  echo "::error::Branch $OLD_MAIN_ID no longer exists (already deleted?). Aborting."
  exit 1
fi
case "$OLD_BRANCH_INFO" in
  "main (old)"*) ;;
  *)
    echo "::error::Branch $OLD_MAIN_ID is named \"$OLD_BRANCH_INFO\", not \"main (old)…\". Aborting delete — this does not look like the orphaned pre-restore branch."
    exit 1
    ;;
esac

# (d) Operator must type the exact old branch ID to confirm.
echo "About to DELETE branch $OLD_MAIN_ID (\"$OLD_BRANCH_INFO\")."
echo "Type the exact branch ID to confirm deletion:"
read -r CONFIRM_ID
if [ "$CONFIRM_ID" != "$OLD_MAIN_ID" ]; then
  echo "::error::Confirmation does not match the recorded old branch ID. Aborting delete."
  exit 1
fi

curl --fail-with-body --silent --show-error --request DELETE \
  -H "Authorization: Bearer $NEON_API_KEY" \
  "https://console.neon.tech/api/v2/projects/$NEON_PROJECT_ID/branches/$OLD_MAIN_ID"
```

**Warning:** A finalized snapshot restore replaces main in-place. Data
written to main after the snapshot was taken is preserved on the
orphaned `main (old)` branch — **retained until recovery is explicitly
verified (step 8)**, then deletable. It is no longer reachable from the
production connection string once the restore finalizes. This is a last
resort.

> **Why the orphaned ID is the PRE-restore main ID, not `.branch.id`
> from the restore response:** a finalized restore swaps the restored
> branch into the active main slot and renames the previous main to
> `main (old)`. The restore response's `.branch` is therefore the
> **newly restored** branch (the new active main) — recording it as
> `OLD_MAIN_ID` and deleting it would delete production. The orphaned
> branch is the branch that used to be main: the `MAIN_BRANCH_ID`
> captured in step 1, before the restore call. Step 8 verifies this
> explicitly (the recorded old ID must differ from the live main ID,
> the branch at the old ID must still exist and be named `main (old)…`,
> and the operator must type the exact ID to confirm). There is no
> name-based fallback — a prior restore may have left a different
> `main (old)` branch, and matching by name alone could delete the
> wrong one.

**Record (if rollback was triggered):**
- Rollback method: [ ] Worker rollback [ ] Forward fix [ ] PITR restore
- Time to rollback: `____________________________`
- Data loss: [ ] none [ ] minimal [ ] significant
- Root cause: `____________________________`

---

## Step 5 — Post-deploy verification

After the canary passes, perform a final manual verification:

```bash
# Deep health check (verifies DB connectivity) — no auth required.
# --fail-with-body exits non-zero on 4xx/5xx so a failing endpoint is
# not piped into jq as if it were a success body.
curl --fail-with-body --silent --show-error "https://api.expirymate.com.au/health?deep=true" | jq .

# Subscription endpoint (verifies schema-dependent read) — REQUIRES auth.
# The /api/subscription/current endpoint calls authenticateApiRequest →
# verifyToken, so a bare curl returns 401. Use the authenticated canary
# mechanism to exercise this endpoint manually:
doppler run -- node scripts/run-authenticated-smoke.js

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

**Expected:** all checks PASS. The authenticated smoke test creates a
fresh Clerk session, mints a JWT, probes both endpoints, and revokes the
session — its evidence document is the manual verification record.

**Record:**
- Deep health: [ ] PASS [ ] FAIL
- Authenticated smoke (subscription read): [ ] PASS [ ] FAIL
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

### Smoke-test identity record

Recorded once when the identities are provisioned (see
[Smoke-test identity provisioning](#smoke-test-identity-provisioning)).
Two identities are required: a **custodian admin** that administers the
smoke organization, and the **smoke identity** (`team_member`) that the
canary mints sessions for. Only the smoke identity's Clerk user ID is
stored as `SMOKE_USER_ID`.

| Field | Value |
|-------|-------|
| Custodian — Clerk user ID | `____________________________` |
| Custodian — application user ID | `____________________________` |
| Smoke identity — Clerk user ID (`SMOKE_USER_ID`) | `____________________________` |
| Smoke identity — application user ID | `____________________________` |
| Smoke identity — application role (must be `team_member`) | `____________________________` |
| Smoke-test organization ID | `____________________________` |
| Verification query result (1 row, role=team_member, subscription present) | [ ] confirmed |
| Provisioned by | `____________________________` |
| Date provisioned | `____________________________` |
| Purpose | Production canary smoke test (read-only) |

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

### GitHub repository variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `PRODUCTION_AUTO_DEPLOY_ENABLED` | Set to `'true'` to enable automatic production deploys on push to `main`. When unset or any other value, push to main does NOT trigger a production deploy — use `workflow_dispatch` from `main` to deploy manually. This is the production safety switch. | Disabled (unset) |

### Doppler production config (existing + new)

The migration CLIs and canary orchestrator read these from the environment
(injected by `doppler run`):

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
| `CLERK_SECRET_KEY` | Production Clerk secret key — used by the canary orchestrator (`scripts/run-authenticated-smoke.js`) to mint short-lived session tokens for the smoke identity. Full Backend API access; blast radius controlled by the protected GitHub `production` environment. |
| `SMOKE_USER_ID` | Clerk user ID of the dedicated smoke-test identity. Not secret, but kept in Doppler so the canary configuration lives in one place. |

---

## Related documentation

- [Migrations E2E Runbook](migrations-e2e-runbook.md) — the operator Neon dev-branch gate (task 1.6)
- [Neon Backup & Restore](neon-backup-restore.md) — Neon PITR details
- [Workers Deployment](workers-deployment.md) — Worker deploy basics
- [Production Deployment Checklist](production-deployment-checklist.md) — general pre-launch checklist
- [Rollback Procedure](rollback-procedure.md) — existing rollback docs
