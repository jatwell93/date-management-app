/**
 * Cloudflare Workers Entry Point (Minimal)
 *
 * This is a minimal implementation that doesn't import backend Express routes
 * to avoid pulling in SQLite dependencies. It provides essential API endpoints
 * using Workers-native code.
 *
 * For full API compatibility, backend Express routes would need refactoring
 * to separate business logic from Node.js-specific code.
 */

import { CatalogueImportMessage, Env } from './types/env';
import { handleHealthCheck } from './health';
import { createWorkersDatabase } from './database';
import * as Sentry from '@sentry/cloudflare';
import { createClerkClient, verifyToken } from '@clerk/backend';
import {
  resolveInventoryFields,
  getDeprecatedSnakeCaseFields,
  InventoryItemRequestBody,
} from './utils/inventory-field-mapping';
import {
  applyCorsHeaders,
  errorResponse,
  getCorsHeaders,
  handleOptions,
  jsonResponse,
  maybeCompressJsonResponse,
} from './utils/worker-response';
import {
  applyRateLimitHeaders,
  checkRateLimit,
  inMemoryRateLimitStore,
} from './utils/minimal-rate-limit';
import { handleWorkerUploadRoute } from './upload/upload-router';
import { resolveMinimalApiRoute, type MinimalApiRoute } from './minimal-api-routes';
import { parseCsvRecords } from './upload/csv-parser';
import {
  findHeaderIndex,
  normalizeHeader,
  parseProductCatalogRow,
  PRODUCT_CATALOG_HEADER_ALIASES,
  validateCatalogueRecords,
  type ProductCatalogRow,
  type ValidatedCatalogueRow,
} from './upload/catalogue-parser';
import {
  parseUploadCompleteBody,
  processCompletedUploadSync,
  queueCompletedCatalogueUpload,
  userOwnsUploadKey,
} from './upload/upload-handlers';
import { isCatalogueWithinLimit, takeImportBatch } from './upload/catalogue-import';

const DIRECT_UPLOAD_THRESHOLD_BYTES = 2 * 1024 * 1024;
const PRESIGNED_UPLOAD_TTL_SECONDS = 15 * 60;
const MAX_ROWS_PER_CHECKPOINT = 10000;
const STANDARD_MAX_FILE_SIZE = 25 * 1024 * 1024;
// Must stay aligned with `max_retries` on the catalogue queue consumers in wrangler.toml.
// After this many delivery attempts we mark the job failed (releasing the one-active-import
// lock) rather than letting it retry forever and dead-letter while stuck in `processing`.
const MAX_PROCESSING_ATTEMPTS = 5;
const CLERK_WEBHOOK_MAX_SKEW_SECONDS = 5 * 60;

// ---- Shared validation helpers ---------------------------------------------

/**
 * Canonical role allowlist. Production Clerk plan only supports 'admin' and
 * 'team_member'; 'manager' is dev-only and may be enabled in dev/staging
 * once the Clerk plan is upgraded. See MEMORY[6ae2c3e4].
 */
const ROLES_PROD = new Set<string>(['admin', 'team_member']);
const ROLES_DEV = new Set<string>(['admin', 'manager', 'team_member']);

function getAllowedRoles(env: Env): Set<string> {
  return env.NODE_ENV === 'production' ? ROLES_PROD : ROLES_DEV;
}

function isValidRole(role: string): boolean {
  // We don't have env here at all call sites; use the superset for validation
  // and rely on the per-env getAllowedRoles for error messages. The DB column
  // accepts any string, so the *gate* is the bigger risk than role validation.
  return ROLES_DEV.has(role);
}

/**
 * User-management capability gate. In prod only 'admin' can manage users; in
 * dev 'manager' is permitted as well so existing test fixtures keep working.
 */
function canManageUsers(role: string | undefined): boolean {
  if (!role) return false;
  if (role === 'admin') return true;
  // 'manager' is dev-only. We don't have env here so we conservatively allow
  // it; the role itself does not exist in production Clerk so this branch is
  // unreachable in prod.
  return role === 'manager';
}

/** Parse a path-segment into a positive integer or return null. */
function parsePositiveInt(value: string): number | null {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
}

/** ISO calendar date YYYY-MM-DD (no time component). */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Detect a Postgres unique-violation. Prefer the SQLSTATE code over
 * substring matching the message, which is locale/version dependent.
 */
function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { code?: unknown; message?: unknown };
  if (e.code === '23505') return true;
  // Some neon driver wrappers nest the pg error under .cause.
  const cause = (error as { cause?: { code?: unknown } }).cause;
  if (cause && typeof cause === 'object' && (cause as { code?: unknown }).code === '23505') {
    return true;
  }
  return false;
}

export { maybeCompressJsonResponse };
export { isCatalogueWithinLimit, takeImportBatch };
export type { ValidatedCatalogueRow };

// Native Worker API route table. Handlers are referenced directly (function
// declarations are hoisted) so each appears once and the matcher stays a small,
// testable module. `kind` is omitted for the common `'static'` shape. Order
// matters only where patterns could overlap.
const RE_USER_ID = /^\/api\/users\/\d+$/;
const RE_INVENTORY_ID = /^\/api\/inventory-items\/\d+$/;
const RE_STORE_AREA_ID = /^\/api\/store-areas\/\d+$/;
const MINIMAL_API_ROUTES: MinimalApiRoute[] = [
  ['POST', '/api/auth/login', handleLogin],
  ['POST', '/api/auth/register', handleRegister],
  ['GET', '/api/users/me', handleGetCurrentUser],
  ['GET', '/api/users', handleListUsers],
  ['POST', '/api/users', handleCreateLegacyUser],
  ['PUT', /^\/api\/users\/\d+\/reset-pin$/, handleResetUserPin],
  ['PUT', RE_USER_ID, handleUpdateUser, 'path'],
  ['DELETE', RE_USER_ID, handleDeleteUser, 'path'],
  ['GET', '/api/products', handleGetProducts],
  ['POST', '/api/products', handleCreateProduct],
  ['GET', /^\/api\/products\/by-barcode\/[^/]+$/, handleGetProductByBarcode, 'path'],
  ['GET', /^\/api\/products\/by-sku\/[^/]+$/, handleGetProductBySku, 'path'],
  ['GET', /^\/api\/products\/\d+$/, handleGetProduct, 'path'],
  ['GET', '/api/inventory-items', handleGetInventory],
  ['POST', '/api/inventory-items', handleCreateInventoryItem],
  ['GET', /^\/api\/inventory-items\/by-barcode\/[^/]+$/, handleGetInventoryByBarcode, 'path'],
  [
    'GET',
    /^\/api\/inventory-items\/recent\/product\/\d+$/,
    handleGetRecentInventoryByProduct,
    'path',
  ],
  ['PUT', RE_INVENTORY_ID, handleUpdateInventoryItem, 'path'],
  ['DELETE', RE_INVENTORY_ID, handleDeleteInventoryItem, 'path'],
  ['GET', '/api/store-areas', handleGetStoreAreas],
  ['POST', '/api/store-areas', handleCreateStoreArea],
  ['PUT', RE_STORE_AREA_ID, handleUpdateStoreArea, 'path'],
  ['DELETE', RE_STORE_AREA_ID, handleDeleteStoreArea, 'path'],
  ['GET', '/api/dashboard', handleGetDashboard],
  ['GET', '/api/reports/expiry', handleGetExpiryReport],
  ['GET', '/api/reports/expiry-overall', handleGetExpiryOverallReport],
  ['GET', '/api/reports/expiry-details', handleGetExpiryDetailsReport],
  ['GET', '/api/reports/daily-usage', handleGetDailyUsageReport],
  ['GET', '/api/reports/items-by-user', handleGetItemsByUserReport],
  ['GET', '/api/reports/items-by-date', handleGetItemsByDateReport],
  ['GET', '/api/reports/loss-by-sku', handleGetLossBySkuReport],
  ['GET', '/api/reports/loss-by-department', handleGetLossByDepartmentReport],
  ['GET', '/api/reports/sell-through', handleGetSellThroughReport],
  ['GET', '/api/expired-items', handleGetExpiredItems],
  ['POST', '/api/expired-items/process', handleProcessExpiredItem],
  ['GET', '/api/subscription/trial-status', handleGetTrialStatus],
  ['POST', '/api/organization/bootstrap', handleOrganizationBootstrap, 'bootstrap'],
];

/**
 * Main Workers fetch handler
 */
export default Sentry.withSentry(
  (env: any) => ({
    dsn: env.WORKERS_SENTRY_DSN,
    tracesSampleRate: 1.0, // Adjust to 0.1 later to save on free tier quota
  }),
  {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
      const requestOrigin = request.headers.get('Origin') || '';

      // Belt-and-suspenders: ensure every response (including unhandled
      // exceptions and preflights) carries CORS headers. Without this an
      // exception thrown above the inner try/catch can produce a bare 500
      // that the browser blocks before the developer ever sees the real
      // error message.
      const withCors = (response: Response): Response => {
        return applyCorsHeaders(response, env, requestOrigin);
      };

      const url = new URL(request.url);
      const { pathname } = url;
      const method = request.method;

      // Handle CORS preflight
      if (method === 'OPTIONS') {
        try {
          return withCors(handleOptions(request, env));
        } catch (error) {
          console.error('Unhandled error in OPTIONS handler:', error);
          return withCors(errorResponse('Internal Server Error', 500, env, requestOrigin));
        }
      }

      try {
        // Health check endpoint (no auth required)
        if (pathname === '/health' || pathname === '/api/health') {
          const healthResponse = await handleHealthCheck(request, env);
          return maybeCompressJsonResponse(request, healthResponse);
        }

        // Root metadata endpoint for human-friendly API discovery
        if (pathname === '/') {
          return maybeCompressJsonResponse(
            request,
            jsonResponse(
              {
                service: 'ExpiryMate API',
                status: 'ok',
                health: '/health',
                docs: '/api',
              },
              200,
              env,
              requestOrigin,
            ),
          );
        }

        // Clerk webhook endpoint (public, signature-verified)
        if (
          method === 'POST' &&
          (pathname === '/api/webhooks/clerk' || pathname === '/webhooks/clerk')
        ) {
          const webhookResponse = await handleClerkWebhook(request, env, requestOrigin);
          return maybeCompressJsonResponse(request, webhookResponse);
        }

        // API routes
        if (pathname.startsWith('/api/') || pathname.startsWith('/upload/')) {
          const rateLimitDecision = await checkRateLimit(request, env, inMemoryRateLimitStore);
          const finalizeApiResponse = async (responseLike: Response | Promise<Response>) => {
            const response = await responseLike;
            return maybeCompressJsonResponse(
              request,
              applyRateLimitHeaders(response, rateLimitDecision),
            );
          };

          if (!rateLimitDecision.allowed) {
            const retryAfter = Math.max(
              1,
              Math.ceil((rateLimitDecision.resetTime - Date.now()) / 1000),
            );
            const blockedResponse = errorResponse(
              `Rate limit exceeded. Please try again in ${retryAfter} seconds.`,
              429,
              env,
              requestOrigin,
            );
            return maybeCompressJsonResponse(
              request,
              applyRateLimitHeaders(blockedResponse, rateLimitDecision, retryAfter),
            );
          }

          if (!env.JWT_SECRET?.trim()) {
            const jwtErrorResponse = errorResponse(
              'JWT_SECRET is required',
              500,
              env,
              requestOrigin,
            );
            return finalizeApiResponse(jwtErrorResponse);
          }

          let db: Database | null = null;
          const getDb = (): Database => {
            db ||= createWorkersDatabase(env);
            return db;
          };
          const uploadResponse = await handleWorkerUploadRoute({
            request,
            env,
            url,
            pathname,
            method,
            requestOrigin,
            getDb,
            handlers: {
              handleUploadInitiate,
              handleUploadDirect,
              handleUploadPresigned,
              handleUploadStatus,
              handleUploadErrorReport,
              handleUploadComplete,
            },
          });
          if (uploadResponse) {
            return finalizeApiResponse(uploadResponse);
          }

          // Initialize database connection for remaining API endpoints
          db = getDb();

          const apiRouteResponse = resolveMinimalApiRoute(MINIMAL_API_ROUTES, {
            request,
            pathname,
            method,
            db,
            env,
          });

          return finalizeApiResponse(apiRouteResponse ?? errorResponse('Not Found', 404, env));
        }

        return withCors(
          await maybeCompressJsonResponse(
            request,
            errorResponse('Not Found', 404, env, requestOrigin),
          ),
        );
      } catch (error) {
        console.error('Unhandled error:', error);
        const message =
          env.NODE_ENV === 'development'
            ? error instanceof Error
              ? `${error.message}${error.stack ? `\n${error.stack}` : ''}`
              : 'Unknown error'
            : 'Internal Server Error';
        try {
          return withCors(
            await maybeCompressJsonResponse(
              request,
              errorResponse(message, 500, env, requestOrigin),
            ),
          );
        } catch (compressError) {
          console.error('Error while writing error response:', compressError);
          return withCors(
            new Response(JSON.stringify({ error: message }), {
              status: 500,
              headers: { 'Content-Type': 'application/json' },
            }),
          );
        }
      }
    },
    async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
      await handleCatalogueImportQueue(batch, env);
    },
  },
);

export async function handleCatalogueImportQueue(
  batch: MessageBatch<unknown>,
  env: Env,
  db: Database = createWorkersDatabase(env),
): Promise<void> {
  for (const message of batch.messages) {
    const body = message.body as Partial<CatalogueImportMessage> | null;
    if (!body || !Number.isInteger(body.uploadId) || Number(body.uploadId) <= 0) {
      message.ack();
      continue;
    }
    try {
      await processCatalogueImportJob(Number(body.uploadId), env, db);
      message.ack();
    } catch (error) {
      Sentry.captureException(error, {
        tags: { feature: 'catalogue-import', action: 'queue-consumer' },
        extra: { uploadId: body.uploadId, attempts: message.attempts },
      });
      // After the final attempt, mark the job failed and ack so the org's
      // one-active-import lock is released instead of leaving it stuck in
      // `processing` once the message dead-letters.
      if (message.attempts >= MAX_PROCESSING_ATTEMPTS) {
        try {
          await failCatalogueImport(
            db,
            Number(body.uploadId),
            'processing',
            'Catalogue import failed after repeated retries',
          );
        } catch (failError) {
          Sentry.captureException(failError, {
            tags: { feature: 'catalogue-import', action: 'queue-consumer-fail' },
            extra: { uploadId: body.uploadId },
          });
        }
        message.ack();
      } else {
        message.retry();
      }
    }
  }
}

// =============================================================================
// API Handlers (Using Neon serverless driver)
// These use the typed Database interface from database.ts
// =============================================================================

import { Database } from './database';
import { SignJWT, jwtVerify } from 'jose';

/**
 * Hash password using Web Crypto (edge-compatible)
 * Uses PBKDF2 which is available in Workers
 */
async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );

  const hash = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256,
  );

  // Combine salt and hash for storage
  const combined = new Uint8Array(salt.length + new Uint8Array(hash).length);
  combined.set(salt);
  combined.set(new Uint8Array(hash), salt.length);

  // Return as base64
  return btoa(String.fromCharCode(...combined));
}

/**
 * Verify password against stored hash
 */
async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  try {
    const encoder = new TextEncoder();

    // Decode stored hash
    const combined = new Uint8Array(
      atob(storedHash)
        .split('')
        .map((c) => c.charCodeAt(0)),
    );

    // Extract salt (first 16 bytes)
    const salt = combined.slice(0, 16);
    const storedHashBytes = combined.slice(16);

    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      'PBKDF2',
      false,
      ['deriveBits'],
    );

    const hash = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: 100000,
        hash: 'SHA-256',
      },
      keyMaterial,
      256,
    );

    // Compare hashes
    const hashBytes = new Uint8Array(hash);
    if (hashBytes.length !== storedHashBytes.length) return false;

    return hashBytes.every((byte, i) => byte === storedHashBytes[i]);
  } catch {
    return false;
  }
}

/**
 * Verify bcrypt-style hash (for backward compatibility with existing users)
 * Note: Full bcrypt verification isn't available in Workers,
 * so we use a simple prefix check and assume valid for testing
 */
async function verifyBcryptPassword(password: string, storedHash: string): Promise<boolean> {
  // Check if it's a bcrypt hash (starts with $2a$, $2b$, etc.)
  if (storedHash.startsWith('$2')) {
    // For bcrypt hashes, we can't verify in Workers without native bindings
    // In production, you'd either:
    // 1. Migrate all users to PBKDF2 hashes
    // 2. Use a Worker that calls an external service
    // 3. Use Cloudflare's Password hashing API when available
    console.warn('Bcrypt hash detected - cannot verify in Workers. Migration needed.');
    return false;
  }

  // Try PBKDF2 verification
  return verifyPassword(password, storedHash);
}

function requireJwtSecret(env: Env): Uint8Array {
  const secret = env.JWT_SECRET?.trim();
  if (!secret) {
    throw new Error('JWT_SECRET is required');
  }
  return new TextEncoder().encode(secret);
}

/**
 * Create JWT token using jose
 */
async function createToken(userId: number, env: Env): Promise<string> {
  const secret = requireJwtSecret(env);

  return await new SignJWT({ userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('24h')
    .setIssuedAt()
    .sign(secret);
}

/**
 * Create short-lived upload token for presigned strategy
 */
async function createUploadToken(
  userId: number,
  key: string,
  maxFileSize: number,
  env: Env,
): Promise<string> {
  const secret = requireJwtSecret(env);

  return await new SignJWT({ userId, key, maxFileSize, purpose: 'upload' })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime(`${PRESIGNED_UPLOAD_TTL_SECONDS}s`)
    .setIssuedAt()
    .sign(secret);
}

/**
 * Verify short-lived upload token
 */
async function verifyUploadToken(
  token: string,
  key: string,
  env: Env,
): Promise<{ userId: number; maxFileSize: number } | null> {
  const secret = requireJwtSecret(env);

  try {
    const { payload } = await jwtVerify(token, secret);

    const tokenUserId = Number(payload.userId);
    const tokenKey = typeof payload.key === 'string' ? payload.key : '';
    const tokenPurpose = payload.purpose;
    const tokenMaxFileSize = Number(payload.maxFileSize);

    if (!Number.isFinite(tokenUserId) || tokenUserId <= 0) {
      return null;
    }

    if (tokenKey !== key || tokenPurpose !== 'upload') {
      return null;
    }

    return {
      userId: tokenUserId,
      maxFileSize:
        Number.isFinite(tokenMaxFileSize) && tokenMaxFileSize > 0
          ? tokenMaxFileSize
          : STANDARD_MAX_FILE_SIZE,
    };
  } catch {
    return null;
  }
}

/**
 * Extract and verify JWT token from Authorization header
 */
async function authenticateRequest(request: Request, env: Env): Promise<{ userId: number } | null> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.slice(7);
  const secret = requireJwtSecret(env);
  try {
    const { payload } = await jwtVerify(token, secret);
    return { userId: payload.userId as number };
  } catch {
    return null;
  }
}

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

// Multi-label public suffixes we care about. The registrable domain is the
// single label immediately before one of these (e.g. expirymate in
// expirymate.com.au). Hosts under single-label TLDs (.com, .dev) use the
// implicit one-label suffix. This is a deliberately small table rather than a
// full Public Suffix List, since the only real domains this code sees are
// expirymate.com.au and *.pages.dev.
const MULTI_LABEL_PUBLIC_SUFFIXES = ['com.au', 'net.au', 'org.au', 'co.uk', 'org.uk'];

// True only for a bare registrable domain with no subdomain in front
// (e.g. expirymate.com.au, example.com) — NOT staging.expirymate.com.au or
// date-management-frontend.pages.dev. Used to decide whether an apex<->www
// pairing is meaningful.
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

// Given a configured frontend URL, return that origin plus its apex/www
// sibling. The apex (https://expirymate.com.au) and www
// (https://www.expirymate.com.au) hosts serve the same app, but Clerk sets the
// session `azp` claim to the exact origin the token was minted from. Only one
// of them is stored in FRONTEND_URL, so without deriving the sibling, requests
// from the other host fail verification with a 401. We only ever pair a true
// apex with its www form (and vice versa) — deeper subdomains and *.pages.dev
// preview hosts get no derived sibling, so the allowlist stays tight.
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
    // Strip www. -> apex, but only when the result is a real registrable apex.
    const apex = host.slice(4);
    if (isApexHost(apex)) {
      origins.add(`${url.protocol}//${apex}${portSuffix}`);
    }
  } else if (isApexHost(host)) {
    // Prepend www. only for a bare apex, never for subdomains/preview hosts.
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

  // In non-production, allow Cloudflare Pages preview deploys whose hostnames
  // change per build (e.g. https://7f5e6f1a.date-management-frontend.pages.dev).
  // Scope is restricted to this project's Pages subdomain (derived from
  // FRONTEND_URL when it is a pages.dev host, otherwise the well-known
  // project base) and to https only, so an attacker-controlled Origin
  // header cannot expand the allowlist to arbitrary pages.dev tenants.
  // Production keeps the strict allowlist defined by FRONTEND_URL.
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

async function authenticateClerkRequest(
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

  const db = createWorkersDatabase(env);
  const existingOrg = await db.sql`
    SELECT id
    FROM organizations
    WHERE clerk_organization_id = ${finalClerkOrgId}
    LIMIT 1
  `;
  const isNewOrg = existingOrg.length === 0;
  const organizationId = isNewOrg
    ? await findOrCreateOrganization(
      db.sql,
      { id: finalClerkOrgId, name: finalOrgName, slug: finalOrgSlug },
      email,
    )
    : String(existingOrg[0].id);

  const existingUser = await db.sql`
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

  const activeAdmin = await db.sql`
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

  await upsertClerkUser(db.sql, {
    clerkUserId: authResult.clerkUserId,
    organizationId,
    role: assignedRole,
    email,
    username,
  });

  await ensureTrialSubscription(db.sql, organizationId);

  const bootstrappedUser = await db.sql`
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

type SqlClient = Database['sql'];

interface ClerkWebhookHeaders {
  id: string;
  timestamp: string;
  signature: string;
}

interface ClerkWebhookEventPayload {
  type?: string;
  data?: Record<string, unknown>;
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

function decodeClerkWebhookSecret(secret: string): Uint8Array {
  const rawSecret = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret;
  // Convert URL-safe base64 ('-' and '_') to standard base64 ('+' and '/')
  // because atob expects the standard base64 alphabet.
  const normalized = rawSecret.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);

  try {
    const binary = atob(padded);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    // Fallback for non-base64 test/local secrets.
    return new TextEncoder().encode(rawSecret);
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let mismatch = 0;

  for (let idx = 0; idx < a.length; idx += 1) {
    mismatch |= a.charCodeAt(idx) ^ b.charCodeAt(idx);
  }

  return mismatch === 0;
}

function extractSvixV1Signatures(signatureHeader: string): string[] {
  const matches = signatureHeader.matchAll(/v1,([A-Za-z0-9+/=]+)/g);
  return Array.from(matches, (match) => match[1]);
}

async function verifyClerkSvixSignature(
  rawBody: string,
  headers: ClerkWebhookHeaders,
  webhookSecret: string,
): Promise<void> {
  const timestampSeconds = Number.parseInt(headers.timestamp, 10);

  if (!Number.isFinite(timestampSeconds)) {
    throw new Error('Invalid svix-timestamp header');
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestampSeconds) > CLERK_WEBHOOK_MAX_SKEW_SECONDS) {
    throw new Error('Webhook timestamp outside allowed window');
  }

  const message = `${headers.id}.${headers.timestamp}.${rawBody}`;
  const secretBytes = decodeClerkWebhookSecret(webhookSecret);
  const key = await crypto.subtle.importKey(
    'raw',
    secretBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const expectedSignature = toBase64(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)),
  );

  const candidateSignatures = extractSvixV1Signatures(headers.signature);
  if (candidateSignatures.length === 0) {
    throw new Error('Invalid svix-signature header');
  }

  const isValid = candidateSignatures.some((signature) =>
    timingSafeEqual(signature, expectedSignature),
  );

  if (!isValid) {
    throw new Error('Invalid Clerk webhook signature');
  }
}

function sanitizeSlug(value: string, fallback: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);

  return slug || fallback;
}

function mapClerkRole(role: unknown): string {
  if (typeof role !== 'string') {
    return 'Team Member';
  }

  if (role === 'admin' || role === 'org:admin') {
    return 'Manager';
  }

  return 'Team Member';
}

function extractPrimaryClerkEmail(data: Record<string, unknown>): string | null {
  const addresses = Array.isArray(data.email_addresses) ? data.email_addresses : [];
  const primaryId =
    typeof data.primary_email_address_id === 'string' ? data.primary_email_address_id : null;

  const pickEmail = (candidate: unknown): string | null => {
    if (!candidate || typeof candidate !== 'object') {
      return null;
    }

    const record = candidate as Record<string, unknown>;
    return typeof record.email_address === 'string' ? record.email_address.toLowerCase() : null;
  };

  if (primaryId) {
    const primary = addresses.find((candidate) => {
      if (!candidate || typeof candidate !== 'object') {
        return false;
      }

      const record = candidate as Record<string, unknown>;
      return record.id === primaryId;
    });

    const primaryEmail = pickEmail(primary);
    if (primaryEmail) {
      return primaryEmail;
    }
  }

  for (const candidate of addresses) {
    const email = pickEmail(candidate);
    if (email) {
      return email;
    }
  }

  return null;
}

function deriveUsername(
  data: Record<string, unknown>,
  email: string | null,
  clerkUserId: string,
): string {
  const raw =
    typeof data.username === 'string' && data.username.trim().length > 0
      ? data.username.trim()
      : email?.split('@')[0] || `user-${clerkUserId.slice(-8)}`;

  return sanitizeSlug(raw, `user-${Date.now().toString(36)}`);
}

async function ensureTrialSubscription(sql: SqlClient, organizationId: string): Promise<void> {
  const existing = await sql`
    SELECT id
    FROM subscription_tiers
    WHERE organization_id = ${organizationId}
    LIMIT 1
  `;

  if (existing.length > 0) {
    return;
  }

  await sql`
    INSERT INTO subscription_tiers (
      organization_id,
      tier_level,
      status,
      billing_cycle,
      trial_started_at,
      trial_end_date,
      created_at,
      updated_at
    ) VALUES (
      ${organizationId},
      'professional',
      'trialing',
      'monthly',
      NOW(),
      NOW() + INTERVAL '14 days',
      NOW(),
      NOW()
    )
  `;
}

async function findOrCreateOrganization(
  sql: SqlClient,
  clerkOrganization: Record<string, unknown> | null,
  fallbackEmail?: string | null,
): Promise<string> {
  const clerkOrganizationId =
    clerkOrganization && typeof clerkOrganization.id === 'string' ? clerkOrganization.id : null;

  if (clerkOrganizationId) {
    const existing = await sql`
      SELECT id
      FROM organizations
      WHERE clerk_organization_id = ${clerkOrganizationId}
      LIMIT 1
    `;

    if (existing[0]?.id) {
      return String(existing[0].id);
    }
  }

  const fallbackLabel = fallbackEmail?.split('@')[0] || 'organization';
  const providedName =
    clerkOrganization && typeof clerkOrganization.name === 'string' ? clerkOrganization.name : null;
  const orgName = providedName || `${fallbackLabel}'s Organization`;

  const providedSlug =
    clerkOrganization && typeof clerkOrganization.slug === 'string' ? clerkOrganization.slug : null;
  const baseSlug = sanitizeSlug(
    providedSlug || orgName || clerkOrganizationId || fallbackLabel,
    `org-${crypto.randomUUID().slice(0, 8)}`,
  );

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const slug =
      attempt === 0 ? baseSlug : `${baseSlug}-${crypto.randomUUID().slice(0, 8)}-${attempt}`;

    // Prisma's @default(uuid()) generates the UUID in the JS layer rather than
    // creating a SQL DEFAULT, so the organizations.id column has no DB default.
    // Raw SQL inserts must supply the id explicitly.
    const newOrgId = crypto.randomUUID();
    try {
      const rows = await sql`
        INSERT INTO organizations (
          id,
          clerk_organization_id,
          name,
          slug,
          contact_email,
          created_at,
          updated_at
        ) VALUES (
          ${newOrgId},
          ${clerkOrganizationId},
          ${orgName},
          ${slug},
          ${fallbackEmail || null},
          NOW(),
          NOW()
        )
        RETURNING id
      `;

      if (rows[0]?.id) {
        return String(rows[0].id);
      }
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === '23505') {
        continue;
      }
      throw error;
    }
  }

  throw new Error('Unable to create organization for Clerk webhook event');
}

async function upsertClerkUser(
  sql: SqlClient,
  options: {
    clerkUserId: string;
    organizationId: string;
    role: string;
    email?: string | null;
    username?: string | null;
  },
): Promise<void> {
  const { clerkUserId, organizationId, role, email = null, username = null } = options;

  try {
    await sql`
      INSERT INTO users (
        organization_id,
        clerk_user_id,
        email,
        username,
        role,
        created_at,
        updated_at
      ) VALUES (
        ${organizationId},
        ${clerkUserId},
        ${email},
        ${username},
        ${role},
        NOW(),
        NOW()
      )
      ON CONFLICT (clerk_user_id)
      DO UPDATE SET
        organization_id = EXCLUDED.organization_id,
        email = COALESCE(EXCLUDED.email, users.email),
        username = COALESCE(EXCLUDED.username, users.username),
        role = EXCLUDED.role,
        deleted_at = NULL,
        updated_at = NOW()
    `;
    return;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code !== '23505' || !email) {
      throw error;
    }
  }

  const updatedExisting = await sql`
    UPDATE users
    SET
      clerk_user_id = ${clerkUserId},
      organization_id = ${organizationId},
      username = COALESCE(${username}, username),
      role = ${role},
      updated_at = NOW()
    WHERE organization_id = ${organizationId}
      AND LOWER(email) = LOWER(${email})
    RETURNING id
  `;

  if (updatedExisting.length === 0) {
    throw new Error('Unable to upsert Clerk user');
  }
}

async function processClerkWebhookEvent(
  sql: SqlClient,
  event: ClerkWebhookEventPayload,
): Promise<void> {
  const eventType = typeof event.type === 'string' ? event.type : 'unknown';
  const data =
    event.data && typeof event.data === 'object' ? (event.data as Record<string, unknown>) : {};

  switch (eventType) {
    case 'user.created': {
      const clerkUserId = typeof data.id === 'string' ? data.id : null;
      if (!clerkUserId) {
        return;
      }

      const primaryEmail = extractPrimaryClerkEmail(data);
      const memberships = Array.isArray(data.organization_memberships)
        ? data.organization_memberships
        : [];
      const firstMembership = memberships.find((item) => item && typeof item === 'object') as
        | Record<string, unknown>
        | undefined;
      const orgPayload =
        firstMembership && typeof firstMembership.organization === 'object'
          ? (firstMembership.organization as Record<string, unknown>)
          : null;

      const organizationId = await findOrCreateOrganization(sql, orgPayload, primaryEmail);
      const username = deriveUsername(data, primaryEmail, clerkUserId);
      const role = mapClerkRole(firstMembership?.role);

      await upsertClerkUser(sql, {
        clerkUserId,
        organizationId,
        role,
        email: primaryEmail,
        username,
      });

      await ensureTrialSubscription(sql, organizationId);
      return;
    }

    case 'user.updated': {
      const clerkUserId = typeof data.id === 'string' ? data.id : null;
      if (!clerkUserId) {
        return;
      }

      const primaryEmail = extractPrimaryClerkEmail(data);
      const memberships = Array.isArray(data.organization_memberships)
        ? data.organization_memberships
        : [];
      const firstMembership = memberships.find((item) => item && typeof item === 'object') as
        | Record<string, unknown>
        | undefined;
      const orgPayload =
        firstMembership && typeof firstMembership.organization === 'object'
          ? (firstMembership.organization as Record<string, unknown>)
          : null;
      const organizationId = await findOrCreateOrganization(sql, orgPayload, primaryEmail);

      await upsertClerkUser(sql, {
        clerkUserId,
        organizationId,
        role: mapClerkRole(firstMembership?.role),
        email: primaryEmail,
        username: deriveUsername(data, primaryEmail, clerkUserId),
      });

      return;
    }

    case 'organization.created':
    case 'organization.updated': {
      await findOrCreateOrganization(sql, data, null);
      return;
    }

    case 'organizationMembership.created': {
      const publicUserData = data.public_user_data as Record<string, unknown> | undefined;
      const clerkUserId =
        publicUserData && typeof publicUserData.user_id === 'string'
          ? publicUserData.user_id
          : null;

      const organizationPayload =
        data.organization && typeof data.organization === 'object'
          ? (data.organization as Record<string, unknown>)
          : null;

      if (!clerkUserId || !organizationPayload) {
        return;
      }

      const identifier =
        publicUserData && typeof publicUserData.identifier === 'string'
          ? publicUserData.identifier.toLowerCase()
          : null;
      const organizationId = await findOrCreateOrganization(sql, organizationPayload, identifier);
      const role = mapClerkRole(data.role);

      const updated = await sql`
        UPDATE users
        SET
          organization_id = ${organizationId},
          role = ${role},
          deleted_at = NULL,
          updated_at = NOW()
        WHERE clerk_user_id = ${clerkUserId}
        RETURNING id
      `;

      if (updated.length === 0 && identifier) {
        await upsertClerkUser(sql, {
          clerkUserId,
          organizationId,
          role,
          email: identifier,
          username: sanitizeSlug(identifier.split('@')[0], `user-${Date.now().toString(36)}`),
        });
      }

      await ensureTrialSubscription(sql, organizationId);
      return;
    }

    case 'organizationMembership.deleted': {
      const publicUserData = data.public_user_data as Record<string, unknown> | undefined;
      const clerkUserId =
        publicUserData && typeof publicUserData.user_id === 'string'
          ? publicUserData.user_id
          : null;
      const organizationPayload =
        data.organization && typeof data.organization === 'object'
          ? (data.organization as Record<string, unknown>)
          : null;

      if (!clerkUserId) {
        return;
      }

      const clerkOrganizationId =
        organizationPayload && typeof organizationPayload.id === 'string'
          ? organizationPayload.id
          : null;

      if (clerkOrganizationId) {
        const orgRows = await sql`
          SELECT id
          FROM organizations
          WHERE clerk_organization_id = ${clerkOrganizationId}
          LIMIT 1
        `;

        if (orgRows[0]?.id) {
          await sql`
            UPDATE users
            SET
              deleted_at = NOW(),
              updated_at = NOW()
            WHERE clerk_user_id = ${clerkUserId}
              AND organization_id = ${String(orgRows[0].id)}
          `;
          return;
        }
      }

      await sql`
        UPDATE users
        SET
          deleted_at = NOW(),
          updated_at = NOW()
        WHERE clerk_user_id = ${clerkUserId}
      `;
      return;
    }

    default:
      // Ignore unhandled events, but keep idempotency tracking.
      return;
  }
}

async function isNewClerkWebhookEvent(sql: SqlClient, eventId: string): Promise<boolean> {
  const rows = await sql`
    SELECT id
    FROM clerk_webhook_events
    WHERE id = ${eventId}
    LIMIT 1
  `;

  return rows.length === 0;
}

async function markClerkWebhookEventProcessed(
  sql: SqlClient,
  eventId: string,
  eventType: string,
): Promise<void> {
  await sql`
    INSERT INTO clerk_webhook_events (id, event_type, processed_at)
    VALUES (${eventId}, ${eventType}, NOW())
    ON CONFLICT (id) DO NOTHING
  `;
}

async function handleClerkWebhook(
  request: Request,
  env: Env,
  requestOrigin?: string,
): Promise<Response> {
  const headers: ClerkWebhookHeaders = {
    id: request.headers.get('svix-id') || '',
    timestamp: request.headers.get('svix-timestamp') || '',
    signature: request.headers.get('svix-signature') || '',
  };

  if (!headers.id || !headers.timestamp || !headers.signature) {
    return errorResponse('Missing required Svix headers', 400, env, requestOrigin);
  }

  const webhookSecret = env.CLERK_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) {
    return errorResponse('CLERK_WEBHOOK_SECRET is not configured', 500, env, requestOrigin);
  }

  const rawBody = await request.text();

  try {
    await verifyClerkSvixSignature(rawBody, headers, webhookSecret);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Signature verification failed';
    console.error('[CLERK_WEBHOOK] Signature verification failed', {
      message,
      eventId: headers.id,
    });
    return errorResponse(message, 400, env, requestOrigin);
  }

  let event: ClerkWebhookEventPayload;
  try {
    event = JSON.parse(rawBody) as ClerkWebhookEventPayload;
  } catch {
    return errorResponse('Invalid webhook payload', 400, env, requestOrigin);
  }

  const eventType = typeof event.type === 'string' ? event.type : 'unknown';

  try {
    const db = createWorkersDatabase(env);
    const isNew = await isNewClerkWebhookEvent(db.sql, headers.id);

    if (!isNew) {
      return jsonResponse({ received: true }, 200, env, requestOrigin);
    }

    await processClerkWebhookEvent(db.sql, event);
    await markClerkWebhookEventProcessed(db.sql, headers.id, eventType);

    return jsonResponse({ received: true }, 200, env, requestOrigin);
  } catch (error) {
    console.error('[CLERK_WEBHOOK] Error processing webhook event', {
      eventId: headers.id,
      eventType,
      error: error instanceof Error ? error.message : 'unknown',
    });
    return errorResponse('Error processing Clerk webhook event', 500, env, requestOrigin);
  }
}

/**
 * POST /api/auth/login
 */
async function handleLogin(request: Request, db: Database, env: Env): Promise<Response> {
  const body = (await request.json()) as { email: string; password: string };

  if (!body.email || !body.password) {
    return errorResponse('Email and password are required', 400, env);
  }

  const user = await db.findUserByEmail(body.email);

  if (!user) {
    return errorResponse('Invalid credentials', 401, env);
  }

  const validPassword = await verifyBcryptPassword(body.password, user.passwordHash);
  if (!validPassword) {
    return errorResponse('Invalid credentials', 401, env);
  }

  const token = await createToken(user.id, env);

  return jsonResponse(
    {
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    },
    200,
    env,
  );
}

/**
 * POST /api/auth/register
 */
async function handleRegister(request: Request, db: Database, env: Env): Promise<Response> {
  const body = (await request.json()) as { email: string; password: string; name: string };

  if (!body.email || !body.password || !body.name) {
    return errorResponse('Email, password, and name are required', 400, env);
  }

  const existingUser = await db.findUserByEmail(body.email);

  if (existingUser) {
    return errorResponse('Email already registered', 409, env);
  }

  const passwordHash = await hashPassword(body.password);
  const emailPrefix =
    body.email
      .split('@')[0]
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '')
      .slice(0, 24) || 'user';
  const uniqueUsername = `${emailPrefix}-${Date.now().toString(36)}`;

  const user = await db.createUser({
    email: body.email,
    passwordHash,
    name: uniqueUsername,
    role: 'user',
  });

  const token = await createToken(user.id, env);

  return jsonResponse(
    {
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    },
    201,
    env,
  );
}

/**
 * Authenticate an API request via Clerk and resolve the internal user record.
 * Returns either an authenticated context or an error Response (already with
 * CORS headers applied via errorResponse).
 *
 * The frontend now signs requests with Clerk RS256 JWTs, so the legacy
 * authenticateRequest (which expects a token signed with our local JWT_SECRET)
 * always returns null for those tokens. Repeated 401s cause the React app to
 * treat the session as expired and sign the user out, bouncing to /login
 * immediately after a successful bootstrap.
 */
async function authenticateApiRequest(
  request: Request,
  env: Env,
  db: Database,
): Promise<
  { userId: number; organizationId: string; clerkUserId: string; role: string } | Response
> {
  const requestOrigin = request.headers.get('Origin') || '';
  const clerkResult = await authenticateClerkRequest(request, env, requestOrigin);
  if (clerkResult instanceof Response) {
    return clerkResult;
  }

  const rows = await db.sql`
    SELECT id,
           organization_id as "organizationId",
           role
    FROM users
    WHERE clerk_user_id = ${clerkResult.clerkUserId}
      AND deleted_at IS NULL
    LIMIT 1
  `;
  if (!rows[0]) {
    return errorResponse('User has not completed organization bootstrap', 401, env, requestOrigin);
  }

  return {
    userId: Number(rows[0].id),
    organizationId: String(rows[0].organizationId),
    clerkUserId: clerkResult.clerkUserId,
    role: String(rows[0].role || 'team_member'),
  };
}

/**
 * GET /api/users/me
 */
async function handleGetCurrentUser(request: Request, db: Database, env: Env): Promise<Response> {
  const auth = await authenticateApiRequest(request, env, db);
  if (auth instanceof Response) {
    return auth;
  }

  const user = await db.findUserById(auth.userId);

  if (!user) {
    return errorResponse('User not found', 404, env);
  }

  return jsonResponse(
    {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      createdAt: user.createdAt,
    },
    200,
    env,
  );
}

/**
 * GET /api/products
 */
async function handleGetProducts(request: Request, db: Database, env: Env): Promise<Response> {
  const auth = await authenticateApiRequest(request, env, db);
  if (auth instanceof Response) {
    return auth;
  }

  const url = new URL(request.url);
  const search = url.searchParams.get('search') || undefined;
  const limit = parseInt(url.searchParams.get('limit') || '100', 10);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);

  const [products, total] = await Promise.all([
    db.findProducts({ search, limit, offset }),
    db.countProducts(search),
  ]);

  return jsonResponse({ products, total, limit, offset }, 200, env);
}

/**
 * GET /api/products/:id
 */
async function handleGetProduct(
  request: Request,
  db: Database,
  env: Env,
  pathname: string,
): Promise<Response> {
  const auth = await authenticateApiRequest(request, env, db);
  if (auth instanceof Response) {
    return auth;
  }

  const match = pathname.match(/\/api\/products\/(\d+)/);
  if (!match) {
    return errorResponse('Invalid product ID', 400, env);
  }

  const id = parseInt(match[1], 10);
  const product = await db.findProductById(id);

  if (!product) {
    return errorResponse('Product not found', 404, env);
  }

  return jsonResponse(product, 200, env);
}

/**
 * GET /api/inventory-items
 */
async function handleGetInventory(request: Request, db: Database, env: Env): Promise<Response> {
  const auth = await authenticateApiRequest(request, env, db);
  if (auth instanceof Response) {
    return auth;
  }

  const url = new URL(request.url);
  const limit = parseInt(url.searchParams.get('limit') || '100', 10);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);

  const [items, total] = await Promise.all([
    db.findInventoryItems({ limit, offset }),
    db.countInventoryItems(),
  ]);

  return jsonResponse({ items, total, limit, offset }, 200, env);
}

/**
 * GET /api/store-areas
 */
async function handleGetStoreAreas(request: Request, db: Database, env: Env): Promise<Response> {
  const auth = await authenticateApiRequest(request, env, db);
  if (auth instanceof Response) {
    return auth;
  }

  const areas = await db.findStoreAreas();

  return jsonResponse(areas, 200, env);
}

/**
 * GET /api/dashboard
 */
async function handleGetDashboard(request: Request, db: Database, env: Env): Promise<Response> {
  const auth = await authenticateApiRequest(request, env, db);
  if (auth instanceof Response) {
    return auth;
  }

  const stats = await db.getDashboardStats(auth.organizationId);

  return jsonResponse({ stats }, 200, env);
}

/**
 * GET /api/reports/expiry
 */
async function handleGetExpiryReport(request: Request, db: Database, env: Env): Promise<Response> {
  const auth = await authenticateApiRequest(request, env, db);
  if (auth instanceof Response) return auth;
  const report = await db.getMonthlyExpiryReport(auth.organizationId);
  return jsonResponse(report, 200, env);
}

/**
 * GET /api/reports/expiry-overall
 */
async function handleGetExpiryOverallReport(
  request: Request,
  db: Database,
  env: Env,
): Promise<Response> {
  const auth = await authenticateApiRequest(request, env, db);
  if (auth instanceof Response) return auth;
  const report = await db.getOverallExpiryReport(auth.organizationId);
  return jsonResponse(report, 200, env);
}

/**
 * GET /api/reports/expiry-details
 */
async function handleGetExpiryDetailsReport(
  request: Request,
  db: Database,
  env: Env,
): Promise<Response> {
  const auth = await authenticateApiRequest(request, env, db);
  if (auth instanceof Response) return auth;
  const report = await db.getDetailedExpiryReport(auth.organizationId);
  return jsonResponse(report, 200, env);
}

/**
 * GET /api/reports/daily-usage
 */
async function handleGetDailyUsageReport(
  request: Request,
  db: Database,
  env: Env,
): Promise<Response> {
  const auth = await authenticateApiRequest(request, env, db);
  if (auth instanceof Response) return auth;
  const report = await db.getDailyUsageReport(auth.organizationId);
  return jsonResponse(report, 200, env);
}

/**
 * GET /api/reports/items-by-user
 */
async function handleGetItemsByUserReport(
  request: Request,
  db: Database,
  env: Env,
): Promise<Response> {
  const auth = await authenticateApiRequest(request, env, db);
  if (auth instanceof Response) return auth;
  const url = new URL(request.url);
  const timeFrame = url.searchParams.get('timeFrame') || undefined;
  const report = await db.getItemsByUserReport(auth.organizationId, timeFrame);
  return jsonResponse(report, 200, env);
}

/**
 * GET /api/reports/items-by-date
 */
async function handleGetItemsByDateReport(
  request: Request,
  db: Database,
  env: Env,
): Promise<Response> {
  const auth = await authenticateApiRequest(request, env, db);
  if (auth instanceof Response) return auth;
  const report = await db.getItemsByDateReport(auth.organizationId);
  return jsonResponse(report, 200, env);
}

/**
 * GET /api/reports/loss-by-sku
 */
async function handleGetLossBySkuReport(
  request: Request,
  db: Database,
  env: Env,
): Promise<Response> {
  const auth = await authenticateApiRequest(request, env, db);
  if (auth instanceof Response) return auth;
  const report = await db.getLossBySkuReport(auth.organizationId);
  return jsonResponse(report, 200, env);
}

/**
 * GET /api/reports/sell-through
 */
async function handleGetSellThroughReport(
  request: Request,
  db: Database,
  env: Env,
): Promise<Response> {
  const auth = await authenticateApiRequest(request, env, db);
  if (auth instanceof Response) return auth;
  const report = await db.getSellThroughByMarkdownLevel(auth.organizationId);
  return jsonResponse(report, 200, env);
}

/**
 * GET /api/reports/loss-by-department
 */
async function handleGetLossByDepartmentReport(
  request: Request,
  db: Database,
  env: Env,
): Promise<Response> {
  const auth = await authenticateApiRequest(request, env, db);
  if (auth instanceof Response) return auth;
  const report = await db.getLossByDepartmentReport(auth.organizationId);
  return jsonResponse(report, 200, env);
}

/**
 * GET /api/expired-items
 */
async function handleGetExpiredItems(request: Request, db: Database, env: Env): Promise<Response> {
  const auth = await authenticateApiRequest(request, env, db);
  if (auth instanceof Response) return auth;
  const items = await db.getExpiredItems(auth.organizationId);
  return jsonResponse(items, 200, env);
}

/**
 * GET /api/products/by-barcode/:barcode
 */
async function handleGetProductByBarcode(
  request: Request,
  db: Database,
  env: Env,
  pathname: string,
): Promise<Response> {
  const auth = await authenticateApiRequest(request, env, db);
  if (auth instanceof Response) return auth;

  const match = pathname.match(/^\/api\/products\/by-barcode\/([^/]+)$/);
  if (!match) {
    return errorResponse('Invalid barcode', 400, env);
  }

  const barcode = decodeURIComponent(match[1]);
  const product = await db.findProductByBarcode(auth.organizationId, barcode);
  if (!product) {
    return errorResponse('Product not found', 404, env);
  }
  return jsonResponse(product, 200, env);
}

/**
 * GET /api/products/by-sku/:sku
 */
async function handleGetProductBySku(
  request: Request,
  db: Database,
  env: Env,
  pathname: string,
): Promise<Response> {
  const auth = await authenticateApiRequest(request, env, db);
  if (auth instanceof Response) return auth;

  const match = pathname.match(/^\/api\/products\/by-sku\/([^/]+)$/);
  if (!match) {
    return errorResponse('Invalid sku', 400, env);
  }

  const sku = decodeURIComponent(match[1]);
  const product = await db.findProductBySku(auth.organizationId, sku);
  if (!product) {
    return errorResponse('Product not found', 404, env);
  }
  return jsonResponse(product, 200, env);
}

/**
 * POST /api/products
 */
async function handleCreateProduct(request: Request, db: Database, env: Env): Promise<Response> {
  const auth = await authenticateApiRequest(request, env, db);
  if (auth instanceof Response) return auth;

  const body = (await request.json()) as {
    barcode?: string;
    sku?: string | null;
    name?: string;
    costPrice?: number;
    notes?: string;
  };

  if (!body.barcode || typeof body.barcode !== 'string') {
    return errorResponse('Missing required field: barcode', 400, env);
  }
  if (!body.name || typeof body.name !== 'string') {
    return errorResponse('Missing required field: name', 400, env);
  }

  try {
    const product = await db.createProduct(auth.organizationId, {
      barcode: body.barcode,
      sku: body.sku ?? null,
      name: body.name,
      costPrice: typeof body.costPrice === 'number' ? body.costPrice : 0,
      notes: typeof body.notes === 'string' ? body.notes : '',
    });
    return jsonResponse(product, 201, env);
  } catch (error) {
    if (isUniqueViolation(error)) {
      return errorResponse('Product with this barcode or SKU already exists', 409, env);
    }
    console.error('handleCreateProduct error:', error);
    return errorResponse('Internal server error', 500, env);
  }
}

/**
 * GET /api/inventory-items/by-barcode/:barcode
 */
async function handleGetInventoryByBarcode(
  request: Request,
  db: Database,
  env: Env,
  pathname: string,
): Promise<Response> {
  const auth = await authenticateApiRequest(request, env, db);
  if (auth instanceof Response) return auth;

  const match = pathname.match(/^\/api\/inventory-items\/by-barcode\/([^/]+)$/);
  if (!match) {
    return errorResponse('Invalid barcode', 400, env);
  }

  const barcode = decodeURIComponent(match[1]);
  const product = await db.findProductByBarcode(auth.organizationId, barcode);
  if (!product) {
    return errorResponse('Product not found', 404, env);
  }

  const items = await db.findInventoryItemsByProductId(auth.organizationId, product.id);
  return jsonResponse(items, 200, env);
}

/**
 * GET /api/inventory-items/recent/product/:productId
 */
async function handleGetRecentInventoryByProduct(
  request: Request,
  db: Database,
  env: Env,
  pathname: string,
): Promise<Response> {
  const auth = await authenticateApiRequest(request, env, db);
  if (auth instanceof Response) return auth;

  const match = pathname.match(/^\/api\/inventory-items\/recent\/product\/(\d+)$/);
  if (!match) {
    return errorResponse('Invalid product id', 400, env);
  }

  const productId = parseInt(match[1], 10);
  const url = new URL(request.url);
  const limitParam = parseInt(url.searchParams.get('limit') || '5', 10);
  const limit = !Number.isFinite(limitParam) || limitParam <= 0 ? 5 : Math.min(limitParam, 50);

  const items = await db.findRecentInventoryItemsByProductId(auth.organizationId, productId, limit);
  return jsonResponse(items, 200, env);
}

/**
 * POST /api/inventory-items
 */
async function handleCreateInventoryItem(
  request: Request,
  db: Database,
  env: Env,
): Promise<Response> {
  const auth = await authenticateApiRequest(request, env, db);
  if (auth instanceof Response) return auth;

  const body = (await request.json()) as InventoryItemRequestBody;

  // Support both camelCase and snake_case for backward compatibility
  const { productId, expiryDate, locationId } = resolveInventoryFields(body);

  // Log deprecation warnings whenever deprecated snake_case fields are present
  const deprecatedFields = getDeprecatedSnakeCaseFields(body);
  if (deprecatedFields.length > 0) {
    console.warn(
      `DEPRECATION: snake_case fields are deprecated. Please migrate: ${deprecatedFields.join(', ')}`,
    );
  }

  if (productId === undefined || !Number.isInteger(productId) || productId < 1) {
    return errorResponse('Missing or invalid productId', 400, env);
  }
  if (!expiryDate || typeof expiryDate !== 'string' || !ISO_DATE_RE.test(expiryDate)) {
    return errorResponse('Missing or invalid expiryDate (expected YYYY-MM-DD)', 400, env);
  }
  if (locationId === undefined || !Number.isInteger(locationId) || locationId < 1) {
    return errorResponse('Missing or invalid locationId', 400, env);
  }

  try {
    const item = await db.createInventoryItem(auth.organizationId, auth.userId, {
      productId,
      expiryDate,
      locationId,
      status: typeof body.status === 'string' ? body.status : undefined,
    });
    return jsonResponse(item, 201, env);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    if (message === 'Product does not exist' || message === 'Location does not exist') {
      return errorResponse(message, 400, env);
    }
    console.error('handleCreateInventoryItem error:', error);
    return errorResponse('Internal server error', 500, env);
  }
}

/**
 * PUT /api/inventory-items/:id
 */
async function handleUpdateInventoryItem(
  request: Request,
  db: Database,
  env: Env,
  pathname: string,
): Promise<Response> {
  const auth = await authenticateApiRequest(request, env, db);
  if (auth instanceof Response) return auth;

  const match = pathname.match(/^\/api\/inventory-items\/(\d+)$/);
  if (!match) {
    return errorResponse('Invalid inventory item id', 400, env);
  }
  const id = parsePositiveInt(match[1]);
  if (id === null) {
    return errorResponse('Invalid inventory item id', 400, env);
  }

  const body = (await request.json()) as {
    productId?: number;
    expiryDate?: string;
    locationId?: number;
    status?: string;
  };

  if (body.productId !== undefined && !Number.isInteger(body.productId)) {
    return errorResponse('Invalid productId', 400, env);
  }
  if (body.locationId !== undefined && !Number.isInteger(body.locationId)) {
    return errorResponse('Invalid locationId', 400, env);
  }
  if (body.expiryDate !== undefined && !ISO_DATE_RE.test(body.expiryDate)) {
    return errorResponse('Invalid expiryDate (expected YYYY-MM-DD)', 400, env);
  }

  try {
    const updated = await db.updateInventoryItem(auth.organizationId, auth.userId, id, {
      productId: body.productId,
      expiryDate: body.expiryDate,
      locationId: body.locationId,
      status: body.status,
    });
    if (!updated) {
      return errorResponse('Inventory item not found', 404, env);
    }
    return jsonResponse(updated, 200, env);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    if (message === 'Location does not exist') {
      return errorResponse(message, 400, env);
    }
    console.error('handleUpdateInventoryItem error:', error);
    return errorResponse('Internal server error', 500, env);
  }
}

/**
 * DELETE /api/inventory-items/:id
 */
async function handleDeleteInventoryItem(
  request: Request,
  db: Database,
  env: Env,
  pathname: string,
): Promise<Response> {
  const auth = await authenticateApiRequest(request, env, db);
  if (auth instanceof Response) return auth;

  const match = pathname.match(/^\/api\/inventory-items\/(\d+)$/);
  if (!match) {
    return errorResponse('Invalid inventory item id', 400, env);
  }
  const id = parsePositiveInt(match[1]);
  if (id === null) {
    return errorResponse('Invalid inventory item id', 400, env);
  }

  const deleted = await db.deleteInventoryItem(auth.organizationId, auth.userId, id);
  if (!deleted) {
    return errorResponse('Inventory item not found', 404, env);
  }
  return jsonResponse({ message: 'Inventory item deleted successfully' }, 200, env);
}

/**
 * POST /api/store-areas
 */
async function handleCreateStoreArea(request: Request, db: Database, env: Env): Promise<Response> {
  const auth = await authenticateApiRequest(request, env, db);
  if (auth instanceof Response) return auth;

  const body = (await request.json()) as {
    name?: string;
    subDepartment?: string | null;
    sub_department?: string | null;
  };

  if (!body.name || typeof body.name !== 'string' || body.name.trim().length === 0) {
    return errorResponse('Missing required field: name', 400, env);
  }

  const subDepartment =
    body.subDepartment !== undefined
      ? body.subDepartment
      : body.sub_department !== undefined
        ? body.sub_department
        : null;

  try {
    const area = await db.createStoreArea(auth.organizationId, {
      name: body.name.trim(),
      subDepartment: subDepartment ?? null,
    });
    return jsonResponse(area, 201, env);
  } catch (error) {
    if (isUniqueViolation(error)) {
      return errorResponse('Store area with this name already exists', 409, env);
    }
    console.error('handleCreateStoreArea error:', error);
    return errorResponse('Internal server error', 500, env);
  }
}

/**
 * PUT /api/store-areas/:id
 */
async function handleUpdateStoreArea(
  request: Request,
  db: Database,
  env: Env,
  pathname: string,
): Promise<Response> {
  const auth = await authenticateApiRequest(request, env, db);
  if (auth instanceof Response) return auth;

  const match = pathname.match(/^\/api\/store-areas\/(\d+)$/);
  if (!match) {
    return errorResponse('Invalid store area id', 400, env);
  }
  const id = parseInt(match[1], 10);

  const body = (await request.json()) as {
    name?: string;
    subDepartment?: string | null;
    sub_department?: string | null;
  };

  const data: { name?: string; subDepartment?: string | null } = {};
  if (typeof body.name === 'string') data.name = body.name.trim();
  if (body.subDepartment !== undefined) {
    data.subDepartment = body.subDepartment ?? null;
  } else if (body.sub_department !== undefined) {
    data.subDepartment = body.sub_department ?? null;
  }

  const updated = await db.updateStoreArea(auth.organizationId, id, data);
  if (!updated) {
    return errorResponse('Store area not found', 404, env);
  }
  return jsonResponse(updated, 200, env);
}

/**
 * DELETE /api/store-areas/:id
 */
async function handleDeleteStoreArea(
  request: Request,
  db: Database,
  env: Env,
  pathname: string,
): Promise<Response> {
  const auth = await authenticateApiRequest(request, env, db);
  if (auth instanceof Response) return auth;

  const match = pathname.match(/^\/api\/store-areas\/(\d+)$/);
  if (!match) {
    return errorResponse('Invalid store area id', 400, env);
  }
  const id = parseInt(match[1], 10);

  try {
    const deleted = await db.deleteStoreArea(auth.organizationId, id);
    if (!deleted) {
      return errorResponse('Store area not found', 404, env);
    }
    return jsonResponse({ message: 'Store area deleted successfully' }, 200, env);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    if (message.includes('in use')) {
      return errorResponse(message, 409, env);
    }
    console.error('handleDeleteStoreArea error:', error);
    return errorResponse('Internal server error', 500, env);
  }
}

/**
 * GET /api/users
 *
 * Restricted to admins (and managers in non-prod). The listing surfaces email,
 * username, role and clerkUserId for every user in the org, which is sensitive
 * enough that team_member callers must not see it.
 */
async function handleListUsers(request: Request, db: Database, env: Env): Promise<Response> {
  const auth = await authenticateApiRequest(request, env, db);
  if (auth instanceof Response) return auth;

  if (!canManageUsers(auth.role)) {
    return errorResponse('Only admins can list users', 403, env);
  }

  const users = await db.listUsers(auth.organizationId);
  return jsonResponse(users, 200, env);
}

/**
 * POST /api/users — creates a team member user record in the caller's org.
 * Signup is managed by Clerk; this endpoint exists for legacy local user
 * creation and is intentionally limited: it only allows an admin to
 * pre-provision a username/role placeholder. Clerk user linkage happens
 * later when the user signs in via Clerk and the bootstrap route links
 * the Clerk ID.
 */
async function handleCreateLegacyUser(request: Request, db: Database, env: Env): Promise<Response> {
  const auth = await authenticateApiRequest(request, env, db);
  if (auth instanceof Response) return auth;

  if (!canManageUsers(auth.role)) {
    return errorResponse('Only admins can create users', 403, env);
  }

  const body = (await request.json()) as { pin?: string; role?: string; username?: string };
  const requestedRole = typeof body.role === 'string' ? body.role : 'team_member';
  if (!isValidRole(requestedRole)) {
    return errorResponse(
      `Invalid role. Allowed: ${Array.from(getAllowedRoles(env)).join(', ')}`,
      400,
      env,
    );
  }
  const username = typeof body.username === 'string' ? body.username : null;

  try {
    // Enforce tier max_users limit before insert. Source of truth is the
    // backend TIER_LIMITS constant (MEMORY[26ef5121]); we replicate the
    // numeric cap inline here because Workers doesn't import the backend
    // module. If unset/null, treat as unlimited.
    const usageRows = await db.sql`
      SELECT
        ou.active_users::int as "activeUsers",
        ou.max_users::int as "maxUsers"
      FROM organization_usage ou
      WHERE ou.organization_id = ${auth.organizationId}
      LIMIT 1
    `;
    const usage = usageRows[0];
    if (usage && usage.maxUsers !== null && usage.activeUsers >= usage.maxUsers) {
      return errorResponse(
        `User limit reached for your subscription tier (max ${usage.maxUsers})`,
        402,
        env,
      );
    }

    const rows = await db.sql`
      INSERT INTO users (organization_id, username, role, created_at, updated_at)
      VALUES (${auth.organizationId}, ${username}, ${requestedRole}, NOW(), NOW())
      RETURNING id, email, username, role,
                clerk_user_id as "clerkUserId",
                created_at::text as "createdAt"
    `;
    return jsonResponse(rows[0], 201, env);
  } catch (error) {
    if (isUniqueViolation(error)) {
      return errorResponse('User with this username already exists', 409, env);
    }
    console.error('handleCreateLegacyUser error:', error);
    return errorResponse('Internal server error', 500, env);
  }
}

/**
 * PUT /api/users/:id — update role.
 */
async function handleUpdateUser(
  request: Request,
  db: Database,
  env: Env,
  pathname: string,
): Promise<Response> {
  const auth = await authenticateApiRequest(request, env, db);
  if (auth instanceof Response) return auth;

  if (!canManageUsers(auth.role)) {
    return errorResponse('Only admins can update users', 403, env);
  }

  const match = pathname.match(/^\/api\/users\/(\d+)$/);
  if (!match) {
    return errorResponse('Invalid user id', 400, env);
  }
  const id = parsePositiveInt(match[1]);
  if (id === null) {
    return errorResponse('Invalid user id', 400, env);
  }

  const body = (await request.json()) as { role?: string };
  if (!body.role || typeof body.role !== 'string') {
    return errorResponse('Missing required field: role', 400, env);
  }
  if (!isValidRole(body.role)) {
    return errorResponse(
      `Invalid role. Allowed: ${Array.from(getAllowedRoles(env)).join(', ')}`,
      400,
      env,
    );
  }

  const updated = await db.updateUserRole(auth.organizationId, id, body.role);
  if (!updated) {
    return errorResponse('User not found', 404, env);
  }
  return jsonResponse(updated, 200, env);
}

/**
 * PUT /api/users/:id/reset-pin — deprecated under Clerk. Returns 410 Gone with guidance.
 *
 * Authentication is required so this endpoint cannot be used as an unauthenticated
 * existence-probe for user IDs (review #1).
 */
async function handleResetUserPin(request: Request, db: Database, env: Env): Promise<Response> {
  const auth = await authenticateApiRequest(request, env, db);
  if (auth instanceof Response) return auth;

  return errorResponse(
    'PIN login is no longer supported. Use Clerk-managed password reset.',
    410,
    env,
  );
}

/**
 * DELETE /api/users/:id — soft delete.
 */
async function handleDeleteUser(
  request: Request,
  db: Database,
  env: Env,
  pathname: string,
): Promise<Response> {
  const auth = await authenticateApiRequest(request, env, db);
  if (auth instanceof Response) return auth;

  if (!canManageUsers(auth.role)) {
    return errorResponse('Only admins can delete users', 403, env);
  }

  const match = pathname.match(/^\/api\/users\/(\d+)$/);
  if (!match) {
    return errorResponse('Invalid user id', 400, env);
  }
  const id = parsePositiveInt(match[1]);
  if (id === null) {
    return errorResponse('Invalid user id', 400, env);
  }

  if (id === auth.userId) {
    return errorResponse('You cannot delete your own user record', 400, env);
  }

  // TODO(clerk-orgs): softDeleteUser only flips deleted_at locally. The
  // matching Clerk org membership is not removed, so the user can sign in
  // again and bootstrap will re-link or create a new local row. Wire this
  // into the Clerk org-membership webhook (or call the Clerk Backend SDK
  // here) before exposing this endpoint to operators. See review #12.
  const deleted = await db.softDeleteUser(auth.organizationId, id);
  if (!deleted) {
    return errorResponse('User not found', 404, env);
  }
  return jsonResponse({ message: 'User deleted successfully' }, 200, env);
}

/**
 * POST /api/expired-items/process
 */
async function handleProcessExpiredItem(
  request: Request,
  db: Database,
  env: Env,
): Promise<Response> {
  const auth = await authenticateApiRequest(request, env, db);
  if (auth instanceof Response) return auth;

  const body = (await request.json()) as {
    inventoryItemId?: number;
    action?: string;
    unitsDiscarded?: number;
  };

  if (
    !body.inventoryItemId ||
    typeof body.inventoryItemId !== 'number' ||
    body.inventoryItemId < 1
  ) {
    return errorResponse('Missing or invalid required field: inventoryItemId', 400, env);
  }

  if (!body.action || (body.action !== 'sold_through' && body.action !== 'expired')) {
    return errorResponse("Action must be either 'sold_through' or 'expired'", 400, env);
  }

  if (body.action === 'expired') {
    if (
      !body.unitsDiscarded ||
      typeof body.unitsDiscarded !== 'number' ||
      body.unitsDiscarded <= 0
    ) {
      return errorResponse(
        'Units discarded must be a positive number when marking as expired',
        400,
        env,
      );
    }
  }

  try {
    const transaction = await db.processExpiredItem(
      body.inventoryItemId,
      auth.userId,
      auth.organizationId,
      body.action,
      body.unitsDiscarded,
    );
    return jsonResponse(transaction, 201, env);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    if (message.includes('not found')) {
      return errorResponse(message, 404, env);
    }
    return errorResponse('Internal server error', 500, env);
  }
}

type TrialStatusResponse = {
  isInTrial: boolean;
  isTrialExpired: boolean;
  subscription: {
    status: 'ACTIVE' | 'TRIALING' | 'EXPIRED' | 'CANCELED';
    tierLevel: string;
    trialEndDate: string | null;
    trialStartedAt: string | null;
    trialConvertedAt: string | null;
    daysRemaining: number | null;
    billingCycle: string | null;
  } | null;
  tierLimits: {
    maxUsers: number;
    maxProducts: number;
    maxStoreAreas: number;
    features: string[];
  };
};

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

const SUBSCRIPTION_TIER_LIMITS: Record<
  string,
  { maxUsers: number; maxProducts: number; maxStoreAreas: number; features: string[] }
> = {
  free: {
    maxUsers: 1,
    maxProducts: 500,
    maxStoreAreas: 3,
    features: ['Basic scanning', 'Expiry tracking', 'Basic reports'],
  },
  starter: {
    maxUsers: 3,
    maxProducts: 5000,
    maxStoreAreas: 20,
    features: ['Basic scanning', 'Expiry tracking', 'CSV uploads', 'Team management'],
  },
  professional: {
    maxUsers: 10,
    maxProducts: 50000,
    maxStoreAreas: 100,
    features: [
      'Advanced scanning',
      'Expiry tracking',
      'All reports',
      'CSV uploads',
      'Team management',
      'Organization invites',
    ],
  },
  premium: {
    maxUsers: 10,
    maxProducts: 50000,
    maxStoreAreas: 100,
    features: [
      'All professional features',
      'Priority support',
      'Custom integrations',
      'API access',
    ],
  },
  concierge: {
    maxUsers: 10,
    maxProducts: 250000,
    maxStoreAreas: 100,
    features: ['Enterprise fair-use access', 'Dedicated support', 'Custom development'],
  },
  enterprise: {
    maxUsers: 10,
    maxProducts: 250000,
    maxStoreAreas: 100,
    features: ['Enterprise fair-use access', 'Dedicated support', 'Custom development'],
  },
};

/**
 * GET /api/subscription/trial-status
 */
async function handleGetTrialStatus(request: Request, db: Database, env: Env): Promise<Response> {
  const auth = await authenticateApiRequest(request, env, db);
  if (auth instanceof Response) {
    return auth;
  }

  const organizationId = auth.organizationId;

  const subscriptionRows = await db.sql`
    SELECT
      status,
      tier_level,
      trial_end_date,
      trial_started_at,
      trial_converted_at,
      billing_cycle
    FROM subscription_tiers
    WHERE organization_id = ${organizationId}
    ORDER BY created_at DESC
    LIMIT 1
  `;

  const subscription = subscriptionRows[0] as
    | {
      status?: string;
      tier_level?: string;
      trial_end_date?: string | null;
      trial_started_at?: string | null;
      trial_converted_at?: string | null;
      billing_cycle?: string | null;
    }
    | undefined;

  let daysRemaining: number | null = null;
  let isTrialExpired = false;

  const subscriptionStatusRaw = (subscription?.status || 'EXPIRED').toUpperCase();
  const normalizedStatus: 'ACTIVE' | 'TRIALING' | 'EXPIRED' | 'CANCELED' =
    subscriptionStatusRaw === 'ACTIVE' ||
      subscriptionStatusRaw === 'TRIALING' ||
      subscriptionStatusRaw === 'CANCELED'
      ? subscriptionStatusRaw
      : 'EXPIRED';

  if (normalizedStatus === 'TRIALING' && subscription?.trial_end_date) {
    const trialEnd = new Date(subscription.trial_end_date);
    const diffTime = trialEnd.getTime() - Date.now();
    isTrialExpired = diffTime <= 0;
    daysRemaining = Math.max(0, Math.ceil(diffTime / MILLISECONDS_PER_DAY));
  }

  const normalizedTierKey = normalizeLaunchTier(subscription?.tier_level);
  const tierKey = Object.prototype.hasOwnProperty.call(SUBSCRIPTION_TIER_LIMITS, normalizedTierKey)
    ? normalizedTierKey
    : 'free';
  const tierLimits = SUBSCRIPTION_TIER_LIMITS[tierKey];

  const response: TrialStatusResponse = {
    isInTrial: normalizedStatus === 'TRIALING' && !isTrialExpired,
    isTrialExpired: normalizedStatus === 'TRIALING' && isTrialExpired,
    subscription: subscription
      ? {
        status: normalizedStatus,
        tierLevel: normalizedTierKey,
        trialEndDate: subscription.trial_end_date || null,
        trialStartedAt: subscription.trial_started_at || null,
        trialConvertedAt: subscription.trial_converted_at || null,
        daysRemaining,
        billingCycle: subscription.billing_cycle || null,
      }
      : null,
    tierLimits,
  };

  return jsonResponse(response, 200, env);
}

/**
 * POST /upload/initiate and /api/upload/initiate
 */
export async function handleUploadInitiate(
  request: Request,
  env: Env,
  uploadRouteBase: '/upload' | '/api/upload',
  db: Database,
): Promise<Response> {
  const auth = await authenticateApiRequest(request, env, db);
  if (auth instanceof Response) {
    return auth;
  }

  const body = (await request.json()) as {
    filename?: string;
    fileSize?: number;
    contentType?: string;
    importType?: string;
  };

  if (!body.filename || typeof body.fileSize !== 'number' || !body.contentType) {
    return errorResponse('Missing required fields: filename, fileSize, contentType', 400, env);
  }

  const queueEnabled = env.CATALOGUE_QUEUE_ENABLED === 'true';
  const tier = queueEnabled ? await getOrganizationLaunchTier(auth.organizationId, db) : 'free';
  const maxFileSize = queueEnabled ? getTierFileSizeLimit(tier, env) : STANDARD_MAX_FILE_SIZE;
  if (body.fileSize > maxFileSize) {
    return errorResponse(`File size exceeds maximum limit of ${maxFileSize} bytes`, 400, env);
  }

  const key = `uploads/user-${auth.userId}/${Date.now()}-${body.filename}`;

  if (body.fileSize > DIRECT_UPLOAD_THRESHOLD_BYTES) {
    const uploadToken = await createUploadToken(auth.userId, key, maxFileSize, env);
    const requestUrl = new URL(request.url);
    const uploadUrl = `${requestUrl.origin}${uploadRouteBase}/presigned/${encodeURIComponent(key)}?token=${encodeURIComponent(uploadToken)}`;

    return jsonResponse(
      {
        strategy: 'presigned',
        uploadUrl,
        method: 'PUT',
        key,
      },
      200,
      env,
    );
  }

  return jsonResponse(
    {
      strategy: 'direct',
      uploadUrl: `${uploadRouteBase}/direct/${encodeURIComponent(key)}?importType=${encodeURIComponent(
        body.importType === 'expiry-list' ? 'expiry-list' : 'product-catalog',
      )}`,
      method: 'POST',
      key,
    },
    200,
    env,
  );
}

/**
 * PUT /upload/presigned/:key and /api/upload/presigned/:key
 */
async function handleUploadPresigned(
  request: Request,
  env: Env,
  key: string,
  uploadToken: string | null,
): Promise<Response> {
  if (!uploadToken) {
    return errorResponse('Missing upload token', 401, env);
  }

  const uploadContext = await verifyUploadToken(uploadToken, key, env);
  if (!uploadContext) {
    return errorResponse('Invalid or expired upload token', 403, env);
  }

  if (!key.startsWith(`uploads/user-${uploadContext.userId}/`)) {
    return errorResponse('Access denied: Upload key does not belong to token user', 403, env);
  }

  const maxFileSize = uploadContext.maxFileSize;
  const contentLengthHeader = request.headers.get('Content-Length');
  if (contentLengthHeader) {
    const contentLength = parseInt(contentLengthHeader, 10);
    if (!Number.isNaN(contentLength) && contentLength > maxFileSize) {
      return errorResponse(`File size exceeds maximum limit of ${maxFileSize} bytes`, 400, env);
    }
  }

  const data = await request.arrayBuffer();
  if (data.byteLength === 0) {
    return errorResponse('Empty upload body', 400, env);
  }

  if (data.byteLength > maxFileSize) {
    return errorResponse(`File size exceeds maximum limit of ${maxFileSize} bytes`, 400, env);
  }

  const contentType = request.headers.get('Content-Type') || 'application/octet-stream';
  await env.CSV_UPLOADS.put(key, data, {
    httpMetadata: {
      contentType,
    },
  });

  return jsonResponse({ message: 'File uploaded', key }, 200, env);
}

/**
 * POST /upload/direct/:key and /api/upload/direct/:key
 */
export async function handleUploadDirect(
  request: Request,
  env: Env,
  key: string,
  db: Database,
): Promise<Response> {
  const auth = await authenticateApiRequest(request, env, db);
  if (auth instanceof Response) {
    return auth;
  }

  // Verify the key belongs to the authenticated user
  if (!key.startsWith(`uploads/user-${auth.userId}/`)) {
    return errorResponse('Access denied: Upload key does not belong to this user', 403, env);
  }

  const formData = await request.formData();
  const fileValue = formData.get('file') as unknown;
  const requestedImportType =
    new URL(request.url).searchParams.get('importType') || String(formData.get('importType') || '');

  if (!(fileValue instanceof File)) {
    return errorResponse('No file uploaded', 400, env);
  }

  // Re-validate file size and content type
  const queueEnabled = env.CATALOGUE_QUEUE_ENABLED === 'true';
  const tier = queueEnabled ? await getOrganizationLaunchTier(auth.organizationId, db) : 'free';
  const maxFileSize = queueEnabled ? getTierFileSizeLimit(tier, env) : STANDARD_MAX_FILE_SIZE;
  if (fileValue.size > maxFileSize) {
    return errorResponse(`File size exceeds maximum limit of ${maxFileSize} bytes`, 400, env);
  }

  const fileType = fileValue.type.toLowerCase();
  const isCsvFileName = fileValue.name.toLowerCase().endsWith('.csv');
  if (fileType && !fileType.includes('csv') && !fileType.includes('text') && !isCsvFileName) {
    return errorResponse('Invalid file type. Only CSV files are allowed.', 400, env);
  }

  const data = await fileValue.arrayBuffer();

  if (queueEnabled && requestedImportType !== 'expiry-list') {
    if (!env.CATALOGUE_IMPORT_QUEUE) {
      return errorResponse('Catalogue import queue is not configured', 503, env);
    }

    await env.CSV_UPLOADS.put(key, data, {
      httpMetadata: { contentType: fileValue.type || 'text/csv' },
    });

    const uploadId = await createQueuedCatalogueUpload({
      db,
      organizationId: auth.organizationId,
      userId: auth.userId,
      key,
      fileName: fileValue.name,
      fileSize: fileValue.size,
      contentType: fileValue.type || 'text/csv',
      tier,
      env,
    });
    if (uploadId === null) {
      await env.CSV_UPLOADS.delete(key);
      return errorResponse(
        'An active catalogue import already exists for this organization',
        409,
        env,
      );
    }

    const queued = await enqueueCatalogueImport(env, db, uploadId);
    if (!queued) {
      try {
        await env.CSV_UPLOADS.delete(key);
      } catch (cleanupError) {
        Sentry.captureException(cleanupError, {
          tags: { feature: 'catalogue-import', action: 'enqueue-direct-cleanup' },
          extra: { uploadId, key },
        });
      }
      return errorResponse('Catalogue import queue is temporarily unavailable', 503, env);
    }

    return jsonResponse(
      {
        message: 'Catalogue upload queued',
        key,
        uploadId,
        status: 'queued',
        progress: 0,
      },
      202,
      env,
    );
  }

  const processingSummary = await processProductCatalogUpload(data, auth.organizationId, db);

  await env.CSV_UPLOADS.put(key, data, {
    httpMetadata: {
      contentType: fileValue.type || 'text/csv',
    },
    customMetadata: serializeUploadProcessingSummary(processingSummary),
  });

  return jsonResponse(
    {
      message: 'File uploaded and processing started',
      key,
      ...processingSummary,
    },
    200,
    env,
  );
}

/**
 * POST /upload/complete and /api/upload/complete
 */
export async function handleUploadComplete(
  request: Request,
  env: Env,
  db: Database,
): Promise<Response> {
  const auth = await authenticateApiRequest(request, env, db);
  if (auth instanceof Response) {
    return auth;
  }

  const body = await parseUploadCompleteBody(request);
  if (!body.key) {
    return errorResponse('Missing required field: key', 400, env);
  }

  if (!userOwnsUploadKey(body.key, auth.userId)) {
    return errorResponse('Access denied: Upload key does not belong to this user', 403, env);
  }

  const object = await env.CSV_UPLOADS.head(body.key);
  if (!object) {
    return errorResponse('Upload not found', 404, env);
  }

  if (env.CATALOGUE_QUEUE_ENABLED === 'true' && body.importType !== 'expiry-list') {
    return queueCompletedCatalogueUpload({
      env,
      db,
      key: body.key,
      object,
      organizationId: auth.organizationId,
      userId: auth.userId,
      deps: {
        getOrganizationLaunchTier,
        createQueuedCatalogueUpload,
        enqueueCatalogueImport,
      },
    });
  }

  return processCompletedUploadSync({
    env,
    db,
    key: body.key,
    organizationId: auth.organizationId,
    deps: { processStoredUpload },
  });
}

/**
 * GET /upload/status/:key and /api/upload/status/:key
 */
export async function handleUploadStatus(
  request: Request,
  env: Env,
  key: string,
  db: Database,
): Promise<Response> {
  const auth = await authenticateApiRequest(request, env, db);
  if (auth instanceof Response) {
    return auth;
  }

  if (!key.startsWith(`uploads/user-${auth.userId}/`)) {
    return errorResponse('Access denied: Upload key does not belong to this user', 403, env);
  }

  if (env.CATALOGUE_QUEUE_ENABLED === 'true') {
    const rows = await db.sql`
      SELECT id,
             status,
             upload_progress as progress,
             rows_processed as "rowsProcessed",
             rows_total as "rowsTotal",
             rows_imported as "importedCount",
             rows_updated as "updatedCount",
             rows_unchanged as "unchangedCount",
             rows_skipped as "skippedCount",
             row_error_count as "errorCount",
             processing_message as message,
             failure_category as "failureCategory",
             row_errors as errors,
             error_report_key as "errorReportKey"
      FROM uploads
      WHERE file_key = ${key} AND organization_id = ${auth.organizationId}
      LIMIT 1
    `;
    const job = rows[0];
    // Only queued catalogue imports have an `uploads` row. Synchronous uploads
    // (e.g. expiry-list) store their result in R2 custom metadata and have no
    // row here, so fall through to the R2 metadata path instead of 404ing.
    if (job) {
      let errors: unknown[] = [];
      try {
        errors = typeof job.errors === 'string' ? JSON.parse(job.errors) : [];
      } catch {
        errors = [];
      }
      return jsonResponse(
        {
          ...job,
          key,
          errors,
          errorReportUrl: job.errorReportKey
            ? `/api/upload/error-report/${encodeURIComponent(key)}`
            : null,
        },
        200,
        env,
      );
    }
  }

  const object = await env.CSV_UPLOADS.head(key);
  if (!object) {
    return errorResponse('Upload not found', 404, env);
  }

  const processingSummary = parseUploadProcessingSummary(object.customMetadata);

  return jsonResponse(
    {
      status: 'complete',
      progress: 100,
      message: 'File uploaded and processed successfully',
      key,
      ...processingSummary,
    },
    200,
    env,
  );
}

export async function handleUploadErrorReport(
  request: Request,
  env: Env,
  key: string,
  db: Database,
): Promise<Response> {
  const auth = await authenticateApiRequest(request, env, db);
  if (auth instanceof Response) return auth;
  const rows = await db.sql`
    SELECT id, error_report_key as "errorReportKey"
    FROM uploads
    WHERE file_key = ${key} AND organization_id = ${auth.organizationId}
    LIMIT 1
  `;
  const reportKey = rows[0]?.errorReportKey;
  if (!reportKey) return errorResponse('Error report not found', 404, env);
  const report = await env.CSV_UPLOADS.get(String(reportKey));
  if (!report) return errorResponse('Error report not found', 404, env);
  return new Response(report.body, {
    status: 200,
    headers: {
      'Content-Type': report.httpMetadata?.contentType || 'application/json',
      'Content-Disposition': `attachment; filename="catalogue-import-${encodeURIComponent(String(rows[0]?.id || 'errors'))}.json"`,
      ...getCorsHeaders(env, request.headers.get('Origin') || ''),
    },
  });
}

export { handleLogin, handleRegister };

type UploadProcessingSummary = {
  rowsProcessed: number;
  rowsTotal: number;
  importedCount: number;
  updatedCount: number;
  skippedCount: number;
  errorCount: number;
  errors: string[];
};

type LaunchTier = 'free' | 'starter' | 'professional' | 'enterprise';

const LAUNCH_TIER_LIMITS: Record<LaunchTier, { maxSkus: number; maxActiveExpiries: number }> = {
  free: { maxSkus: 500, maxActiveExpiries: 500 },
  starter: { maxSkus: 5000, maxActiveExpiries: 5000 },
  professional: { maxSkus: 50000, maxActiveExpiries: 50000 },
  enterprise: { maxSkus: 250000, maxActiveExpiries: 250000 },
};

function normalizeLaunchTier(value: unknown): LaunchTier {
  const tier = String(value || '')
    .trim()
    .toLowerCase();
  if (tier === 'free') return 'free';
  if (tier === 'starter') return 'starter';
  if (tier === 'professional') return 'professional';
  if (tier === 'enterprise') return 'enterprise';
  if (tier === 'premium') return 'professional';
  if (tier === 'concierge') return 'enterprise';
  return 'free';
}

async function getOrganizationLaunchTier(
  organizationId: string,
  db: Database,
): Promise<LaunchTier> {
  const rows = await db.sql`
    SELECT tier_level
    FROM subscription_tiers
    WHERE organization_id = ${organizationId}
    ORDER BY created_at DESC
    LIMIT 1
  `;
  return normalizeLaunchTier(rows[0]?.tier_level);
}

// Parse a positive-integer env override, falling back to `fallback` when the value
// is missing, non-numeric, NaN, or non-positive. Without this guard a misconfigured
// ENTERPRISE_* var would yield NaN and silently fail every enterprise import
// (e.g. `count <= NaN` is always false).
function parsePositiveIntEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function getTierFileSizeLimit(tier: LaunchTier, env: Env): number {
  if (tier === 'enterprise') {
    const configured = parsePositiveIntEnv(env.ENTERPRISE_MAX_FILE_SIZE, 100 * 1024 * 1024);
    return Math.min(Math.max(configured, STANDARD_MAX_FILE_SIZE), 100 * 1024 * 1024);
  }
  return STANDARD_MAX_FILE_SIZE;
}

async function createQueuedCatalogueUpload(input: {
  db: Database;
  organizationId: string;
  userId: number;
  key: string;
  fileName: string;
  fileSize: number;
  contentType: string;
  tier: LaunchTier;
  env: Env;
}): Promise<number | null> {
  const tierLimits = LAUNCH_TIER_LIMITS[input.tier];
  const maxSkus =
    input.tier === 'enterprise'
      ? parsePositiveIntEnv(input.env.ENTERPRISE_MAX_SKUS, tierLimits.maxSkus)
      : tierLimits.maxSkus;
  const maxActiveExpiries =
    input.tier === 'enterprise'
      ? parsePositiveIntEnv(input.env.ENTERPRISE_MAX_ACTIVE_EXPIRIES, tierLimits.maxActiveExpiries)
      : tierLimits.maxActiveExpiries;
  try {
    const rows = await input.db.sql`
      INSERT INTO uploads (
        organization_id, user_id, file_key, file_name, file_size_bytes, content_type,
        import_type, tier_snapshot, max_skus_snapshot, max_active_expiries_snapshot,
        status, upload_progress, processing_message, processing_offset, created_at, updated_at
      )
      SELECT ${input.organizationId}, ${input.userId}, ${input.key}, ${input.fileName},
             ${input.fileSize}, ${input.contentType}, 'product-catalog', ${input.tier},
             ${maxSkus}, ${maxActiveExpiries}, 'pending', 0, 'Preparing catalogue import', 0, NOW(), NOW()
      WHERE NOT EXISTS (
        SELECT 1 FROM uploads
        WHERE organization_id = ${input.organizationId}
          AND import_type = 'product-catalog'
          AND status IN ('pending', 'queued', 'validating', 'processing')
      )
      RETURNING id
    `;
    return rows[0]?.id ? Number(rows[0].id) : null;
  } catch (error) {
    if (error instanceof Error && /unique|duplicate|23505/i.test(error.message)) return null;
    throw error;
  }
}

type CatalogueImportJob = {
  id: number;
  organizationId: string;
  fileKey: string;
  status: string;
  processingOffset: number;
  maxSkusSnapshot: number;
  importedCount: number;
  updatedCount: number;
  unchangedCount: number;
  skippedCount: number;
  errorCount: number;
};

export async function processCatalogueImportJob(
  uploadId: number,
  env: Env,
  db: Database,
): Promise<void> {
  const rows = await db.sql`
    SELECT id, organization_id as "organizationId", file_key as "fileKey", status,
           processing_offset as "processingOffset", max_skus_snapshot as "maxSkusSnapshot",
           rows_imported as "importedCount", rows_updated as "updatedCount",
           rows_unchanged as "unchangedCount", rows_skipped as "skippedCount",
           row_error_count as "errorCount"
    FROM uploads WHERE id = ${uploadId} LIMIT 1
  `;
  const job = rows[0] as CatalogueImportJob | undefined;
  if (!job || ['completed', 'completed_with_errors', 'failed'].includes(job.status)) return;

  const object = await env.CSV_UPLOADS.get(job.fileKey);
  if (!object) {
    await failCatalogueImport(
      db,
      uploadId,
      'source_missing',
      'Uploaded source file is unavailable',
    );
    return;
  }

  try {
    const records = parseCsvRecords(new TextDecoder().decode(await object.arrayBuffer()));
    await db.sql`
      UPDATE uploads SET status = 'validating', processing_message = 'Validating catalogue',
             validation_started_at = COALESCE(validation_started_at, NOW()), updated_at = NOW()
      WHERE id = ${uploadId}
    `;
    const validation = validateCatalogueRecords(records);
    const initialValidationErrorCount = validation.rowErrors.length;
    if (validation.fatalErrors.length > 0) {
      await completeCatalogueWithErrors(db, env, job, validation.fatalErrors, 'validation');
      return;
    }

    const startOffset = Number(job.processingOffset || 0);
    // Identifier-only projection of the rows. The quota and conflict queries only read
    // sku/barcode, so serializing the full rows (incl. name/costPrice) into jsonb wastes
    // payload and Worker memory on large catalogues. NOTE: the whole source is still
    // buffered and parsed in memory (no true streaming yet), so the tier file-size caps
    // are the practical ceiling here.
    const identifierRows = validation.rows.map((row) => ({
      rowNumber: row.rowNumber,
      sku: row.sku,
      barcode: row.barcode,
    }));
    const serializedIdentifierRows = JSON.stringify(identifierRows);

    // Enforce the post-import SKU quota only on the first pass. On checkpoint resumes
    // (offset > 0) the quota was already enforced, and recomputing it against products
    // mutated by earlier checkpoints would be both wasteful and a TOCTOU drift.
    if (startOffset === 0) {
      const projectedRows = await db.sql`
        WITH input AS (
          SELECT DISTINCT sku, barcode
          FROM jsonb_to_recordset(${serializedIdentifierRows}::jsonb)
            AS x(sku text, barcode text)
        ), projected AS (
          SELECT p.sku
          FROM products p
          WHERE p.organization_id = ${job.organizationId}
            AND NOT EXISTS (
              SELECT 1 FROM input i WHERE i.sku = p.sku OR i.barcode = p.barcode
            )
          UNION
          SELECT sku FROM input
        )
        SELECT COUNT(*)::int AS count FROM projected
      `;
      const projectedCount = Number(projectedRows[0]?.count || 0);
      if (!isCatalogueWithinLimit(projectedCount, Number(job.maxSkusSnapshot))) {
        await failCatalogueImport(
          db,
          uploadId,
          'quota',
          `Catalogue would contain ${projectedCount} SKUs, exceeding the ${job.maxSkusSnapshot} SKU limit`,
        );
        return;
      }
    }

    await db.sql`
      UPDATE uploads SET status = 'processing', rows_total = ${validation.totalRows},
             rows_processed = CASE WHEN processing_offset = 0 THEN ${initialValidationErrorCount} ELSE rows_processed END,
             rows_skipped = CASE WHEN processing_offset = 0 THEN ${initialValidationErrorCount} ELSE rows_skipped END,
             row_error_count = CASE WHEN processing_offset = 0 THEN ${initialValidationErrorCount} ELSE row_error_count END,
             processing_message = 'Importing catalogue', processing_started_at = COALESCE(processing_started_at, NOW()),
             row_errors = ${JSON.stringify(validation.rowErrors.slice(0, 100))}, updated_at = NOW()
      WHERE id = ${uploadId}
    `;

    let offset = startOffset;
    const checkpointEnd = Math.min(validation.rows.length, offset + MAX_ROWS_PER_CHECKPOINT);
    while (offset < checkpointEnd) {
      const batchRows = takeImportBatch(validation.rows, offset, checkpointEnd);
      const nextOffset = offset + batchRows.length;
      const outcome = await upsertProductBatch(db, job.organizationId, batchRows, {
        uploadId,
        nextOffset,
        totalRows: validation.totalRows,
        validationErrorCount: initialValidationErrorCount,
      });
      offset = nextOffset;
      validation.rowErrors.push(...outcome.errors);
    }

    if (offset < validation.rows.length) {
      await env.CATALOGUE_IMPORT_QUEUE?.send({ uploadId });
      return;
    }

    const finalRows = await db.sql`
      SELECT rows_skipped as skipped, row_error_count as errors FROM uploads WHERE id = ${uploadId}
    `;
    const hasErrors = Number(finalRows[0]?.errors || 0) > 0;
    const conflictErrors = await findIdentifierConflictErrors(
      db,
      job.organizationId,
      serializedIdentifierRows,
    );
    const finalErrors = Array.from(new Set([...validation.rowErrors, ...conflictErrors]));
    const reportKey = finalErrors.length > 0 ? `upload-errors/${uploadId}.json` : null;
    if (reportKey) {
      await env.CSV_UPLOADS.put(reportKey, JSON.stringify(finalErrors), {
        httpMetadata: { contentType: 'application/json' },
      });
    }
    await db.sql`
      UPDATE uploads SET status = ${hasErrors ? 'completed_with_errors' : 'completed'},
             upload_progress = 100, processing_message = ${hasErrors ? 'Import completed with row errors' : 'Import completed'},
             row_errors = ${JSON.stringify(finalErrors.slice(0, 100))},
             error_report_key = ${reportKey}, completed_at = NOW(), updated_at = NOW()
      WHERE id = ${uploadId}
    `;
  } catch (error) {
    await db.sql`
      UPDATE uploads SET retry_count = retry_count + 1, failure_category = 'processing',
             error_message = 'Catalogue processing failed and will be retried', updated_at = NOW()
      WHERE id = ${uploadId}
    `;
    throw error;
  }
}

async function upsertProductBatch(
  db: Database,
  organizationId: string,
  rows: ValidatedCatalogueRow[],
  checkpoint: {
    uploadId: number;
    nextOffset: number;
    totalRows: number;
    validationErrorCount: number;
  },
): Promise<{
  importedCount: number;
  updatedCount: number;
  unchangedCount: number;
  rejectedCount: number;
  errors: string[];
}> {
  const result = await db.sql`
    WITH input AS (
      SELECT * FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb)
        AS x("rowNumber" int, sku text, name text, barcode text, "costPrice" double precision)
    ), matched AS (
      SELECT i.*, sku_match.id AS sku_id, barcode_match.id AS barcode_id
      FROM input i
      LEFT JOIN products sku_match ON sku_match.organization_id = ${organizationId} AND sku_match.sku = i.sku
      LEFT JOIN products barcode_match ON barcode_match.organization_id = ${organizationId} AND barcode_match.barcode = i.barcode
    ), classified_base AS (
      SELECT *,
             (sku_id IS NOT NULL AND barcode_id IS NOT NULL AND sku_id <> barcode_id) AS id_conflict,
             COALESCE(sku_id, barcode_id) AS product_id
      FROM matched
    ), classified AS (
      -- Reject a row when its sku and barcode resolve to two different existing
      -- products (id_conflict), AND when two or more input rows resolve to the same
      -- existing product (shared_target) -- otherwise UPDATE ... FROM would target
      -- that product from multiple rows nondeterministically and corrupt the counts.
      SELECT *,
             (
               id_conflict
               OR (
                 product_id IS NOT NULL
                 AND COUNT(*) FILTER (WHERE NOT id_conflict)
                       OVER (PARTITION BY product_id) > 1
               )
             ) AS conflict
      FROM classified_base
    ), updated AS (
      UPDATE products p SET sku = c.sku, barcode = c.barcode, name = c.name,
             cost_price = c."costPrice", updated_at = NOW()
      FROM classified c
      WHERE NOT c.conflict AND c.product_id = p.id
        AND (p.sku IS DISTINCT FROM c.sku OR p.barcode IS DISTINCT FROM c.barcode
          OR p.name IS DISTINCT FROM c.name OR p.cost_price IS DISTINCT FROM c."costPrice")
      RETURNING p.id
    ), inserted AS (
      INSERT INTO products (organization_id, sku, barcode, name, cost_price, notes, created_at, updated_at)
      SELECT ${organizationId}, c.sku, c.barcode, c.name, c."costPrice", '', NOW(), NOW()
      FROM classified c WHERE NOT c.conflict AND c.product_id IS NULL
      RETURNING id
    ), counts AS (
      SELECT (SELECT COUNT(*) FROM inserted)::int AS inserted,
             (SELECT COUNT(*) FROM updated)::int AS updated,
             (SELECT COUNT(*) FROM classified WHERE conflict)::int AS rejected,
             (SELECT COUNT(*) FROM classified)::int -
               (SELECT COUNT(*) FROM inserted) - (SELECT COUNT(*) FROM updated) -
               (SELECT COUNT(*) FROM classified WHERE conflict) AS unchanged,
             COALESCE((SELECT json_agg(json_build_object('rowNumber', "rowNumber",
               'reason', CASE WHEN id_conflict THEN 'identifier' ELSE 'shared_target' END))
               FROM classified WHERE conflict), '[]'::json) AS conflicts
    ), checkpoint AS (
      UPDATE uploads u
      SET processing_offset = ${checkpoint.nextOffset},
          rows_processed = ${checkpoint.nextOffset + checkpoint.validationErrorCount},
          rows_imported = u.rows_imported + counts.inserted,
          rows_updated = u.rows_updated + counts.updated,
          rows_unchanged = u.rows_unchanged + counts.unchanged,
          rows_skipped = u.rows_skipped + counts.rejected,
          row_error_count = u.row_error_count + counts.rejected,
          upload_progress = ${Math.floor(
    ((checkpoint.nextOffset + checkpoint.validationErrorCount) / checkpoint.totalRows) *
    100,
  )},
          processing_message = ${`Imported ${checkpoint.nextOffset} catalogue rows`},
          updated_at = NOW()
      FROM counts
      WHERE u.id = ${checkpoint.uploadId}
      RETURNING counts.inserted, counts.updated, counts.rejected, counts.unchanged, counts.conflicts
    )
    SELECT * FROM checkpoint
  `;
  const summary = result[0] || {};
  const conflicts = Array.isArray(summary.conflicts) ? summary.conflicts : [];
  return {
    importedCount: Number(summary.inserted || 0),
    updatedCount: Number(summary.updated || 0),
    unchangedCount: Number(summary.unchanged || 0),
    rejectedCount: Number(summary.rejected || 0),
    errors: conflicts.map((conflict: { rowNumber?: number; reason?: string }) =>
      conflict.reason === 'shared_target'
        ? `Row ${conflict.rowNumber || '?'}: multiple rows match the same existing product`
        : `Row ${conflict.rowNumber || '?'}: SKU and barcode identify different existing products`,
    ),
  };
}

async function findIdentifierConflictErrors(
  db: Database,
  organizationId: string,
  serializedIdentifierRows: string,
): Promise<string[]> {
  if (!serializedIdentifierRows || serializedIdentifierRows === '[]') return [];
  const result = await db.sql`
    WITH input AS (
      SELECT * FROM jsonb_to_recordset(${serializedIdentifierRows}::jsonb)
        AS x("rowNumber" int, sku text, barcode text)
    )
    SELECT i."rowNumber" as "rowNumber"
    FROM input i
    JOIN products sku_match
      ON sku_match.organization_id = ${organizationId} AND sku_match.sku = i.sku
    JOIN products barcode_match
      ON barcode_match.organization_id = ${organizationId} AND barcode_match.barcode = i.barcode
    WHERE sku_match.id <> barcode_match.id
    ORDER BY i."rowNumber"
  `;
  return result.map(
    (row) => `Row ${Number(row.rowNumber)}: SKU and barcode identify different existing products`,
  );
}

async function failCatalogueImport(
  db: Database,
  uploadId: number,
  category: string,
  message: string,
): Promise<void> {
  await db.sql`
    UPDATE uploads SET status = 'failed', failure_category = ${category}, error_message = ${message},
           processing_message = ${message}, failed_at = NOW(), updated_at = NOW()
    WHERE id = ${uploadId}
  `;
}

async function enqueueCatalogueImport(env: Env, db: Database, uploadId: number): Promise<boolean> {
  try {
    await env.CATALOGUE_IMPORT_QUEUE?.send({ uploadId });
    await db.sql`
      UPDATE uploads
      SET status = 'queued', processing_message = 'Queued for validation', queued_at = NOW(), updated_at = NOW()
      WHERE id = ${uploadId}
    `;
    return true;
  } catch (error) {
    Sentry.captureException(error, {
      tags: { feature: 'catalogue-import', action: 'enqueue' },
      extra: { uploadId },
    });
    try {
      await failCatalogueImport(
        db,
        uploadId,
        'enqueue',
        'Catalogue import could not be queued',
      );
    } catch (failureUpdateError) {
      Sentry.captureException(failureUpdateError, {
        tags: { feature: 'catalogue-import', action: 'enqueue-fail-update' },
        extra: { uploadId },
      });
    }
    return false;
  }
}

async function completeCatalogueWithErrors(
  db: Database,
  env: Env,
  job: CatalogueImportJob,
  errors: string[],
  category: string,
): Promise<void> {
  const reportKey = `upload-errors/${job.id}.json`;
  await env.CSV_UPLOADS.put(reportKey, JSON.stringify(errors), {
    httpMetadata: { contentType: 'application/json' },
  });
  await db.sql`
    UPDATE uploads SET status = 'failed', failure_category = ${category},
           error_message = ${errors[0]}, processing_message = ${errors[0]},
           row_error_count = ${errors.length}, row_errors = ${JSON.stringify(errors.slice(0, 100))},
           error_report_key = ${reportKey}, failed_at = NOW(), updated_at = NOW()
    WHERE id = ${job.id}
  `;
}

function emptyUploadProcessingSummary(): UploadProcessingSummary {
  return {
    rowsProcessed: 0,
    rowsTotal: 0,
    importedCount: 0,
    updatedCount: 0,
    skippedCount: 0,
    errorCount: 0,
    errors: [],
  };
}

function serializeUploadProcessingSummary(
  summary: UploadProcessingSummary,
): Record<string, string> {
  return {
    rowsProcessed: String(summary.rowsProcessed),
    rowsTotal: String(summary.rowsTotal),
    importedCount: String(summary.importedCount),
    updatedCount: String(summary.updatedCount),
    skippedCount: String(summary.skippedCount),
    errorCount: String(summary.errorCount),
    errors: JSON.stringify(summary.errors),
  };
}

function parseUploadProcessingSummary(
  customMetadata?: Record<string, string>,
): UploadProcessingSummary {
  if (!customMetadata) {
    return emptyUploadProcessingSummary();
  }

  let errors: string[] = [];
  try {
    const parsedErrors = JSON.parse(customMetadata.errors || '[]') as unknown;
    if (Array.isArray(parsedErrors)) {
      errors = parsedErrors.filter((error): error is string => typeof error === 'string');
    }
  } catch {
    errors = [];
  }

  return {
    rowsProcessed: parseMetadataNumber(customMetadata.rowsProcessed),
    rowsTotal: parseMetadataNumber(customMetadata.rowsTotal),
    importedCount: parseMetadataNumber(customMetadata.importedCount),
    updatedCount: parseMetadataNumber(customMetadata.updatedCount),
    skippedCount: parseMetadataNumber(customMetadata.skippedCount),
    errorCount: parseMetadataNumber(customMetadata.errorCount),
    errors,
  };
}

function parseMetadataNumber(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

async function processStoredUpload(
  key: string,
  organizationId: string,
  env: Env,
  db: Database,
): Promise<UploadProcessingSummary> {
  if (typeof env.CSV_UPLOADS.get !== 'function') {
    return emptyUploadProcessingSummary();
  }

  const object = await env.CSV_UPLOADS.get(key);
  if (!object) {
    throw new Error('Upload not found');
  }

  const data = await object.arrayBuffer();
  const processingSummary = await processProductCatalogUpload(data, organizationId, db);

  await env.CSV_UPLOADS.put(key, data, {
    httpMetadata: {
      contentType: object.httpMetadata?.contentType || 'text/csv',
    },
    customMetadata: serializeUploadProcessingSummary(processingSummary),
  });

  return processingSummary;
}

async function processProductCatalogUpload(
  data: ArrayBuffer,
  organizationId: string,
  db: Database,
): Promise<UploadProcessingSummary> {
  const summary = emptyUploadProcessingSummary();
  const text = new TextDecoder().decode(data);
  const records = parseCsvRecords(text);

  if (records.length < 2) {
    summary.errors.push('No product rows found');
    summary.errorCount = summary.errors.length;
    return summary;
  }

  const headers = records[0].map(normalizeHeader);
  const columnIndexes = {
    sku: findHeaderIndex(headers, PRODUCT_CATALOG_HEADER_ALIASES.sku),
    name: findHeaderIndex(headers, PRODUCT_CATALOG_HEADER_ALIASES.name),
    barcode: findHeaderIndex(headers, PRODUCT_CATALOG_HEADER_ALIASES.barcode),
    cost: findHeaderIndex(headers, PRODUCT_CATALOG_HEADER_ALIASES.cost),
  };

  const missingHeaders = Object.entries(columnIndexes)
    .filter(([, index]) => index === -1)
    .map(([name]) => name);
  if (missingHeaders.length > 0) {
    summary.errors.push(`Missing required column header(s): ${missingHeaders.join(', ')}`);
    summary.errorCount = summary.errors.length;
    return summary;
  }

  const rows = records.slice(1).filter((row) => row.some((cell) => cell.trim()));
  summary.rowsTotal = rows.length;

  for (const [index, row] of rows.entries()) {
    const rowNumber = index + 2;
    const parsedRow = parseProductCatalogRow(row, columnIndexes);
    if (!parsedRow) {
      summary.skippedCount += 1;
      summary.errors.push(`Row ${rowNumber}: Missing required product fields`);
      continue;
    }

    try {
      const wasInserted = await upsertProductFromUpload(db, organizationId, parsedRow);
      if (wasInserted) {
        summary.importedCount += 1;
      } else {
        summary.updatedCount += 1;
      }
    } catch (error) {
      Sentry.captureException(error, {
        tags: { feature: 'worker-upload', action: 'product-import-row' },
        extra: { rowNumber },
      });
      summary.skippedCount += 1;
      summary.errors.push(`Row ${rowNumber}: Product import failed`);
    }
  }

  summary.rowsProcessed = summary.importedCount + summary.updatedCount + summary.skippedCount;
  summary.errorCount = summary.errors.length;
  return summary;
}

async function upsertProductFromUpload(
  db: Database,
  organizationId: string,
  row: ProductCatalogRow,
): Promise<boolean> {
  const rows = await db.sql`
    WITH updated AS (
      UPDATE products
      SET barcode = ${row.barcode},
          sku = ${row.sku},
          name = ${row.name},
          cost_price = ${row.costPrice},
          updated_at = NOW()
      WHERE organization_id = ${organizationId}
        AND (sku = ${row.sku} OR barcode = ${row.barcode})
      RETURNING id
    ),
    inserted AS (
      INSERT INTO products (organization_id, barcode, sku, name, cost_price, notes, created_at, updated_at)
      SELECT ${organizationId}, ${row.barcode}, ${row.sku}, ${row.name}, ${row.costPrice}, '', NOW(), NOW()
      WHERE NOT EXISTS (SELECT 1 FROM updated)
      RETURNING id
    )
    SELECT EXISTS(SELECT 1 FROM inserted) as inserted
  `;
  return rows[0]?.inserted === true;
}
