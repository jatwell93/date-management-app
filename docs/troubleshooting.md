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

### Port 3001 already in use

**Symptoms:** `Error: listen EADDRINUSE :::3001`

**Solutions:**

Linux/macOS:

```bash
# Find process using port
lsof -i :3001

# Kill the process
kill -9 <PID>

# Or use a different port
PORT=3002 npm run dev
```

Windows:

```bash
# Find process using port
netstat -ano | findstr :3001

# Kill the process
taskkill /PID <PID> /F

# Or use a different port
set PORT=3002 && npm run dev
```

### TypeScript compilation errors

**Symptoms:** `error TS2304: Cannot find name 'X'`

**Solution:**

```bash
# Regenerate Prisma client
npx prisma generate

# Clear TypeScript cache
rm -rf dist/ .tsbuildinfo

# Retry
npm run build
```

### Hot reload not working

**Symptoms:** Changes not reflected when saving files

**Solution:**

```bash
# Verify nodemon is installed
npm ls nodemon

# If not, reinstall
npm install --save-dev nodemon

# Kill any lingering processes
killall node  # or taskkill /IM node.exe /F on Windows

# Restart development server
npm run dev
```

---

## Database Issues

### SQLite: "database.sqlite-wal" locked errors

**Symptoms:** `SQLITE_BUSY` or "database is locked"

**Causes:** Multiple simultaneous connections, unfinished transactions

**Solution:**

```bash
# Option 1: Restart the server
npm run dev

# Option 2: Remove WAL files and reset
rm database.sqlite*
npm run migrate:dev

# Option 3: Check for zombie processes
ps aux | grep node
kill -9 <PID>

# Option 4: Clear test locks
npm run test -- --forceExit
```

### SQLite: Database reset fails

**Symptoms:** `npx prisma migrate reset` hangs or fails

**Solution:**

```bash
# Kill any active connections
lsof | grep database.sqlite  # macOS/Linux
netstat -an | findstr database.sqlite  # Windows

# Remove database file and reset
rm database.sqlite*

# Run migration again
npx prisma migrate dev --name init
```

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

**Symptoms:** Uploaded files disappear after server restart

**Causes:** Files stored in upload directory that was deleted

**Solution:**

```bash
# Ensure uploads/ directory is writable
mkdir -p uploads/
chmod 755 uploads/

# Check file ownership
ls -la uploads/

# If ownership is wrong
chown $USER:$USER uploads/

# Don't add uploads/ to .gitignore accidentally
git check-ignore uploads/
```

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
curl -X POST http://localhost:3001/api/upload/initiate \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"filename":"test.csv","fileSize":1024,"contentType":"text/csv"}'

# Check the uploadUrl is correct
# Should contain your R2 bucket name and CDN domain
```

---

## Authentication & Security

### JWT token validation fails

**Symptoms:** `401 Unauthorized` or "Invalid token"

**Causes:**

- Token expired
- Wrong JWT_SECRET
- Token malformed

**Solution:**

```bash
# 1. Verify JWT_SECRET is consistent
echo $JWT_SECRET

# 2. Test token generation
npm run test -- auth.test.ts

# 3. Check token expiry
# Tokens expire in 24 hours by default
# See: backend/src/services/auth.service.ts

# 4. For Workers, verify JWT_SECRET is in Secrets
wrangler secret list --env production
```

### CORS errors in browser

**Symptoms:** `Access to XMLHttpRequest blocked by CORS policy`

**Causes:**

- Frontend domain not in CORS_ORIGIN allowlist
- Credentials not sent with request

**Solution:**

```bash
# 1. Check CORS configuration
echo $CORS_ORIGIN

# 2. Ensure frontend domain is included
CORS_ORIGIN=http://localhost:3000,https://yourdomain.com

# 3. Verify frontend sends credentials
// In fetch request:
fetch(url, {
  credentials: 'include',  // Required for CORS
  headers: { 'Authorization': `Bearer ${token}` }
})

# 4. For development, temporarily allow all origins
CORS_ORIGIN="*"  # Only for dev! Uses stricter config in prod
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
❌ import sqlite3 from 'sqlite3'     // Native binding
✅ import { Prisma } from '@prisma/client'  // OK

# For database access in Workers, use:
- @neondatabase/serverless (recommended)
- @vercel/postgres
- With Hyperdrive for connection pooling

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

# 4. Reduce payload size with Prisma select
const users = await db.user.findMany({
  select: { id: true, email: true },  // Only needed fields
})
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

# 3. Profile with DevTools
NODE_OPTIONS=--inspect npm run dev
# Open chrome://inspect

# 4. Monitor Hyperdrive pool
# Check connection pool usage in Cloudflare Dashboard

# 5. Enable response caching for read-heavy endpoints
# See: backend/src/middleware/cache.middleware.ts
```

### High memory usage

**Symptoms:** Memory usage grows over time, server crashes

**Causes:**

- Memory leak in service code
- Large file buffering
- Connection pooling issue

**Solution:**

```bash
# 1. Monitor memory
node --max-old-space-size=4096 index.js  # Increase heap

# 2. Profile with Node inspector
node --inspect=9229 index.js
# Visit: chrome://inspect → Target → Memory tab

# 3. Check for unfinished streams or connections
# Ensure all file uploads are streamed, not buffered
// Bad:
const data = await readFile(path);  // Loads entire file in memory
// Good:
const stream = fs.createReadStream(path);
stream.pipe(destination);

# 4. Monitor Prisma connection pool
// In backend/src/services/db.service.ts
console.log(prisma.$metrics.connectionStats());
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

# 2. Check backend is running
curl http://localhost:3001/health

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

**Causes:** Shared test data, transaction conflicts

**Solution:**

```bash
# 1. Use transactions for test cleanup
// In beforeEach/afterEach:
const tx = await prisma.$transaction(async (tx) => {
  // Test runs in transaction
  // Auto-rollback on completion
});

# 2. Reset database between test files
npm test -- --setupFilesAfterEnv=test-setup.js

# 3. Use unique identifiers per test
const testId = `test-${Date.now()}-${Math.random()}`;
const user = await db.user.create({ data: { email: `${testId}@test.com` } });

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
wrangler publish --env production --verbose

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

# Backend
DEBUG=* npm run dev

# Workers
wrangler publish --env production --verbose

# Test
npm test -- --verbose
```

### Logs to Check

1. **Application Logs**

   ```bash
   # Backend: backend/logs/ or console output
   npm run dev 2>&1 | tee app.log

   # Workers: CloudFlare dashboard or wrangler tail
   wrangler tail --env production
   ```

2. **Database Logs**

   ```bash
   # SQLite: Enable query logging
   DATABASE_DEBUG=1 npm run dev

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
| `CORS error`                    | Frontend domain not allowed       | Add to CORS_ORIGIN allowlist            |
| `401 Unauthorized`              | Invalid or expired token          | Generate new token, check secret        |

### Getting Support

If you can't resolve the issue:

1. **Check documentation**
   - This troubleshooting guide
   - [docs/developer-guide.md](developer-guide.md)
   - [docs/dual-environment-guide.md](dual-environment-guide.md)

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
