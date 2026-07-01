import { createClerkClient, verifyToken } from '@clerk/backend';
import { neon } from '@neondatabase/serverless';
import type { Env } from '../types/env';
import { errorResponse, jsonResponse } from '../utils/worker-response';
import {
  deriveUsername,
  ensureTrialSubscription,
  findOrCreateOrganization,
  sanitizeSlug,
  upsertClerkUser,
} from './clerk-persistence';

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

type BootstrapRoleValue = 'admin' | 'manager' | 'team_member';

const DEFAULT_PAGES_PREVIEW_BASE_HOST = 'date-management-frontend.pages.dev';
const MULTI_LABEL_PUBLIC_SUFFIXES = ['com.au', 'net.au', 'org.au', 'co.uk', 'org.uk'];

function getConnectionString(env: Env): string {
  return env.NEON_CONNECTION_STRING || env.DATABASE_URL || env.HYPERDRIVE?.connectionString || '';
}

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

function normalizeBootstrapRole(role: string | null | undefined): BootstrapRoleValue {
  if (!role) {
    return 'team_member';
  }

  if (
    role === 'admin' ||
    role === 'Admin' ||
    role === 'ADMIN' ||
    role === 'owner' ||
    role === 'org:admin'
  ) {
    return 'admin';
  }

  if (role === 'manager' || role === 'Manager' || role === 'MANAGER' || role === 'org:manager') {
    return 'manager';
  }

  return 'team_member';
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

export async function handleOrganizationBootstrap(
  request: Request,
  env: Env,
): Promise<Response> {
  const requestOrigin = request.headers.get('Origin') || '';
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
    return jsonResponse(
      {
        userId: Number(existingUser[0].id),
        organizationId: String(existingUser[0].organizationId),
        role: normalizeBootstrapRole(String(existingUser[0].role)),
        isNewOrg: false,
        isNewUser: false,
        isFirstAdmin: false,
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

  return jsonResponse(
    {
      userId: Number(bootstrappedUser[0].id),
      organizationId,
      role: normalizeBootstrapRole(String(bootstrappedUser[0].role)),
      isNewOrg,
      isNewUser: true,
      isFirstAdmin,
    },
    201,
    env,
    requestOrigin,
  );
}
