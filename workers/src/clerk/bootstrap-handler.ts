import { createClerkClient, verifyToken } from '@clerk/backend';
import { neon } from '@neondatabase/serverless';
import type { Env } from '../types/env';
import { errorResponse, jsonResponse } from '../utils/worker-response';
import { getConnectionString } from '../utils/db-connection';
import { enforceJsonBodyLimit } from '../utils/body-limit';
import {
  deriveUsername,
  ensureTrialSubscription,
  findOrCreateOrganization,
  insertOrgAuditLog,
  sanitizeSlug,
  upsertClerkUser,
  type SqlClient,
} from './clerk-persistence';
import { getClientIp } from '../utils/minimal-rate-limit';
import { ORG_AUDIT_EVENT_TYPES, ORG_AUDIT_TRIGGERS } from '../../../shared/domain/org-audit';
import { isPlatformAdminUser } from '../../../shared/domain/platform-catalogue';
import { normalizeRole, type RoleValue } from '../constants/roles';

interface ClerkSessionClaims {
  sub?: string;
  email?: string;
  username?: string;
  org_id?: string;
  org_role?: string;
  role?: string;
}

interface ClerkAuthContext {
  clerkUserId: string;
  email: string | null;
  username: string | null;
  organizationId: string | null;
  organizationRole: string | null;
}

interface OrganizationBootstrapBody {
  organizationName?: string;
  organizationSlug?: string;
  clerkOrganizationId?: string;
  clerkMembershipRole?: string | null;
}

/** The canonical role set. Kept as a local alias of the shared `RoleValue`
 * so the many signatures below read unchanged. */
type BootstrapRoleValue = RoleValue;

const DEFAULT_PAGES_PREVIEW_BASE_HOST = 'date-management-frontend.pages.dev';
const MULTI_LABEL_PUBLIC_SUFFIXES = ['com.au', 'net.au', 'org.au', 'co.uk', 'org.uk'];

function getPagesPreviewBaseHost(env: Env): string {
  const candidates = [env.FRONTEND_URL];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const { hostname } = new URL(candidate);
      if (hostname.endsWith('.pages.dev')) {
        return hostname;
      }
    } catch {
      // ignore malformed env values
    }
  }
  return DEFAULT_PAGES_PREVIEW_BASE_HOST;
}

function isApexHost(host: string): boolean {
  let suffixLabels = 1;
  for (const suffix of MULTI_LABEL_PUBLIC_SUFFIXES) {
    if (host === suffix || host.endsWith(`.${suffix}`)) {
      suffixLabels = suffix.split('.').length;
      break;
    }
  }
  return host.split('.').length === suffixLabels + 1;
}

function expandApexAndWwwOrigins(rawUrl: string): string[] {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return [];
  }

  const portSuffix = url.port ? `:${url.port}` : '';
  const host = url.hostname;
  const origins = new Set<string>([`${url.protocol}//${host}${portSuffix}`]);

  if (host.startsWith('www.')) {
    const apex = host.slice(4);
    if (isApexHost(apex)) {
      origins.add(`${url.protocol}//${apex}${portSuffix}`);
    }
  } else if (isApexHost(host)) {
    origins.add(`${url.protocol}//www.${host}${portSuffix}`);
  }

  return Array.from(origins);
}

export function getClerkAuthorizedParties(env: Env, requestOrigin?: string): string[] {
  const parties = new Set<string>(['http://localhost:3002', 'http://127.0.0.1:3002']);

  if (env.FRONTEND_URL) {
    for (const origin of expandApexAndWwwOrigins(env.FRONTEND_URL)) {
      parties.add(origin);
    }
  }

  if (env.NODE_ENV !== 'production' && requestOrigin) {
    try {
      const url = new URL(requestOrigin);
      if (url.protocol === 'https:') {
        const projectBase = getPagesPreviewBaseHost(env);
        const previewSuffix = `.${projectBase}`;
        if (url.hostname === projectBase || url.hostname.endsWith(previewSuffix)) {
          parties.add(`https://${url.hostname}`);
        }
      }
    } catch {
      // ignore malformed Origin headers
    }
  }

  return Array.from(parties);
}

/**
 * Normalize a Clerk role for the bootstrap path.
 *
 * This was a hand-rolled ladder covering a subset of the spellings the shared
 * table already holds. It was also the *correct* one of the Worker's two
 * normalizers — the webhook's disagreed with it, which is issue #517 — so
 * pointing both at `shared/domain/roles.ts` is what makes them agree by
 * construction rather than by review.
 */
function normalizeBootstrapRole(role: string | null | undefined): BootstrapRoleValue {
  return normalizeRole(role);
}

export async function authenticateClerkRequest(
  request: Request,
  env: Env,
  requestOrigin?: string,
): Promise<ClerkAuthContext | Response> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return errorResponse('Missing or invalid Authorization header', 401, env, requestOrigin);
  }

  const token = authHeader.slice(7);
  const secretKey = env.CLERK_SECRET_KEY?.trim();

  if (!secretKey) {
    return errorResponse('Auth service not configured', 500, env, requestOrigin);
  }

  try {
    const payload = (await verifyToken(token, {
      secretKey,
      authorizedParties: getClerkAuthorizedParties(env, requestOrigin),
    })) as ClerkSessionClaims;

    if (!payload.sub) {
      return errorResponse('Invalid or expired token', 401, env, requestOrigin);
    }

    return {
      clerkUserId: payload.sub,
      email: typeof payload.email === 'string' ? payload.email.toLowerCase() : null,
      username: typeof payload.username === 'string' ? payload.username : null,
      organizationId: typeof payload.org_id === 'string' ? payload.org_id : null,
      organizationRole:
        typeof payload.org_role === 'string'
          ? payload.org_role
          : typeof payload.role === 'string'
            ? payload.role
            : null,
    };
  } catch (error) {
    console.error('[ORG_BOOTSTRAP] Clerk token verification failed', error);
    return errorResponse('Invalid or expired token', 401, env, requestOrigin);
  }
}

async function getClerkUserProfile(
  clerkUserId: string,
  env: Env,
): Promise<{ email: string | null; username: string | null }> {
  const secretKey = env.CLERK_SECRET_KEY?.trim();

  if (!secretKey) {
    return { email: null, username: null };
  }

  const clerkClient = createClerkClient({ secretKey });
  const user = await clerkClient.users.getUser(clerkUserId);

  return {
    email: user.primaryEmailAddress?.emailAddress?.toLowerCase() ?? null,
    username: typeof user.username === 'string' ? user.username : null,
  };
}

export async function handleOrganizationBootstrap(request: Request, env: Env): Promise<Response> {
  const requestOrigin = request.headers.get('Origin') || '';

  // The JSON body cap is enforced here rather than inherited from the entry
  // point. This route is dispatched by `resolveBootstrapApiRoute`
  // (index-minimal.ts) *above* that check -- bootstrap must precede the legacy
  // `JWT_SECRET` check, which is pinned by a test -- so without this it would
  // buffer an unbounded body into the isolate (`request.text()` below).
  //
  // It is not alone in that: `{/upload,/api/upload}/initiate` and `.../complete`
  // also dispatch above the entry-point check and buffer `request.json()`. They
  // are capped in `upload/upload-router.ts`. See `utils/body-limit.ts` for the
  // full per-route map -- the cap is a per-route guarantee, not a global one,
  // and successive revisions of that comment claimed otherwise twice.
  //
  // Placed before authentication deliberately. Clerk verification is a network
  // round trip, and there is no reason to spend one on a request already known
  // to be refused; a 413 for an unauthenticated caller discloses nothing, since
  // the size was in their own header. Nothing below reads the body before this
  // point, so the ordering is safe.
  const oversizedBody = enforceJsonBodyLimit(request, env, requestOrigin);
  if (oversizedBody) {
    return oversizedBody;
  }

  const authResult = await authenticateClerkRequest(request, env, requestOrigin);

  if (authResult instanceof Response) {
    return authResult;
  }

  let body: OrganizationBootstrapBody = {};

  try {
    const rawBody = await request.text();
    body = rawBody ? (JSON.parse(rawBody) as OrganizationBootstrapBody) : {};
  } catch {
    return errorResponse('Invalid request body', 400, env, requestOrigin);
  }

  const missingProfileFields = !authResult.email || !authResult.username;
  const profile = missingProfileFields
    ? await getClerkUserProfile(authResult.clerkUserId, env)
    : { email: null, username: null };

  const email = authResult.email || profile.email;
  if (!email) {
    return errorResponse(
      'Authenticated Clerk user is missing a primary email',
      400,
      env,
      requestOrigin,
    );
  }

  const username =
    authResult.username || profile.username || deriveUsername({}, email, authResult.clerkUserId);
  const finalClerkOrgId =
    body.clerkOrganizationId?.trim() ||
    authResult.organizationId ||
    `clerk-org-${authResult.clerkUserId}-${Date.now()}`;
  const finalOrgName = body.organizationName?.trim() || `${email.split('@')[0]}'s Organization`;
  const finalOrgSlug = sanitizeSlug(
    body.organizationSlug?.trim() || finalOrgName,
    `${email.split('@')[0]}-${Date.now()}`.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
  );

  const sql = neon(getConnectionString(env));

  // Returning-user happy path: a single lookup is enough. The user row already
  // carries its organization and role, so we never need to resolve the org here.
  const existingUser = await sql`
    SELECT id,
           organization_id as "organizationId",
           role
    FROM users
    WHERE clerk_user_id = ${authResult.clerkUserId}
    LIMIT 1
  `;

  if (existingUser[0]) {
    const userId = Number(existingUser[0].id);
    return jsonResponse(
      {
        userId,
        organizationId: String(existingUser[0].organizationId),
        role: normalizeBootstrapRole(String(existingUser[0].role)),
        isNewOrg: false,
        isNewUser: false,
        isFirstAdmin: false,
        isPlatformAdmin: isPlatformAdminUser(userId, env.PLATFORM_ADMIN_USER_IDS),
      },
      200,
      env,
      requestOrigin,
    );
  }

  // New user: resolve (and if needed create) the organization before linking.
  const existingOrg = await sql`
    SELECT id
    FROM organizations
    WHERE clerk_organization_id = ${finalClerkOrgId}
    LIMIT 1
  `;
  const isNewOrg = existingOrg.length === 0;
  const organizationId = isNewOrg
    ? await findOrCreateOrganization(
        sql,
        { id: finalClerkOrgId, name: finalOrgName, slug: finalOrgSlug },
        email,
      )
    : String(existingOrg[0].id);

  // **This check-then-act race is accepted, not overlooked** (#474, task 3.1.h).
  // Two first sign-ins against one organization with no active admin, inside the
  // same few milliseconds, both read zero rows here and both assign 'admin'.
  //
  // It is not closed, and the two obvious closures were rejected on their merits:
  //
  //   * Folding the check into the INSERT as a conditional single statement —
  //     the data-modifying-CTE shape used four times for the audit trail — does
  //     **not** fix it. That pattern buys atomicity, not isolation. Two
  //     bootstraps insert different clerk_user_ids, contend on no common row,
  //     and each evaluates the admin subquery against a snapshot taken before
  //     the other's insert. The window shrinks to one round-trip and the defect
  //     survives.
  //   * A partial unique index (role = 'admin' AND deleted_at IS NULL) does
  //     close it, and also makes a *second* admin impossible everywhere —
  //     including via POST /api/users and PUT /api/users/:id, which deliberately
  //     mint one (`isValidRole` admits 'admin'). That is the larger change.
  //
  // The mechanism that would work without a transaction is a compare-and-swap on
  // a one-shot organizations column, since a single-row UPDATE re-checks its own
  // qualifier against the updated version. It costs a migration and it removes a
  // live fallback: today an organization whose only admin is soft-deleted grants
  // admin to the next person to bootstrap.
  //
  // What the race yields is one extra admin **inside the caller's own
  // organization** — a state that organization can already reach on purpose — and
  // it is pre-existing in Express too (`org-bootstrap.service.ts:100` reads the
  // admin outside the `$transaction` opened at `:116`). Bounded, no cross-tenant
  // reach, unchanged at the cutover.
  //
  // **Do not add a concurrency test for this.** pglite serialises these tests on
  // one connection, so such a test passes because the harness cannot fail it, and
  // it would codify the accepted defect as intended behaviour.
  const activeAdmin = await sql`
    SELECT id
    FROM users
    WHERE organization_id = ${organizationId}
      AND role = 'admin'
      AND deleted_at IS NULL
    LIMIT 1
  `;

  const isFirstAdmin = activeAdmin.length === 0;
  const assignedRole = isFirstAdmin
    ? 'admin'
    : normalizeBootstrapRole(body.clerkMembershipRole ?? authResult.organizationRole);

  await upsertClerkUser(sql, {
    clerkUserId: authResult.clerkUserId,
    organizationId,
    role: assignedRole,
    email,
    username,
  });

  await ensureTrialSubscription(sql, organizationId);

  const bootstrappedUser = await sql`
    SELECT id,
           role
    FROM users
    WHERE clerk_user_id = ${authResult.clerkUserId}
    LIMIT 1
  `;

  if (!bootstrappedUser[0]) {
    return errorResponse('Failed to bootstrap organization membership', 500, env, requestOrigin);
  }

  await recordBootstrapRoleAssignment(sql, {
    organizationId,
    userId: Number(bootstrappedUser[0].id),
    role: normalizeBootstrapRole(String(bootstrappedUser[0].role)),
    isFirstAdmin,
    isNewOrg,
    clerkMembershipRole: body.clerkMembershipRole ?? authResult.organizationRole ?? null,
    ipAddress: getClientIp(request),
  });

  return jsonResponse(
    {
      userId: Number(bootstrappedUser[0].id),
      organizationId,
      role: normalizeBootstrapRole(String(bootstrappedUser[0].role)),
      isNewOrg,
      isNewUser: true,
      isFirstAdmin,
      isPlatformAdmin: isPlatformAdminUser(
        Number(bootstrappedUser[0].id),
        env.PLATFORM_ADMIN_USER_IDS,
      ),
    },
    201,
    env,
    requestOrigin,
  );
}

/**
 * Record the role this bootstrap assigned, in `org_audit_log` (migration 0013).
 *
 * **Deliberately non-blocking**, unlike the promotion path in `handleUpdateUser`,
 * which writes its audit row in the same statement as the role change. The
 * asymmetry is the point:
 *
 *   * This entry is a *self*-assignment — actor and target are the same user, at
 *     account creation — and is therefore reconstructible after the fact from
 *     `users.role` and `users.created_at`. Losing one is recoverable.
 *   * Failing here would otherwise fail a user's very first sign-in, locking them
 *     out of the product entirely to protect a record that is already derivable.
 *
 * A deliberate promotion is neither self-evident nor reconstructible, so that one
 * is made atomic instead. Express also swallowed this failure
 * (`org-bootstrap.service.ts:165`), so behaviour is unchanged at the cutover.
 */
async function recordBootstrapRoleAssignment(
  sql: SqlClient,
  details: {
    organizationId: string;
    userId: number;
    role: BootstrapRoleValue;
    isFirstAdmin: boolean;
    isNewOrg: boolean;
    clerkMembershipRole: string | null;
    ipAddress: string;
  },
): Promise<void> {
  try {
    await insertOrgAuditLog(sql, {
      organizationId: details.organizationId,
      eventType: ORG_AUDIT_EVENT_TYPES.ROLE_ASSIGNED,
      actorUserId: details.userId,
      actorOrganizationId: details.organizationId,
      targetUserId: details.userId,
      targetOrganizationId: details.organizationId,
      newRole: details.role,
      ipAddress: details.ipAddress,
      metadata: {
        trigger: ORG_AUDIT_TRIGGERS.BOOTSTRAP,
        isFirstAdmin: details.isFirstAdmin,
        isNewOrg: details.isNewOrg,
        clerkMembershipRole: details.clerkMembershipRole,
      },
    });
  } catch (error) {
    console.error('Failed to record bootstrap role assignment:', error);
  }
}
