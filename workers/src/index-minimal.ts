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

/**
 * CORS headers for production
 */
function getCorsHeaders(env: Env, requestOrigin?: string): HeadersInit {
  // For development/testing: Allow all origins
  // In production with real domain, use FRONTEND_URL env var
  const allowAll = env.NODE_ENV !== 'production' || !env.FRONTEND_URL;
  
  const allowedOrigin = allowAll 
    ? (requestOrigin || '*')
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
    .map(v => v.trim().toLowerCase())
    .filter(v => v.length > 0);

  const newValue = value.toLowerCase();

  if (!values.includes(newValue)) {
    values.push(newValue);
  }

  headers.set('Vary', values.join(', '));
}

export async function maybeCompressJsonResponse(request: Request, response: Response): Promise<Response> {
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

      if (pathname.startsWith('/api/') && !env.JWT_SECRET?.trim()) {
        const jwtErrorResponse = errorResponse('JWT_SECRET is required', 500, env, requestOrigin);
        return maybeCompressJsonResponse(request, jwtErrorResponse);
      }

      // API routes
      if (pathname.startsWith('/api/')) {
        // Initialize database connection
        const db = createWorkersDatabase(env);

        // Route handling
        switch (true) {
          // Auth endpoints
          case pathname === '/api/auth/login' && method === 'POST':
            return maybeCompressJsonResponse(request, await handleLogin(request, db, env));

          case pathname === '/api/auth/register' && method === 'POST':
            return maybeCompressJsonResponse(request, await handleRegister(request, db, env));

          // User endpoints (require auth)
          case pathname === '/api/users/me' && method === 'GET':
            return maybeCompressJsonResponse(request, await handleGetCurrentUser(request, db, env));

          // Products endpoints
          case pathname === '/api/products' && method === 'GET':
            return maybeCompressJsonResponse(request, await handleGetProducts(request, db, env));

          case pathname.match(/^\/api\/products\/\d+$/) && method === 'GET':
            return maybeCompressJsonResponse(request, await handleGetProduct(request, db, env, pathname));

          // Inventory endpoints
          case pathname === '/api/inventory-items' && method === 'GET':
            return maybeCompressJsonResponse(request, await handleGetInventory(request, db, env));

          // Store areas endpoints
          case pathname === '/api/store-areas' && method === 'GET':
            return maybeCompressJsonResponse(request, await handleGetStoreAreas(request, db, env));

          // Dashboard endpoints
          case pathname === '/api/dashboard' && method === 'GET':
            return maybeCompressJsonResponse(request, await handleGetDashboard(request, db, env));

          default:
            return maybeCompressJsonResponse(request, errorResponse('Not Found', 404, env));
        }
      }

      return maybeCompressJsonResponse(request, errorResponse('Not Found', 404, env));
    } catch (error) {
      console.error('Unhandled error:', error);
      const message = env.NODE_ENV === 'development' 
        ? (error instanceof Error ? error.message : 'Unknown error')
        : 'Internal Server Error';
      return maybeCompressJsonResponse(request, errorResponse(message, 500, env, requestOrigin));
    }
  },
});

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
    ['deriveBits']
  );
  
  const hash = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
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
      atob(storedHash).split('').map(c => c.charCodeAt(0))
    );
    
    // Extract salt (first 16 bytes)
    const salt = combined.slice(0, 16);
    const storedHashBytes = combined.slice(16);
    
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      'PBKDF2',
      false,
      ['deriveBits']
    );
    
    const hash = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: 100000,
        hash: 'SHA-256',
      },
      keyMaterial,
      256
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
  const body = await request.json() as { email: string; password: string };
  
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

  return jsonResponse({
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    },
  }, 200, env);
}

/**
 * POST /api/auth/register
 */
async function handleRegister(request: Request, db: Database, env: Env): Promise<Response> {
  const body = await request.json() as { email: string; password: string; name: string };
  
  if (!body.email || !body.password || !body.name) {
    return errorResponse('Email, password, and name are required', 400, env);
  }

  const existingUser = await db.findUserByEmail(body.email);

  if (existingUser) {
    return errorResponse('Email already registered', 409, env);
  }

  const passwordHash = await hashPassword(body.password);

  const user = await db.createUser({
    email: body.email,
    passwordHash,
    name: body.name,
    role: 'user',
  });

  const token = await createToken(user.id, env);

  return jsonResponse({
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    },
  }, 201, env);
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

  return jsonResponse({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    createdAt: user.createdAt,
  }, 200, env);
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
async function handleGetProduct(request: Request, db: Database, env: Env, pathname: string): Promise<Response> {
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

export {
  handleLogin,
  handleRegister,
};
