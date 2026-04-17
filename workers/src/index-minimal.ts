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

import { Env } from './types/env';
import { handleHealthCheck } from './health';
import { createWorkersDatabase } from './database';
import * as Sentry from '@sentry/cloudflare';

const COMPRESSION_MIN_BYTES = 1024;
const DIRECT_UPLOAD_THRESHOLD_BYTES = 2 * 1024 * 1024;
const PRESIGNED_UPLOAD_TTL_SECONDS = 15 * 60;
const CLERK_WEBHOOK_MAX_SKEW_SECONDS = 5 * 60;
const inMemoryRateLimitStore = new Map<string, { count: number; resetTime: number }>();

interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetTime: number;
}

/**
 * CORS headers for production
 */
function getCorsHeaders(env: Env, requestOrigin?: string): HeadersInit {
  // For development/testing: Allow all origins
  // In production with real domain, use FRONTEND_URL env var
  const allowAll = env.NODE_ENV !== 'production' || !env.FRONTEND_URL;

  const allowedOrigin = allowAll
    ? requestOrigin || '*'
    : env.FRONTEND_URL || 'http://localhost:3000';

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    ...(allowAll ? {} : { 'Access-Control-Allow-Credentials': 'true' }),
  };
}

/**
 * Handle CORS preflight requests
 */
function handleOptions(request: Request, env: Env): Response {
  const origin = request.headers.get('Origin') || '';
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(env, origin),
  });
}

/**
 * JSON response helper
 */
function jsonResponse(data: unknown, status = 200, env?: Env, requestOrigin?: string): Response {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(env ? getCorsHeaders(env, requestOrigin) : {}),
  };

  return new Response(JSON.stringify(data), { status, headers });
}

/**
 * Error response helper
 */
function errorResponse(message: string, status = 500, env?: Env, requestOrigin?: string): Response {
  return jsonResponse({ error: message }, status, env, requestOrigin);
}

function requestSupportsGzip(request: Request): boolean {
  const acceptEncoding = request.headers.get('Accept-Encoding') || '';
  return acceptEncoding.toLowerCase().includes('gzip');
}

function appendVaryHeader(headers: Headers, value: string): void {
  const existing = headers.get('Vary');

  if (!existing) {
    headers.set('Vary', value.toLowerCase());
    return;
  }

  const values = existing
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter((v) => v.length > 0);

  const newValue = value.toLowerCase();

  if (!values.includes(newValue)) {
    values.push(newValue);
  }

  headers.set('Vary', values.join(', '));
}

export async function maybeCompressJsonResponse(
  request: Request,
  response: Response,
): Promise<Response> {
  if (!requestSupportsGzip(request)) {
    return response;
  }

  if (request.method === 'HEAD') {
    return response;
  }

  if (!response.body) {
    return response;
  }

  if (response.headers.has('Content-Encoding')) {
    return response;
  }

  const contentType = response.headers.get('Content-Type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return response;
  }

  const rawBody = await response.arrayBuffer();
  if (rawBody.byteLength < COMPRESSION_MIN_BYTES) {
    return new Response(rawBody, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }

  const stream = new Blob([rawBody]).stream().pipeThrough(new CompressionStream('gzip'));
  const headers = new Headers(response.headers);
  headers.set('Content-Encoding', 'gzip');
  headers.delete('Content-Length');
  appendVaryHeader(headers, 'Accept-Encoding');

  return new Response(stream, {
    encodeBody: 'manual',
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function getClientIp(request: Request): string {
  return (
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0].trim() ||
    'unknown'
  );
}

function applyRateLimitHeaders(
  response: Response,
  decision: RateLimitDecision,
  retryAfterSeconds?: number,
): Response {
  const headers = new Headers(response.headers);
  headers.set('X-RateLimit-Limit', String(decision.limit));
  headers.set('X-RateLimit-Remaining', String(decision.remaining));
  headers.set('X-RateLimit-Reset', new Date(decision.resetTime).toISOString());

  if (retryAfterSeconds !== undefined) {
    headers.set('Retry-After', String(retryAfterSeconds));
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function checkRateLimit(request: Request, env: Env): Promise<RateLimitDecision> {
  const windowMs = parseInt(env.RATE_LIMIT_WINDOW || '60000', 10);
  const maxAnonymous = parseInt(env.RATE_LIMIT_MAX_REQUESTS || '5', 10);
  const maxAuthenticated = parseInt(env.RATE_LIMIT_MAX_AUTHENTICATED || '30', 10);

  const pathname = new URL(request.url).pathname;
  const isPresignedUpload = request.method === 'PUT' && pathname.includes('/upload/presigned/');
  const isAuthenticated = Boolean(request.headers.get('Authorization')) || isPresignedUpload;
  const limit = isAuthenticated ? maxAuthenticated : maxAnonymous;

  const ip = getClientIp(request);
  const keyBase = `${isAuthenticated ? 'auth' : 'anon'}:${ip}`;

  const now = Date.now();
  const currentWindow = Math.floor(now / windowMs);
  const previousWindow = currentWindow - 1;
  const currentKey = `ratelimit:${keyBase}:${currentWindow}`;
  const previousKey = `ratelimit:${keyBase}:${previousWindow}`;
  const resetTime = (currentWindow + 1) * windowMs;

  if (env.RATE_LIMITER) {
    const [currentRaw, previousRaw] = await Promise.all([
      env.RATE_LIMITER.get(currentKey),
      env.RATE_LIMITER.get(previousKey),
    ]);

    const currentCount = Number.parseInt(currentRaw || '0', 10) || 0;
    const previousCount = Number.parseInt(previousRaw || '0', 10) || 0;

    const elapsedInWindow = now - currentWindow * windowMs;
    const previousWeight = (windowMs - elapsedInWindow) / windowMs;
    const effectiveCount = currentCount + previousCount * previousWeight;

    if (effectiveCount + 1 > limit) {
      return {
        allowed: false,
        limit,
        remaining: 0,
        resetTime,
      };
    }

    const nextCurrentCount = currentCount + 1;
    await env.RATE_LIMITER.put(currentKey, String(nextCurrentCount), {
      expirationTtl: Math.ceil((windowMs * 2) / 1000),
    });

    return {
      allowed: true,
      limit,
      remaining: Math.max(0, Math.floor(limit - (effectiveCount + 1))),
      resetTime,
    };
  }

  const existing = inMemoryRateLimitStore.get(keyBase);
  if (!existing || now > existing.resetTime) {
    inMemoryRateLimitStore.set(keyBase, {
      count: 1,
      resetTime: now + windowMs,
    });

    return {
      allowed: true,
      limit,
      remaining: limit - 1,
      resetTime: now + windowMs,
    };
  }

  if (existing.count >= limit) {
    return {
      allowed: false,
      limit,
      remaining: 0,
      resetTime: existing.resetTime,
    };
  }

  existing.count += 1;
  return {
    allowed: true,
    limit,
    remaining: limit - existing.count,
    resetTime: existing.resetTime,
  };
}

/**
 * Main Workers fetch handler
 */
export default Sentry.withSentry(
  (env: any) => ({
    dsn: env.WORKERS_SENTRY_DSN || env.SENTRY_DSN,
    tracesSampleRate: 1.0, // Adjust to 0.1 later to save on free tier quota
  }),
  {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
      const url = new URL(request.url);
      const { pathname } = url;
      const method = request.method;

      const requestOrigin = request.headers.get('Origin') || '';

      // Handle CORS preflight
      if (method === 'OPTIONS') {
        return handleOptions(request, env);
      }

      try {
        // Test route for Sentry testing
        if (pathname === '/api/test-error') {
          // This will trigger an error that should be captured by Sentry
          throw new Error('Test error from Cloudflare Workers - this should be captured by Sentry');
        }

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
          const rateLimitDecision = await checkRateLimit(request, env);
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

          const uploadRouteBase = pathname.startsWith('/api/upload') ? '/api/upload' : '/upload';

          // Workers-native upload endpoints
          if (method === 'POST' && pathname === `${uploadRouteBase}/initiate`) {
            return finalizeApiResponse(handleUploadInitiate(request, env, uploadRouteBase));
          }

          if (method === 'POST' && pathname.startsWith(`${uploadRouteBase}/direct/`)) {
            const encodedKey = pathname.slice(`${uploadRouteBase}/direct/`.length);
            if (!encodedKey) {
              return finalizeApiResponse(
                errorResponse('Missing key in URL', 400, env, requestOrigin),
              );
            }
            let key: string;
            try {
              key = decodeURIComponent(encodedKey);
            } catch (error) {
              return finalizeApiResponse(
                errorResponse('Invalid key encoding', 400, env, requestOrigin),
              );
            }
            return finalizeApiResponse(handleUploadDirect(request, env, key));
          }

          if (method === 'PUT' && pathname.startsWith(`${uploadRouteBase}/presigned/`)) {
            const encodedKey = pathname.slice(`${uploadRouteBase}/presigned/`.length);
            if (!encodedKey) {
              return finalizeApiResponse(
                errorResponse('Missing key in URL', 400, env, requestOrigin),
              );
            }

            let key: string;
            try {
              key = decodeURIComponent(encodedKey);
            } catch {
              return finalizeApiResponse(
                errorResponse('Invalid key encoding', 400, env, requestOrigin),
              );
            }

            const uploadToken = url.searchParams.get('token');
            return finalizeApiResponse(handleUploadPresigned(request, env, key, uploadToken));
          }

          if (method === 'GET' && pathname.startsWith(`${uploadRouteBase}/status/`)) {
            const encodedKey = pathname.slice(`${uploadRouteBase}/status/`.length);
            if (!encodedKey) {
              return finalizeApiResponse(
                errorResponse('Missing key in URL', 400, env, requestOrigin),
              );
            }

            let key: string;
            try {
              key = decodeURIComponent(encodedKey);
            } catch {
              return finalizeApiResponse(
                errorResponse('Invalid key encoding', 400, env, requestOrigin),
              );
            }

            return finalizeApiResponse(handleUploadStatus(request, env, key));
          }

          if (method === 'POST' && pathname === `${uploadRouteBase}/complete`) {
            return finalizeApiResponse(handleUploadComplete(request, env));
          }

          // Initialize database connection for remaining API endpoints
          const db = createWorkersDatabase(env);

          // Route handling
          switch (true) {
            // Auth endpoints
            case pathname === '/api/auth/login' && method === 'POST':
              return finalizeApiResponse(handleLogin(request, db, env));

            case pathname === '/api/auth/register' && method === 'POST':
              return finalizeApiResponse(handleRegister(request, db, env));

            // User endpoints (require auth)
            case pathname === '/api/users/me' && method === 'GET':
              return finalizeApiResponse(handleGetCurrentUser(request, db, env));

            // Products endpoints
            case pathname === '/api/products' && method === 'GET':
              return finalizeApiResponse(handleGetProducts(request, db, env));

            case pathname.match(/^\/api\/products\/\d+$/) && method === 'GET':
              return finalizeApiResponse(handleGetProduct(request, db, env, pathname));

            // Inventory endpoints
            case pathname === '/api/inventory-items' && method === 'GET':
              return finalizeApiResponse(handleGetInventory(request, db, env));

            // Store areas endpoints
            case pathname === '/api/store-areas' && method === 'GET':
              return finalizeApiResponse(handleGetStoreAreas(request, db, env));

            // Dashboard endpoints
            case pathname === '/api/dashboard' && method === 'GET':
              return finalizeApiResponse(handleGetDashboard(request, db, env));

            // Subscription endpoints
            case pathname === '/api/subscription/trial-status' && method === 'GET':
              return finalizeApiResponse(handleGetTrialStatus(request, db, env));

            default:
              return finalizeApiResponse(errorResponse('Not Found', 404, env));
          }
        }

        return maybeCompressJsonResponse(request, errorResponse('Not Found', 404, env));
      } catch (error) {
        console.error('Unhandled error:', error);
        const message =
          env.NODE_ENV === 'development'
            ? error instanceof Error
              ? error.message
              : 'Unknown error'
            : 'Internal Server Error';
        return maybeCompressJsonResponse(request, errorResponse(message, 500, env, requestOrigin));
      }
    },
  },
);

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
async function createUploadToken(userId: number, key: string, env: Env): Promise<string> {
  const secret = requireJwtSecret(env);

  return await new SignJWT({ userId, key, purpose: 'upload' })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime(`${PRESIGNED_UPLOAD_TTL_SECONDS}s`)
    .setIssuedAt()
    .sign(secret);
}

/**
 * Verify short-lived upload token
 */
async function verifyUploadToken(token: string, key: string, env: Env): Promise<number | null> {
  const secret = requireJwtSecret(env);

  try {
    const { payload } = await jwtVerify(token, secret);

    const tokenUserId = Number(payload.userId);
    const tokenKey = typeof payload.key === 'string' ? payload.key : '';
    const tokenPurpose = payload.purpose;

    if (!Number.isFinite(tokenUserId) || tokenUserId <= 0) {
      return null;
    }

    if (tokenKey !== key || tokenPurpose !== 'upload') {
      return null;
    }

    return tokenUserId;
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
      'starter',
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

    try {
      const rows = await sql`
        INSERT INTO organizations (
          clerk_organization_id,
          name,
          slug,
          contact_email,
          created_at,
          updated_at
        ) VALUES (
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
 * GET /api/users/me
 */
async function handleGetCurrentUser(request: Request, db: Database, env: Env): Promise<Response> {
  const auth = await authenticateRequest(request, env);
  if (!auth) {
    return errorResponse('Unauthorized', 401, env);
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
  const auth = await authenticateRequest(request, env);
  if (!auth) {
    return errorResponse('Unauthorized', 401, env);
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
  const auth = await authenticateRequest(request, env);
  if (!auth) {
    return errorResponse('Unauthorized', 401, env);
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
  const auth = await authenticateRequest(request, env);
  if (!auth) {
    return errorResponse('Unauthorized', 401, env);
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
  const auth = await authenticateRequest(request, env);
  if (!auth) {
    return errorResponse('Unauthorized', 401, env);
  }

  const areas = await db.findStoreAreas();

  return jsonResponse(areas, 200, env);
}

/**
 * GET /api/dashboard
 */
async function handleGetDashboard(request: Request, db: Database, env: Env): Promise<Response> {
  const auth = await authenticateRequest(request, env);
  if (!auth) {
    return errorResponse('Unauthorized', 401, env);
  }

  const stats = await db.getDashboardStats();

  return jsonResponse({ stats }, 200, env);
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
  starter: {
    maxUsers: 1,
    maxProducts: 500,
    maxStoreAreas: 3,
    features: ['Basic scanning', 'Expiry tracking', 'Basic reports'],
  },
  professional: {
    maxUsers: 10,
    maxProducts: 5000,
    maxStoreAreas: 20,
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
    maxUsers: 50,
    maxProducts: 25000,
    maxStoreAreas: 100,
    features: [
      'All professional features',
      'Priority support',
      'Custom integrations',
      'API access',
    ],
  },
  concierge: {
    maxUsers: -1,
    maxProducts: -1,
    maxStoreAreas: -1,
    features: ['Unlimited everything', 'Dedicated support', 'Custom development'],
  },
};

/**
 * GET /api/subscription/trial-status
 */
async function handleGetTrialStatus(request: Request, db: Database, env: Env): Promise<Response> {
  const auth = await authenticateRequest(request, env);
  if (!auth) {
    return errorResponse('Unauthorized', 401, env);
  }

  const userRows = await db.sql`
    SELECT organization_id
    FROM users
    WHERE id = ${auth.userId}
    LIMIT 1
  `;

  const organizationId = userRows[0]?.organization_id as string | undefined;
  if (!organizationId) {
    return errorResponse('User or organization not found', 404, env);
  }

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

  const normalizedTierKey = subscription?.tier_level?.trim().toLowerCase() || 'starter';
  const tierKey = Object.prototype.hasOwnProperty.call(SUBSCRIPTION_TIER_LIMITS, normalizedTierKey)
    ? normalizedTierKey
    : 'starter';
  const tierLimits = SUBSCRIPTION_TIER_LIMITS[tierKey];

  const response: TrialStatusResponse = {
    isInTrial: normalizedStatus === 'TRIALING' && !isTrialExpired,
    isTrialExpired: normalizedStatus === 'TRIALING' && isTrialExpired,
    subscription: subscription
      ? {
          status: normalizedStatus,
          tierLevel: subscription.tier_level || 'starter',
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
): Promise<Response> {
  const auth = await authenticateRequest(request, env);
  if (!auth) {
    return errorResponse('Unauthorized', 401, env);
  }

  const body = (await request.json()) as {
    filename?: string;
    fileSize?: number;
    contentType?: string;
  };

  if (!body.filename || typeof body.fileSize !== 'number' || !body.contentType) {
    return errorResponse('Missing required fields: filename, fileSize, contentType', 400, env);
  }

  const maxFileSize = parseInt(env.MAX_FILE_SIZE || '10485760', 10);
  if (body.fileSize > maxFileSize) {
    return errorResponse(`File size exceeds maximum limit of ${maxFileSize} bytes`, 400, env);
  }

  const key = `uploads/user-${auth.userId}/${Date.now()}-${body.filename}`;

  if (body.fileSize > DIRECT_UPLOAD_THRESHOLD_BYTES) {
    const uploadToken = await createUploadToken(auth.userId, key, env);
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
      uploadUrl: `${uploadRouteBase}/direct/${encodeURIComponent(key)}`,
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

  const tokenUserId = await verifyUploadToken(uploadToken, key, env);
  if (!tokenUserId) {
    return errorResponse('Invalid or expired upload token', 403, env);
  }

  if (!key.startsWith(`uploads/user-${tokenUserId}/`)) {
    return errorResponse('Access denied: Upload key does not belong to token user', 403, env);
  }

  const maxFileSize = parseInt(env.MAX_FILE_SIZE || '10485760', 10);
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
async function handleUploadDirect(request: Request, env: Env, key: string): Promise<Response> {
  const auth = await authenticateRequest(request, env);
  if (!auth) {
    return errorResponse('Unauthorized', 401, env);
  }

  // Verify the key belongs to the authenticated user
  if (!key.startsWith(`uploads/user-${auth.userId}/`)) {
    return errorResponse('Access denied: Upload key does not belong to this user', 403, env);
  }

  const formData = await request.formData();
  const fileValue = formData.get('file') as unknown;

  if (!(fileValue instanceof File)) {
    return errorResponse('No file uploaded', 400, env);
  }

  // Re-validate file size and content type
  const maxFileSize = parseInt(env.MAX_FILE_SIZE || '10485760', 10);
  if (fileValue.size > maxFileSize) {
    return errorResponse(`File size exceeds maximum limit of ${maxFileSize} bytes`, 400, env);
  }

  // Validate content type (assuming CSV files)
  if (!fileValue.type || (!fileValue.type.includes('csv') && !fileValue.type.includes('text'))) {
    return errorResponse('Invalid file type. Only CSV files are allowed.', 400, env);
  }

  const data = await fileValue.arrayBuffer();

  await env.CSV_UPLOADS.put(key, data, {
    httpMetadata: {
      contentType: fileValue.type || 'text/csv',
    },
  });

  return jsonResponse(
    {
      message: 'File uploaded and processing started',
      key,
    },
    200,
    env,
  );
}

/**
 * POST /upload/complete and /api/upload/complete
 */
async function handleUploadComplete(request: Request, env: Env): Promise<Response> {
  const auth = await authenticateRequest(request, env);
  if (!auth) {
    return errorResponse('Unauthorized', 401, env);
  }

  const body = (await request.json()) as { key?: string };
  if (!body.key) {
    return errorResponse('Missing required field: key', 400, env);
  }

  if (!body.key.startsWith(`uploads/user-${auth.userId}/`)) {
    return errorResponse('Access denied: Upload key does not belong to this user', 403, env);
  }

  const object = await env.CSV_UPLOADS.head(body.key);
  if (!object) {
    return errorResponse('Upload not found', 404, env);
  }

  return jsonResponse({ message: 'Upload completed and processing started' }, 200, env);
}

/**
 * GET /upload/status/:key and /api/upload/status/:key
 */
export async function handleUploadStatus(
  request: Request,
  env: Env,
  key: string,
): Promise<Response> {
  const auth = await authenticateRequest(request, env);
  if (!auth) {
    return errorResponse('Unauthorized', 401, env);
  }

  if (!key.startsWith(`uploads/user-${auth.userId}/`)) {
    return errorResponse('Access denied: Upload key does not belong to this user', 403, env);
  }

  const object = await env.CSV_UPLOADS.head(key);
  if (!object) {
    return errorResponse('Upload not found', 404, env);
  }

  return jsonResponse(
    {
      status: 'complete',
      progress: 100,
      message: 'File uploaded and processed successfully',
      key,
    },
    200,
    env,
  );
}

export { handleLogin, handleRegister };
