# RBAC + Org Management Rollout Runbook

**Feature**: `add-clerk-organization-management-rbac`  
**Date**: 2026-04-19  
**Status**: Merged to `main`

---

## Pre-Rollout Checklist

- [ ] All backend tests pass (1443/1452, 9 pre-existing skips)
- [ ] Frontend TypeScript clean (`tsc --noEmit` exit 0)
- [ ] Workers TypeScript clean (`tsc --noEmit` exit 0)
- [ ] Prisma migrations applied to Neon production
- [ ] Backfill script dry-run passes with 0 errors
- [ ] Backfill script live run + idempotency verification pass
- [ ] Cloudflare WAF rules deployed (3 rules)
- [ ] Environment variables confirmed: `CLERK_SECRET_KEY`, `DATABASE_URL`

---

## 6.1 Role Backfill — Production Neon Database

### Purpose
Normalize any legacy role values (`Manager`, `owner`, `Staff`, etc.) in the `User` and `OrganizationInvite` tables to canonical values (`admin`, `manager`, `team_member`). The script is idempotent — safe to run multiple times.

### Step 1 — Dry Run (no writes)

```powershell
$env:DATABASE_URL = "postgresql://<user>:<pass>@<host>/<db>?sslmode=require"
node backend/scripts/backfill-canonical-roles.js --dry-run
```

Expected output when already clean:
```
Users: 0 updated, N already canonical (N total)
Invites: 0 updated, N already canonical (N total)
✅ Backfill complete (DRY RUN — no changes made).
```

### Step 2 — Live Run

```powershell
$env:DATABASE_URL = "postgresql://<user>:<pass>@<host>/<db>?sslmode=require"
node backend/scripts/backfill-canonical-roles.js
```

Expected output:
```
✅ Verification passed: all roles are canonical.
✅ Backfill complete.
```

### Step 3 — Idempotency Check

Run the script a second time — must report **0 updates**:
```
Users: 0 updated, N already canonical (N total)
Invites: 0 updated, N already canonical (N total)
✅ Verification passed: all roles are canonical.
```

### Step 4 — Direct SQL Verification

```sql
-- Should return 0 rows
SELECT id, role FROM users
WHERE role NOT IN ('admin', 'manager', 'team_member');

-- Should return 0 rows
SELECT id, role FROM organization_invites
WHERE role NOT IN ('admin', 'manager', 'team_member');
```

---

## 6.2 Token Hashing Verification

### Automated
Covered by `backend/src/tests/unit/organization-invite-security.test.ts` (5 tests):
- Hash stored, plain token not in DB
- Token cleared on accept (one-time use)
- Token cleared on revoke
- Legacy token fallback accepted
- Expired invite rejected and token cleared

### Manual spot-check (optional)
```sql
-- Verify no plain-text tokens in DB (all values should look like bcrypt hashes starting with $2b$)
SELECT id, LEFT(invite_token_hash, 7) AS hash_prefix
FROM organization_invites
WHERE invite_token_hash IS NOT NULL
LIMIT 5;
-- Expected: $2b$12$...
```

---

## 6.3 Audit Log Verification

### Covered events
| Action | Event Type | Location |
|---|---|---|
| Bootstrap (first login) | `role_assigned` | `OrgBootstrapService` |
| Create invite | `invite_created` | `OrganizationInviteService.createInvite` |
| Accept invite | `invite_accepted` | `OrganizationInviteService.acceptInvite` |
| Revoke invite | `invite_revoked` | `OrganizationInviteService.revokeInvite` |
| Resend invite | `invite_resent` | `OrganizationInviteService.resendInvite` |

### Verification query
```sql
-- View recent org audit events (last 50)
SELECT event_type, actor_user_id, target_user_id, invite_id, created_at
FROM org_audit_log
ORDER BY created_at DESC
LIMIT 50;

-- Confirm no raw tokens in metadata
SELECT id, metadata FROM org_audit_log
WHERE metadata LIKE '%token%';
-- Should return 0 rows
```

---

## 6.4 End-to-End Validation Steps

### (a) Admin Bootstrap
1. Create a new Clerk organization
2. Sign in as first member → call `POST /api/organization/bootstrap`
3. Verify response: `{ role: "admin", isFirstAdmin: true }`
4. Verify DB: `SELECT role FROM "User" WHERE clerk_user_id = '<id>'` → `admin`

### (b) Invite Acceptance
1. Admin creates invite: `POST /api/organization/invites`
2. Accept with matching email: `POST /api/organization/invites/:id/accept`
3. Attempt re-accept (same token) → expect `404` or `400`
4. Accept with wrong token → expect rejection
5. Verify DB: invited user has correct canonical role

### (c) Upload Role Restrictions
```bash
# team_member upload attempt → should return 403
curl -X POST https://api.example.com/api/uploads/csv \
  -H "Authorization: Bearer <team_member_token>" \
  # Expected: 403 FORBIDDEN

# admin upload → should succeed
curl -X POST https://api.example.com/api/uploads/csv \
  -H "Authorization: Bearer <admin_token>" \
  # Expected: 200 or presigned URL response
```

### (d) Rate Limiting
Manual test only (requires Cloudflare WAF rules active — see 6.6).

---

## 6.6 WAF Rate Limiting Verification

See full rule specifications: `docs/plans/2026-04-17-cloudflare-waf-rate-limits.md`

| Rule | Endpoint | Threshold | Window |
|---|---|---|---|
| Invite creation | `POST /api/organization/invites` | 10 req | 60s |
| Invite acceptance | `POST /api/organization/invites/:id/accept` | 5 req | 60s |
| Role assignment | `POST /api/organization/members/:id/role` | 20 req | 1h |

### Verification
```bash
# Send 11 POSTs to invite creation within 60s — 11th must return 429
for i in {1..11}; do
  curl -s -o /dev/null -w "%{http_code}\n" \
    -X POST https://api.example.com/api/organization/invites \
    -H "Authorization: Bearer <token>"
done
# First 10: 400/422 (validation error), 11th: 429
```

---

## 6.7 Rollback Procedures

### Scenario A: Frontend role gate blocking all users

**Symptom**: Admin users see no protected nav items, redirected to `/scan`.

**Root cause** (fixed in this branch): `decodeTokenAndGetRole` was reading `decodedToken.role` but Clerk JWTs use `org_role` (`org:admin`, `org:member`).

**Fix applied**:
1. `frontend/src/constants/roles.ts` — added `org:admin`, `org:manager`, `org:member`, `org:team_member` to `LEGACY_ROLE_MAP`
2. `frontend/src/components/ClerkAuthProvider.tsx` — `decodeTokenAndGetRole` now reads `decodedToken.role ?? decodedToken.org_role`
3. `frontend/src/App.tsx` — `effectiveUserRole = bootstrapResult?.role ?? userRole` (DB role takes precedence over JWT-decoded role)

**Emergency revert** (if re-introduced):
```typescript
// Temporary workaround — allow admin by checking org_role directly
const userRole = org_role === 'org:admin' ? 'admin' : 'team_member';
```

### Scenario B: WAF rules blocking legitimate traffic

**Symptom**: Users getting 429 on normal usage.

**Fix**: Disable WAF rule via Cloudflare Dashboard:
> Security → WAF → Rate limiting rules → Toggle rule OFF

Re-enable after adjusting threshold values.

### Scenario C: requireOrgRole blocking existing users

**Symptom**: 403 responses on previously working endpoints.

**Check**: Verify user's `role` in DB is a canonical value:
```sql
SELECT id, email, role FROM "User" WHERE email = '<user_email>';
-- If non-canonical, run backfill
```

**Emergency disable** (add to route):
```typescript
// Temporary: bypass role check while debugging
router.get('/', authenticateToken, /* requireOrgRole('admin', 'manager'), */ handler);
```

### Scenario D: Bootstrap loop / stuck at "Setting up organization"

**Symptom**: Frontend shows perpetual "Setting up your organization..." spinner.

**Check**: Browser DevTools Network tab → look for failed `POST /api/organization/bootstrap` call.

**Common causes**:
- `CLERK_SECRET_KEY` not set on backend → `500 Auth service not configured`
- User's Clerk org not loaded yet → retry after 2s

**Fix**: Trigger retry via "Retry Setup" button or page reload.

---

## Admin Constraint Verification

The system must never allow the last admin to be removed from an organization.

**Check in `OrgBootstrapService`**: first user in an org always gets `admin` regardless of `clerkMembershipRole`.

**Verify**:
```sql
-- Confirm each org has at least one admin
SELECT organization_id, COUNT(*) as admin_count
FROM "User"
WHERE role = 'admin'
GROUP BY organization_id
HAVING COUNT(*) = 0;
-- Should return 0 rows
```

---

## Post-Deployment Monitoring

| Signal | Expected | Action if wrong |
|---|---|---|
| `POST /api/organization/bootstrap` 5xx rate | < 0.1% | Check `CLERK_SECRET_KEY`, DB connection |
| `GET /api/users` 403 rate spike | < 1% | Check role backfill, token extraction |
| `org_audit_log` row count growing | Increasing after each action | OK |
| `org_audit_log` row count frozen | No new rows | Check `OrgAuditService` DB connection |
| Cloudflare 429 count | Near zero during normal hours | Adjust WAF thresholds if needed |
