# Cloudflare Workers Implementation Guide

## Overview

This directory contains the production deployment code for the Date Management API using Cloudflare Workers. The implementation wraps existing Express routes with a Workers-compatible adapter, enabling serverless deployment while reusing 100% of the backend codebase.

## Architecture

```
workers/
├── src/
│   ├── index.ts                    # Main Workers entry point
│   ├── express-adapter.ts          # Express-to-Workers compatibility layer
│   ├── health.ts                   # Health check endpoint
│   ├── types/
│   │   └── env.d.ts               # Workers environment bindings
│   └── middleware/
│       ├── cors.middleware.ts      # CORS handling
│       ├── rate-limit.middleware.ts # Rate limiting
│       └── error-handler.middleware.ts # Error handling & logging
├── wrangler.toml                   # Workers configuration
├── package.json                    # Dependencies
└── tsconfig.json                   # TypeScript configuration
```

## Local Development

### Prerequisites

1. Install Wrangler CLI globally:

   ```bash
   npm install -g wrangler
   ```

2. Authenticate with Cloudflare:
   ```bash
   wrangler login
   ```

### Running Locally

```bash
cd workers
npm install
npm run dev
```

This starts a local development server at `http://localhost:8787`.

### Test Commands

```bash
# Deterministic local suite (excludes external preview deployment smoke test)
npm test

# Explicit preview deployment smoke test against WORKERS_PREVIEW_URL
npm run test:preview
```

### Testing Health Check

```bash
# Basic health check
curl http://localhost:8787/health

# Deep health check (tests R2 and database connectivity)
curl http://localhost:8787/health?deep=true
```

## Configuration

### Environment Variables

Set in `wrangler.toml` under `[env.production.vars]` or `[env.development.vars]`:

- `NODE_ENV`: Environment name (`production`, `staging`, `development`)
- `STORAGE_PROVIDER`: Storage backend (`r2` for production, `local` for dev)
- `MAX_FILE_SIZE`: Maximum upload size in bytes (default: `10485760` = 10MB)
- `CSV_BATCH_SIZE`: Batch size for CSV processing (default: `100`)
- `RATE_LIMIT_WINDOW`: Rate limit window in milliseconds (default: `60000` = 1 minute)
- `RATE_LIMIT_MAX_REQUESTS`: Max requests per window (unauthenticated) (default: `10`)
- `RATE_LIMIT_MAX_AUTHENTICATED`: Max requests per window (authenticated) (default: `100`)

### Secrets

Secrets are encrypted and set via CLI. Never commit secrets to git.

```bash
# Set production secrets
wrangler secret put NEON_CONNECTION_STRING --env production
wrangler secret put JWT_SECRET --env production
wrangler secret put CLERK_SECRET_KEY --env production
wrangler secret put CLERK_WEBHOOK_SECRET --env production
wrangler secret put R2_ACCOUNT_ID --env production
wrangler secret put R2_ACCESS_KEY_ID --env production
wrangler secret put R2_SECRET_ACCESS_KEY --env production
wrangler secret put R2_BUCKET_NAME --env production

# Optional: Sentry error monitoring
wrangler secret put WORKERS_SENTRY_DSN --env production
```

### R2 Bucket Bindings

R2 buckets are bound to the Workers environment in `wrangler.toml`:

```toml
[[env.production.r2_buckets]]
binding = "CSV_UPLOADS"
bucket_name = "csv-uploads-prod"
```

Access in code via `env.CSV_UPLOADS`.

## Deployment

### Deploy to Development

```bash
npm run deploy:dev
```

### Deploy to Production

```bash
npm run deploy:prod
```

### Verify Deployment

```bash
# Check health endpoint
curl https://date-management-api.your-subdomain.workers.dev/health

# Tail logs
npm run tail:prod
```

## Express Route Adapter

The Express adapter (`express-adapter.ts`) converts between Workers and Express request/response models:

### Workers Request → Express Request

- Parses JSON, form data, and multipart uploads
- Extracts query parameters and route params
- Provides Express-style `req.get()` method
- Maps Cloudflare headers (e.g., `CF-Connecting-IP` → `req.ip`)

### Express Response → Workers Response

- Provides `res.status()`, `res.json()`, `res.send()`
- Builds Workers Response with correct headers
- Supports middleware chains

### Example Usage

```typescript
import { adaptExpressHandler } from './express-adapter';

const handler = adaptExpressHandler(async (req, res) => {
  const data = await productService.getAllProducts();
  res.json(data);
});
```

## Middleware

### CORS

Production CORS restricts to the static allowlist plus `FRONTEND_URL`; non-production allows dynamic preview origins where tests cover that behavior:

```typescript
// Configured in cors.middleware.ts
const allowedOrigins = [
  'https://date-management-status.pages.dev',
  process.env.FRONTEND_URL,
];
```

Set `FRONTEND_URL` before production deploy. Do not rely on dynamic preview origins in production.

### Rate Limiting

Per-IP rate limiting with separate limits for authenticated and unauthenticated requests:

- **Unauthenticated**: 10 requests/minute (default)
- **Authenticated**: 100 requests/minute (default)

Rate limit headers returned:

- `X-RateLimit-Limit`: Total allowed requests
- `X-RateLimit-Remaining`: Remaining requests in window
- `X-RateLimit-Reset`: Timestamp when limit resets
- `Retry-After`: Seconds until limit resets (only on 429 responses)

### Error Handling

Centralized error handling with:

- Structured JSON logging
- Sentry integration (optional)
- Sanitization of sensitive data
- Different error messages for development vs production

## Testing

### Unit Tests

```bash
npm test
```

### Integration Tests

Testing with Miniflare (local Workers runtime):

```bash
# TODO: Add Miniflare tests
```

## Performance

### Bundle Size

Workers scripts have a 1MB limit. Measure the bundle before production deploy with:

```bash
npm run build
```

**Optimization strategies** if bundle exceeds 800KB:

- Code splitting by route group
- Tree-shaking unused dependencies
- Dynamic imports for large libraries

### Cold Start

Workers cold start time: **<10ms target**

Measured after deployment with:

```bash
curl -w "Time: %{time_total}s\n" https://your-worker.workers.dev/health
```

## Troubleshooting

### Common Issues

#### 1. "Module not found" errors

**Cause**: Missing dependency or incorrect import path

**Fix**:

```bash
cd workers
npm install
```

#### 2. "Exceeded CPU time limit"

**Cause**: CPU-intensive operation (e.g., large CSV parsing)

**Fix**: Offload to background using `ctx.waitUntil()` or Queues

#### 3. "R2 bucket not found"

**Cause**: R2 binding not configured or bucket doesn't exist

**Fix**: Check `wrangler.toml` R2 bindings match actual bucket names

#### 4. Rate limit not working

**Cause**: In-memory rate limiter resets on worker restart

**Fix**: Use KV namespace or Durable Objects for persistent rate limiting

### Debugging

Enable verbose logging:

```bash
wrangler tail --env production --format pretty
```

Check Workers dashboard:

- https://dash.cloudflare.com → Workers & Pages → date-management-api

## Limitations

### Workers Environment Constraints

- **No file system access**: Use R2 for file storage
- **10ms CPU time limit per request**: Offload heavy work to background
- **No persistent memory**: Use KV, Durable Objects, or external DB for state
- **Request size limit**: 100MB for Workers with Streams support

### Express Compatibility

**Supported:**

- ✅ Route handlers (`router.get`, `router.post`, etc.)
- ✅ Middleware chains
- ✅ `req.body`, `req.params`, `req.query`
- ✅ `res.status()`, `res.json()`, `res.send()`
- ✅ Authentication middleware

**Not Supported:**

- ❌ File uploads via `multer` (use direct R2 presigned URLs instead)
- ❌ Session middleware (use JWT tokens)
- ❌ `res.redirect()` (implement custom redirect logic)
- ❌ Streaming responses (Workers has different streaming API)

## Next Steps

1. **Import Backend Routes**: Integrate all 10 Express routes from `backend/src/routes/`
2. **Prisma Integration**: Configure Prisma client for Neon in Workers
3. **Sentry Setup**: Configure error monitoring
4. **Load Testing**: Test with 1000+ concurrent requests
5. **Custom Domain**: Configure production domain in Cloudflare dashboard

## Resources

- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [Wrangler CLI Docs](https://developers.cloudflare.com/workers/wrangler/)
- [R2 Docs](https://developers.cloudflare.com/r2/)
- [Workers Pricing](https://developers.cloudflare.com/workers/platform/pricing/)
