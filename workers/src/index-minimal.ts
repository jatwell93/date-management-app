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
import {
  LAUNCH_TIER_USER_LIMITS,
  normalizeLaunchTier,
  parsePositiveIntEnv,
  isUsageEnforcementEnabled,
  resolveMaxActiveExpiries,
  resolveMaxSkus,
  resolveStorageLimitBytes,
  UNLIMITED_CAP,
  type LaunchTier,
} from './utils/usage-limits';
import { deriveSubscriptionAccess, type SubscriptionAccessRow } from './subscription-status';
import { handleWorkerUploadRoute } from './upload/upload-router';
import {
  resolveBootstrapApiRoute,
  resolveMinimalApiRoute,
  type MinimalApiRoute,
} from './minimal-api-routes';
import type { ValidatedCatalogueRow } from './upload/catalogue-parser';
import { processExpiryListUpload } from './upload/expiry-import';
import {
  parseUploadCompleteBody,
  parseUploadProcessingSummary,
  processProductCatalogUpload,
  processStoredUpload,
  processCompletedUploadSync,
  queueCompletedCatalogueUpload,
  serializeUploadProcessingSummary,
  type UploadProcessingSummary,
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
import {
  CREDIT_SCOPES,
  DEFAULT_FULL_CREDIT_MARKDOWN_MATRIX,
  DEFAULT_MARKDOWN_MATRIX,
  DEFAULT_MARKDOWN_MATRIX_SET,
  type MarkdownBasis,
  type MarkdownMatrixConfig,
  type MarkdownMatrixSet,
} from '../../shared/domain/markdown';
import { isCatalogueReviewState } from '../../shared/domain/brand-supplier';
import { isPlatformAdminUser as isSharedPlatformAdminUser } from '../../shared/domain/platform-catalogue';
import {
  isCreditType,
  isPolicyWrite,
  validatePolicyWrite,
  type PolicyFieldError,
  type SupplierPolicyRecord,
} from '../../shared/domain/supplier-policy';
import { normalizeRole, ROLES } from './constants/roles';

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

// Postgres `undefined_column` (42703) or `undefined_table` (42P01). Guards
// against a code-before-migration gap: e.g. the products.retail_price column or
// organization_markdown_config table (#338) not yet applied to the live Neon DB.
// Detecting it lets callers degrade to cost-only defaults instead of surfacing
// a raw NeonDbError to the user.
function isMissingSchemaError(error: unknown): boolean {
  const hasMissingCode = (value: unknown): boolean =>
    !!value &&
    typeof value === 'object' &&
    ((value as { code?: unknown }).code === '42703' ||
      (value as { code?: unknown }).code === '42P01');
  if (hasMissingCode(error)) return true;
  // Some neon driver wrappers nest the pg error under .cause.
  return hasMissingCode((error as { cause?: unknown }).cause);
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
const RE_STORE_AREA_CHECK_CYCLE_COMPLETE = /^\/api\/store-areas\/check-cycles\/\d+\/complete$/;
const RE_SUPPLIER_CREDIT_BRAND_SUPPLIER = /^\/api\/supplier-credits\/brands\/\d+\/supplier$/;
const RE_SUPPLIER_CREDIT_PRODUCT_SUPPLIER = /^\/api\/supplier-credits\/products\/\d+\/supplier$/;
const RE_SUPPLIER_CREDIT_SUPPLIER = /^\/api\/supplier-credits\/suppliers\/\d+$/;
const RE_SUPPLIER_CREDIT_SUPPLIER_POLICY = /^\/api\/supplier-credits\/suppliers\/\d+\/policy$/;
const RE_SUPPLIER_CREDIT_DISPOSE = /^\/api\/supplier-credits\/claimable-pool\/\d+\/dispose$/;
const RE_PLATFORM_CATALOGUE_CORRECTION = /^\/api\/platform\/catalogue-corrections\/\d+$/;
const OPEN_CREDIT_CLAIM_STATUSES = ['DRAFT', 'SENDING', 'SENT', 'ACKNOWLEDGED'];
const SETTLED_CREDIT_CLAIM_STATUSES = ['CREDITED', 'PARTIALLY_CREDITED', 'REJECTED', 'CANCELLED'];
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
  ['GET', '/api/store-areas/check-cycles', handleListCheckCycles],
  ['POST', '/api/store-areas/check-cycles', handleCreateCheckCycle],
  ['POST', RE_STORE_AREA_CHECK_CYCLE_COMPLETE, handleCompleteCheckCycle, 'path'],
  ['POST', '/api/store-areas/bay-checks', handleRecordBayCheck],
  ['GET', '/api/store-areas/floor-progress', handleGetFloorProgress],
  ['PUT', RE_STORE_AREA_ID, handleUpdateStoreArea, 'path'],
  ['DELETE', RE_STORE_AREA_ID, handleDeleteStoreArea, 'path'],
  ['GET', '/api/dashboard', handleGetDashboard],
  ['GET', '/api/reports/expiry', handleGetExpiryReport],
  ['GET', '/api/reports/expiry-overall', handleGetExpiryOverallReport],
  ['GET', '/api/reports/expiry-details', handleGetExpiryDetailsReport],
  ['GET', '/api/reports/expiry-entries', handleGetActiveExpiryEntriesReport],
  ['GET', '/api/reports/daily-usage', handleGetDailyUsageReport],
  ['GET', '/api/reports/items-by-user', handleGetItemsByUserReport],
  ['GET', '/api/reports/items-by-date', handleGetItemsByDateReport],
  ['GET', '/api/reports/store-walk-audit', handleGetStoreWalkAuditReport],
  ['GET', '/api/reports/loss-by-sku', handleGetLossBySkuReport],
  ['GET', '/api/reports/loss-by-department', handleGetLossByDepartmentReport],
  ['GET', '/api/reports/sell-through', handleGetSellThroughReport],
  ['GET', '/api/expired-items', handleGetExpiredItems],
  ['GET', '/api/expired-items/reports/expired-losses', handleGetExpiredLossesReport],
  ['GET', '/api/supplier-credits/suppliers', handleListSuppliers],
  ['POST', '/api/supplier-credits/suppliers', handleCreateSupplier],
  ['PUT', RE_SUPPLIER_CREDIT_SUPPLIER, handleReplaceSupplier, 'path'],
  ['PATCH', RE_SUPPLIER_CREDIT_SUPPLIER, handlePatchSupplier, 'path'],
  ['DELETE', RE_SUPPLIER_CREDIT_SUPPLIER_POLICY, handleClearSupplierPolicy, 'path'],
  ['GET', '/api/supplier-credits/policy-review', handlePolicyReview],
  ['POST', '/api/supplier-credits/policy-review/bulk-attach', handleBulkAttachPolicy],
  ['POST', '/api/supplier-credits/brands/bulk-link', handleBulkLinkProducts],
  ['GET', '/api/supplier-credits/brands', handleListBrands],
  ['GET', '/api/supplier-credits/brand-review', handleBrandReview],
  ['POST', '/api/supplier-credits/brands', handleAddBrand],
  ['PUT', RE_SUPPLIER_CREDIT_BRAND_SUPPLIER, handleConfirmBrandSupplier, 'path'],
  ['PUT', RE_SUPPLIER_CREDIT_PRODUCT_SUPPLIER, handleAssignProductSupplier, 'path'],
  ['POST', RE_SUPPLIER_CREDIT_DISPOSE, handleDisposeClaimableWriteOff, 'path'],
  ['GET', '/api/supplier-credits/claimable-pool', handleGetClaimablePool],
  ['GET', '/api/supplier-credits/recovery-report', handleGetRecoveryReport],
  ['GET', '/api/supplier-credits/claims', handleListCreditClaims],
  ['GET', '/api/platform/catalogue-corrections', handleListCatalogueCorrections],
  ['GET', '/api/platform/catalogue/provenance', handleGetCatalogueProvenance],
  ['PATCH', RE_PLATFORM_CATALOGUE_CORRECTION, handleReviewCatalogueCorrection, 'path'],
  ['POST', '/api/expired-items/process', handleProcessExpiredItem],
  ['GET', '/api/subscription/current', handleGetCurrentSubscription],
  ['GET', '/api/subscription/trial-status', handleGetTrialStatus],
  ['GET', '/api/organization/usage', handleGetOrganizationUsage],
  ['GET', '/api/markdown-config', handleGetMarkdownConfig],
  ['PUT', '/api/markdown-config', handleUpdateMarkdownConfig],
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

          const bootstrapRouteResponse = resolveBootstrapApiRoute(MINIMAL_API_ROUTES, {
            request,
            pathname,
            method,
            env,
          });
          if (bootstrapRouteResponse) {
            return finalizeApiResponse(bootstrapRouteResponse);
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

          // `return await` (not a bare `return`) so a rejected handler promise
          // surfaces inside this try block and is caught by the outer handler,
          // which wraps the 500 with CORS headers. A bare `return` adopts the
          // rejected promise's state at the caller, skipping the catch and
          // producing a CORS-less 500 the browser masks as a CORS error.
          return await finalizeApiResponse(
            apiRouteResponse ?? errorResponse('Not Found', 404, env),
          );
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

import {
  Database,
  type BulkAttachResult,
  type BulkLinkResult,
  type Supplier,
  type SupplierWriteData,
  type UsageCounts,
} from './database';
import { isReferentialError } from './tenant-references';
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

  return resolveAuthenticatedUser(request, db, clerkResult.clerkUserId, env, requestOrigin);
}

/**
 * Everything `authenticateApiRequest` does after the Clerk token verifies: the
 * user lookup, and the organization entitlement gate.
 *
 * Exported so the gate can be exercised against real SQL. Token verification is
 * covered separately in `clerk/request-authentication.test.ts`; splitting here
 * means the database half can be tested against an actual Postgres rather than
 * asserted about — a joined query is exactly the kind of code that passes a
 * hand-built-row unit test and fails in production on a column alias.
 */
export async function resolveAuthenticatedUser(
  request: Request,
  db: Database,
  clerkUserId: string,
  env: Env,
  requestOrigin: string,
): Promise<
  { userId: number; organizationId: string; clerkUserId: string; role: string } | Response
> {
  // The organization and subscription columns ride along on the user lookup
  // rather than costing two more round trips. The join to subscription_tiers is
  // only safe because migration 0012 made organization_id unique there (#472);
  // before that a second row would have multiplied this result, which is why
  // every other reader still says ORDER BY created_at DESC LIMIT 1.
  const rows = await db.sql`
    SELECT u.id,
           u.organization_id as "organizationId",
           u.role,
           o.is_creation_locked as "isCreationLocked",
           s.id as "subscriptionId",
           s.status,
           s.tier_level,
           s.trial_end_date,
           s.current_period_end,
           s.cancel_at_period_end,
           s.past_due_since
    FROM users u
    LEFT JOIN organizations o ON o.id = u.organization_id
    LEFT JOIN subscription_tiers s ON s.organization_id = u.organization_id
    WHERE u.clerk_user_id = ${clerkUserId}
      AND u.deleted_at IS NULL
    LIMIT 1
  `;
  if (!rows[0]) {
    return errorResponse('User has not completed organization bootstrap', 401, env, requestOrigin);
  }

  const organizationId = String(rows[0].organizationId);
  const gate = checkOrganizationEntitlement(request, rows[0], organizationId, env, requestOrigin);
  if (gate) {
    return gate;
  }

  return {
    userId: Number(rows[0].id),
    organizationId,
    clerkUserId,
    role: String(rows[0].role || 'team_member'),
  };
}

/**
 * Refuses creation for an organization that is creation-locked or whose
 * subscription has lapsed. Returns a 403 to short-circuit on, or `null`.
 *
 * **Creation only, deliberately.** Reads and edits of existing data stay open in
 * every lapsed state — including a cancellation past its paid-through window,
 * where Express rejects the request outright. That divergence is a product
 * decision recorded in task 3.1.k: one rule for every lapse reason, and a
 * customer never loses access to data they already own over a billing state.
 *
 * The two triggers are one control from opposite directions. `is_creation_locked`
 * is a stored flag Express's webhook and dunning paths set on an over-limit
 * downgrade; the derived lapse is the same conclusion reached from dates, for
 * the transitions no Worker writer performs yet (#489).
 */
function checkOrganizationEntitlement(
  request: Request,
  row: Record<string, unknown>,
  organizationId: string,
  env: Env,
  requestOrigin: string,
): Response | null {
  // A LEFT JOIN that matches nothing yields a row of NULLs, not the absence of
  // a row, so the join key has to say which it is. Without this an organization
  // with no subscription reports "unrecognized-status" instead of the missing
  // row it actually has, and the alert names the wrong problem.
  const subscription = row.subscriptionId == null ? null : (row as SubscriptionAccessRow);
  const access = deriveSubscriptionAccess(subscription);
  if (request.method !== 'POST') {
    // Anomalies describe a standing state rather than an event, so they are
    // reported where the entitlement decision is actually made instead of once
    // per read for as long as the organization stays in that state.
    return null;
  }

  if (access.anomaly) {
    console.warn(
      JSON.stringify({
        event: 'subscription_state_anomaly',
        anomaly: access.anomaly,
        organizationId,
        status: typeof row.status === 'string' ? row.status : null,
      }),
    );
  }

  if (row.isCreationLocked === true) {
    return jsonResponse(
      {
        error:
          'Your account is creation-locked because your current usage exceeds your subscription tier limits. Remove items or upgrade to re-enable creation.',
        locked: true,
        retryable: false,
      },
      403,
      env,
      requestOrigin,
    );
  }

  if (access.lapsed) {
    console.warn(
      JSON.stringify({
        event: 'subscription_lapsed_creation_blocked',
        reason: access.reason,
        organizationId,
      }),
    );
    return jsonResponse(
      {
        error:
          'Your subscription is no longer active, so new records cannot be created. Existing data stays available. Renew or upgrade to re-enable creation.',
        locked: true,
        reason: access.reason,
        retryable: false,
      },
      403,
      env,
      requestOrigin,
    );
  }

  return null;
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
    db.findProducts(auth.organizationId, { search, limit, offset }),
    db.countProducts(auth.organizationId, search),
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
  const product = await db.findProductById(auth.organizationId, id);

  // A product belonging to another organization is reported as 404 rather than
  // 403: a 403 would confirm the id exists, which is itself a cross-tenant leak
  // when ids are sequential.
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
    db.findInventoryItems(auth.organizationId, { limit, offset }),
    db.countInventoryItems(auth.organizationId),
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

  const areas = await db.findStoreAreas(auth.organizationId);

  return jsonResponse(areas, 200, env);
}

/**
 * GET /api/store-areas/check-cycles
 */
async function handleListCheckCycles(request: Request, db: Database, env: Env): Promise<Response> {
  const auth = await authenticateApiRequest(request, env, db);
  if (auth instanceof Response) return auth;

  const cycles = await db.listCheckCycles(auth.organizationId);
  return jsonResponse(cycles, 200, env);
}

/**
 * POST /api/store-areas/check-cycles
 */
async function handleCreateCheckCycle(request: Request, db: Database, env: Env): Promise<Response> {
  const auth = await authenticateApiRequest(request, env, db);
  if (auth instanceof Response) return auth;

  const body = (await request.json()) as { name?: string; startedAt?: string };
  if (!body.name || typeof body.name !== 'string' || body.name.trim().length === 0) {
    return errorResponse('Missing required field: name', 400, env);
  }

  try {
    const cycle = await db.createCheckCycle(auth.organizationId, {
      name: body.name.trim(),
      startedAt: body.startedAt,
    });
    return jsonResponse(cycle, 201, env);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    if (message.includes('Active check cycle already exists')) {
      return errorResponse(message, 409, env);
    }
    console.error('handleCreateCheckCycle error:', error);
    return errorResponse('Internal server error', 500, env);
  }
}

/**
 * POST /api/store-areas/check-cycles/:id/complete
 */
async function handleCompleteCheckCycle(
  request: Request,
  db: Database,
  env: Env,
  pathname: string,
): Promise<Response> {
  const auth = await authenticateApiRequest(request, env, db);
  if (auth instanceof Response) return auth;

  const match = pathname.match(/^\/api\/store-areas\/check-cycles\/(\d+)\/complete$/);
  if (!match) {
    return errorResponse('Invalid check cycle id', 400, env);
  }

  try {
    const cycle = await db.completeCheckCycle(auth.organizationId, parseInt(match[1], 10));
    return jsonResponse(cycle, 200, env);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    if (message.includes('not found')) {
      return errorResponse(message, 404, env);
    }
    console.error('handleCompleteCheckCycle error:', error);
    return errorResponse('Internal server error', 500, env);
  }
}

/**
 * POST /api/store-areas/bay-checks
 */
async function handleRecordBayCheck(request: Request, db: Database, env: Env): Promise<Response> {
  const auth = await authenticateApiRequest(request, env, db);
  if (auth instanceof Response) return auth;

  const body = (await request.json()) as {
    storeAreaId?: number;
    store_area_id?: number;
    checkedAt?: string;
    checked_at?: string;
    itemsAddedCount?: number;
    items_added_count?: number;
    notes?: string | null;
  };
  const storeAreaId = body.storeAreaId ?? body.store_area_id;
  if (!Number.isInteger(storeAreaId) || Number(storeAreaId) <= 0) {
    return errorResponse('Missing required field: storeAreaId', 400, env);
  }

  try {
    const check = await db.recordBayCheck(auth.organizationId, auth.userId, {
      storeAreaId: Number(storeAreaId),
      checkedAt: body.checkedAt ?? body.checked_at,
      itemsAddedCount: body.itemsAddedCount ?? body.items_added_count,
      notes: body.notes,
    });
    return jsonResponse(check, 201, env);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    if (message.includes('Active check cycle is required')) {
      return errorResponse(message, 409, env);
    }
    if (message.includes('leaf bay')) {
      return errorResponse(message, 400, env);
    }
    console.error('handleRecordBayCheck error:', error);
    return errorResponse('Internal server error', 500, env);
  }
}

/**
 * GET /api/store-areas/floor-progress
 */
async function handleGetFloorProgress(request: Request, db: Database, env: Env): Promise<Response> {
  const auth = await authenticateApiRequest(request, env, db);
  if (auth instanceof Response) return auth;

  const progress = await db.getFloorProgress(auth.organizationId);
  return jsonResponse(progress, 200, env);
}

/**
 * GET /api/dashboard
 */
async function handleGetDashboard(request: Request, db: Database, env: Env): Promise<Response> {
  const auth = await authenticateApiRequest(request, env, db);
  if (auth instanceof Response) {
    return auth;
  }

  const [stats, lastCatalogueUpload, expiredItemsEnteredToday, stockLossLast30Days] =
    await Promise.all([
      db.getDashboardStats(auth.organizationId),
      db.getLastCatalogueUpload(auth.organizationId),
      db.getExpiredItemsEnteredToday(auth.organizationId),
      db.getStockLossLast30Days(auth.organizationId),
    ]);

  return jsonResponse(
    {
      stats,
      activity: {
        lastCatalogueUpload,
        expiredItemsEnteredToday,
        stockLossLast30Days,
      },
    },
    200,
    env,
  );
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
 * GET /api/reports/expiry-entries
 */
async function handleGetActiveExpiryEntriesReport(
  request: Request,
  db: Database,
  env: Env,
): Promise<Response> {
  const auth = await authenticateApiRequest(request, env, db);
  if (auth instanceof Response) return auth;
  const report = await db.getActiveExpiryEntries(auth.organizationId);
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
 * GET /api/reports/store-walk-audit
 */
async function handleGetStoreWalkAuditReport(
  request: Request,
  db: Database,
  env: Env,
): Promise<Response> {
  const auth = await authenticateApiRequest(request, env, db);
  if (auth instanceof Response) return auth;
  const report = await db.getStoreWalkAuditReport(auth.organizationId);
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
    db.getExpiredLossBySku(auth.organizationId),
    db.getExpiredLossByStoreArea(auth.organizationId),
  ]);
  return jsonResponse({ lossesBySKU, lossesByStoreArea }, 200, env);
}

/**
 * GET /api/supplier-credits/suppliers
 */
async function handleListSuppliers(request: Request, db: Database, env: Env): Promise<Response> {
  const auth = await authenticateApiRequest(request, env, db);
  if (auth instanceof Response) return auth;

  const suppliers = await db.listSuppliers(auth.organizationId);
  return jsonResponse(suppliers, 200, env);
}

type SupplierInput = Partial<
  Pick<
    SupplierWriteData,
    | 'name'
    | 'creditType'
    | 'contactEmail'
    | 'contactPhone'
    | 'creditPolicyNote'
    | 'policyWriteOffQty'
    | 'policyCreditQty'
    | 'followUpDays'
    | 'representativeName'
    | 'representativeEmail'
  >
>;

interface StructuredErrorOptions {
  code: string;
  message: string;
  statusCode: number;
  errors?: Array<{ field: string; message: string }>;
}

function structuredErrorResponse(options: StructuredErrorOptions, env: Env): Response {
  const { code, message, statusCode, errors } = options;
  return jsonResponse(
    { code, message, statusCode, ...(errors?.length ? { errors } : {}) },
    statusCode,
    env,
  );
}

function policyValidationResponse(
  message: string,
  errors: Array<{ field: string; message: string }>,
  env: Env,
): Response {
  return structuredErrorResponse(
    { code: 'POLICY_VALIDATION_ERROR', message, statusCode: 422, errors },
    env,
  );
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

type SupplierFieldError = { field: string; message: string };
type SupplierTextField = 'name' | 'creditPolicyNote' | 'contactPhone' | 'representativeName';

function parseSupplierTextField(
  body: Record<string, unknown>,
  input: SupplierInput,
  errors: SupplierFieldError[],
  field: SupplierTextField,
  options: { max: number; nullable: boolean },
): void {
  const value = body[field];
  if (value === undefined) return;
  if (value === null && options.nullable) {
    (input as Record<string, unknown>)[field] = value;
    return;
  }
  if (typeof value !== 'string') {
    errors.push({ field, message: 'Must be a string' });
    return;
  }
  if (value.length > options.max) {
    errors.push({ field, message: `Must be at most ${options.max} characters` });
    return;
  }
  input[field] = value;
}

function parseSupplierEmailField(
  body: Record<string, unknown>,
  input: SupplierInput,
  errors: SupplierFieldError[],
  field: 'contactEmail' | 'representativeEmail',
): void {
  const value = body[field];
  if (value === undefined) return;
  if (value === null) {
    input[field] = value;
    return;
  }
  if (typeof value !== 'string' || value.length > 255 || !isEmail(value.trim())) {
    errors.push({ field, message: 'Must be a valid email address' });
    return;
  }
  input[field] = value;
}

function parseSupplierQuantityField(
  body: Record<string, unknown>,
  input: SupplierInput,
  errors: SupplierFieldError[],
  field: 'policyWriteOffQty' | 'policyCreditQty',
): void {
  const value = body[field];
  if (value === undefined) return;
  if (!isValidSupplierQuantity(field, value)) {
    errors.push({
      field,
      message:
        field === 'policyCreditQty'
          ? 'Must be a non-negative integer or null'
          : 'Must be a positive integer or null',
    });
    return;
  }
  input[field] = value;
}

function isValidSupplierQuantity(
  field: 'policyWriteOffQty' | 'policyCreditQty',
  value: unknown,
): value is number | null {
  if (value === null) return true;
  if (typeof value !== 'number' || !Number.isInteger(value)) return false;
  return field === 'policyCreditQty' ? value >= 0 : value > 0;
}

function parseFollowUpDays(
  body: Record<string, unknown>,
  input: SupplierInput,
  errors: SupplierFieldError[],
): void {
  const value = body.followUpDays;
  if (value === undefined) return;
  if (!isPositiveInteger(value) || value > 365) {
    errors.push({ field: 'followUpDays', message: 'Must be an integer between 1 and 365' });
    return;
  }
  input.followUpDays = value;
}

function validateSupplierName(
  input: SupplierInput,
  errors: SupplierFieldError[],
  requireName: boolean,
): void {
  if (typeof input.name !== 'string' || input.name.trim().length === 0) {
    if (requireName || input.name !== undefined) {
      errors.push({ field: 'name', message: 'Supplier name is required' });
    }
    return;
  }
  if (requireName && (input.name.includes('<') || input.name.includes('>'))) {
    errors.push({ field: 'name', message: 'Supplier name cannot contain HTML tags' });
  }
}

async function parseSupplierBody(
  request: Request,
  env: Env,
  requireName: boolean,
): Promise<{ input: SupplierInput } | { response: Response }> {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || Array.isArray(body)) {
    return {
      response: structuredErrorResponse(
        { code: 'VALIDATION_ERROR', message: 'Invalid request body', statusCode: 400 },
        env,
      ),
    };
  }

  const errors: SupplierFieldError[] = [];
  const input: SupplierInput = {};
  parseSupplierTextField(body, input, errors, 'name', { max: 120, nullable: false });
  parseSupplierTextField(body, input, errors, 'creditPolicyNote', {
    max: 10_000,
    nullable: false,
  });
  parseSupplierTextField(body, input, errors, 'contactPhone', { max: 80, nullable: true });
  parseSupplierTextField(body, input, errors, 'representativeName', {
    max: 120,
    nullable: true,
  });
  parseSupplierEmailField(body, input, errors, 'contactEmail');
  parseSupplierEmailField(body, input, errors, 'representativeEmail');
  parseSupplierQuantityField(body, input, errors, 'policyWriteOffQty');
  parseSupplierQuantityField(body, input, errors, 'policyCreditQty');
  if (Object.prototype.hasOwnProperty.call(body, 'creditType')) {
    if (!isCreditType(body.creditType)) {
      errors.push({ field: 'creditType', message: 'Credit type must be NONE or FULL_CREDIT' });
    } else {
      input.creditType = body.creditType;
    }
  }
  parseFollowUpDays(body, input, errors);
  validateSupplierName(input, errors, requireName);
  if (!requireName && Object.keys(input).length === 0) {
    errors.push({ field: 'body', message: 'Provide at least one supplier field' });
  }

  return errors.length
    ? {
        response: structuredErrorResponse(
          {
            code: 'VALIDATION_ERROR',
            message: 'Request validation failed',
            statusCode: 400,
            errors,
          },
          env,
        ),
      }
    : { input };
}

function toCreateSupplierData(input: SupplierInput, policyChanged: boolean): SupplierWriteData {
  return {
    name: input.name?.trim() ?? '',
    creditType: input.creditType ?? 'NONE',
    contactEmail: normalizeOptionalText(input.contactEmail),
    contactPhone: normalizeOptionalText(input.contactPhone),
    creditPolicyNote: input.creditPolicyNote?.trim() ?? '',
    policyWriteOffQty: input.policyWriteOffQty ?? null,
    policyCreditQty: input.policyCreditQty ?? null,
    followUpDays: input.followUpDays ?? 7,
    representativeName: normalizeOptionalText(input.representativeName),
    representativeEmail: normalizeOptionalText(input.representativeEmail),
    policyUpdatedAt: policyChanged ? new Date().toISOString() : null,
  };
}

function mergedValue<T>(value: T | undefined, fallback: T): T {
  return value === undefined ? fallback : value;
}

function mergedOptionalText(
  value: string | null | undefined,
  fallback: string | null,
): string | null {
  return value === undefined ? fallback : normalizeOptionalText(value);
}

function toMergedSupplierData(
  input: SupplierInput,
  existing: Supplier,
  policyChanged: boolean,
): SupplierWriteData {
  return {
    name: input.name === undefined ? existing.name : input.name.trim(),
    creditType: mergedValue(input.creditType, existing.creditType),
    contactEmail: mergedOptionalText(input.contactEmail, existing.contactEmail),
    contactPhone: mergedOptionalText(input.contactPhone, existing.contactPhone),
    creditPolicyNote:
      input.creditPolicyNote === undefined
        ? existing.creditPolicyNote
        : input.creditPolicyNote.trim(),
    policyWriteOffQty: mergedValue(input.policyWriteOffQty, existing.policyWriteOffQty),
    policyCreditQty: mergedValue(input.policyCreditQty, existing.policyCreditQty),
    followUpDays: mergedValue(input.followUpDays, existing.followUpDays),
    representativeName: mergedOptionalText(input.representativeName, existing.representativeName),
    representativeEmail: mergedOptionalText(
      input.representativeEmail,
      existing.representativeEmail,
    ),
    policyUpdatedAt: policyChanged ? new Date().toISOString() : existing.policyUpdatedAt,
  };
}

function ratioErrors(data: SupplierPolicyRecord): Array<{ field: string; message: string }> {
  return (data.policyWriteOffQty == null) !== (data.policyCreditQty == null)
    ? [
        {
          field: 'policyCreditQty',
          message:
            'A credit ratio needs both a write-off quantity and a credit quantity, or neither.',
        },
      ]
    : [];
}

function authorizeAndValidateWorkerPolicy(
  input: SupplierPolicyRecord,
  existing: SupplierPolicyRecord | null,
  role: string,
  env: Env,
): Response | null {
  if (!isPolicyWrite(input, existing)) return null;
  if (normalizeRole(role) !== ROLES.ADMIN) {
    return structuredErrorResponse(
      { code: 'AUTHORIZATION_ERROR', message: 'Insufficient permissions', statusCode: 403 },
      env,
    );
  }
  const errors: PolicyFieldError[] = validatePolicyWrite(input, existing);
  return errors.length ? policyValidationResponse('Supplier policy is invalid', errors, env) : null;
}

async function handleCreateSupplier(request: Request, db: Database, env: Env): Promise<Response> {
  const auth = await authenticateApiRequest(request, env, db);
  if (auth instanceof Response) return auth;
  const parsed = await parseSupplierBody(request, env, true);
  if ('response' in parsed) return parsed.response;
  const policyError = authorizeAndValidateWorkerPolicy(parsed.input, null, auth.role, env);
  if (policyError) return policyError;
  const policyChanged = isPolicyWrite(parsed.input, null);
  const data = toCreateSupplierData(parsed.input, policyChanged);
  const ratio = ratioErrors(data);
  if (ratio.length) return policyValidationResponse('Supplier policy is invalid', ratio, env);
  return jsonResponse(await db.createSupplier(auth.organizationId, data), 201, env);
}

interface SupplierWriteRequest {
  pathname: string;
  replace: boolean;
}

async function writeSupplier(
  request: Request,
  db: Database,
  env: Env,
  options: SupplierWriteRequest,
): Promise<Response> {
  const auth = await authenticateApiRequest(request, env, db);
  if (auth instanceof Response) return auth;
  const supplierId = parsePositiveInt(options.pathname.split('/')[4] ?? '');
  if (supplierId == null)
    return structuredErrorResponse(
      { code: 'VALIDATION_ERROR', message: 'Invalid supplier ID', statusCode: 400 },
      env,
    );
  const parsed = await parseSupplierBody(request, env, options.replace);
  if ('response' in parsed) return parsed.response;
  const existing = await db.findSupplier(auth.organizationId, supplierId);
  if (!existing) {
    return structuredErrorResponse(
      {
        code: 'NOT_FOUND_ERROR',
        message: `Supplier ${supplierId} not found`,
        statusCode: 404,
      },
      env,
    );
  }
  const replacement = options.replace ? toCreateSupplierData(parsed.input, false) : null;
  const candidate: SupplierPolicyRecord = replacement ?? parsed.input;
  const policyError = authorizeAndValidateWorkerPolicy(candidate, existing, auth.role, env);
  if (policyError) return policyError;
  const policyChanged = isPolicyWrite(candidate, existing);
  const data: SupplierWriteData = replacement
    ? {
        ...replacement,
        policyUpdatedAt: policyChanged ? new Date().toISOString() : existing.policyUpdatedAt,
      }
    : toMergedSupplierData(parsed.input, existing, policyChanged);
  const ratio = ratioErrors(data);
  if (ratio.length) return policyValidationResponse('Supplier policy is invalid', ratio, env);
  const supplier = await db.updateSupplier(auth.organizationId, supplierId, data);
  return supplier
    ? jsonResponse(supplier, 200, env)
    : structuredErrorResponse(
        {
          code: 'NOT_FOUND_ERROR',
          message: `Supplier ${supplierId} not found`,
          statusCode: 404,
        },
        env,
      );
}

async function handleReplaceSupplier(
  request: Request,
  db: Database,
  env: Env,
  pathname: string,
): Promise<Response> {
  return writeSupplier(request, db, env, { pathname, replace: true });
}

async function handlePatchSupplier(
  request: Request,
  db: Database,
  env: Env,
  pathname: string,
): Promise<Response> {
  return writeSupplier(request, db, env, { pathname, replace: false });
}

async function handleClearSupplierPolicy(
  request: Request,
  db: Database,
  env: Env,
  pathname: string,
): Promise<Response> {
  const auth = await authenticateApiRequest(request, env, db);
  if (auth instanceof Response) return auth;
  if (normalizeRole(auth.role) !== ROLES.ADMIN) {
    return structuredErrorResponse(
      { code: 'AUTHORIZATION_ERROR', message: 'Insufficient permissions', statusCode: 403 },
      env,
    );
  }
  const supplierId = parsePositiveInt(pathname.split('/')[4] ?? '');
  if (supplierId == null)
    return structuredErrorResponse(
      { code: 'VALIDATION_ERROR', message: 'Invalid supplier ID', statusCode: 400 },
      env,
    );
  const supplier = await db.clearSupplierPolicy(auth.organizationId, supplierId);
  return supplier
    ? jsonResponse(supplier, 200, env)
    : structuredErrorResponse(
        {
          code: 'NOT_FOUND_ERROR',
          message: `Supplier ${supplierId} not found`,
          statusCode: 404,
        },
        env,
      );
}

function isPolicyStatus(value: string | null): value is 'ATTACHED' | 'MISSING' | null {
  return value == null || value === 'ATTACHED' || value === 'MISSING';
}

async function handlePolicyReview(request: Request, db: Database, env: Env): Promise<Response> {
  const auth = await authenticateApiRequest(request, env, db);
  if (auth instanceof Response) return auth;
  const query = new URL(request.url).searchParams;
  const status = query.get('status');
  if (!isPolicyStatus(status)) {
    return structuredErrorResponse(
      {
        code: 'VALIDATION_ERROR',
        message: 'Policy status must be ATTACHED or MISSING',
        statusCode: 400,
      },
      env,
    );
  }
  return jsonResponse(
    await db.listPolicyReview(auth.organizationId, {
      brand: query.get('brand') ?? undefined,
      supplier: query.get('supplier') ?? undefined,
      status: status ?? undefined,
    }),
    200,
    env,
  );
}

function normalizeBulkIds(
  value: unknown,
  field: string,
  env: Env,
): { ids: number[] } | { response: Response } {
  if (!isValidBulkIdBatch(value)) {
    return {
      response: policyValidationResponse(
        'Bulk request is invalid',
        [{ field, message: 'Provide between 1 and 500 positive integer IDs' }],
        env,
      ),
    };
  }
  return { ids: [...new Set(value)] };
}

function isValidBulkIdBatch(value: unknown): value is number[] {
  if (!Array.isArray(value)) return false;
  if (value.length < 1 || value.length > 500) return false;
  return value.every(isPositiveInteger);
}

function bulkAttachResponse(result: BulkAttachResult, env: Env): Response {
  if (result.kind === 'SUCCESS') {
    const { kind: _kind, ...body } = result;
    return jsonResponse(body, 200, env);
  }
  if (result.kind === 'SUPPLIER_POLICY_MISSING') {
    return policyValidationResponse(
      'Supplier policy is invalid',
      [{ field: 'supplierId', message: 'The selected supplier has no store instructions' }],
      env,
    );
  }
  return structuredErrorResponse(
    {
      code: 'NOT_FOUND_ERROR',
      message:
        result.kind === 'SUPPLIER_NOT_FOUND'
          ? 'Supplier not found'
          : 'One or more brands were not found',
      statusCode: 404,
    },
    env,
  );
}

async function handleBulkAttachPolicy(request: Request, db: Database, env: Env): Promise<Response> {
  const auth = await authenticateApiRequest(request, env, db);
  if (auth instanceof Response) return auth;
  if (normalizeRole(auth.role) !== ROLES.ADMIN) {
    return structuredErrorResponse(
      { code: 'AUTHORIZATION_ERROR', message: 'Insufficient permissions', statusCode: 403 },
      env,
    );
  }
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!isPositiveInteger(body?.supplierId)) {
    return policyValidationResponse(
      'Bulk request is invalid',
      [{ field: 'supplierId', message: 'Supplier ID must be a positive integer' }],
      env,
    );
  }
  const normalized = normalizeBulkIds(body.brandIds, 'brandIds', env);
  if ('response' in normalized) return normalized.response;
  return bulkAttachResponse(
    await db.bulkAttachSupplier(auth.organizationId, body.supplierId, normalized.ids, auth.userId),
    env,
  );
}

function bulkLinkResponse(result: BulkLinkResult, env: Env): Response {
  if (result.kind === 'SUCCESS') {
    const { kind: _kind, ...body } = result;
    return jsonResponse(body, 200, env);
  }
  if (result.kind === 'BRAND_CONFLICT') {
    return structuredErrorResponse(
      {
        code: 'CONFLICT_ERROR',
        message: 'One or more products are linked to a different brand',
        statusCode: 409,
      },
      env,
    );
  }
  return structuredErrorResponse(
    {
      code: 'NOT_FOUND_ERROR',
      message:
        result.kind === 'BRAND_NOT_FOUND'
          ? 'Brand not found'
          : 'One or more products were not found',
      statusCode: 404,
    },
    env,
  );
}

type BulkLinkTarget = { brandId: number } | { brandName: string };

function parseBulkLinkTarget(
  body: Record<string, unknown> | null,
  env: Env,
): { target: BulkLinkTarget } | { response: Response } {
  const brandId = body?.brandId;
  const brandName = typeof body?.brandName === 'string' ? body.brandName.trim() : '';
  if ((brandId == null) === (brandName.length === 0)) {
    return {
      response: policyValidationResponse(
        'Bulk request is invalid',
        [{ field: 'brand', message: 'Provide exactly one brandId or brandName' }],
        env,
      ),
    };
  }
  if (brandId != null && !isPositiveInteger(brandId)) {
    return {
      response: policyValidationResponse(
        'Bulk request is invalid',
        [{ field: 'brandId', message: 'Brand ID must be a positive integer' }],
        env,
      ),
    };
  }
  if (brandName.length > 160) {
    return {
      response: policyValidationResponse(
        'Bulk request is invalid',
        [{ field: 'brandName', message: 'Brand name must be at most 160 characters' }],
        env,
      ),
    };
  }
  return { target: brandId == null ? { brandName } : { brandId } };
}

async function handleBulkLinkProducts(request: Request, db: Database, env: Env): Promise<Response> {
  const auth = await authenticateApiRequest(request, env, db);
  if (auth instanceof Response) return auth;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const normalized = normalizeBulkIds(body?.productIds, 'productIds', env);
  if ('response' in normalized) return normalized.response;
  const parsedTarget = parseBulkLinkTarget(body, env);
  if ('response' in parsedTarget) return parsedTarget.response;
  return bulkLinkResponse(
    await db.bulkLinkProducts(
      auth.organizationId,
      parsedTarget.target,
      normalized.ids,
      auth.userId,
    ),
    env,
  );
}

export function isPlatformAdminUser(
  userId: number | undefined,
  configuration: string | undefined,
): boolean {
  return isSharedPlatformAdminUser(userId, configuration);
}

async function handleListBrands(request: Request, db: Database, env: Env): Promise<Response> {
  const auth = await authenticateApiRequest(request, env, db);
  if (auth instanceof Response) return auth;
  return jsonResponse(await db.listBrands(auth.organizationId), 200, env);
}

async function handleBrandReview(request: Request, db: Database, env: Env): Promise<Response> {
  const auth = await authenticateApiRequest(request, env, db);
  if (auth instanceof Response) return auth;
  const query = new URL(request.url).searchParams;
  const cursor = query.get('cursor');
  const state = query.get('state');
  if (state != null && !isCatalogueReviewState(state)) {
    return errorResponse(
      'Catalogue review state must be NEEDS_BRAND, PENDING_CONFIRMATION, or CONFIRMED',
      400,
      env,
    );
  }
  const pageParam = query.get('page');
  const pageSizeParam = query.get('pageSize');
  const title = query.get('title')?.trim() ?? '';
  const titleMatch = query.get('titleMatch');
  const sort = query.get('sort');
  const numbered =
    pageParam != null ||
    pageSizeParam != null ||
    query.has('title') ||
    titleMatch != null ||
    sort != null;
  if (numbered && cursor != null) {
    return errorResponse('cursor cannot be combined with numbered pagination', 400, env);
  }
  const page = pageParam == null ? 1 : parsePositiveInt(pageParam);
  if (numbered && page == null) {
    return errorResponse('page must be a positive integer', 400, env);
  }
  const pageSize = pageSizeParam == null ? 50 : parsePositiveInt(pageSizeParam);
  if (numbered && (pageSize == null || pageSize > 100)) {
    return errorResponse('pageSize must be an integer from 1 to 100', 400, env);
  }
  if (titleMatch != null && titleMatch !== 'contains' && titleMatch !== 'startsWith') {
    return errorResponse('titleMatch must be contains or startsWith', 400, env);
  }
  if (sort != null && sort !== 'titleAsc' && sort !== 'titleDesc') {
    return errorResponse('sort must be titleAsc or titleDesc', 400, env);
  }
  if (numbered) {
    return jsonResponse(
      await db.reviewBrands(auth.organizationId, {
        state: state ?? undefined,
        group: query.get('group') ?? undefined,
        page: page ?? 1,
        pageSize: pageSize ?? 50,
        ...(title ? { title } : {}),
        titleMatch: (titleMatch ?? 'contains') as 'contains' | 'startsWith',
        sort: (sort ?? 'titleAsc') as 'titleAsc' | 'titleDesc',
      }),
      200,
      env,
    );
  }
  const requestedLimit = Number(query.get('limit') ?? 50);
  return jsonResponse(
    await db.reviewBrands(auth.organizationId, {
      state: state ?? undefined,
      group: query.get('group') ?? undefined,
      cursor: cursor == null ? undefined : (parsePositiveInt(cursor) ?? undefined),
      limit: Number.isInteger(requestedLimit) ? Math.min(100, Math.max(1, requestedLimit)) : 50,
    }),
    200,
    env,
  );
}

async function handleAddBrand(request: Request, db: Database, env: Env): Promise<Response> {
  const auth = await authenticateApiRequest(request, env, db);
  if (auth instanceof Response) return auth;
  const body = (await request.json().catch(() => null)) as {
    productId?: unknown;
    name?: unknown;
    supplierId?: unknown;
  } | null;
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const productId = parsePositiveInt(String(body?.productId ?? ''));
  const supplierId = body?.supplierId == null ? null : parsePositiveInt(String(body.supplierId));
  const invalidSupplierId = body?.supplierId != null && supplierId == null;
  if ([productId == null, name.length === 0, invalidSupplierId].includes(true)) {
    return errorResponse(
      'Valid productId, brand name, and optional supplierId are required',
      400,
      env,
    );
  }
  const brand = await db.addBrand(auth.organizationId, auth.userId, {
    productId: productId as number,
    name,
    supplierId,
  });
  if (!brand) return errorResponse('Product or supplier not found', 404, env);
  return jsonResponse(brand, 201, env);
}

async function handleConfirmBrandSupplier(
  request: Request,
  db: Database,
  env: Env,
  pathname: string,
): Promise<Response> {
  const auth = await authenticateApiRequest(request, env, db);
  if (auth instanceof Response) return auth;
  const brandId = parsePositiveInt(pathname.split('/')[4] ?? '');
  const body = (await request.json().catch(() => null)) as { supplierId?: unknown } | null;
  if (brandId == null || !isPositiveInteger(body?.supplierId)) {
    return errorResponse('Valid brand and supplier IDs are required', 400, env);
  }
  const brand = await db.confirmBrandSupplier(auth.organizationId, brandId, body.supplierId);
  return brand
    ? jsonResponse(brand, 200, env)
    : errorResponse('Brand or supplier not found', 404, env);
}

async function handleAssignProductSupplier(
  request: Request,
  db: Database,
  env: Env,
  pathname: string,
): Promise<Response> {
  const auth = await authenticateApiRequest(request, env, db);
  if (auth instanceof Response) return auth;
  const productId = parsePositiveInt(pathname.split('/')[4] ?? '');
  const body = (await request.json().catch(() => null)) as { supplierId?: unknown } | null;
  const supplierId = body?.supplierId == null ? null : parsePositiveInt(String(body.supplierId));
  const invalidSupplierId = body?.supplierId != null && supplierId == null;
  if ([productId == null, invalidSupplierId].includes(true)) {
    return errorResponse('Valid product and optional supplier IDs are required', 400, env);
  }
  const updated = await db.assignProductSupplier(
    auth.organizationId,
    auth.userId,
    productId as number,
    supplierId,
  );
  if (!updated) return errorResponse('Product or supplier not found', 404, env);
  return jsonResponse({ productId, supplierId }, 200, env);
}

async function handleDisposeClaimableWriteOff(
  request: Request,
  db: Database,
  env: Env,
  pathname: string,
): Promise<Response> {
  const auth = await authenticateApiRequest(request, env, db);
  if (auth instanceof Response) return auth;
  const transactionId = parsePositiveInt(pathname.split('/')[4] ?? '');
  if (transactionId == null) return errorResponse('Invalid expired transaction ID', 400, env);
  const result = await db.disposeClaimableWriteOff(auth.organizationId, transactionId);
  if (result === 'NOT_FOUND') return errorResponse('Expired transaction not found', 404, env);
  if (result === 'CLAIMED')
    return errorResponse('Expired transaction has entered a claim', 409, env);
  return jsonResponse({ transactionId, creditDisposition: 'DISPOSED' }, 200, env);
}

async function handleListCatalogueCorrections(
  request: Request,
  db: Database,
  env: Env,
): Promise<Response> {
  const auth = await authenticateApiRequest(request, env, db);
  if (auth instanceof Response) return auth;
  if (!isPlatformAdminUser(auth.userId, env.PLATFORM_ADMIN_USER_IDS)) {
    return errorResponse('Platform catalogue review access required', 403, env);
  }
  const query = new URL(request.url).searchParams;
  const cursor = query.get('cursor');
  return jsonResponse(
    await db.listCatalogueCorrections({
      status: query.get('status') ?? 'PENDING',
      cursor: cursor == null ? undefined : (parsePositiveInt(cursor) ?? undefined),
      limit: 50,
    }),
    200,
    env,
  );
}

async function handleGetCatalogueProvenance(
  request: Request,
  db: Database,
  env: Env,
): Promise<Response> {
  const auth = await authenticateApiRequest(request, env, db);
  if (auth instanceof Response) return auth;
  if (!isPlatformAdminUser(auth.userId, env.PLATFORM_ADMIN_USER_IDS)) {
    return errorResponse('Platform catalogue review access required', 403, env);
  }
  return jsonResponse(await db.getCatalogueProvenance(), 200, env);
}

async function handleReviewCatalogueCorrection(
  request: Request,
  db: Database,
  env: Env,
  pathname: string,
): Promise<Response> {
  const auth = await authenticateApiRequest(request, env, db);
  if (auth instanceof Response) return auth;
  if (!isPlatformAdminUser(auth.userId, env.PLATFORM_ADMIN_USER_IDS)) {
    return errorResponse('Platform catalogue review access required', 403, env);
  }
  const id = parsePositiveInt(pathname.split('/')[4] ?? '');
  const body = (await request.json().catch(() => null)) as { status?: unknown } | null;
  const status = body?.status;
  const validStatus = ['ACCEPTED', 'REJECTED'].includes(String(status));
  if ([id == null, !validStatus].includes(true)) {
    return errorResponse('Status must be ACCEPTED or REJECTED', 400, env);
  }
  const result = await db.reviewCatalogueCorrection(
    id as number,
    status as 'ACCEPTED' | 'REJECTED',
  );
  if (result === 'NOT_FOUND') return errorResponse('Catalogue correction not found', 404, env);
  if (result === 'ALREADY_REVIEWED') {
    return errorResponse('Catalogue correction has already been reviewed', 409, env);
  }
  return jsonResponse({ id, status }, 200, env);
}

/**
 * GET /api/supplier-credits/claimable-pool
 */
async function handleGetClaimablePool(request: Request, db: Database, env: Env): Promise<Response> {
  const auth = await authenticateApiRequest(request, env, db);
  if (auth instanceof Response) return auth;

  const pool = await db.getClaimablePool(auth.organizationId);
  return jsonResponse(pool, 200, env);
}

/**
 * GET /api/supplier-credits/recovery-report
 */
async function handleGetRecoveryReport(
  request: Request,
  db: Database,
  env: Env,
): Promise<Response> {
  const auth = await authenticateApiRequest(request, env, db);
  if (auth instanceof Response) return auth;

  const report = await db.getRecoveryReport(auth.organizationId);
  return jsonResponse(report, 200, env);
}

/**
 * GET /api/supplier-credits/claims?view=open|settled|all
 */
async function handleListCreditClaims(request: Request, db: Database, env: Env): Promise<Response> {
  const auth = await authenticateApiRequest(request, env, db);
  if (auth instanceof Response) return auth;

  const view = new URL(request.url).searchParams.get('view');
  const statuses =
    view === 'open'
      ? OPEN_CREDIT_CLAIM_STATUSES
      : view === 'settled'
        ? SETTLED_CREDIT_CLAIM_STATUSES
        : undefined;
  const claims = await db.listCreditClaims(auth.organizationId, statuses);
  return jsonResponse(claims, 200, env);
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
    const tier = await getOrganizationLaunchTier(auth.organizationId, db);
    const maxSkus = resolveMaxSkus(tier, env);
    const enforced = isUsageEnforcementEnabled(env);
    const input = {
      barcode: body.barcode,
      sku: body.sku ?? null,
      name: body.name,
      costPrice: typeof body.costPrice === 'number' ? body.costPrice : 0,
      notes: typeof body.notes === 'string' ? body.notes : '',
    };

    let product = await db.createProduct(auth.organizationId, input, maxSkus);
    if (!product) {
      logUsageLimitReached({
        resource: 'SKU',
        organizationId: auth.organizationId,
        tier,
        limit: maxSkus,
        enforced,
      });
      if (enforced) {
        return usageLimitResponse('SKU', maxSkus, env);
      }
      // Measure-only: re-run the same statement with the cap lifted. The first
      // attempt inserted nothing (it returned no rows), so this is the only
      // write, not a second one.
      product = await db.createProduct(auth.organizationId, input, UNLIMITED_CAP);
      if (!product) {
        console.error('handleCreateProduct: uncapped retry inserted no row');
        return errorResponse('Internal server error', 500, env);
      }
    }
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
    const tier = await getOrganizationLaunchTier(auth.organizationId, db);
    const maxActiveExpiries = resolveMaxActiveExpiries(tier, env);
    const enforced = isUsageEnforcementEnabled(env);
    const input = {
      productId,
      expiryDate,
      locationId,
      status: typeof body.status === 'string' ? body.status : undefined,
    };

    let item = await db.createInventoryItem(
      auth.organizationId,
      auth.userId,
      input,
      maxActiveExpiries,
    );
    if (!item) {
      logUsageLimitReached({
        resource: 'active expiry item',
        organizationId: auth.organizationId,
        tier,
        limit: maxActiveExpiries,
        enforced,
      });
      if (enforced) {
        return usageLimitResponse('active expiry item', maxActiveExpiries, env);
      }
      // Measure-only. The refused attempt wrote neither the item nor its audit
      // row (both live in one CTE), so the retry is the only write.
      item = await db.createInventoryItem(auth.organizationId, auth.userId, input, UNLIMITED_CAP);
      if (!item) {
        console.error('handleCreateInventoryItem: uncapped retry inserted no row');
        return errorResponse('Internal server error', 500, env);
      }
    }
    return jsonResponse(item, 201, env);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    if (isReferentialError(message)) {
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
    // Both product and location references are validated against the caller's
    // organization, so either rejection is a client error rather than a fault.
    // Shared with `handleCreateInventoryItem` via `isReferentialError`, whose
    // messages are defined next to the throws in database.ts — a third
    // reference check added there is handled here without an edit.
    if (isReferentialError(message)) {
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
    parentId?: number | null;
    parent_id?: number | null;
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
      parentId: body.parentId ?? body.parent_id ?? null,
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
    parentId?: number | null;
    parent_id?: number | null;
  };

  const data: { name?: string; subDepartment?: string | null; parentId?: number | null } = {};
  if (typeof body.name === 'string') data.name = body.name.trim();
  if (body.subDepartment !== undefined) {
    data.subDepartment = body.subDepartment ?? null;
  } else if (body.sub_department !== undefined) {
    data.subDepartment = body.sub_department ?? null;
  }
  if (body.parentId !== undefined) {
    data.parentId = body.parentId;
  } else if (body.parent_id !== undefined) {
    data.parentId = body.parent_id;
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

  if (body.action === 'expired') {
    if (!isPositiveInteger(body.unitsDiscarded)) {
      return {
        ok: false,
        message: 'Units discarded must be a positive number when marking as expired',
      };
    }
    return {
      ok: true,
      inventoryItemId: body.inventoryItemId,
      action: body.action,
      unitsDiscarded: body.unitsDiscarded,
    };
  }

  return {
    ok: true,
    inventoryItemId: body.inventoryItemId,
    action: body.action,
    unitsDiscarded: undefined,
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
    // Predictable client-input failures — e.g. available stock changed between
    // the worklist loading and the user submitting (race). These are 400s, not
    // server faults, so surface the real message and keep them out of the
    // 500/Sentry path.
    if (message.includes('Cannot discard') || message.includes('must be a positive number')) {
      return errorResponse(message, 400, env);
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

type SubscriptionSettingsRow = {
  status?: string | null;
  tier_level?: string | null;
  billing_cycle?: string | null;
  trial_end_date?: string | null;
  current_period_end?: string | null;
  cancel_at_period_end?: boolean | null;
};

type OrganizationUsageRow = {
  total_skus?: number | string | null;
  active_users?: number | string | null;
  storage_used_bytes?: number | string | null;
  total_inventory_items?: number | string | null;
  max_users?: number | string | null;
  max_skus?: number | string | null;
  max_inventory_items?: number | string | null;
};

const toNullableLimit = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value);

const mapSubscriptionSettingsResponse = (subscription?: SubscriptionSettingsRow) => ({
  tierLevel: normalizeLaunchTier(subscription?.tier_level),
  status: String(subscription?.status || 'expired').toLowerCase(),
  billingCycle: subscription?.billing_cycle || 'monthly',
  currentPeriodEnd: subscription?.current_period_end || null,
  cancelAtPeriodEnd: subscription?.cancel_at_period_end ?? false,
});

// The frontend SubscriptionDashboard renders each resource as a
// "{current} / {limit}" progress bar, so the API MUST return a nested
// { current, limit } pair per resource -- not a flat number.
//
// Every `current` is a live count and every `limit` comes from the org's tier,
// because the `organization_usage` columns these once read are written as
// literal zeros and never maintained (task 3.1.a): the endpoint reported 0 of
// N for every organization, so the dashboard bars sat empty and the frontend's
// 80% UsageWarning (frontend/src/components/UsageWarning.tsx) could never
// trigger. `users.current` is now accurate too, though the user limit itself
// is still not enforced on either backend -- see the 3.1.a note in tasks.md.
const mapOrganizationUsageResponse = (
  counts: UsageCounts,
  storageUsedBytes: number,
  tier: LaunchTier,
  env: Env,
) => ({
  skus: {
    current: counts.skus,
    limit: resolveMaxSkus(tier, env),
  },
  users: {
    current: counts.users,
    limit: LAUNCH_TIER_USER_LIMITS[tier],
  },
  storage: {
    current: storageUsedBytes,
    limit: resolveStorageLimitBytes(tier),
  },
  inventoryItems: {
    current: counts.activeExpiries,
    limit: resolveMaxActiveExpiries(tier, env),
  },
});

/**
 * GET /api/subscription/current
 */
async function handleGetCurrentSubscription(
  request: Request,
  db: Database,
  env: Env,
): Promise<Response> {
  const auth = await authenticateApiRequest(request, env, db);
  if (auth instanceof Response) {
    return auth;
  }

  const rows = await db.sql`
    SELECT
      status,
      tier_level,
      billing_cycle,
      trial_end_date,
      current_period_end,
      cancel_at_period_end
    FROM subscription_tiers
    WHERE organization_id = ${auth.organizationId}
    ORDER BY created_at DESC
    LIMIT 1
  `;

  return jsonResponse(
    mapSubscriptionSettingsResponse(rows[0] as SubscriptionSettingsRow),
    200,
    env,
  );
}

/**
 * GET /api/organization/usage
 */
async function handleGetOrganizationUsage(
  request: Request,
  db: Database,
  env: Env,
): Promise<Response> {
  const auth = await authenticateApiRequest(request, env, db);
  if (auth instanceof Response) {
    return auth;
  }

  // NOTE: this GET still seeds `organization_usage`, and nothing on this path
  // reads it any more -- 3.1.a moved the response onto live counts precisely
  // because these columns are written once as literal zeros and maintained
  // nowhere. The hardcoded free-tier values below (max_users 1, max_skus 500)
  // are seeded for every org regardless of tier, which is the mis-seeding
  // hazard task 3.1.j(a) tracks.
  //
  // It is left in place rather than removed here because the row's one
  // remaining reader is the seat gate in `handleCreateLegacyUser`
  // (`active_users`, always 0, so it never fires). Removing the seed and that
  // gate together is 3.1.j(a)'s job; removing the seed alone would leave the
  // gate reading a row that may not exist, and that is an auth-adjacent path
  // whose fate is an owner decision, not a tidy-up.
  await db.sql`
    INSERT INTO organization_usage (
      organization_id,
      active_users,
      max_users,
      total_skus,
      max_skus,
      total_inventory_items,
      max_inventory_items,
      storage_used_bytes,
      created_at,
      updated_at
    )
    VALUES (${auth.organizationId}, 0, 1, 0, 500, 0, 500, 0, NOW(), NOW())
    ON CONFLICT (organization_id) DO NOTHING
  `;

  const tier = await getOrganizationLaunchTier(auth.organizationId, db);
  const [counts, storageUsedBytes] = await Promise.all([
    db.getUsageCounts(auth.organizationId),
    db.getStorageUsedBytes(auth.organizationId),
  ]);

  return jsonResponse(mapOrganizationUsageResponse(counts, storageUsedBytes, tier, env), 200, env);
}

// A missing products.retail_price column (migration 0003 not applied) is
// reported distinctly from "column present, zero retail rows": the GET path
// degrades either way, but the PUT path must tell them apart so a retail-based
// save returns an actionable 503 rather than a misleading 400.
async function organizationHasRetailData(
  organizationId: string,
  db: Database,
): Promise<{ hasRetailData: boolean; retailColumnMissing: boolean }> {
  try {
    const rows = await db.sql`
      SELECT id
      FROM products
      WHERE organization_id = ${organizationId}
        AND retail_price IS NOT NULL
      LIMIT 1
    `;
    return { hasRetailData: rows.length > 0, retailColumnMissing: false };
  } catch (error) {
    // The products.retail_price column ships in Neon migration 0003 (#338). If
    // it is missing the migration has not been applied yet — degrade to
    // cost-only (no retail data) so markdown config still loads, rather than
    // 500-ing with a raw NeonDbError. Log loudly so ops can spot the un-applied
    // migration.
    if (isMissingSchemaError(error)) {
      console.error(
        'organization_markdown_config: products.retail_price column missing — apply Neon migration 0003_add_configurable_markdown_matrix. Falling back to cost-only.',
      );
      return { hasRetailData: false, retailColumnMissing: true };
    }
    throw error;
  }
}

// Shared 503 for when Neon migration 0003 (#338) has not been applied, so the
// markdown config schema (organization_markdown_config table / retail_price
// column) is missing.
function markdownSchemaMissingResponse(env: Env): Response {
  return errorResponse(
    'Markdown settings storage is not ready yet. The database migration for this feature has not been applied — please contact your administrator.',
    503,
    env,
  );
}

async function getOrganizationMarkdownMatrices(
  organizationId: string,
  db: Database,
): Promise<MarkdownMatrixSet> {
  try {
    const rows = await db.sql`
      SELECT
        credit_scope,
        band1_percentage,
        band2_percentage,
        band3_percentage,
        band1_basis,
        band2_basis,
        band3_basis
      FROM organization_markdown_config
      WHERE organization_id = ${organizationId}
    `;
    const scoped = new Map(
      rows.map((row) => [String(row.credit_scope ?? 'NO_CREDIT'), row as MarkdownConfigRow]),
    );
    return {
      NO_CREDIT: markdownConfigRowToMatrix(scoped.get('NO_CREDIT'), DEFAULT_MARKDOWN_MATRIX),
      FULL_CREDIT: markdownConfigRowToMatrix(
        scoped.get('FULL_CREDIT'),
        DEFAULT_FULL_CREDIT_MARKDOWN_MATRIX,
      ),
    };
  } catch (error) {
    // organization_markdown_config ships in Neon migration 0003 (#338). If the
    // table is missing, fall back to the default matrix (cost-only ladder) so
    // Settings still renders instead of 500-ing. markdownConfigRowToMatrix(undefined)
    // returns those defaults.
    if (isMissingSchemaError(error)) {
      console.error(
        'organization_markdown_config table missing — apply Neon migration 0003_add_configurable_markdown_matrix. Falling back to default matrix.',
      );
      return DEFAULT_MARKDOWN_MATRIX_SET;
    }
    throw error;
  }
}

/**
 * GET /api/markdown-config
 */
async function handleGetMarkdownConfig(
  request: Request,
  db: Database,
  env: Env,
): Promise<Response> {
  const auth = await authenticateApiRequest(request, env, db);
  if (auth instanceof Response) {
    return auth;
  }

  const [matrices, retailData] = await Promise.all([
    getOrganizationMarkdownMatrices(auth.organizationId, db),
    organizationHasRetailData(auth.organizationId, db),
  ]);

  return jsonResponse(
    { matrices, matrix: matrices.NO_CREDIT, hasRetailData: retailData.hasRetailData },
    200,
    env,
  );
}

/**
 * PUT /api/markdown-config
 */
async function handleUpdateMarkdownConfig(
  request: Request,
  db: Database,
  env: Env,
): Promise<Response> {
  const auth = await authenticateApiRequest(request, env, db);
  if (auth instanceof Response) {
    return auth;
  }
  if (!canManageUsers(auth.role)) {
    return errorResponse('Only admins can update markdown settings', 403, env);
  }

  const body = await request.json().catch(() => null);
  const parsedMatrices = parseMarkdownMatrixRequest(body);
  if (typeof parsedMatrices === 'string') {
    return errorResponse(parsedMatrices, 400, env);
  }

  const { hasRetailData, retailColumnMissing } = await organizationHasRetailData(
    auth.organizationId,
    db,
  );
  if (Object.values(parsedMatrices.matrices).some(matrixUsesRetail)) {
    // A missing retail_price column means migration 0003 is not applied — the
    // save cannot honour retail bands, and telling the user to "upload retail
    // prices" would be unactionable. Surface it as the same 503 as the INSERT
    // path. A cost-only matrix skips this block and saves normally.
    if (retailColumnMissing) {
      return markdownSchemaMissingResponse(env);
    }
    if (!hasRetailData) {
      return errorResponse(
        'Retail-based markdowns require retail prices. Upload a catalogue with a retail (or selling price) column first.',
        400,
        env,
      );
    }
  }

  const noCredit = parsedMatrices.matrices.NO_CREDIT;
  try {
    if (parsedMatrices.legacy) {
      await db.sql`
        INSERT INTO organization_markdown_config (
          organization_id, credit_scope, band1_percentage, band2_percentage,
          band3_percentage, band1_basis, band2_basis, band3_basis, created_at, updated_at
        ) VALUES (
          ${auth.organizationId}, 'NO_CREDIT', ${noCredit.band1.percentage},
          ${noCredit.band2.percentage}, ${noCredit.band3.percentage}, ${noCredit.band1.basis},
          ${noCredit.band2.basis}, ${noCredit.band3.basis}, NOW(), NOW()
        )
        ON CONFLICT (organization_id, credit_scope) DO UPDATE SET
          band1_percentage = EXCLUDED.band1_percentage,
          band2_percentage = EXCLUDED.band2_percentage,
          band3_percentage = EXCLUDED.band3_percentage,
          band1_basis = EXCLUDED.band1_basis,
          band2_basis = EXCLUDED.band2_basis,
          band3_basis = EXCLUDED.band3_basis,
          updated_at = NOW()
      `;
    } else {
      const fullCredit = parsedMatrices.matrices.FULL_CREDIT;
      await db.sql`
      INSERT INTO organization_markdown_config (
        organization_id, credit_scope,
        band1_percentage,
        band2_percentage,
        band3_percentage,
        band1_basis,
        band2_basis,
        band3_basis,
        created_at,
        updated_at
      )
      VALUES (
        ${auth.organizationId}, 'NO_CREDIT', ${noCredit.band1.percentage},
        ${noCredit.band2.percentage}, ${noCredit.band3.percentage}, ${noCredit.band1.basis},
        ${noCredit.band2.basis}, ${noCredit.band3.basis}, NOW(), NOW()
      ), (
        ${auth.organizationId}, 'FULL_CREDIT', ${fullCredit.band1.percentage},
        ${fullCredit.band2.percentage}, ${fullCredit.band3.percentage}, ${fullCredit.band1.basis},
        ${fullCredit.band2.basis}, ${fullCredit.band3.basis}, NOW(), NOW()
      )
      ON CONFLICT (organization_id, credit_scope) DO UPDATE SET
        band1_percentage = EXCLUDED.band1_percentage,
        band2_percentage = EXCLUDED.band2_percentage,
        band3_percentage = EXCLUDED.band3_percentage,
        band1_basis = EXCLUDED.band1_basis,
        band2_basis = EXCLUDED.band2_basis,
        band3_basis = EXCLUDED.band3_basis,
        updated_at = NOW()
    `;
    }
  } catch (error) {
    // The organization_markdown_config table (and products.retail_price) ship in
    // Neon migration 0003 (#338). A missing table/column here means the migration
    // has not been applied to this database — return an actionable 503 rather than
    // leaking a raw NeonDbError to the admin.
    if (isMissingSchemaError(error)) {
      console.error(
        'handleUpdateMarkdownConfig: markdown config schema missing — apply Neon migration 0003_add_configurable_markdown_matrix.',
      );
      return markdownSchemaMissingResponse(env);
    }
    throw error;
  }

  const matrices = parsedMatrices.legacy
    ? { ...(await getOrganizationMarkdownMatrices(auth.organizationId, db)), NO_CREDIT: noCredit }
    : parsedMatrices.matrices;
  return jsonResponse({ matrices, matrix: matrices.NO_CREDIT, hasRetailData }, 200, env);
}

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

  const storageRefusal = await enforceStorageLimit(db, env, auth.organizationId, body.fileSize);
  if (storageRefusal) return storageRefusal;

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

  const storageRefusal = await enforceStorageLimit(db, env, auth.organizationId, fileValue.size);
  if (storageRefusal) return storageRefusal;

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

  const processingSummary = await processDirectUpload(
    data,
    requestedImportType,
    auth.organizationId,
    db,
  );

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

function processDirectUpload(
  data: ArrayBuffer,
  requestedImportType: string,
  organizationId: string,
  db: Database,
): Promise<UploadProcessingSummary> {
  if (requestedImportType === 'expiry-list') {
    return processExpiryListUpload(data, organizationId, db);
  }

  return processProductCatalogUpload(data, organizationId, db);
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

  const storageRefusal = await enforceStorageLimit(db, env, auth.organizationId, object.size);
  if (storageRefusal) {
    // Unlike initiate and direct, the bytes are already in R2 by the time this
    // runs, and a refused complete never reaches the `INSERT INTO uploads` in
    // `createQueuedCatalogueUpload` -- so the object would sit in the bucket
    // with no row to represent it, invisible to `getStorageUsedBytes` and
    // therefore consuming quota the gate can never see. Repeated refusals would
    // accumulate uncounted objects indefinitely. Deleting is safe: the client
    // got a 402 and can re-upload after freeing space.
    await env.CSV_UPLOADS.delete(body.key).catch((error) => {
      console.error('handleUploadComplete: failed to delete refused upload object:', error);
    });
    return storageRefusal;
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
    importType: body.importType,
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

type MarkdownConfigRow = {
  credit_scope?: string | null;
  band1_percentage?: number | string | null;
  band2_percentage?: number | string | null;
  band3_percentage?: number | string | null;
  band1_basis?: string | null;
  band2_basis?: string | null;
  band3_basis?: string | null;
};

function isMarkdownBasis(value: unknown): value is MarkdownBasis {
  return value === 'cost' || value === 'retail';
}

function markdownConfigRowToMatrix(
  row: MarkdownConfigRow | undefined,
  fallback: MarkdownMatrixConfig = DEFAULT_MARKDOWN_MATRIX,
): MarkdownMatrixConfig {
  if (!row) {
    return fallback;
  }

  return {
    band1: {
      percentage: Number(row.band1_percentage ?? fallback.band1.percentage),
      basis: isMarkdownBasis(row.band1_basis) ? row.band1_basis : 'cost',
    },
    band2: {
      percentage: Number(row.band2_percentage ?? fallback.band2.percentage),
      basis: isMarkdownBasis(row.band2_basis) ? row.band2_basis : 'cost',
    },
    band3: {
      percentage: Number(row.band3_percentage ?? fallback.band3.percentage),
      basis: isMarkdownBasis(row.band3_basis) ? row.band3_basis : 'cost',
    },
  };
}

function parseMarkdownMatrixRequest(
  value: unknown,
): { matrices: MarkdownMatrixSet; legacy: boolean } | string {
  const body = value as { matrices?: unknown } | null;
  if (body?.matrices !== undefined) {
    if (!body.matrices || typeof body.matrices !== 'object') {
      return 'matrices must include NO_CREDIT and FULL_CREDIT.';
    }
    const candidate = body.matrices as Record<string, unknown>;
    if (!CREDIT_SCOPES.every((scope) => candidate[scope] !== undefined)) {
      return 'matrices must include NO_CREDIT and FULL_CREDIT.';
    }
    const noCredit = parseMarkdownMatrix(candidate.NO_CREDIT);
    if (typeof noCredit === 'string') return `NO_CREDIT: ${noCredit}`;
    const fullCredit = parseMarkdownMatrix(candidate.FULL_CREDIT);
    if (typeof fullCredit === 'string') return `FULL_CREDIT: ${fullCredit}`;
    return { matrices: { NO_CREDIT: noCredit, FULL_CREDIT: fullCredit }, legacy: false };
  }
  const matrix = parseMarkdownMatrix(value);
  return typeof matrix === 'string'
    ? matrix
    : {
        matrices: { NO_CREDIT: matrix, FULL_CREDIT: DEFAULT_FULL_CREDIT_MARKDOWN_MATRIX },
        legacy: true,
      };
}

function parseMarkdownMatrix(value: unknown): MarkdownMatrixConfig | string {
  if (!value || typeof value !== 'object') {
    return 'Request body must be a markdown matrix.';
  }

  const matrix = value as Partial<Record<keyof MarkdownMatrixConfig, unknown>>;
  const parsed = {
    band1: parseMarkdownBand(matrix.band1, 'Markdown 1'),
    band2: parseMarkdownBand(matrix.band2, 'Markdown 2'),
    band3: parseMarkdownBand(matrix.band3, 'Markdown 3'),
  };

  for (const band of [parsed.band1, parsed.band2, parsed.band3]) {
    if (typeof band === 'string') {
      return band;
    }
  }

  const validMatrix = parsed as MarkdownMatrixConfig;
  if (
    validMatrix.band1.percentage > validMatrix.band2.percentage ||
    validMatrix.band2.percentage > validMatrix.band3.percentage
  ) {
    return 'Discounts must not decrease as expiry nears: Markdown 1 <= Markdown 2 <= Markdown 3.';
  }

  return validMatrix;
}

function parseMarkdownBand(
  value: unknown,
  label: string,
): { percentage: number; basis: MarkdownBasis } | string {
  if (!value || typeof value !== 'object') {
    return `${label} must include percentage and basis.`;
  }

  const band = value as { percentage?: unknown; basis?: unknown };
  if (
    typeof band.percentage !== 'number' ||
    !Number.isFinite(band.percentage) ||
    band.percentage < 0 ||
    band.percentage > 100
  ) {
    return `${label} percentage must be between 0 and 100.`;
  }
  if (!isMarkdownBasis(band.basis)) {
    return `${label} basis must be cost or retail.`;
  }

  return { percentage: band.percentage, basis: band.basis };
}

function matrixUsesRetail(matrix: MarkdownMatrixConfig): boolean {
  return (
    matrix.band1.basis === 'retail' ||
    matrix.band2.basis === 'retail' ||
    matrix.band3.basis === 'retail'
  );
}

/**
 * Refusal for a create that would exceed a tier cap.
 *
 * 402 rather than Express's 403 (`feature-gate.middleware.ts:346`): this Worker
 * already answers 402 on the one usage gate it shipped with
 * (`handleCreateLegacyUser`), and the frontend keys off the message rather than
 * the status, so matching the Worker's own precedent keeps the API internally
 * consistent. `retryable: false` marks it as a state the caller cannot fix by
 * retrying, only by upgrading or deleting.
 */
/**
 * Records a write that met its tier cap, in BOTH flag states.
 *
 * The event name is `usage_limit_reached`, not `would_refuse`, because with
 * enforcement on it is a refusal and with it off it is not; `enforced` carries
 * that distinction rather than the name lying in one of the two states. One
 * line of JSON so the events are greppable in `wrangler tail` and parseable by
 * Logpush without a custom decoder.
 *
 * There is no observed-count field, and that is deliberate. Emitting one would
 * cost an extra round trip on every over-cap write, and with enforcement off
 * usage is unbounded — so the question the trial actually asks (where does
 * usage land per tier) is answered by reading `getUsageCounts` at the end, not
 * by sampling it here. What this log uniquely provides is which organizations
 * crossed the provisional line, and when.
 */
function logUsageLimitReached(input: {
  resource: string;
  organizationId: string;
  tier: LaunchTier;
  limit: number;
  enforced: boolean;
  observedBytes?: number;
}): void {
  console.warn(
    JSON.stringify({
      event: 'usage_limit_reached',
      resource: input.resource,
      organizationId: input.organizationId,
      tier: input.tier,
      limit: input.limit,
      enforced: input.enforced,
      ...(input.observedBytes === undefined ? {} : { observedBytes: input.observedBytes }),
    }),
  );
}

function usageLimitResponse(resource: string, limit: number, env: Env): Response {
  return jsonResponse(
    {
      error: `${resource} limit reached for your subscription tier (max ${limit})`,
      limit,
      retryable: false,
    },
    402,
    env,
  );
}

/**
 * Refuses an upload that would take the organization past its tier storage cap.
 * Returns a 402 Response to short-circuit on, or `null` to proceed.
 *
 * Placed at the same three points Express gates it — initiate, direct and
 * complete (`backend/src/routes/upload.routes.ts:32/48/64`).
 *
 * At initiate and direct this refuses before bytes move. At complete it cannot:
 * the object is already in R2 by then, so that call site deletes it on refusal
 * rather than leaving an object no `uploads` row accounts for.
 */
async function enforceStorageLimit(
  db: Database,
  env: Env,
  organizationId: string,
  incomingBytes: number,
): Promise<Response | null> {
  let tier: LaunchTier;
  let used: number;
  try {
    tier = await getOrganizationLaunchTier(organizationId, db);
    used = await db.getStorageUsedBytes(organizationId);
  } catch (error) {
    // Fails OPEN, deliberately. This gate already undercounts (see
    // `getStorageUsedBytes`), so it is a backstop rather than a guarantee, and
    // turning a transient read failure on subscription_tiers into a rejected
    // upload costs a customer real work to protect a quota we cannot measure
    // exactly anyway. The upload handlers have no catch of their own, so
    // without this a blip here would surface as an unhandled throw rather than
    // a clean response.
    console.error('enforceStorageLimit: quota check failed, allowing upload:', error);
    return null;
  }

  const limit = resolveStorageLimitBytes(tier);
  if (used + incomingBytes > limit) {
    const enforced = isUsageEnforcementEnabled(env);
    // `used` is already in hand here, so unlike the row-count gates this one
    // can report the observed total without paying for another query.
    logUsageLimitReached({
      resource: 'Storage',
      organizationId,
      tier,
      limit,
      enforced,
      observedBytes: used + incomingBytes,
    });
    if (enforced) {
      return usageLimitResponse('Storage', limit, env);
    }
  }
  return null;
}

/**
 * The tier to enforce limits against — the stored tier while the subscription
 * holds, `free` once it has lapsed (#489).
 *
 * Degrading here rather than at each call site is what makes the rule reach
 * every quota at once: interactive creates, queued catalogue imports and the
 * storage cap all resolve their tier through this function.
 */
export async function getOrganizationLaunchTier(
  organizationId: string,
  db: Database,
): Promise<LaunchTier> {
  const rows = await db.sql`
    SELECT tier_level,
           status,
           trial_end_date,
           current_period_end,
           cancel_at_period_end,
           past_due_since
    FROM subscription_tiers
    WHERE organization_id = ${organizationId}
    ORDER BY created_at DESC
    LIMIT 1
  `;
  return deriveSubscriptionAccess(rows[0] as SubscriptionAccessRow | undefined).effectiveTier;
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
  const maxSkus = resolveMaxSkus(input.tier, input.env);
  const maxActiveExpiries = resolveMaxActiveExpiries(input.tier, input.env);
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
