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

- [ ] `MIGRATION_DOPPLER_TOKEN` GitHub environment secret configured in
      `preview`, scoped read-only to the minimal migration-validation config
- [ ] `DOPPLER_TOKEN` GitHub environment secret configured separately in
      `preview` (development Worker deploy config) and `production`
      (production deploy config)
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
- [ ] Runtime role separation complete: `app_runtime` provisioned on the
      Neon `production` branch (not the Git branch `main` — the two are
      distinct) via SQL `CREATE ROLE` (not Neon's "Add Role" button), grants
      + default privileges applied, `REVOKE ALL PRIVILEGES ON TABLE
      schema_migrations FROM app_runtime` applied,
      `scripts/verify-runtime-role.js` passes against the `production`
      branch's `app_runtime` URL in **read-only mode** (active-probe mode was
      used on the `migration-role-check` branch first), and Doppler
      config updated so `DATABASE_URL_UNPOOLED`/`MIGRATION_ROLE` use
      `neondb_owner` and `NEON_CONNECTION_STRING` uses the pooled
      `app_runtime` URL (see
      [Runtime role separation](#runtime-role-separation-appruntime-provisioning)
      below)
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

### Runtime role separation (app_runtime provisioning)

The Worker must not run with the schema owner's credentials. The
security objective is met by **reducing the Worker's privileges**, not
by creating a second highly privileged DDL login. The existing schema
owner (`neondb_owner`) remains the schema owner and becomes the
**migration-only** identity; the application is moved to a restricted
**runtime** identity (`app_runtime`) that can read and write data but
cannot run DDL.

> **Why SQL `CREATE ROLE`, not Neon's "Add Role" button:** Neon's
> "Add Role" button creates a login role that **automatically inherits
> `neon_superuser`** — a Neon-managed superuser role that bypasses the
> privilege separation this section establishes. Creating the role via
> SQL (`CREATE ROLE app_runtime LOGIN`) does **not** grant
> `neon_superuser`, so the role starts with no privileges and receives
> only the explicit grants below. This is the only supported way to
> create a restricted runtime role on Neon.

> **Do not recreate the malformed ` migration_runner` role.** A prior
> attempt created a role with a leading space in its name
> (`" migration_runner"`) via Neon Console. That role is unnecessary
> under this ownership model (`neondb_owner` is the migration identity)
> and should be deleted from the Neon `production` branch through the Neon
> Console after confirming it owns no objects and is unused (see
> [Cleanup](#runtime-role-cleanup) below).

**Provision `app_runtime` on a temporary branch first.** Create a
Neon branch named `migration-role-check` from the Neon `production`
branch (the Neon branch named `production`, not the Git branch `main`)
and execute the provisioning SQL there. This lets you test the grants
and the Worker against a realistic schema without touching production.
Only after
verification passes on the branch do you provision `app_runtime` on the
Neon `production` branch and cut the Worker over.

#### 1. Create the role (interactive psql as `neondb_owner`)

Connect to the `migration-role-check` branch as `neondb_owner` (the
schema owner) via psql. Do **not** put a password in committed SQL,
shell history, psql history, or process arguments. The procedure
below generates the password to a `chmod 600` temp file, installs an
EXIT/INT/TERM cleanup trap that validates the path before removing it,
reads the password into a psql variable via `\set` backtick expansion,
and runs `ALTER ROLE` with the `:'variable'` quoting syntax — so the
password value never appears in `.psql_history`, shell history, or
`ps aux` argument lists.

> **Why not `\password`:** the `\password` psql meta-command prompts
> without echoing and is history-safe in principle, but it is fragile
> in some terminal environments (e.g., Git Bash on Windows can fail to
> suppress echo or mishandle the double-prompt), and it cannot be used
> in a semi-automated procedure. The file-based `ALTER ROLE` procedure
> below is robust in all terminals, works in interactive psql sessions,
> and keeps the password out of every persistent artifact. It also
> generates a cryptographically strong password (`openssl rand`) rather
> than relying on the operator to type one.

> **Do NOT hand-construct the `app_runtime` connection URI.** Base64
> passwords contain `+`, `/`, and `=` characters that are NOT
> URL-safe and MUST be percent-encoded if interpolated into a
> `postgresql://` URI. Instead, after the password is set, obtain the
> pooled `app_runtime` connection URI from Neon's
> `connection_uri` REST API (same endpoint used in Step 1b step 4),
> which returns a complete, callable, correctly-encoded URI. The
> history-safe procedure for obtaining and storing that URI in Doppler
> is step 1d below — run it **before** the temp password file is
> destroyed by the cleanup trap.

```bash
set -euo pipefail

# 1. Generate a strong password to a chmod 600 temp file. openssl rand
#    produces 32 bytes of entropy, base64-encoded (44 chars). The
#    password is never in a shell variable that could be logged — it
#    lives only in the temp file (deleted after use) and in psql's
#    process memory (the `pw` variable, unset after the ALTER ROLE).
PWFILE=$(mktemp)
chmod 600 "$PWFILE"
openssl rand -base64 32 > "$PWFILE"

# 2. Install a cleanup trap IMMEDIATELY after PWFILE is created, so the
#    temp file is destroyed even if the operator Ctrl-C's the psql
#    session, the terminal sends SIGHUP, or the script exits early for
#    any reason. The trap fires on EXIT, INT (Ctrl-C), and TERM.
#
#    The trap VALIDATES the path before removing it: it checks that
#    PWFILE is non-empty, that the path starts with the system temp
#    dir ($TMPDIR or /tmp), and that the path is a regular file (not a
#    directory, symlink, device, or empty string). This prevents the
#    trap from ever calling `shred`/`rm` on an unexpected path if
#    PWFILE is somehow unset or reassigned later. shred -u overwrites
#    then removes; fall back to rm -f if shred is unavailable (e.g.,
#    on macOS, where shred is not installed by default).
cleanup_pwfile() {
  if [ -n "${PWFILE:-}" ] && [ -f "$PWFILE" ]; then
    case "$PWFILE" in
      "${TMPDIR:-/tmp}"/*)
        shred -u "$PWFILE" 2>/dev/null || rm -f "$PWFILE"
        ;;
      *)
        echo "::warning::Refusing to clean PWFILE outside TMPDIR: $PWFILE (remove manually)"
        ;;
    esac
  fi
  unset PWFILE
}
trap cleanup_pwfile EXIT INT TERM

# 3. Connect to the migration-role-check branch as neondb_owner.
#    The connection string is obtained from the Neon console or the
#    connection_uri API (see Step 1b for the API call shape).
#
#    Do NOT use `psql ... -c "SELECT current_user;"` here: `-c` runs the
#    query and exits immediately, so the CREATE ROLE and ALTER ROLE
#    instructions below would have no interactive session to run in.
#    Start a plain interactive psql session instead — the SQL and
#    meta-commands in the next block run inside it.
#
#    The PWFILE path is exported so the psql `\set` backtick expansion
#    can read it inside the session. The path is not sensitive — only
#    the file contents are.
export PWFILE
export OWNER_URL="postgresql://neondb_owner@<branch-host>/neondb"
psql "$OWNER_URL"

# 4. After the psql session exits (step 2's grants + step 1d's
#    connection-URI capture are done inside it), the EXIT trap fires
#    automatically and securely deletes the temp file. No explicit
#    shred/rm call is needed here — the trap handles it. The `unset
#    PWFILE` below is defensive (the trap also unsets); it is safe
#    because the trap re-checks `-n "${PWFILE:-}"` and `-f "$PWFILE"`.
unset PWFILE
```

At the `psql` prompt (`neondb=>`), run:

```sql
-- Sanity-check the connected identity first.
SELECT current_user;

-- Create the runtime role. NO INHERIT is not required, but creating
-- via SQL (not Neon's Add Role button) ensures it does NOT inherit
-- neon_superuser. LOGIN allows it to authenticate; the password is
-- set via ALTER ROLE below so it is never in committed SQL or history.
CREATE ROLE app_runtime LOGIN;

-- Set the password from the temp file via \set backtick expansion.
-- psql history records this line (with the $PWFILE path) and the
-- ALTER ROLE line (with :'pw' — the variable NAME, not its value).
-- Neither line contains the password. The :'pw' syntax expands to a
-- properly-quoted string literal at execution time, so special
-- characters in the base64 password are handled correctly.
\set pw `cat $PWFILE`
ALTER ROLE app_runtime PASSWORD :'pw';

-- Unset the variable so the password is not retained in psql's
-- variable space for the rest of the session.
\unset pw
```

Then proceed to step 2's grants **in the same psql session** (do not
exit — the grants must also run as `neondb_owner`). Using `export
OWNER_URL=...` (a single shell variable) instead of inlining the
connection string also avoids the Git Bash heredoc quoting problems
that occur when a `postgresql://` URI with special characters is
embedded directly in a multi-line shell command.

#### 2. Grant runtime privileges (as `neondb_owner`)

Still in the interactive psql session as `neondb_owner`, run the
following grants. These give `app_runtime` exactly the privileges the
Worker needs — CONNECT, USAGE on the public schema, DML on all tables,
sequence access, and function execution — and nothing more (no CREATE,
no ALTER, no DROP).

```sql
GRANT CONNECT ON DATABASE neondb TO app_runtime;
GRANT USAGE ON SCHEMA public TO app_runtime;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON ALL TABLES IN SCHEMA public
  TO app_runtime;

GRANT USAGE, SELECT, UPDATE
  ON ALL SEQUENCES IN SCHEMA public
  TO app_runtime;

GRANT EXECUTE
  ON ALL FUNCTIONS IN SCHEMA public
  TO app_runtime;

-- Revoke ALL privileges on the migration ledger. The runtime role must
-- NOT be able to read or write schema_migrations — it is the migration
-- identity's ledger, not the application's. The GRANT ... ON ALL TABLES
-- above would otherwise grant DML on it (the ledger is a public table
-- created by the runner as neondb_owner). REVOKE ALL covers every table
-- privilege PostgreSQL supports (SELECT, INSERT, UPDATE, DELETE,
-- TRUNCATE, REFERENCES, TRIGGER) so no residual access remains.
REVOKE ALL PRIVILEGES ON TABLE schema_migrations FROM app_runtime;
```

> **Why the explicit REVOKE is required.** `GRANT ... ON ALL TABLES IN
> SCHEMA public` grants DML on every existing public table, including
> `schema_migrations` (the migration ledger, created by the runner as
> `neondb_owner`). The runtime role must not touch the ledger — only
> the migration identity does. `ALTER DEFAULT PRIVILEGES` (below) does
> not help here: it applies only to *future* objects, and PostgreSQL
> offers no way to exclude a specific table from a default-privilege
> grant. The explicit `REVOKE ALL PRIVILEGES ON TABLE schema_migrations`
> is the only way to ensure the runtime role has zero ledger access.
> `scripts/verify-runtime-role.js` enforces this: its
> `checkCannotAccessLedger` check fails if the runtime role holds ANY
> of the seven table privileges on the ledger.
>
> **This REVOKE must be re-applied AFTER adoption creates the ledger.**
> The provisioning REVOKE here covers the ledger only if it already
> exists at provisioning time. But adoption runs `ensureLedger`
> (`CREATE TABLE IF NOT EXISTS schema_migrations`) as `neondb_owner`,
> and `ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public
> GRANT ... ON TABLES TO app_runtime` (set below) **auto-grants DML on
> the ledger the moment adoption creates it**. A REVOKE applied before
> the ledger exists does not cover this auto-grant. Therefore the
> REVOKE must be re-applied immediately after adoption creates the
> ledger, and the runtime-role verifier must run after that re-REVOKE.
> See [First-production adoption procedure — step F](#f-revoke-ledger-access-after-adoption-creates-schema_migrations)
> for the corrected ordering. `checkCannotAccessLedger` now probes
> ledger existence via `pg_catalog` (`pg_class` + `pg_namespace`)
> instead of `information_schema.tables`, so it detects an
> existing-but-inaccessible ledger instead of passing vacuously with
> `ledgerExists: false` (the false negative observed during the real
> `migration-role-check` branch exercise).

Future objects created by migrations also need privileges. The
`ALTER DEFAULT PRIVILEGES` statements ensure any table, sequence, or
function created by `neondb_owner` in the `public` schema in the future
automatically grants the runtime privileges to `app_runtime` — so a
new migration does not require a separate grant step:

```sql
ALTER DEFAULT PRIVILEGES
  FOR ROLE neondb_owner
  IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;

ALTER DEFAULT PRIVILEGES
  FOR ROLE neondb_owner
  IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO app_runtime;

ALTER DEFAULT PRIVILEGES
  FOR ROLE neondb_owner
  IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO app_runtime;
```

#### 1d. Capture and store the pooled `app_runtime` connection URI (before the temp password is destroyed)

> **Timing (2026-07-28 hardening).** This step MUST run **after** step 2's
> grants complete (so the role is fully provisioned) and **before** the
> shell exits and the EXIT trap destroys the temp password file. The
> connection URI is obtained from Neon's `connection_uri` REST API,
> which authenticates to Neon as the role and returns a complete,
> correctly-percent-encoded URI — the password is never read from the
> temp file or interpolated by hand. Run this from the **same shell**
> as step 1 (the trap is still armed; it fires when the shell exits,
> not when psql exits).

The `app_runtime` password is base64-encoded and contains `+`, `/`,
and `=` characters that are NOT URL-safe. Hand-interpolating it into a
`postgresql://` URI would produce a malformed connection string (the
`+` would be decoded as a space, `/` would break the path, `=` would
be misparsed as a query separator). Neon's `connection_uri` REST API
handles the percent-encoding correctly and returns a callable URI
that embeds the role and the password. Use it.

```bash
set -euo pipefail
# Assumes NEON_API_KEY, NEON_PROJECT_ID are exported (same shell as step 1).
# Assumes the migration-role-check branch ID is resolved (or resolve it here).

# 1. Resolve the migration-role-check branch ID (if not already resolved).
ROLE_CHECK_BRANCH_ID=$(curl --fail-with-body --silent --show-error \
  -H "Authorization: Bearer $NEON_API_KEY" \
  "https://console.neon.tech/api/v2/projects/$NEON_PROJECT_ID/branches?search=migration-role-check" \
  | jq -r 'first(.branches[] | select(.name=="migration-role-check") | .id) // empty')
if [ -z "$ROLE_CHECK_BRANCH_ID" ]; then
  echo "::error::Could not resolve migration-role-check branch ID. Aborting."
  exit 1
fi

# 2. Obtain the POOLED app_runtime connection URI from Neon's
#    connection_uri API. pooled=true routes through PgBouncer (the
#    Worker uses pooled connections). The API returns a complete,
#    callable URI with the password correctly percent-encoded — do NOT
#    hand-construct the URI from the password in $PWFILE.
#    https://api-docs.neon.tech/reference/getconnectionuri
APP_RUNTIME_URI=$(curl --fail-with-body --silent --show-error \
  -H "Authorization: Bearer $NEON_API_KEY" \
  --get \
  --data-urlencode "branch_id=$ROLE_CHECK_BRANCH_ID" \
  --data-urlencode "database_name=neondb" \
  --data-urlencode "role_name=app_runtime" \
  --data-urlencode "pooled=true" \
  "https://console.neon.tech/api/v2/projects/$NEON_PROJECT_ID/connection_uri" \
  | jq -r '.uri // empty')
if [ -z "$APP_RUNTIME_URI" ]; then
  echo "::error::connection_uri endpoint returned an empty URI. Aborting."
  exit 1
fi

# 3. Store the URI in Doppler for the role_check Worker environment.
#    `doppler secrets set` reads the value from stdin (via printf, no
#    trailing newline) so the URI is not in shell history or process
#    args. Use the role_check-scoped Doppler config so this branch-
#    specific URI does NOT overwrite the production NEON_CONNECTION_STRING.
#    (The production URI is captured separately in step 6.3 when
#    provisioning on the Neon production branch.)
printf '%s' "$APP_RUNTIME_URI" | doppler secrets set NEON_CONNECTION_STRING \
  --config role_check 2>/dev/null \
  || echo "::warning::Could not set Doppler role_check NEON_CONNECTION_STRING. \
Set it manually in the Doppler dashboard before deploying the role_check Worker (step 5)."

# 4. Unset the URI from the shell — it is now in Doppler and no longer
#    needed in process memory. The temp password file is still on disk
#    (the EXIT trap will destroy it when the shell exits).
unset APP_RUNTIME_URI
```

> **History safety:** the URI is piped from `curl` to `jq` to
> `printf` to `doppler` — it is never in a shell variable that is
> echoed, never in a command argument (Doppler reads from stdin), and
> never in psql history. The `APP_RUNTIME_URI` shell variable exists
> only briefly between the `curl` and the `doppler secrets set`, and
> is unset immediately after. The password in `$PWFILE` is never read
> by this step — Neon's API handles the authentication and encoding.

#### 3. Verify the runtime role's privileges

The verifier has two modes:

- **Read-only mode (default):** runs only catalog-level privilege
  queries (`has_table_privilege`, `has_sequence_privilege`,
  `has_function_privilege`, `pg_has_role`, `pg_class`/`pg_roles`
  ownership lookups). No INSERT/UPDATE/DELETE, no `nextval`, no ALTER
  attempt. Safe to run against production at any time.
- **Active-probe mode (`RUNTIME_ROLE_ACTIVE_PROBE=1`):** additionally
  runs two rolled-back active probes — a transactional
  INSERT/UPDATE/DELETE that proves the grants actually let the Worker
  write (using a reserved negative ID `id = -1` so no serial sequence
  is advanced), and an `ALTER TABLE ... SET (autovacuum_enabled = true)`
  attempt that proves the role cannot alter (expecting SQLSTATE 42501;
  success or any other SQLSTATE is a failure). Intended only for the
  temporary `migration-role-check` branch.

Both modes check that `app_runtime` is not a `neon_superuser` member,
cannot create tables, does not own any public table and is not a member
of any table's owner role (catalog proof of non-alterability), can
SELECT/INSERT/UPDATE/DELETE on every `public` table **except**
`schema_migrations` (the migration ledger), has **NO** privileges on
`schema_migrations` (all seven table privileges denied), can use
sequences (USAGE/SELECT — catalog only, no `nextval`), and can execute
all `public` functions. The password is redacted from all output,
including nested probe error messages.

**On the `migration-role-check` branch, use active-probe mode** so the
write and alter-denial probes are exercised against a realistic schema
before touching the Neon `production` branch:

```bash
set -euo pipefail

# Obtain the app_runtime connection string for the migration-role-check
# branch via the Neon connection_uri API (same shape as Step 1b):
#   curl --fail-with-body --silent --show-error \
#     -H "Authorization: Bearer $NEON_API_KEY" \
#     --get \
#     --data-urlencode "branch_id=<branch-id>" \
#     --data-urlencode "database_name=neondb" \
#     --data-urlencode "role_name=app_runtime" \
#     --data-urlencode "pooled=true" \
#     "https://console.neon.tech/api/v2/projects/$NEON_PROJECT_ID/connection_uri" \
#     | jq -r '.uri // empty'
export RUNTIME_ROLE_URL="<app_runtime connection string for migration-role-check>"
if [ -z "$RUNTIME_ROLE_URL" ]; then
  echo "::error::RUNTIME_ROLE_URL is empty. Resolve it from the Neon connection_uri API."
  exit 1
fi

# Active-probe mode: runs the write + alter-denial probes in addition
# to the catalog checks. The write probe uses id = -1 (no nextval) and
# rolls back, so it is non-mutating outside its transaction.
RUNTIME_ROLE_ACTIVE_PROBE=1 \
  node scripts/verify-runtime-role.js > runtime-role-evidence.json
# Exit code propagates: a failed check exits non-zero and stops the
# procedure. The evidence JSON contains only host + database (no
# password).
```

**On the Neon `production` branch, use read-only mode** (no
`RUNTIME_ROLE_ACTIVE_PROBE`) so no write or ALTER attempt is made
against production:

```bash
set -euo pipefail
export RUNTIME_ROLE_URL="<app_runtime connection string for the Neon production branch>"
node scripts/verify-runtime-role.js > runtime-role-evidence-production.json
```

**Expected:** all checks PASS. If any check fails, **stop** — the
grants are incomplete, the role was created via Neon's "Add Role"
button (inheriting `neon_superuser`), or the `REVOKE ALL PRIVILEGES ON
TABLE schema_migrations` was not applied. Re-provision via SQL `CREATE
ROLE`, re-run the grants **and the REVOKE**, then re-verify.

#### 4. Verify `neondb_owner` can still run migrations

On the same `migration-role-check` branch, confirm the schema owner can
still run the full migration sequence (preflight, seed, apply, verify).
This proves the role separation did not break the migration identity:

```bash
set -euo pipefail

DATABASE_URL_UNPOOLED="<neondb_owner direct URL for migration-role-check>" \
MIGRATION_ALLOWED_HOST=<branch-host> \
MIGRATION_ALLOWED_DATABASE=neondb \
MIGRATION_ENVIRONMENT=production \
MIGRATION_TARGET_KIND=primary \
MIGRATION_ROLE=neondb_owner \
MIGRATION_CONFIRM_PRODUCTION="APPLY <branch-host>/neondb" \
npm run migrate:preflight

# Then seed + verify (apply is a no-op if the branch was created from the
# Neon production branch with the schema already at the latest migration):
DATABASE_URL_UNPOOLED="<neondb_owner direct URL>" \
MIGRATION_ROLE=neondb_owner \
MIGRATION_SEED_CONFIRMATION="SEED <branch-host>/neondb" \
MIGRATION_ALLOWED_HOST=<branch-host> \
MIGRATION_ALLOWED_DATABASE=neondb \
MIGRATION_ENVIRONMENT=production \
MIGRATION_TARGET_KIND=primary \
npm run migrate:seed

DATABASE_URL_UNPOOLED="<neondb_owner direct URL>" \
MIGRATION_ROLE=neondb_owner \
MIGRATION_ALLOWED_HOST=<branch-host> \
MIGRATION_ALLOWED_DATABASE=neondb \
MIGRATION_ENVIRONMENT=production \
MIGRATION_TARGET_KIND=primary \
npm run migrate:verify
```

**Expected:** preflight, seed, and verify all PASS as `neondb_owner`.

#### 5. Test the Worker against the temporary branch

Static grants are not enough evidence that every production query
works. Point the Worker at the `migration-role-check` branch using the
`app_runtime` pooled connection string and run the Worker DB tests and
smoke checks against it.

```bash
set -euo pipefail

# Build the Worker FIRST. `wrangler deploy` uploads the built artifact
# at workers/dist/index.js (the `main` field in workers/wrangler.toml,
# produced by `node build.js`). Skipping the build deploys a stale or
# empty artifact — `wrangler deploy` does NOT build for you. The root
# `build:workers` script runs `npm run build --prefix workers`, matching
# the production deploy workflow (`.github/workflows/workers-deploy.yml`
# runs `npm run build` from `working-directory: ./workers`).
npm run build:workers

# Deploy the Worker to a separately-named preview URL pointed at the
# migration-role-check branch. NEON_CONNECTION_STRING is a Worker
# secret (wrangler.toml:168, workers/src/types/env.d.ts:35), NOT a
# [env.*.vars] entry, so `wrangler deploy` does NOT pick it up from the
# surrounding shell — it must be registered via `wrangler secret put`.
# Setting it as a shell env var around `wrangler deploy` would silently
# leave the preview Worker with NO NEON_CONNECTION_STRING binding, and
# workers/src/utils/db-connection.ts would fall through to DATABASE_URL
# / Hyperdrive (likely the dev branch, not migration-role-check).
#
# The dedicated `role_check` environment in workers/wrangler.toml creates
# date-management-api-role-check as a separate Worker. It intentionally
# declares no routes, queues, Hyperdrive, R2, KV, or Analytics bindings,
# so it cannot consume background work or share mutable application
# resources with production/development.
#
# Wrangler must find workers/wrangler.toml. Run Wrangler from workers/
# (the production deploy workflow uses `working-directory: ./workers`),
# OR pass an explicit `--config workers/wrangler.toml` from the repo
# root. The commands below use `--config` so they can run from the repo
# root alongside the root-level `npm run build:workers` and `npm run
# test:db` scripts. (`--config` resolves the `main`/build paths relative
# to the config file, so the built artifact is found correctly.)
npx wrangler deploy --env role_check --config workers/wrangler.toml

# Bind the branch-specific pooled app_runtime URL as the preview
# Worker's NEON_CONNECTION_STRING secret. printf (no trailing newline)
# keeps the connection string exact. The role_check environment targets
# the separately-named Worker's secret store, not the dev Worker.
printf '%s' "<pooled app_runtime URL for migration-role-check>" \
  | npx wrangler secret put NEON_CONNECTION_STRING \
    --env role_check --config workers/wrangler.toml

# Run the Worker DB tests (pglite real-SQL) — these do not hit Neon but
# prove the Worker code compiles and the SQL is valid:
npm run test:db

# Smoke-test the preview Worker's real endpoints against the
# migration-role-check branch via app_runtime:
curl --fail-with-body --silent --show-error \
  "https://date-management-api-role-check.<subdomain>.workers.dev/health?deep=true" | jq .
```

> **Equivalent: run Wrangler from `workers/`.** Instead of
> `--config workers/wrangler.toml`, you may `cd workers` and run
> `npx wrangler deploy --env role_check` (and the matching
> `secret put` / `delete`) without `--config` — Wrangler discovers
> `wrangler.toml` in the current directory. This matches how the
> production deploy workflow runs. Either form is correct; pick one and
> use it consistently within a single run so the `role_check` environment
> resolves the same Worker name.

**Expected:** `/health?deep=true` reports DB readiness pass. If it
fails with a connection or permission error, a grant is missing — do
not cut over. Add the missing grant (re-run step 2's SQL for the
specific privilege) and re-test. A 5xx with a connection-string error
specifically suggests the `wrangler secret put` step was skipped,
targeted the wrong `--name`, or the build step was skipped so the
deployed artifact is stale.

#### 5b. Clean up the role-check preview Worker

The role-check Worker is a separately-named Cloudflare Worker with its
own secret binding. It is not garbage-collected when the
`migration-role-check` Neon branch is deleted — it must be removed
explicitly. After step 5 passes (and no later than the role-cutover
cleanup in [Runtime role cleanup](#runtime-role-cleanup)):

```bash
set -euo pipefail

# Delete the role-check Worker. This also drops its secret bindings
# (including the branch-specific NEON_CONNECTION_STRING). The dedicated
# role_check environment resolves the exact Worker name from
# wrangler.toml. Pass --config (or run from workers/) so Wrangler finds
# the same config used to deploy it in step 5 — see step 5 for the
# rationale. No build is needed for `wrangler delete`.
npx wrangler delete --env role_check --config workers/wrangler.toml
```

If `wrangler delete` is unavailable in your pinned Wrangler version,
delete the Worker from the Cloudflare dashboard (Workers & Pages →
date-management-api-role-check → Settings → Delete) and confirm the
secret is gone. Do **not** leave the role-check Worker running after
the cutover — it would be an unmonitored Worker holding a credential
for a deleted Neon branch.

#### 6. Provision on the Neon `production` branch and cut over

Only after steps 3–5 pass on the `migration-role-check` branch:

1. Repeat steps 1–2 on the Neon **`production`** branch (create
   `app_runtime` via SQL, set the password via the history-protected
   `ALTER ROLE` procedure (step 1), run the grants +
   default privileges **and the `REVOKE ALL PRIVILEGES ON TABLE
   schema_migrations`**).
2. Run `scripts/verify-runtime-role.js` against the `production`
   branch's `app_runtime` connection string in **read-only mode** (no
   `RUNTIME_ROLE_ACTIVE_PROBE`) — see Step 3 for the read-only command.
   Read-only mode makes no write or ALTER attempt against production;
   the catalog checks (including ledger-access denial and non-ownership
   proof) are sufficient evidence on the `production` branch because the
   same grants were already proven with active probes on the
   `migration-role-check` branch.
3. Capture the pooled `app_runtime` connection URI for the Neon
   `production` branch via the same `connection_uri` REST API procedure
   as step 1d (substituting the `production` branch ID and storing into
   the **production** Doppler config, not `role_check`). This MUST run
   before the temp password file is destroyed by the EXIT trap. See
   step 1d for the exact history-safe procedure.
4. Update Doppler production config (see
   [Doppler production config](#doppler-production-config-existing--new)
   below):
   - `DATABASE_URL_UNPOOLED` → direct `neondb_owner` URL (migrations)
   - `MIGRATION_ROLE` → `neondb_owner`
   - `NEON_CONNECTION_STRING` → pooled `app_runtime` URL (Worker,
     captured in step 3 above via the `connection_uri` API — do NOT
     hand-construct it; the base64 password contains `+`, `/`, `=`
     characters that must be percent-encoded)
   - confirmation tokens remain based on the same host/database
5. **Retain the previous Worker connection secret** (the old
   `NEON_CONNECTION_STRING` value) securely until the canary passes —
   see [Role-cutover rollback](#role-cutover-rollback) below.
6. Trigger a production deploy (`workflow_dispatch` from `main`) and
   observe the canary.

**No workflow output exposes either password.** The migration CLIs
redact connection strings (host + database only). The
`verify-runtime-role.js` script redacts the password from its JSON
evidence. The canary's `CLERK_SECRET_KEY` and `SMOKE_USER_ID` are
injected via `doppler run` and never printed.

#### Role-cutover rollback

If the Worker fails during the canary window because of a missing
runtime grant:

1. **Restore the previous Worker connection credential.** Set
   `NEON_CONNECTION_STRING` in Doppler production config back to the
   previous value (retained from step 6.4) and save. The previous
   credential is the `neondb_owner`-as-runtime or
   pre-role-separation connection string.
2. **Redeploy the known-good Worker** via `workflow_dispatch` from the
   last known-good SHA. The production deploy job's
   `Bind NEON_CONNECTION_STRING secret to worker` step (see
   `.github/workflows/workers-deploy.yml`) re-binds the restored
   Doppler value to the Worker via `wrangler secret put` **before**
   `wrangler deploy` runs — so restoring Doppler is sufficient; no
   manual `wrangler secret put` is required for rollback. The Worker
   reconnects with the restored credential on the next request.
3. **Add the missing runtime grant** through a reviewed forward fix —
   re-run the specific `GRANT` statement from step 2 on the Neon
   `production` branch as `neondb_owner` via an interactive psql session.
   Do not bundle grant changes into a migration file; role administration
   is not schema DDL.
4. **Repeat verification:** run `scripts/verify-runtime-role.js`
   against the `production` branch's `app_runtime` URL in **read-only
   mode**, then re-cut over (step 6.3–6.5). If the missing grant was on
   `schema_migrations`
   (i.e., the `REVOKE` was not applied), re-apply the
   `REVOKE ALL PRIVILEGES ON TABLE schema_migrations FROM app_runtime`
   before re-verifying.

This is the same three-layer rollback discipline as Step 4: restore the
known-good state first, then forward-fix the root cause, then
re-verify. Do not default to a destructive down migration.

<a id="runtime-role-cleanup"></a>

#### Runtime role cleanup

After the role separation is proven on the Neon `production` branch and
the canary passes:

1. **Delete the `migration-role-check` branch** via the Neon console or
   API. It is no longer needed.
2. **Delete the malformed `" migration_runner"` role** from the Neon
   `production` branch through the Neon Console. Before deleting, confirm
   it owns no objects and is unused:
   ```sql
   -- Run as neondb_owner on the Neon production branch. If either query
   -- returns rows, do NOT delete the role — reassign or drop the
   -- dependent objects first.
   SELECT n.nspname || '.' || c.relname AS owned_object
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relowner = '" migration_runner"'::regrole;

   SELECT n.nspname || '.' || p.proname AS owned_function
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proowner = '" migration_runner"'::regrole;
   ```
   If both queries return zero rows, delete the role via the Neon
   Console (Settings → Roles). Do **not** recreate it — it is
   unnecessary under this ownership model.
3. **Record the cleanup** in the sign-off section below.

---

## First-production adoption procedure (one-time gate)

Adoption is the **one-time** operation that transitions the production
database from Prisma-managed (`prisma db push` + hand-written neon-sql
deltas) to migration-runner-managed (the authoritative `schema_migrations`
ledger). It must be completed **before the first regular deploy workflow**
(Step 1 → Step 5) is allowed to run `migrate:apply`, because `migrate:apply`
only applies *pending* migrations — it does not stamp the historical
baseline. Until adoption stamps `0000`–`0009`, the ledger is absent and
`migrate:apply` would attempt to re-run the entire history against an
already-shaped database (failing on `ALTER TABLE ... ADD COLUMN IF NOT
EXISTS` no-ops for some objects, but refusing on any object that already
exists with a different definition).

This section has **two tracks** that share steps A–D and F–G but diverge
at the apply/seed/verify stage:

- **Branch proof track** (`migration-role-check` Neon branch): runs the
  **full manual sequence** A–G including step E (manual `migrate:apply`,
  `migrate:seed`, `migrate:verify`). This proves the entire adoption +
  first-migration flow end-to-end against a production-shaped copy before
  touching production. **Do not skip the branch exercise** — the sequence
  below was hardened after the real branch exercise surfaced two safety
  gaps (the missing `0001` schema gap and the `information_schema`
  ledger-detection false negative; see the callouts below).

- **Production adoption track** (Neon `production` branch): runs steps
  A–D, F–G, then **hands off to the protected GitHub deploy workflow**
  (Step 2 below) which
  applies `0010` and `0011`, seeds, verifies, deploys the Worker, and runs canary —
  all inside the CI gate that records artifacts and enforces the audit
  trail. Step E (manual `migrate:apply` / `migrate:seed` / `migrate:verify`)
  is **branch-proof only** and must NOT be run manually on production.
  The production track ordering is A → B → C → D → F → G → **hand off to
  workflow** (the workflow applies 0010 and 0011, seeds, verifies, deploys,
  canaries). The REVOKE (F) and runtime-role verification (G) happen
  **before** the workflow so the ledger is locked down the moment adoption
  creates it, not after the workflow finishes.

### Pre-adoption PITR gate (mandatory, before any production DDL)

> **Critical ordering (2026-07-28 hardening).** Production adoption
> performs irreversible DDL (reconciliation `ALTER TABLE` / `CREATE
> INDEX`, then `CREATE TABLE schema_migrations` + stamping). A fresh
> PITR drill MUST pass **immediately before** any production
> reconciliation or adoption mutation — not the CI PITR readiness check
> (which only verifies a snapshot exists), but the full
> restore-to-new-branch drill in [Step 1 — Pre-deploy PITR drill](#step-1--pre-deploy-pitr-drill-operator-gate)
> below. If the drill fails or is stale (older than 2 hours from the
> start of adoption), **stop** — do not proceed to step A on production.

Before starting the production adoption track:

1. Complete the full PITR drill (Step 1a → 1c) and confirm it passes
   **against the pre-adoption acceptance criteria below** (NOT the
   latest-schema `migrate:verify` PASS that Step 1b lists for the
   regular post-adoption drill — see the callout below).
2. Record the drill completion time. The drill must be **fresh** —
   completed within the last 2 hours before step A begins on production.
3. If the branch proof track is run on the same day, the branch drill
   does NOT satisfy this gate — the production drill must be against the
   Neon `production` branch's snapshots.

The branch proof track does not require a PITR drill (the branch is
disposable), but the production track MUST NOT proceed past step A
without a fresh, passing PITR drill on record.

> **Pre-adoption acceptance criteria (2026-07-28 drill finding).**
> Step 1b's `migrate:verify` PASS expectation assumes the restored
> snapshot is at the **latest** schema (the regular pre-deploy drill,
> run before a normal migration on an already-adopted database). A
> **pre-adoption** snapshot predates adoption: the
> `schema_migrations` ledger does not exist yet, and migrations `0010`
> (the `tier_feature_flags.limit_value` `integer → bigint` change) and
> `0011` (the `subscription_tiers` period columns) have
> not been applied. `migrate:verify` checks the catalog against the
> latest fingerprint **and** requires the ledger — so it **cannot
> pass** on a pre-adoption restored branch, and treating its failure as
> a drill failure would block adoption on a perfectly good restore.
>
> For the pre-adoption drill, replace Step 1b step 6 (`migrate:verify`)
> with these acceptance criteria — all three must pass:
>
> 1. **Successful restore polling** — every operation returned by the
>    snapshot-restore call reaches a terminal success state
>    (`finished` / `skipped` / `cancelled`) via
>    `scripts/neon-poll-operations.js` (Step 1b step 3). A `failed`
>    operation or poll deadline exits non-zero and fails the drill.
> 2. **Restored-state fidelity checks** — the restored branch
>    materializes the expected pre-adoption schema. Run the Step 1b
>    step 5 `information_schema.tables` count, plus a targeted check of
>    the tables that adoption will reconcile (e.g. the `uploads` columns
>    that `0001` adds, if the 0001 gap is still open) so the restore is
>    not silently empty or partial. The table count must match
>    production's pre-adoption count, not the post-migration count.
> 3. **`migrate:preflight` PASS against the restored branch** —
>    preflight is read-only and reports `Ready: YES,
>    schema_migrations ledger: not initialized` for a pre-adoption
>    snapshot, which is exactly the expected pre-adoption state. Run it
>    with `MIGRATION_TARGET_KIND=restore-drill` (read-only target kind)
>    and the same `DATABASE_URL_UNPOOLED="$DRILL_URL"` /
>    `MIGRATION_ROLE="$DRILL_ROLE"` wiring as Step 1b step 6.
>
> **Reserve latest-schema `migrate:verify` for AFTER the protected
> workflow applies `0010` and `0011`.** Once adoption stamps `0000`–`0009` and the
> protected GitHub workflow applies `0010` and `0011` (seeds, verifies, deploys,
> canaries), the database is at the latest schema and the regular
> Step 1b `migrate:verify` PASS expectation is correct for every
> subsequent pre-deploy drill. The branch proof track's step E
> (`migrate:verify` PASS on the disposable branch) is the place that
> proves latest-schema verification works end-to-end before production
> gets there.

### Corrected sequence (in order)

**Branch proof track** (disposable `migration-role-check` branch):

```
env setup (step 0 — export shared variables once)
  → preflight
  → reconcile 0001 if required (read-only dry-run → review → guarded apply → re-dry-run)
  → adopt dry-run        (capture exit code; branch on READY vs REFUSED — see step B)
  → adopt apply at 0009  (MIGRATION_ADOPTION_POINT=0009; stamps 0000–0009; creates schema_migrations)
  → status               (confirm 0000–0009 applied, 0010 and 0011 pending)
  → apply 0010, 0011     (migrate:apply — applies the two pending migrations)
  → status               (confirm 0000–0011 applied, none pending)
  → seed                 (migrate:seed — 54 tier_feature_flags rows)
  → verify               (migrate:verify — PASS)
  → revoke ledger access (REVOKE ALL PRIVILEGES ON TABLE schema_migrations FROM app_runtime)
  → runtime-role verification  (corrected verify-runtime-role.js — pg_catalog ledger detection)
```

**Production adoption track** (Neon `production` branch — no manual
apply/seed/verify):

```
[pre-adoption PITR gate: fresh drill MUST pass]
env setup (step 0 — export shared variables once)
  → preflight
  → reconcile 0001 if required (read-only dry-run → review → guarded apply → re-dry-run)
  → adopt dry-run        (capture exit code; branch on READY vs REFUSED — see step B)
  → adopt apply at 0009  (MIGRATION_ADOPTION_POINT=0009; stamps 0000–0009; creates schema_migrations)
  → status               (confirm 0000–0009 applied, 0010 and 0011 pending)
  → revoke ledger access (REVOKE ALL PRIVILEGES ON TABLE schema_migrations FROM app_runtime)
  → runtime-role verification  (corrected verify-runtime-role.js — pg_catalog ledger detection)
  → HAND OFF to protected GitHub workflow (Step 2) — workflow applies 0010 and 0011, seeds, verifies, deploys, canaries
```

Each step must pass before the next begins. The sequence runs under
`set -euo pipefail`, but the initial adopt dry-run (step B.1) is
**expected** to exit non-zero when `0001` is missing — that refusal is
the operator gate, not a failure. Step B.1 captures the dry-run exit
code explicitly and branches on `READY` (exit 0) versus `REFUSED`
(exit 1) so `set -e` does not close the interactive shell on the
expected refusal.

### 0. One-time environment setup (run once per target, reuse for all steps)

All steps below (A–G) reuse the variables exported here. Run this block
**once** per target (branch proof or production) in the interactive shell
before starting step A. This avoids the failure mode where step B.1
supplies variables as inline assignments (which do not persist) while
step B.2 expects them to be exported — an operator following the blocks
literally would reach `DATABASE_URL_UNPOOLED is required` mid-sequence.

```bash
set -euo pipefail

# Set these values for the target. The URL is the neondb_owner
# DIRECT (non-pooled) connection string. The host and database are the
# allowlist values the migration CLIs validate against. The SHA is
# derived from the current git HEAD — do not type it manually, to
# prevent a typo or unrelated SHA from entering the adoption ledger.
# -s reads the URL silently (no echo) because it contains the
# production password; printf '\n' moves to a fresh line afterwards.
read -r -s -p "DATABASE_URL_UNPOOLED (neondb_owner direct URL): " DATABASE_URL_UNPOOLED
printf '\n'
read -r -p "MIGRATION_ALLOWED_HOST: " MIGRATION_ALLOWED_HOST
read -r -p "MIGRATION_ALLOWED_DATABASE: " MIGRATION_ALLOWED_DATABASE
MIGRATION_DEPLOYMENT_SHA="$(git rev-parse HEAD)"

# Derive host and database from the URL and validate against the
# allowlist (mirrors validateMigrationTarget in
# src/database/migrations/runner.ts:469). Refuses pooled URLs.
export DATABASE_URL_UNPOOLED MIGRATION_ALLOWED_HOST MIGRATION_ALLOWED_DATABASE MIGRATION_DEPLOYMENT_SHA
TARGET=$(node -e '
  const u = new URL(process.env.DATABASE_URL_UNPOOLED);
  const host = u.hostname.toLowerCase();
  const db = decodeURIComponent(u.pathname.replace(/^\//, ""));
  if (host.includes("-pooler."))
    { console.error("Refusing: pooled connection string"); process.exit(1); }
  if (host !== process.env.MIGRATION_ALLOWED_HOST.toLowerCase() ||
      db !== process.env.MIGRATION_ALLOWED_DATABASE)
    { console.error("Refusing: target does not match allowlist"); process.exit(1); }
  console.log(host + "/" + db);
  ')
echo "Validated target: ${TARGET}"

# Export the shared migration guard variables. The confirmation token
# is derived from the validated host/database so it cannot drift.
export MIGRATION_ENVIRONMENT=production
export MIGRATION_TARGET_KIND=primary
export MIGRATION_ROLE=neondb_owner
export MIGRATION_CONFIRM_PRODUCTION="APPLY ${TARGET}"
```

After this block, all subsequent steps (A–G) reuse the exported
variables — do not redeclare them inline.

### A. Preflight

```bash
set -euo pipefail
npm run migrate:preflight
```

**Expected:** `Ready: YES`, `schema_migrations ledger: not initialized`.
If preflight reports the ledger already initialized, adoption has already
run — use `migrate:status` and `migrate:apply` instead (this section is
one-time).

### B. Reconcile the 0001 schema gap (if the dry-run refuses)

> **Observed production-shaped schema gap (2026-07-28, real Neon
> `migration-role-check` branch exercise).** The first
> `migrate:adopt -- --dry-run` against the production-shaped branch
> reported `STATUS: REFUSED — catalog does not match expected schema`:
> migration `0001_queued_catalogue_imports` was missing — 15 columns on
> `uploads` (`import_type`, `tier_snapshot`, `max_skus_snapshot`,
> `max_active_expiries_snapshot`, `rows_unchanged`, `row_errors`,
> `processing_offset`, `retry_count`, `failure_category`,
> `error_report_key`, `queued_at`, `validation_started_at`,
> `processing_started_at`, `completed_at`, `failed_at`) and the partial
> index `uploads_one_active_catalogue_per_org`. The branch had been
> shaped by `prisma db push` plus a subset of the neon-sql deltas, so
> `0001` had never been applied through any authoritative path. See
> `migration-adopt-dry-run-role-check.txt` for the exact refusal report.

**Do NOT silently allowlist the missing 0001 objects.** The adoption
comparison profile (`ADOPTION_COMPARISON`) is strict by design — a
missing column or partial index is a real schema drift that must be
reconciled, not hidden behind an exception tuple. Allowlisting would
leave production with a schema that does not match the migration
history, so every future `migrate:verify` would fail and every future
migration would be built against a false baseline.

The reconciliation procedure is:

1. **Run a read-only adoption dry-run first** and review the EXACT
   mismatch. The dry-run is read-only (no ledger creation, no stamping)
   and exits **non-zero** on any refusal (catalog mismatch OR a populated
   ledger) — `STATUS: READY` (and only that) exits 0. Because `set -e`
   is active, the expected non-zero refusal would close the interactive
   shell — the same failure we hit during the branch exercise. **Capture
   the exit code explicitly** and branch on `READY` versus `REFUSED`:

   ```bash
   set -euo pipefail
   # Initialize before the command so a stale value from a previous
   # dry-run in the same shell does not persist if this one succeeds.
   DRY_RUN_EXIT=0
   npm run migrate:adopt -- --dry-run > adopt-dry-run-1.txt 2>&1 \
     || DRY_RUN_EXIT=$?

   if [ "$DRY_RUN_EXIT" -eq 0 ]; then
     echo "STATUS: READY — catalog matches. Skip to step C (adopt apply)."
   elif [ "$DRY_RUN_EXIT" -eq 1 ]; then
     echo "STATUS: REFUSED — review adopt-dry-run-1.txt, then proceed to step B.2."
   else
     echo "::error::Unexpected dry-run exit code: $DRY_RUN_EXIT. Aborting."
     exit 1
   fi
   ```

   If the report is `STATUS: REFUSED`, **do not proceed to `--apply`**.
   Read the diff in `adopt-dry-run-1.txt` (columns/indexes only in
   expected) and confirm it matches `0001_queued_catalogue_imports.up.sql`
   exactly. If the diff contains anything beyond the 15 columns and the
   `uploads_one_active_catalogue_per_org` partial index listed in the
   callout above, **stop** — a different migration may also be missing.

2. **Apply the reviewed 0001 SQL through a guarded operator procedure.**
   The missing objects are reconciled by applying the reviewed
   `database/migrations/0001_queued_catalogue_imports.up.sql` directly
   as `neondb_owner` via psql. The file is idempotent
   (`ADD COLUMN IF NOT EXISTS`, `CREATE UNIQUE INDEX IF NOT EXISTS`), so
   it is safe to re-run against a partially-shaped database. The psql
   invocation is guarded with four checks so it cannot be run accidentally
   or against the wrong target:

   - **Reuses `$DATABASE_URL_UNPOOLED`** — exported by the one-time
     setup block (step 0). No separately pasted URL that could drift to
     a different database.
   - **Derives the confirmation token from the validated target** —
     `ADOPT-RECONCILE <host>/<database> 0001` — computed from the same
     host/database the setup block already validated against the
     allowlist. The validation is not repeated here; if the setup block
     passed, the target is already confirmed.
   - **Confirms `current_user = neondb_owner`** before any DDL, so a
     wrong-role session cannot mutate the schema.
   - **Prechecks for organizations with multiple active catalogue
     uploads** — the `CREATE UNIQUE INDEX` partial index
     `uploads_one_active_catalogue_per_org` requires that no
     organization has more than one row with
     `import_type = 'product-catalog'` and
     `status IN ('pending', 'queued', 'validating', 'processing')`.
     Because the migration adds `import_type` with a default of
     `'product-catalog'`, **every existing row** in an active status
     would satisfy the partial-index predicate. If any org has multiple
     active uploads, the index creation fails inside
     `--single-transaction` and the entire migration rolls back —
     wasting a reconciliation round and leaving the database unchanged.
     The precheck catches this before the transaction starts. The
     precheck queries **only** `status` (not `import_type`) because
     `import_type` is one of the missing columns this migration adds —
     querying it would fail with `column does not exist`, and the
     default `'product-catalog'` means every active row will satisfy
     the predicate anyway, so checking `status` alone is both correct
     and safe against the pre-migration schema. Any precheck error
     aborts — there is no skip path.
   - **Runs `psql --single-transaction -v ON_ERROR_STOP=1`** so any
     error rolls back the entire migration (columns + index), leaving
     the database unchanged rather than partially reconciled.

   ```bash
   set -euo pipefail
   : "${DATABASE_URL_UNPOOLED:?DATABASE_URL_UNPOOLED is required (run step 0 setup first)}"
   : "${MIGRATION_ALLOWED_HOST:?MIGRATION_ALLOWED_HOST is required (run step 0 setup first)}"
   : "${MIGRATION_ALLOWED_DATABASE:?MIGRATION_ALLOWED_DATABASE is required (run step 0 setup first)}"

   # Derive the confirmation token from the validated target. The
   # setup block (step 0) already validated host/database against the
   # allowlist and refused pooled URLs, so we reuse that result.
   TARGET="${MIGRATION_ALLOWED_HOST}/${MIGRATION_ALLOWED_DATABASE}"
   EXPECTED_TOKEN="ADOPT-RECONCILE ${TARGET} 0001"

   echo "Target: ${TARGET}"
   echo "Type the following confirmation token to proceed:"
   echo "  ${EXPECTED_TOKEN}"
   read -r CONFIRM
   if [ "$CONFIRM" != "$EXPECTED_TOKEN" ]; then
     echo "::error::Confirmation does not match. Aborting 0001 reconcile."
     exit 1
   fi

   # Confirm the session identity is neondb_owner — a wrong-role session
   # must not mutate the production schema.
   CURRENT_USER=$(psql "$DATABASE_URL_UNPOOLED" -tAc "SELECT current_user")
   if [ "$CURRENT_USER" != "neondb_owner" ]; then
     echo "::error::Connected as '${CURRENT_USER}', expected 'neondb_owner'. Aborting."
     exit 1
   fi

   # Precheck: the unique partial index uploads_one_active_catalogue_per_org
   # will fail if any organization has multiple uploads in an active status.
   # Query ONLY status (not import_type) because import_type is one of the
   # missing columns this migration adds — querying it would fail with
   # "column does not exist". After this migration, every existing row gets
   # import_type='product-catalog' (the column default), so every active
   # row satisfies the partial-index predicate regardless. Checking status
   # alone is both correct and safe against the pre-migration schema.
   # Any error here MUST abort — there is no skip path.
   BLOCKING=$(psql "$DATABASE_URL_UNPOOLED" -tAc "
     SELECT count(*) FROM (
       SELECT organization_id
         FROM uploads
        WHERE status IN ('pending', 'queued', 'validating', 'processing')
        GROUP BY organization_id
       HAVING count(*) > 1
     ) s
   ")
   if [ "$BLOCKING" != "0" ]; then
     echo "::error::Found ${BLOCKING} organization(s) with multiple active uploads."
     echo "::error::The unique partial index cannot be created until these are resolved."
     echo "::error::Abort the duplicate uploads or wait for them to complete, then re-run."
     exit 1
   fi

   # Apply the migration in a single transaction. --single-transaction
   # wraps the entire file in BEGIN/COMMIT so any error (e.g. the CREATE
   # UNIQUE INDEX failing on conflicts) rolls back the ADD COLUMN
   # statements too, leaving the database unchanged. ON_ERROR_STOP=1
   # makes psql exit non-zero on the first error instead of continuing.
   psql "$DATABASE_URL_UNPOOLED" \
     --single-transaction \
     -v ON_ERROR_STOP=1 \
     -f database/migrations/0001_queued_catalogue_imports.up.sql
   ```

   Do **not** bundle the reconciliation into a new migration file —
   `0001` already exists in the history; re-applying its SQL directly
   brings the production-shaped database up to the migration-derived
   schema without inventing a duplicate history entry.

3. **Repeat the read-only dry-run** (using the same exit-code capture
   from step B.1, including the `DRY_RUN_EXIT=0` initialization) until it
   reports `STATUS: READY — catalog matches expected schema` (exit 0).
   Only then proceed to adoption apply. If the second dry-run still
   refuses (exit 1), do NOT allowlist the remaining diff — investigate
   it (a different migration may also be missing, or an object may exist
   with the wrong definition). Every object in the diff must be
   reconciled to match the fingerprint exactly before adoption.

   ```bash
   set -euo pipefail
   DRY_RUN_EXIT=0
   npm run migrate:adopt -- --dry-run > adopt-dry-run-2.txt 2>&1 \
     || DRY_RUN_EXIT=$?
   if [ "$DRY_RUN_EXIT" -ne 0 ]; then
     echo "::error::Dry-run did not report READY (exit $DRY_RUN_EXIT)."
     echo "::error::Review adopt-dry-run-2.txt and reconcile remaining diffs."
     exit 1
   fi
   echo "STATUS: READY — proceed to step C (adopt apply)."
   ```

### C. Adopt at 0009 (stamp the historical baseline)

Once the dry-run reports `STATUS: READY`, adopt at the historical
adoption point `0009` (the last migration before `0010`). This stamps
`0000`–`0009` into the newly-created `schema_migrations` ledger and
leaves `0010` and `0011` as the pending migrations, so the subsequent
`migrate:apply` applies exactly two migrations:

```bash
set -euo pipefail
MIGRATION_ADOPTION_POINT=0009 \
MIGRATION_ADOPT_CONFIRMATION="ADOPT ${MIGRATION_ALLOWED_HOST}/${MIGRATION_ALLOWED_DATABASE} AT 0009" \
npm run migrate:adopt -- --apply
```

**Expected:** `STATUS: READY — catalog matches expected schema`,
`Adoption point: 0009`, `Migrations to stamp: 0000, 0001, ..., 0009`.

> **Why adopt at 0009, not 0010.** `0010_alter_tier_feature_flags_limit_value_to_bigint`
> is a real expand migration that has NOT yet been applied to the
> production-shaped database (the column is still `integer`). Adopting
> at `0010` would stamp `0010` as `applied` without ever running its
> SQL — leaving the column at `integer` while the ledger claims
> `0010` is done, so `migrate:verify` would fail on the
> bigint-vs-integer drift and the storage_bytes limits (10 GB / 100 GB)
> that exceed int32 could never be seeded. Adopting at `0009` stamps
> only the already-shaped history and leaves `0010` and `0011` pending so
> `migrate:apply` runs their SQL for real. (`0011` adds the
> `subscription_tiers` period columns and is likewise unapplied on the
> pre-adoption database, so it too must stay pending, not be stamped.)

### D. Confirm 0010 and 0011 are pending

```bash
set -euo pipefail
npm run migrate:status
```

**Expected:** `Ledger: present`, `Applied: 0000, 0001, ..., 0009`,
`Pending: 0010, 0011`, `Health: OK`. If anything other than `0010` and
`0011` is pending, **stop** — adoption stamped the wrong prefix; do not
proceed to apply.

### E. Apply 0010 and 0011, then status, seed, verify — BRANCH PROOF ONLY

> **Production track: SKIP THIS STEP.** On production, after step D
> confirms exactly `0010` and `0011` pending, proceed directly to step F
> (revoke ledger access), then step G (runtime-role verification), then
> hand off to the protected GitHub deploy workflow (Step 2 below). The
> workflow applies `0010` and `0011`, seeds, verifies, deploys the Worker, and runs canary
> — all inside the CI gate that records artifacts and enforces the audit
> trail. Manually running `migrate:apply` / `migrate:seed` /
> `migrate:verify` on production bypasses that gate and is forbidden.

**Branch proof track only:** after step D confirms exactly `0010` and
`0011` pending on the disposable `migration-role-check` branch, run the regular
apply → status → seed → verify sequence manually. This proves the entire
adoption + first-migration flow end-to-end against the production-shaped
copy before touching production:

```bash
set -euo pipefail
# apply 0010 and 0011
npm run migrate:apply

# status — confirm 0000–0011 applied, none pending
npm run migrate:status

# seed — 54 tier_feature_flags rows
MIGRATION_SEED_CONFIRMATION="SEED ${MIGRATION_ALLOWED_HOST}/${MIGRATION_ALLOWED_DATABASE}" \
npm run migrate:seed

# verify — PASS
npm run migrate:verify
```

**Expected (branch proof):** apply reports `applied: ["0010", "0011"]`; status
reports `Pending: (none — up to date)`; seed reports `Upserted: 54`,
`Verified: YES`; verify reports `Verdict: PASS`.

### F. Revoke ledger access AFTER adoption creates schema_migrations

> **Critical ordering (2026-07-28 hardening).** The
> `REVOKE ALL PRIVILEGES ON TABLE schema_migrations FROM app_runtime`
> in the [Runtime role separation](#runtime-role-separation-appruntime-provisioning)
> provisioning step (step 2) is necessary but **not sufficient** on its
> own. Adoption runs `ensureLedger` (`CREATE TABLE IF NOT EXISTS
> schema_migrations`) as `neondb_owner`. Because the provisioning step
> also ran `ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA
> public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime`,
> **the moment adoption creates `schema_migrations`, PostgreSQL
> auto-grants DML on it to `app_runtime`** via those default privileges.
> A `REVOKE` applied during provisioning (before the ledger exists) does
> not cover this auto-grant — the default privileges re-grant on
> creation. Therefore the `REVOKE` MUST be re-applied **immediately
> after adoption creates the ledger**, and the runtime-role verifier
> must run **after** that re-REVOKE. This is the ordering this section
> enforces.

**Branch proof track:** run this after step E's `migrate:verify` PASS.
**Production track:** run this immediately after step D (confirm `0010`
and `0011` pending) — do NOT wait for the workflow to apply `0010` and
`0011` first.
The REVOKE strips `app_runtime`'s auto-granted DML on the ledger; the
workflow's `migrate:apply` runs as `neondb_owner` (which retains full
access), so the REVOKE does not interfere with the workflow's ability
to stamp `0010` and `0011`.

Re-apply the REVOKE as `neondb_owner` via an interactive psql session:

```sql
-- Run as neondb_owner on the target branch (then the Neon production branch).
-- This strips the DML that ALTER DEFAULT PRIVILEGES auto-granted on
-- schema_migrations when adoption created it. Covers ALL seven table
-- privileges (SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES,
-- TRIGGER) so no residual access remains.
REVOKE ALL PRIVILEGES ON TABLE schema_migrations FROM app_runtime;
```

Verify the revoke took effect with a direct catalog probe (this is the
query that produced `runtime-ledger-privileges-role-check.txt` during
the branch exercise — it uses `pg_class`, not `information_schema`, so
it sees the ledger even after the REVOKE):

```sql
-- Run as neondb_owner. Confirms the ledger exists and every supported
-- table privilege is denied to app_runtime.
SELECT EXISTS (
        SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = 'schema_migrations'
      ) AS ledger_exists,
       priv.privilege,
       has_table_privilege('app_runtime', 'public.schema_migrations', priv.privilege) AS granted
  FROM (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
               ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) AS priv(privilege);
```

**Expected:** `ledger_exists = t` and `granted = f` for all seven
privileges (matches `runtime-ledger-privileges-role-check.txt`). If any
`granted = t`, **stop** — re-run the REVOKE and re-probe.

### G. Runtime-role verification (corrected verifier)

Run the corrected `scripts/verify-runtime-role.js` **after** the
re-REVOKE. The verifier's `checkCannotAccessLedger` now probes ledger
existence via `pg_catalog` (`pg_class` + `pg_namespace`) instead of
`information_schema.tables`, so it detects an existing-but-inaccessible
ledger instead of passing vacuously with `ledgerExists: false` (the
false negative observed in `runtime-role-evidence.json` during the
branch exercise, while `runtime-ledger-privileges-role-check.txt` proved
the ledger existed with all seven privileges denied).

On the `migration-role-check` branch, use active-probe mode:

```bash
set -euo pipefail
export RUNTIME_ROLE_URL="<app_runtime connection string for the branch>"
RUNTIME_ROLE_ACTIVE_PROBE=1 \
  node scripts/verify-runtime-role.js > runtime-role-evidence.json
```

On the Neon `production` branch, use read-only mode (no
`RUNTIME_ROLE_ACTIVE_PROBE`):

```bash
set -euo pipefail
export RUNTIME_ROLE_URL="<app_runtime connection string for the Neon production branch>"
node scripts/verify-runtime-role.js > runtime-role-evidence-production.json
```

**Expected:** `Overall: PASS`, and `ledgerAccessDenied: PASS
(ledgerExists=true, granted=none)`. The `ledgerExists` field MUST read
`true` (not `false`) — a `false` here means the verifier is still using
`information_schema` and would pass vacuously; do not accept it. If any
check fails, **stop** — re-run the REVOKE from step F and re-verify.

### After adoption: hand off to the protected deploy workflow

**Branch proof track:** after steps A–G pass on the
`migration-role-check` branch (adoption stamped `0000`–`0009`, `0010`
and `0011` applied manually, seed + verify PASS, ledger access revoked, runtime-role
verification PASS), the branch proof is complete. The branch can be
deleted (or kept for reference until production adoption is signed off).

**Production track:** after steps A, B (if needed), C, D, F, G pass on
the Neon `production` branch (adoption stamped `0000`–`0009`, `0010`
and `0011` confirmed as the pending migrations, ledger access revoked,
runtime-role verification PASS), the database is **adoption-stamped but
not yet migration-complete** — `0010` and `0011` are still pending. Do NOT run
`migrate:apply` manually. Instead, hand off to the protected GitHub
deploy workflow (Step 2 below) via `workflow_dispatch` from the Git
branch `main`:

1. **Keep `PRODUCTION_AUTO_DEPLOY_ENABLED` unset** — do not enable
   auto-deploy yet. Trigger the workflow manually with
   `workflow_dispatch` from `main`.
2. The workflow runs the full sequence: `migrate:status` →
   `migrate:preflight` → PITR check → `migrate:apply` (applies `0010` and `0011`)
   → `migrate:seed` → `migrate:verify` → `wrangler deploy --env
   production` → canary. Every step records an artifact for the audit
   trail.
3. Monitor the workflow per Step 2a. Confirm `migrate:apply` reports
   `applied: ["0010", "0011"]`, `migrate:seed` reports `Upserted: 54`,
   `migrate:verify` reports `Verdict: PASS`, and canary passes.
4. Only after the first post-adoption canary passes may you set
   `PRODUCTION_AUTO_DEPLOY_ENABLED=true` for future deploys.

From this point on, the regular deploy workflow (Step 1 → Step 5) may
run `migrate:apply` — it will see `0000`–`0011` applied and apply only
future migrations.

Record the adoption in the sign-off section below (adoption point,
migrations stamped, 0010 and 0011 applied by the workflow, ledger REVOKE
re-applied,
runtime-role verification PASS with `ledgerExists=true`).

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
# This is the same script CI runs; it resolves the Neon production branch
# (named "production", not the Git branch "main"), filters snapshots by
# branch_id (normalizing branch_id ?? source_branch_id), and fails closed
# if no recent snapshot exists.
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

# Create a snapshot of the Neon production branch via the Neon REST API.
# (neonctl@2.27.0 has no `snapshots` subcommand, so use the API directly.)
# The branch ID is a path parameter; `name` is a QUERY parameter per the
# Neon create-snapshot API (https://api-docs.neon.tech/reference/createsnapshot).
# --fail-with-body makes curl exit non-zero on 4xx/5xx (otherwise an error
# response would be piped into jq as if it were a success body).
# jq's first(...) is used instead of `| head -1` so the pipeline does not
# abort under `set -o pipefail` (head closing the pipe early would surface
# SIGPIPE as a non-zero exit and trip `set -e`).
PROD_BRANCH_ID=$(curl --fail-with-body --silent --show-error \
  -H "Authorization: Bearer $NEON_API_KEY" \
  "https://console.neon.tech/api/v2/projects/dawn-darkness-22587117/branches?search=production" \
  | jq -r 'first(.branches[] | select(.name=="production") | .id) // empty')
if [ -z "$PROD_BRANCH_ID" ]; then
  echo "::error::Could not resolve the Neon production branch ID. Aborting."
  exit 1
fi
curl --fail-with-body --silent --show-error --request POST \
  -H "Authorization: Bearer $NEON_API_KEY" \
  --get \
  --data-urlencode "name=pre-migration-manual" \
  "https://console.neon.tech/api/v2/projects/dawn-darkness-22587117/branches/$PROD_BRANCH_ID/snapshot" \
  | jq '.'
```

### 1b. Restore-to-new-branch drill

This step must restore a **specific snapshot** into a new preview branch —
creating an ordinary child branch from the current Neon production branch
does **not** prove PITR. The drill verifies that a snapshot can be
materialized via Neon's snapshot-restore REST API and the application
works against the restored data.

> **Tooling note (verified 2026-07-26):** `neonctl@2.27.0` does **not**
> expose a `snapshots` subcommand (its `branches` command has no
> snapshot-restore path either), so this drill uses the Neon REST API
> directly — the same API the CI PITR check
> (`scripts/check-neon-pitr.js`) uses to list snapshots. The endpoint is
> `POST /api/v2/projects/{project_id}/snapshots/{snapshot_id}/restore`
> with `finalize_restore: false` to create a preview branch without
> touching the Neon production branch. Do not connect to the restored branch until every
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

# 1. Pick the newest snapshot ID for the Neon production branch from Step 1a.
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
#    finalize_restore: false means the Neon production branch is NOT touched — the restore
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
#    role_name). Use the schema owner (neondb_owner) here — the same
#    identity migrate:verify will use below — so the URI embeds the role
#    and psql and the migration runner authenticate as the same identity.
#    https://api-docs.neon.tech/reference/getconnectionuri
export DRILL_ROLE="neondb_owner"
if [ -z "$DRILL_ROLE" ]; then
  echo "::error::DRILL_ROLE is empty. Set it to neondb_owner (the schema owner / migration identity) before continuing."
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

**Expected (regular / post-adoption drill):** `migrate:verify` reports
PASS. If it fails, the production schema has drift that must be
investigated before migrating.

> **Pre-adoption drill — different acceptance criteria.** The
> `migrate:verify` PASS expectation above is correct for the **regular**
> pre-deploy drill (an already-adopted database at the latest schema).
> For the **pre-adoption** drill (run before the one-time adoption
> gate), the restored snapshot predates the `schema_migrations` ledger
> and migrations `0010` and `0011`, so `migrate:verify` **cannot** pass and its
> failure is NOT a drill failure. Use the pre-adoption acceptance
> criteria in [Pre-adoption PITR gate](#pre-adoption-pitr-gate-mandatory-before-any-production-ddl)
> instead: successful restore polling, restored-state fidelity checks,
> and `migrate:preflight` PASS. Reserve latest-schema `migrate:verify`
> for after the protected workflow applies `0010` and `0011`.

> **Why the snapshot-restore API and not `neonctl branches create
> --parent production`:** `--parent production` creates a child branch
> from the current tip of the Neon production branch — that is a copy of
> the live branch, not a restore from a saved snapshot. PITR proves you
> can recover a **captured point-in-time state**. The snapshot-restore
> REST endpoint with `finalize_restore: false` materializes a new
> preview branch from the named snapshot and leaves the Neon production
> branch untouched — which is exactly the recovery primitive the drill
> must exercise. The accompanying operation-polling step is the same
> discipline a real rollback requires.

### 1c. Clean up the drill branch

```bash
neonctl branches delete \
  --project-id "$NEON_PROJECT_ID" \
  --branch "$DRILL_BRANCH"
```

**Record:**
- Restore point timestamp: `____________________________`
- Drill branch table count: `____________________________`
- Drill type: [ ] regular (post-adoption) [ ] pre-adoption
- Restore polling: [ ] PASS (all operations terminal-success) [ ] FAIL
- Restored-state fidelity checks: [ ] PASS [ ] FAIL
- `migrate:preflight` (pre-adoption) / `migrate:verify` (regular): [ ] PASS [ ] FAIL
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
   - **seed**: `migration-seed.txt` artifact — check 54 rows upserted
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
and `target_branch_id` set to the Neon production branch's ID, so the
restored branch **swaps in for the Neon production branch and preserves
the production connection string** — the Worker does not need to be
repointed. The pre-restore Neon production branch is preserved by Neon
under an auto-generated `production (old)` name.

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

# 1. Resolve the Neon production branch's ID (the restore target).
#    jq's first(...) is used instead of `| head -1` so the pipeline does
#    not abort under `set -o pipefail` (head closing the pipe early would
#    surface SIGPIPE as a non-zero exit and trip `set -e`).
PROD_BRANCH_ID=$(curl --fail-with-body --silent --show-error \
  -H "Authorization: Bearer $NEON_API_KEY" \
  "https://console.neon.tech/api/v2/projects/$NEON_PROJECT_ID/branches?search=production" \
  | jq -r 'first(.branches[] | select(.name=="production") | .id) // empty')
if [ -z "$PROD_BRANCH_ID" ]; then
  echo "::error::Could not resolve the Neon production branch ID. Aborting rollback."
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

# 3. Restore the snapshot onto the Neon production branch, finalizing
#    immediately so the production connection string is preserved. Neon
#    renames the old production branch to "production (old)"
#    automatically. --fail-with-body makes curl exit non-zero on 4xx/5xx
#    so an error response is not silently captured as the "restore
#    response".
RESTORE_RESPONSE=$(curl --fail-with-body --silent --show-error --request POST \
  -H "Authorization: Bearer $NEON_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"target_branch_id\":\"$PROD_BRANCH_ID\",\"finalize_restore\":true}" \
  "https://console.neon.tech/api/v2/projects/$NEON_PROJECT_ID/snapshots/$SNAPSHOT_ID/restore")
echo "$RESTORE_RESPONSE" | jq '.' > rollback-restore-response.json

# 4. Poll every returned operation ID to a terminal state. The
#    connection string is stable, but the branch ID changes after a
#    finalized restore — re-resolve the Neon production branch's ID
#    after completion if you need it for subsequent API calls.
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
#    the PRE-RESTORE Neon production branch to "production (old)" and
#    swaps in the restored branch as the new active production branch.
#    The orphaned branch is therefore the pre-restore PROD_BRANCH_ID
#    captured in step 1 — NOT .branch.id from the restore response (that
#    is the newly restored branch, i.e. the NEW active production branch;
#    deleting it would delete production). Do NOT delete it yet. Do NOT
#    use a name-based fallback (a prior restore may have left a different
#    "production (old)" branch).
OLD_PROD_ID="$PROD_BRANCH_ID"
printf '%s\n' "$OLD_PROD_ID" > rollback-old-prod-id.txt
echo "Orphaned production (old) branch ID (RETAIN until step 8): $OLD_PROD_ID"

# 6. Verify the restored data using the existing connection string
#    (unchanged because finalize_restore preserved it).
psql "$DATABASE_URL_UNPOOLED" -c "SELECT count(*) FROM tier_feature_flags;"

# 7. Redeploy the Worker so it reconnects to the restored Neon production
#    branch. The connection string is unchanged, but the Worker's pooled
#    connections may be stale — a redeploy forces a clean reconnect.
#    Use the known-good SHA (the pre-migration Worker), not the
#    post-migration one.
git revert <merge-sha>   # or dispatch from the known-good SHA
git push origin main     # triggers workers-deploy.yml (if auto-deploy is enabled)
# Or, if PRODUCTION_AUTO_DEPLOY_ENABLED is not 'true', dispatch manually:
#   Actions → Deploy Workers API → Run workflow → known-good SHA

# 8. ONLY after recovery is explicitly verified (canary passes, Sentry
#    clean, business data confirmed), delete the orphaned
#    "production (old)" branch recorded in step 5. This is a separate,
#    deliberate action — not part of the restore. Do not run it in the
#    same script run. Retaining the orphaned branch preserves the
#    pre-restore state in case the restored data is itself bad and a
#    second restore is needed.
#
#    Four safety checks BEFORE the DELETE — all must pass:
#    (a) the recorded old ID is non-empty;
#    (b) the recorded old ID differs from the CURRENT post-restore Neon
#        production branch ID (re-resolved live — if they match, the
#        restore did not swap branches and deleting would kill
#        production);
#    (c) the branch at the recorded old ID still exists and its name
#        begins with "production (old)" (confirms Neon actually renamed
#        it);
#    (d) the operator supplies an explicit confirmation containing the
#        exact old branch ID (typed, not a y/N prompt).
OLD_PROD_ID=$(cat rollback-old-prod-id.txt 2>/dev/null)
if [ -z "$OLD_PROD_ID" ]; then
  echo "::error::No recorded orphaned branch ID. Resolve it manually from the Neon console before deleting."
  exit 1
fi

# (b) Re-resolve the current Neon production branch ID and confirm it differs.
CURRENT_PROD_ID=$(curl --fail-with-body --silent --show-error \
  -H "Authorization: Bearer $NEON_API_KEY" \
  "https://console.neon.tech/api/v2/projects/$NEON_PROJECT_ID/branches?search=production" \
  | jq -r 'first(.branches[] | select(.name=="production") | .id) // empty')
if [ -z "$CURRENT_PROD_ID" ]; then
  echo "::error::Could not re-resolve the current Neon production branch ID. Aborting delete — production state is uncertain."
  exit 1
fi
if [ "$OLD_PROD_ID" = "$CURRENT_PROD_ID" ]; then
  echo "::error::Recorded old branch ID equals the current Neon production branch ID ($OLD_PROD_ID). Aborting delete — this would delete the active production branch."
  exit 1
fi

# (c) Confirm the branch at OLD_PROD_ID still exists and is named "production (old)...".
OLD_BRANCH_INFO=$(curl --fail-with-body --silent --show-error \
  -H "Authorization: Bearer $NEON_API_KEY" \
  "https://console.neon.tech/api/v2/projects/$NEON_PROJECT_ID/branches/$OLD_PROD_ID" \
  | jq -r '.branch.name // empty')
if [ -z "$OLD_BRANCH_INFO" ]; then
  echo "::error::Branch $OLD_PROD_ID no longer exists (already deleted?). Aborting."
  exit 1
fi
case "$OLD_BRANCH_INFO" in
  "production (old)"*) ;;
  *)
    echo "::error::Branch $OLD_PROD_ID is named \"$OLD_BRANCH_INFO\", not \"production (old)…\". Aborting delete — this does not look like the orphaned pre-restore branch."
    exit 1
    ;;
esac

# (d) Operator must type the exact old branch ID to confirm.
echo "About to DELETE branch $OLD_PROD_ID (\"$OLD_BRANCH_INFO\")."
echo "Type the exact branch ID to confirm deletion:"
read -r CONFIRM_ID
if [ "$CONFIRM_ID" != "$OLD_PROD_ID" ]; then
  echo "::error::Confirmation does not match the recorded old branch ID. Aborting delete."
  exit 1
fi

curl --fail-with-body --silent --show-error --request DELETE \
  -H "Authorization: Bearer $NEON_API_KEY" \
  "https://console.neon.tech/api/v2/projects/$NEON_PROJECT_ID/branches/$OLD_PROD_ID"
```

**Warning:** A finalized snapshot restore replaces the Neon production
branch in-place. Data written to the production branch after the
snapshot was taken is preserved on the orphaned `production (old)`
branch — **retained until recovery is explicitly verified (step 8)**,
then deletable. It is no longer reachable from the production connection
string once the restore finalizes. This is a last resort.

> **Why the orphaned ID is the PRE-restore production branch ID, not
> `.branch.id` from the restore response:** a finalized restore swaps
> the restored branch into the active production slot and renames the
> previous production branch to `production (old)`. The restore
> response's `.branch` is therefore the **newly restored** branch (the
> new active production branch) — recording it as `OLD_PROD_ID` and
> deleting it would delete production. The orphaned branch is the branch
> that used to be the production branch: the `PROD_BRANCH_ID` captured
> in step 1, before the restore call. Step 8 verifies this explicitly
> (the recorded old ID must differ from the live production branch ID,
> the branch at the old ID must still exist and be named
> `production (old)…`, and the operator must type the exact ID to
> confirm). There is no name-based fallback — a prior restore may have
> left a different `production (old)` branch, and matching by name
> alone could delete the wrong one.

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
MIGRATION_ROLE=neondb_owner \
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
| Operator name | Josh Atwell (`jatwell93`) |
| Date completed | 2026-08-04 |
| Git SHA deployed | `b240631a` |
| Workflow run URL | https://github.com/jatwell93/date-management-app/actions/runs/30868236574 |
| Runtime role separation (app_runtime provisioned, REVOKE on schema_migrations applied, verify-runtime-role.js PASS — active on branch, read-only on the Neon production branch) | [x] PASS |
| First-production adoption (one-time gate — see [First-production adoption procedure](#first-production-adoption-procedure-one-time-gate)) | [x] PASS (adopted at 0009 on 2026-07-31; see adoption sign-off below) |
| Step 1 (PITR drill) | [x] PASS |
| Step 2 (CI deploy) | [x] PASS |
| Step 3 (canary) | [x] PASS |
| Step 4 (rollback) | [x] N/A (not exercised — deploy healthy, no rollback needed) |
| Step 5 (post-deploy verify) | [x] PASS |
| Runtime role cleanup (migration-role-check branch deleted, malformed " migration_runner" role deleted) | [x] done (2026-08-04) |

### Adoption sign-off (one-time)

Recorded once when the first-production adoption procedure is completed.
Required only for the first deploy after the migration runner becomes
authoritative; leave N/A for subsequent deploys.

| Field | Value |
|-------|-------|
| Branch proof track completed (`migration-role-check` branch — steps A–G including manual apply/seed/verify) | [x] PASS |
| Pre-adoption PITR gate (fresh drill on the Neon production branch, within 2 hours of step A) | [x] PASS |
| Adoption point (`MIGRATION_ADOPTION_POINT`) | `0009` |
| Migrations stamped (`0000`–`0009`) | [x] confirmed via `migrate:status` |
| `0010` and `0011` confirmed as the pending migrations (step D) | [x] confirmed |
| 0001 schema gap reconciled (if the dry-run refused) | [x] reconciled via guarded psql (15 `uploads` columns + `uploads_one_active_catalogue_per_org` partial index applied idempotently as neondb_owner) |
| Ledger REVOKE re-applied AFTER adoption created `schema_migrations` (step F, before workflow) | [x] confirmed (all 7 privileges denied) |
| Runtime-role verification PASS with `ledgerExists=true` (corrected `pg_catalog` detection, step G) | [x] confirmed (via DIRECT endpoint — pooler gives false negative) |
| Production hand-off: `0010` and `0011` applied by the protected GitHub workflow (not manually) | [x] confirmed via workflow artifact (run 30868236574 `migrate:apply` → `["0010","0011"]`) |
| `migrate:seed` — 54 `tier_feature_flags` rows (via workflow) | [x] Verified: YES |
| `migrate:verify` — PASS (via workflow) | [x] confirmed |
| `PRODUCTION_AUTO_DEPLOY_ENABLED` left unset until adoption + first canary PASS | [x] confirmed — kept unset through adoption + first canary PASS, then set to `'true'` on 2026-08-04 (push-to-main auto-deploy now enabled) |

### Evidence attachments

Paste links to CI runs, artifacts, or commit output files to the PR:

- [x] CI workflow run URL: https://github.com/jatwell93/date-management-app/actions/runs/30868236574 (conclusion: success)
- [x] PITR drill output: [`docs/evidence/2026-08-04-1.7b/pitr-drill-poll-evidence.json`](evidence/2026-08-04-1.7b/pitr-drill-poll-evidence.json) (`ok:true`, 3 ops `finished/success`), [`pitr-drill-restore-response.json`](evidence/2026-08-04-1.7b/pitr-drill-restore-response.json); plus the in-run "Check Neon PITR readiness" step + PITR evidence artifact on run 30868236574
- [x] Runtime role verification evidence: [`docs/evidence/2026-08-04-1.7b/runtime-role-evidence-production.json`](evidence/2026-08-04-1.7b/runtime-role-evidence-production.json) (`role:app_runtime`, `mode:read-only`, `pass:true`; passwords redacted)
- [x] Adoption dry-run report: [`adopt-dry-run-0009.txt`](evidence/2026-08-04-1.7b/adopt-dry-run-0009.txt), [`adopt-dry-run-0009b.txt`](evidence/2026-08-04-1.7b/adopt-dry-run-0009b.txt), [`adopt-dry-run-1.txt`](evidence/2026-08-04-1.7b/adopt-dry-run-1.txt)
- [x] Adoption apply report: applied in-session as `neondb_owner` (adoption stamp 0000–0009); confirmed by run 30868236574 `migrate:apply` reporting 0000–0009 `alreadyApplied`
- [x] Ledger-privileges probe: recorded in step F re-REVOKE (all 7 privileges denied); `ledgerExists=true` in runtime-role verify (step G, direct endpoint)
- [x] Migration artifacts (status/preflight/apply/seed/verify): uploaded as artifacts on run 30868236574 (Migration prep job 91864588683)
- [x] Canary evidence artifact: run 30868236574 Post-deploy canary job (91865534955) — both rounds PASS, evidence artifact uploaded
- [x] Post-deploy verify output: `/health?deep=true` → 200 (database `pass`) on both `api.expirymate.com.au` and the workers.dev target; operator browser login verified

### Smoke-test identity record

Recorded once when the identities are provisioned (see
[Smoke-test identity provisioning](#smoke-test-identity-provisioning)).
Two identities are required: a **custodian admin** that administers the
smoke organization, and the **smoke identity** (`team_member`) that the
canary mints sessions for. Only the smoke identity's Clerk user ID is
stored as `SMOKE_USER_ID`.

| Field | Value |
|-------|-------|
| Custodian — Clerk user ID | `user_…` *(redacted — see operator notes)* |
| Custodian — application user ID | 22 (role `admin`) |
| Smoke identity — Clerk user ID (`SMOKE_USER_ID`) | *(redacted — authoritative value stored as Doppler production `SMOKE_USER_ID`)* |
| Smoke identity — application user ID | 23 |
| Smoke identity — application role (must be `team_member`) | `team_member` |
| Smoke-test organization ID | *(redacted — Clerk `org_…` / application org UUID stored in operator notes)* |
| Verification query result (1 row, role=team_member, subscription present) | [x] confirmed |
| Provisioned by | Josh Atwell (`jatwell93`) |
| Date provisioned | 2026-07-30 |
| Purpose | Production canary smoke test (read-only) |

### Outstanding evidence

If any step could not be completed in this session, record what is missing
and why:

- **Runtime role cleanup — DONE (2026-08-04).** The `migration-role-check`
  Neon branch and the malformed `" migration_runner"` role were deleted after
  the canary passed (run 30868236574). No residual items remain.
- **Canary edge note (not a gap):** the post-deploy canary targets the
  worker's `*.workers.dev` URL rather than the `api.expirymate.com.au` custom
  domain, to bypass free-plan Cloudflare Bot Fight Mode which 403s CI
  datacenter IPs at the edge (PR #436). The custom-domain edge is verified
  separately (`/health?deep=true` = 200). Retarget via `vars.SMOKE_TARGET_URL`
  after a Pro upgrade + WAF Skip rule (PR #427 header).

Once all steps are PASS and evidence is attached, update `tasks.md` to check
off task 1.7.B-execute and the parent 1.7 checkbox.

---

## New secrets and variables reference

### GitHub environment secrets (preview)

| Secret | Purpose | Required |
|--------|---------|----------|
| `MIGRATION_DOPPLER_TOKEN` | Read-only token scoped to the minimal preview migration-validation config | Yes |
| `DOPPLER_TOKEN` | Token scoped to the development Worker deployment config | Yes |

### GitHub environment secrets (production)

| Secret | Purpose | Required |
|--------|---------|----------|
| `DOPPLER_TOKEN` | Token scoped to the production deployment config | Yes |
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
(injected by `doppler run`). After runtime role separation (see
[Runtime role separation](#runtime-role-separation-appruntime-provisioning)
above), the migration identity and the Worker runtime identity are
**distinct**:

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL_UNPOOLED` | Direct (non-pooled) Neon connection authenticated as **`neondb_owner`** (the schema owner / migration identity). Used by `migrate:*` commands. |
| `MIGRATION_ALLOWED_HOST` | Allowlisted hostname |
| `MIGRATION_ALLOWED_DATABASE` | Allowlisted database name |
| `MIGRATION_CONFIRM_PRODUCTION` | `APPLY <host>/<database>` confirmation token |
| `MIGRATION_ROLE` | `neondb_owner` — the schema owner is the migration identity. The runner's `verifyMigrationRole` guard asserts `current_user` equals this value. |
| `MIGRATION_SEED_CONFIRMATION` | `SEED <host>/<database>` confirmation token |
| `NEON_CONNECTION_STRING` | **Pooled** Neon connection authenticated as **`app_runtime`** (the restricted runtime identity). Read by the Worker (`workers/src/utils/db-connection.ts` resolves `NEON_CONNECTION_STRING \|\| DATABASE_URL`). `app_runtime` has DML privileges but no DDL. |
| `CLOUDFLARE_API_TOKEN` | Worker deploy (existing) |
| `CLOUDFLARE_ACCOUNT_ID` | Worker deploy (existing) |
| `CLERK_SECRET_KEY` | Production Clerk secret key — used by the canary orchestrator (`scripts/run-authenticated-smoke.js`) to mint short-lived session tokens for the smoke identity. Full Backend API access; blast radius controlled by the protected GitHub `production` environment. |
| `SMOKE_USER_ID` | Clerk user ID of the dedicated smoke-test identity. Not secret, but kept in Doppler so the canary configuration lives in one place. |

> **No workflow output exposes either password.** The migration CLIs
> redact connection strings (host + database only, no password).
> `scripts/verify-runtime-role.js` redacts the `app_runtime` password
> from its JSON evidence, including in nested probe error messages
> (active-probe mode only). The canary's `CLERK_SECRET_KEY` and
> `SMOKE_USER_ID` are injected via `doppler run` and never printed. The
> previous Worker connection secret is retained securely (outside
> Doppler, in operator-controlled storage) until the canary passes, so
> the role cutover can be rolled back without re-provisioning.

---

## Related documentation

- [Migrations E2E Runbook](migrations-e2e-runbook.md) — the operator Neon dev-branch gate (task 1.6)
- [Neon Backup & Restore](neon-backup-restore.md) — Neon PITR details
- [Workers Deployment](workers-deployment.md) — Worker deploy basics
- [Production Deployment Checklist](production-deployment-checklist.md) — general pre-launch checklist
- [Rollback Procedure](rollback-procedure.md) — existing rollback docs
