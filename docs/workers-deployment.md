# Cloudflare Workers Deployment to Preview Environment

This document describes how to deploy and test the Cloudflare Workers to the preview environment.

## Overview

The Workers deployment process includes:
1. Building the Workers bundle
2. Deploying to preview environment (development)
3. Testing the preview deployment
4. Verifying health checks and API endpoints

## Prerequisites

- Wrangler CLI installed globally: `npm install -g wrangler`
- Cloudflare account with Workers configured
- Neon database credentials available
- R2 bucket credentials available (if testing file uploads)

## Deployment

### Build the Workers

```bash
cd workers
npm run build
```

**Output**:
```
dist/index.js         254.8kb
dist/index.js.map     443.9kb
✅ Workers build completed successfully
```

### Deploy to Preview Environment

```bash
# Deploy to development environment (preview)
cd workers
npm run deploy:dev
```

This deploys the Workers to Cloudflare's free `workers.dev` subdomain.

**Output**:
```
✓ Uploaded date-management-api-dev (X.XXmb) in X.XXs
✓ Published at https://date-management-api-dev.{username}.workers.dev
```

### Deploy to Production

```bash
# Deploy to production environment
cd workers
npm run deploy:prod
```

## Testing the Deployment

### Run Local Tests

```bash
cd workers
npm test
```

This runs all Workers tests against the local `wrangler dev` environment.

**Test Suite Output**:
```
 ✓ src/workers-deployment.test.ts (6 tests)
   ✓ Health Check > should return 200 OK from health endpoint
   ✓ Health Check > should return valid JSON from health endpoint
   ✓ Authentication Endpoints > should return 400 for login without credentials
   ✓ CORS Headers > should include CORS headers in responses
   ✓ Rate Limiting > should apply rate limiting to anonymous requests
   ✓ Worker Performance > should respond within acceptable time

Test Files: 3 passed (3)
Tests: 19 passed (19)
```

### Test Against Deployed Preview

Once deployed, test the actual preview URL:

```bash
# Set the preview URL environment variable
export WORKERS_PREVIEW_URL="https://date-management-api-dev.{username}.workers.dev"

# Run tests against preview
npm test
```

### Manual Health Check

```bash
# Health check
curl https://date-management-api-dev.{username}.workers.dev/health
```

**Expected Response**:
```json
{
  "status": "ok",
  "timestamp": "2026-02-07T11:48:12.000Z"
}
```

## Configuration

### Environment Variables (Preview/Development)

**Set via `wrangler.toml` [env.development]**:
```toml
[env.development]
name = "date-management-api-dev"

[env.development.vars]
NODE_ENV = "development"
STORAGE_PROVIDER = "local"
```

### Secrets (Set via CLI)

Development environment secrets:
```bash
# Set Neon connection string
wrangler secret put NEON_CONNECTION_STRING --env development

# Set JWT secret
wrangler secret put JWT_SECRET --env development

# Set R2 credentials (optional for development)
wrangler secret put R2_ACCOUNT_ID --env development
wrangler secret put R2_ACCESS_KEY_ID --env development
wrangler secret put R2_SECRET_ACCESS_KEY --env development
```

## Monitoring Deployment

### View Live Logs

```bash
# Stream logs from development deployment
npm run tail

# Or specify environment
cd workers
npm run tail
```

### Performance Metrics

Workers provides built-in analytics:
1. Log in to Cloudflare Dashboard
2. Navigate to Workers → date-management-api-dev
3. View "Analytics" tab

**Key Metrics**:
- Requests per minute
- Error rate
- P50/P95/P99 latency
- CPU backend time

## Troubleshooting

### Deployment Fails with "Account ID Required"

**Solution**:
```bash
# Initialize Wrangler with account ID
wrangler login
# Follow prompts to authenticate
```

### Cold Start Too Slow

Workers should respond in <50ms typically. If slower:
1. Check Neon connection pooling (Hyperdrive)
2. Verify R2 credentials are valid
3. Check for errors in Worker logs

### 502 Bad Gateway from Worker

**Causes**:
- Network request timeout
- Database connection timeout
- R2 authentication failure

**Debug**:
```bash
# View Worker logs
wrangler tail
# Check error messages
```

## Deployment Checklist

Before deploying to production:

- [ ] Build succeeds: `npm run build`
- [ ] All tests pass: `npm test`
- [ ] Health check works: `curl https://.../health`
- [ ] Environment variables set in wrangler.toml
- [ ] Secrets configured: `wrangler secret put <KEY>`
- [ ] No errors in `wrangler tail` output
- [ ] Performance acceptable (P95 latency <200ms)
- [ ] Error rate <0.1%

## Rollback Procedure

If issues occur after deployment:

1. Revert to previous version if using Git
2. Redeploy previous version:
   ```bash
   git checkout <previous-commit>
   npm run build && npm run deploy
   ```

3. Or use Workers Gradual Rollouts:
   - Cloudflare Dashboard → Workers
   - Click deployment
   - Rollback to previous version

## Cost Notes

- **Preview/Development**: Free tier (100,000 requests/day)
- **Production**: Bundled plan ($5/month) includes unlimited requests
- Request pricing: $0.50 per million requests after quota
