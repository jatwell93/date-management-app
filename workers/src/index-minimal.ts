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
import type { ValidatedCatalogueRow } from './upload/catalogue-parser';
import {
  parseUploadCompleteBody,
  parseUploadProcessingSummary,
  processProductCatalogUpload,
  processStoredUpload,
  processCompletedUploadSync,
  queueCompletedCatalogueUpload,
  serializeUploadProcessingSummary,
  userOwnsUploadKey,
} from './upload/upload-handlers';
import {
  enqueueCatalogueImport,
  failCatalogueImport,
  isCatalogueWithinLimit,
  processCatalogueImportJob,
  takeImportBatch,
} from './upload/catalogue-import';
import {
  authenticateClerkRequest,
  getClerkAuthorizedParties,
  handleOrganizationBootstrap,
} from './clerk/bootstrap-handler';
import { handleClerkWebhook } from './clerk/webhook-handler';

const DIRECT_UPLOAD_THRESHOLD_BYTES = 2 * 1024 * 1024;
const PRESIGNED_UPLOAD_TTL_SECONDS = 15 * 60;
const STANDARD_MAX_FILE_SIZE = 25 * 1024 * 1024;
// Must stay aligned with `max_retries` on the catalogue queue consumers in wrangler.toml.
// After this many delivery attempts we mark the job failed (releasing the one-active-import
// lock) rather than letting it retry forever and dead-letter while stuck in `processing`.
const MAX_PROCESSING_ATTEMPTS = 5;

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

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
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
export const MINIMAL_API_ROUTES: MinimalApiRoute[] = [
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
  ['GET', '/api/expired-items/reports/expired-losses', handleGetExpiredLossesReport],
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
 * GET /api/expired-items/reports/expired-losses
 */
async function handleGetExpiredLossesReport(
  request: Request,
  db: Database,
  env: Env,
): Promise<Response> {
  const auth = await authenticateApiRequest(request, env, db);
  if (auth instanceof Response) return auth;
  const [lossesBySKU, lossesByStoreArea] = await Promise.all([
    db.getLossBySkuReport(auth.organizationId),
    db.getLossByDepartmentReport(auth.organizationId),
  ]);
  return jsonResponse({ lossesBySKU, lossesByStoreArea }, 200, env);
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
type ExpiredItemProcessBody = {
  inventoryItemId?: unknown;
  action?: unknown;
  unitsDiscarded?: unknown;
};

type ParsedExpiredItemProcessBody =
  | {
      ok: true;
      inventoryItemId: number;
      action: 'sold_through' | 'expired';
      unitsDiscarded?: number;
    }
  | { ok: false; message: string };

function parseExpiredItemProcessBody(body: ExpiredItemProcessBody): ParsedExpiredItemProcessBody {
  if (!isPositiveInteger(body.inventoryItemId)) {
    return { ok: false, message: 'Missing or invalid required field: inventoryItemId' };
  }

  if (body.action !== 'sold_through' && body.action !== 'expired') {
    return { ok: false, message: "Action must be either 'sold_through' or 'expired'" };
  }

  if (body.action === 'expired' && !isPositiveInteger(body.unitsDiscarded)) {
    return {
      ok: false,
      message: 'Units discarded must be a positive number when marking as expired',
    };
  }

  return {
    ok: true,
    inventoryItemId: body.inventoryItemId,
    action: body.action,
    unitsDiscarded: body.action === 'expired' ? body.unitsDiscarded : undefined,
  };
}

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
  const parsed = parseExpiredItemProcessBody(body);
  if (!parsed.ok) {
    return errorResponse(parsed.message, 400, env);
  }

  try {
    const transaction = await db.processExpiredItem(
      parsed.inventoryItemId,
      auth.userId,
      auth.organizationId,
      parsed.action,
      parsed.unitsDiscarded,
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

export { handleLogin, handleRegister, handleOrganizationBootstrap };
export { getClerkAuthorizedParties };

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
