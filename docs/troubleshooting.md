# Troubleshooting Guide

Common issues and their solutions for the Date Management App across development and production.

## Table of Contents

1. [Development Issues](#development-issues)
2. [Database Issues](#database-issues)
3. [Storage & Upload Issues](#storage--upload-issues)
4. [Authentication & Security](#authentication--security)
5. [Cloudflare Workers Issues](#cloudflare-workers-issues)
6. [Performance Issues](#performance-issues)
7. [Testing Issues](#testing-issues)
8. [Deployment Issues](#deployment-issues)
9. [Getting Help](#getting-help)

---

## Development Issues

### npm install fails

**Symptoms:** `ERR! code ERESOLVE` or dependency conflicts

**Solution:**

```bash
# Option 1: Use legacy peer deps (npm 7+)
npm install --legacy-peer-deps

# Option 2: Clear npm cache and retry
npm cache clean --force
npm install

# Option 3: Update npm
npm install -g npm@latest
npm install
```

### Port 8787 or 3002 already in use

**Symptoms:** `Address already in use` from `wrangler dev` (Worker, port 8787) or the frontend dev server (port 3002)

**Solutions:**

Linux/macOS:

```bash
# Find process using port
lsof -i :8787

# Kill the process
kill -9 <PID>

# Or use a different Worker port (extra args are forwarded to wrangler)
npm run dev:local --prefix workers -- --port 8788
```

Windows:

```bash
# Find process using port
netstat -ano | findstr :8787

# Kill the process
taskkill /PID <PID> /F
```

If you move the Worker to another port, point the frontend at it with `REACT_APP_API_URL` (see [local-expect-qa.md](local-expect-qa.md)).

### TypeScript compilation errors

**Symptoms:** `error TS2304: Cannot find name 'X'`

**Solution:**

```bash
# Type-check the Worker, including test files (CI runs this)
(cd workers && npm run typecheck)

# Type-check the root package (migration runner, operator tools)
npm run compile

# Clear stale build output and retry
rm -rf build/ workers/dist/
```

### Hot reload not working

**Symptoms:** Changes not reflected when saving files

**Solution:**

```bash
# Worker: wrangler dev reloads on save. If it stalls, restart it
npm run dev:local --prefix workers

# Kill any lingering processes
killall node  # or taskkill /IM node.exe /F on Windows

# Frontend: restart the dev server
npm start --prefix frontend
```

---

## Database Issues

### Migrations: pending or failed

**Symptoms:** `relation "..." does not exist`, or a column the code expects is missing

**Cause:** The database is behind the migrations in `database/migrations/`.

**Solution:**

```bash
# Show applied and pending migrations (needs the same DATABASE_URL env as migrate:apply)
npm run migrate:status

# Check the database matches the expected schema
npm run migrate:verify
```

Production schema changes are applied only by the migration runner; see [migrations.md](migrations.md) and [migrations-deploy-runbook.md](migrations-deploy-runbook.md). Do not edit a production schema by hand.

### Real-SQL tests (pglite): fail or cannot find a table

**Symptoms:** `npm run test:db` fails with `relation "..." does not exist`, or one file fails when run with the others

**Causes:** The test harness schema is behind a new migration, or a test reuses data from another test.

**Solution:**

```bash
# Run one file
cd workers
npx vitest run --config vitest.node.config.mts src/database.tenant-isolation.pglite.node.test.ts

# Run the whole real-SQL suite
npm run test:db
```

The harness applies the real migrations. If a new migration changed a column type, check that any hand-written fixture SQL in `workers/src/__tests__/pglite-db.ts` still matches it.

### Neon: Connection timeout errors

**Symptoms:** `Error: timeout` or `ECONNREFUSED`

**Causes:**

- Database is suspended (free tier suspends after 1 week)
- Network connectivity issue
- Invalid connection string
- Too many connections (connection pool exhausted)

**Solution:**

```bash
# 1. Check Neon dashboard
# https://console.neon.tech/app/projects
# Look for suspend notice or connection issues

# 2. Wake up suspended database
neon projects list
neon projects resume <project-id>

# 3. Verify connection string
echo $DATABASE_URL
psql $DATABASE_URL -c "SELECT 1"

# 4. Check connection pool
# See docs/performance.md for pool sizing

# 5. If all else fails, create new branch
neon branches create main --project-id <id>
# Update DATABASE_URL with new connection string
```

### Neon: Authentication fails

**Symptoms:** `FATAL: password authentication failed` or `role "..." does not exist`

**Solution:**

```bash
# 1. Verify credentials in Neon dashboard
# https://console.neon.tech/app/projects

# 2. Check connection string format
# Should be: postgresql://user:password@host/database?sslmode=require

# 3. Reset password in Neon dashboard
# Projects → Select project → Connection details → Reset password

# 4. Update connection string
DATABASE_URL=postgresql://new-user:new-pass@host/db?sslmode=require
npm run migrate:prod
```

### Neon: SSL/TLS connection errors

**Symptoms:** `SSL: CERTIFICATE_VERIFY_FAILED` or TLS errors

**Solution:**

```bash
# Neon requires SSL. Ensure connection string has sslmode=require
DATABASE_URL=postgresql://user:pass@host/db?sslmode=require

# If on Windows and still failing:
NODE_TLS_REJECT_UNAUTHORIZED=0 npm run start
# ⚠️ Only for local dev/testing, NEVER in production
```

---

## Storage & Upload Issues

### Local Storage: Files not persisting

**Symptoms:** Uploaded files disappear after restarting `npm run dev:local`

**Causes:** In local dev the R2 `CSV_UPLOADS` bucket runs in Miniflare's local emulation, and its state was cleared or lives in a different directory.

**Solution:**

```bash
# Local emulation state lives under workers/.wrangler/state
ls workers/.wrangler/state

# Run dev:local from the same checkout each time so the state is reused
npm run dev:local --prefix workers
```

Local R2 state is disposable. Do not rely on it between machines.

### R2: 403 Forbidden errors

**Symptoms:** "Access Denied" or 403 errors when uploading to R2

**Causes:**

- Invalid R2 credentials
- R2 bucket not created
- Insufficient permissions

**Solution:**

```bash
# 1. Verify R2 credentials
wrangler r2 bucket list

# 2. If empty, create bucket
wrangler r2 bucket create csv-uploads-prod

# 3. Check API token permissions
# https://dash.cloudflare.com/profile/api-tokens
# Token should have: Object Read, Object Write, Workspace Read

# 4. Update Wrangler config
# See: docs/cloudflare-setup.md#r2-setup

# 5. Test R2 connection
wrangler r2 object put <bucket> test.txt --path test.txt
wrangler r2 object get <bucket> test.txt
wrangler r2 object delete <bucket> test.txt
```

### R2: CORS errors on upload

**Symptoms:** `402 Bad Request - CORS error` or preflight failures

**Causes:** R2 CORS policy not configured or incorrect

**Solution:**

```bash
# 1. Verify CORS policy in R2 bucket settings
# https://dash.cloudflare.com/
# R2 → csv-uploads-prod → Settings → CORS

# 2. CORS policy should be:
{
  "CORSRules": [{
    "AllowedOrigins": ["http://localhost:3000", "https://yourdomain.com"],
    "AllowedMethods": ["GET", "PUT", "POST"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag", "x-amz-version-id"]
  }]
}

# 3. Include correct domain for production
# See: docs/cloudflare-setup.md#configuring-cors
```

### Presigned URL errors

**Symptoms:** 403 or 404 when accessing presigned URL

**Causes:**

- URL expired (default 1 hour)
- Wrong bucket or key
- Credential permissions missing

**Solution:**

```bash
# The presigned URL is valid for 1 hour
# If testing manually, regenerate the URL:
curl -X POST http://localhost:8787/api/upload/initiate \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"filename":"test.csv","fileSize":1024,"contentType":"text/csv"}'

# Check the uploadUrl is correct
# Should contain your R2 bucket name and CDN domain
```

---

## Authentication & Security

### Clerk token validation fails

**Symptoms:** `401 Unauthorized`, "Invalid or expired token", "Missing or invalid Authorization header", or "User has not completed organization bootstrap"

**Causes:**

- Token expired (Clerk session tokens are short-lived; the frontend refreshes them)
- `CLERK_SECRET_KEY` belongs to a different Clerk instance than the frontend's `REACT_APP_CLERK_PUBLISHABLE_KEY`
- The request origin is not an allowed authorized party
- The signed-in user has no `users` row yet (organization bootstrap has not run)

**Solution:**

```bash
# 1. Confirm the secret is set (production)
wrangler secret list --env production

# 2. Locally, confirm workers/.dev.vars has CLERK_SECRET_KEY from the same
#    Clerk instance as the frontend publishable key

# 3. Reproduce the verification path in tests
npm test --prefix workers -- request-authentication

# 4. If the error is "has not completed organization bootstrap", sign out and in,
#    and check the diagnostics fields in docs/local-expect-qa.md
```

### CORS errors in browser

**Symptoms:** `Access to XMLHttpRequest blocked by CORS policy`

**Causes:**

- `FRONTEND_URL` is unset or does not match the frontend origin exactly (production allows only that origin)
- Credentials not sent with request

**Solution:**

```bash
# 1. Check the Worker's FRONTEND_URL (production)
wrangler secret list --env production

# 2. Ensure it equals the frontend origin, with scheme and no trailing slash
FRONTEND_URL=https://yourdomain.com

# 3. Verify frontend sends the bearer token
// In fetch request:
fetch(url, {
  headers: { 'Authorization': `Bearer ${token}` }
})

# 4. In non-production, or with FRONTEND_URL unset, the Worker reflects any origin.
#    That is for development only: set FRONTEND_URL before a production deploy.
```

---

## Cloudflare Workers Issues

### Workers deployment fails

**Symptoms:** `Error: wrangler publish` fails with 50x error

**Solution:**

```bash
# 1. Verify Cloudflare credentials
wrangler whoami

# 2. If not authenticated, login
wrangler login

# 3. Verify wrangler.toml is correct
# See: workers/wrangler.toml

# 4. Check bundle size doesn't exceed limits
npm run build:workers
ls -lh workers/dist/

# 5. Redeploy
wrangler publish --env production
```

### Workers: Module resolution errors

**Symptoms:** `Error: Cannot find module` or import failures

**Causes:** Workers can't use Node.js built-ins or native modules

**Solution:**

```bash
# Don't import Node.js specific modules in Workers:
❌ import * as fs from 'fs'         // Node.js only
❌ import bcrypt from 'bcrypt'       // Native binding
✅ import { neon } from '@neondatabase/serverless'  // OK

# For database access in Workers, use:
- @neondatabase/serverless, through workers/src/database.ts
- Hyperdrive for connection pooling

# See: docs/workers-deployment.md
```

### Workers: Memory or timeout errors

**Symptoms:** `Worker exceeded CPU time limit` or 503 Gateway Timeout

**Causes:**

- Complex database queries
- Large file processing
- Infinite loops

**Solution:**

```bash
# 1. Check query complexity
# Log slow queries: see docs/performance.md

# 2. Optimize with indexes
# See: docs/database-migrations.md

# 3. Use caching for repeated queries
// In Workers, use KV for caching:
const cached = await KV.get('key');
if (!cached) {
  const result = await db.query(...);
  await KV.put('key', JSON.stringify(result), { expirationTtl: 3600 });
}

# 4. Reduce payload size: select only the columns the response needs
SELECT id, name, barcode FROM products WHERE organization_id = ${organizationId}
```

### Workers health check failing

**Symptoms:** `GET /health` returns 500 or `database: 'unhealthy'`

**Solution:**

```bash
# 1. Check database connection
curl https://api.yourdomain.com/health/ready

# If fails:
# 2. Verify DATABASE_URL secret is set
wrangler secret list --env production

# 3. Test Neon database directly
psql $DATABASE_URL -c "SELECT 1"

# 4. Verify Hyperdrive config if using it
# See: docs/cloudflare-setup.md#hyperdrive-setup

# 5. Check Sentry for errors
# https://sentry.io/organizations/
```

---

## Performance Issues

### Slow API responses

**Symptoms:** Responses taking >500ms

**Solution:**

```bash
# 1. Check query performance
# In Neon dashboard: Monitoring → Query Performance
# Look for queries >100ms

# 2. Add indexes
# See: docs/performance.md#adding-indexes

# 3. Watch live requests
npm run tail:prod --prefix workers

# 4. Monitor Hyperdrive pool
# Check connection pool usage in Cloudflare Dashboard

# 5. Cache read-heavy responses with KV or the Cloudflare cache
# See: docs/performance.md
```

### High memory usage

**Symptoms:** Worker errors with memory limit exceeded, or 1102 resource-limit responses

**Causes:**

- Large request body buffered whole (`request.json()` reads the entire body)
- Large file parsed in one pass
- Unbounded query result held in memory

**Solution:**

```bash
# 1. Remember the limit: an isolate has 128 MB shared with other requests
# 2. JSON bodies are capped at 1 MiB by default (workers/src/utils/body-limit.ts)
# 3. Page large reads in SQL (LIMIT/OFFSET) instead of loading every row
# 4. Offload heavy work (big CSV imports) to the queue consumer
#    See: workers/README.md ("Scheduled jobs and queues")
```

---

## Testing Issues

### Tests pass locally but fail in CI/CD

**Symptoms:** Tests pass with `npm test` but fail in GitHub Actions

**Causes:**

- Environment variable differences
- Missing services (Neon, R2)
- Race conditions

**Solution:**

```bash
# 1. Ensure .env.test is configured correctly
cp .env.example .env.test

# 2. Run with same settings as CI
npm ci  # Instead of npm install (respects lock file)
npm test

# 3. Check CI logs for actual error
# GitHub Actions → Workflows → Failed job → Logs

# 4. Run test isolation
npm test -- --forceExit  # Ensure all connections close
```

### E2E tests timing out

**Symptoms:** Playwright tests timeout after 30s

**Solution:**

```bash
# 1. Increase timeout
# In playwright.config.ts:
timeout: 60000,  // 60 seconds

# 2. Check the Worker is running
curl http://localhost:8787/health

# 3. Add debugging
// In test file:
test('my test', async ({ page }) => {
  page.on('console', msg => console.log(msg.text()));
  // ... test code
});

# 4. Run in debug mode
npx playwright test --debug

# 5. Check network isn't slow
# Network tab in test output
```

### Database test isolation issues

**Symptoms:** Tests fail when run together but pass individually

**Causes:** Shared test data, or a test that depends on another test's rows

**Solution:**

```bash
# 1. Give each test its own database: create the pglite harness in beforeEach
const harness = await createPgliteHarness();   // workers/src/__tests__/pglite-db.ts

# 2. Seed what the test needs, including a second organization
await seedOrganization(harness.pg, 'org-a');

# 3. Use unique identifiers per test
const testId = `test-${Date.now()}-${Math.random()}`;

# 4. Don't rely on test order
# Tests should be independent and runnable in any order
```

---

## Deployment Issues

### Deployment hangs or times out

**Symptoms:** `wrangler publish` or build process hangs indefinitely

**Solution:**

```bash
# 1. Check logs
wrangler tail --env production --format pretty

# 2. Increase timeout
wrangler publish --env production --no-bundle

# 3. Clear Wrangler cache
rm -rf .wrangler/

# 4. Verify network connectivity
curl https://api.cloudflare.com/

# 5. Try again with exponential backoff
# Max 5 attempts with delays
```

### Deployment succeeds but service unavailable

**Symptoms:** `https://api.yourdomain.com` returns 502 or 503

**Solution:**

```bash
# 1. Check Workers status
wrangler tail --env production

# 2. View deployment details
wrangler deployments list

# 3. Rollback if necessary
wrangler rollback --env production

# 4. Check Sentry for errors
# https://sentry.io
# Filter by recent deployments

# 5. Verify environment secrets
wrangler secret list --env production
```

---

## Getting Help

### Debug Mode

**Enable verbose logging:**

```bash
# Frontend
REACT_APP_LOG_LEVEL=debug npm start

# Workers
wrangler tail --env production --format pretty

# Test
npm test -- --verbose
```

### Logs to Check

1. **Application Logs**

   ```bash
   # Worker: Cloudflare dashboard or wrangler tail
   wrangler tail --env production
   ```

2. **Database Logs**

   ```bash
   # Neon: Check dashboard
   # https://console.neon.tech → Monitoring → Query Log
   ```

3. **Error Tracking**
   - Sentry: https://sentry.io
   - Filters: Recent errors, by service

### Common Error Messages

| Error                           | Cause                             | Solution                                |
| ------------------------------- | --------------------------------- | --------------------------------------- |
| `ENOENT: no such file`          | File/directory not found          | Check file path and existence           |
| `EACCES: permission denied`     | File permissions issue            | Run with `sudo` or fix chmod            |
| `ECONNREFUSED`                  | Service not running or wrong port | Check server is running on correct port |
| `connect ETIMEDOUT`             | Network timeout                   | Check firewall, VPN, DNS                |
| `INVALID_ARGUMENT`              | Wrong env variable format         | Validate variable syntax                |
| `SSL_CERTIFICATE_VERIFY_FAILED` | SSL/TLS issue                     | Ensure TLS setup, see database section  |
| `CORS error`                    | Frontend domain not allowed       | Set FRONTEND_URL on the Worker          |
| `401 Unauthorized`              | Invalid or expired token          | Generate new token, check secret        |

### Getting Support

If you can't resolve the issue:

1. **Check documentation**
   - This troubleshooting guide
   - [docs/developer-guide.md](developer-guide.md)
   - [docs/architecture.md](architecture.md)

2. **Check GitHub Issues**
   - Search existing issues
   - Include: OS, Node version, error message

3. **Create GitHub Issue with:**
   - Full error message
   - Steps to reproduce
   - Environment: OS, Node.js version, npm version
   - Relevant logs

4. **Sentry Error Tracking**
   - Filter by timestamp
   - Check similar errors
   - Review stack traces
