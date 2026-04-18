# Dual Environment Guide

Complete guide for developing and testing the Date Management App across local development and production environments.

## Table of Contents

1. [Environment Overview](#environment-overview)
2. [Development Environment Setup](#development-environment-setup)
3. [Production Environment Setup](#production-environment-setup)
4. [Switching Between Environments](#switching-between-environments)
5. [Testing in Both Environments](#testing-in-both-environments)
6. [Database Environment Differences](#database-environment-differences)
7. [Storage Environment Differences](#storage-environment-differences)
8. [Troubleshooting](#troubleshooting)

---

## Environment Overview

### Development Environment

- **Database:** SQLite (local file: `database.sqlite`)
- **Storage:** Local filesystem (`uploads/` directory)
- **Compute:** Node.js/Express server
- **Setup Time:** < 5 minutes
- **Cost:** Free
- **Connection:** localhost:3001

### Production Environment

- **Database:** Neon PostgreSQL (serverless)
- **Storage:** Cloudflare R2 (object storage)
- **Compute:** Cloudflare Workers (edge compute)
- **Setup Time:** 15-30 minutes (requires external accounts)
- **Cost:** Pay-as-you-go (free tier available)
- **Connection:** Your domain or `*.workers.dev`

---

## Development Environment Setup

### Prerequisites

- Node.js 18+
- npm 9+
- Git

### Quick Setup (5 minutes)

```bash
# Clone and enter repository
git clone <repo-url>
cd date-management-app

# Run automated setup
cd backend
npm run setup

# This will:
# - Install all dependencies
# - Create .env.development from template
# - Create SQLite database
# - Run migrations
# - Seed test data
# - Run initial tests

# Start development server
npm run dev
```

### Manual Setup

```bash
# Install dependencies
npm install

# Copy environment template
cp .env.example .env.development

# Verify these settings in .env.development:
NODE_ENV=development
DATABASE_PROVIDER=sqlite
STORAGE_PROVIDER=local
PORT=3001
JWT_SECRET=dev-secret-change-in-production

# Create and populate database
npm run migrate
npm run seed
npm run seed:tier-flags

# Start server
npm run dev
```

### Verify Development Setup

```bash
# Check server is running
curl http://localhost:3001/health

# Expected response:
# {
#   "status": "healthy",
#   "database": "connected",
#   "timestamp": "2026-03-09T12:00:00Z"
# }

# Run tests
npm test

# View database
npm run db:studio
```

---

## Production Environment Setup

### Prerequisites

1. **Neon Account** (free tier sufficient)
   - Create at https://neon.tech
   - Create PostgreSQL database project
   - Copy connection string

2. **Cloudflare Account** (free tier sufficient)
   - Create at https://cloudflare.com
   - Create R2 bucket
   - Generate API tokens (R2, Workers)
   - Create Workers service

3. **Stripe Account** (for billing)
   - Create at https://stripe.com
   - Generate API keys

### Setup Steps

**1. Configure Environment Variables**

```bash
# Copy production template
cp .env.production .env.production

# Fill in all variables:
NODE_ENV=production
DATABASE_PROVIDER=postgresql
STORAGE_PROVIDER=r2
NEON_CONNECTION_STRING=postgresql://user:pass@host/dbname?sslmode=require
R2_ACCOUNT_ID=your-account-id
R2_ACCESS_KEY_ID=your-access-key
R2_SECRET_ACCESS_KEY=your-secret-key
JWT_SECRET=$(openssl rand -base64 32)  # Generate secure secret
```

**2. Deploy Workers**

```bash
# Install Wrangler CLI globally
npm install -g wrangler

# Authenticate with Cloudflare
wrangler login

# Deploy to production
wrangler publish --env production

# Verify deployment
curl https://api.yourdomain.com/health
```

**3. Configure Workers Secrets**

```bash
# Add secrets (do NOT commit to git)
wrangler secret put DATABASE_URL --env production
wrangler secret put JWT_SECRET --env production
wrangler secret put R2_ACCOUNT_ID --env production
wrangler secret put R2_ACCESS_KEY_ID --env production

# Verify secrets are set
wrangler secret list --env production
```

**4. Deploy Frontend**

Deploy the React frontend to:

- Cloudflare Pages (recommended)
- Vercel
- Netlify
- Your own CDN

Set environment variables:

```
REACT_APP_API_URL=https://api.yourdomain.com
REACT_APP_SENTRY_DSN=your-sentry-dsn
```

### Verify Production Setup

```bash
# Health check
curl https://api.yourdomain.com/health

# Check database connection
curl https://api.yourdomain.com/health/ready

# Check Metrics
curl https://api.yourdomain.com/metrics
```

---

## Switching Between Environments

### From Development to Production

```bash
# Development (default)
NODE_ENV=development npm run dev

# Production
NODE_ENV=production npm run start
```

### Environment Detection

The application auto-detects the environment from `NODE_ENV`:

```typescript
// backend/src/config/environment.ts
export const isDevelopment = process.env.NODE_ENV === 'development';
export const isProduction = process.env.NODE_ENV === 'production';
```

Based on this, the app automatically:

- Loads the correct `.env` file
- Selects SQLite or PostgreSQL
- Selects local or R2 storage
- Configures appropriate URLs and CORS origins

---

## Testing in Both Environments

### Run Tests in Development

```bash
# All tests (SQLite)
npm test

# Specific test file
npm test -- src/tests/upload.test.ts

# With coverage
npm run test:coverage

# Watch mode
npm test -- --watch
```

### Test in Development Mode (SQLite)

```bash
NODE_ENV=development npm run test:dev
```

### Test in Production Mode (PostgreSQL/Neon)

Requires Neon database to be setup.

```bash
# Configure production connection string
cp .env.production .env.production
# Edit .env.production with Neon connection string

# Run tests against Neon
NODE_ENV=production npm run test:prod

# This creates a separate test database on Neon
# to avoid conflicts with production data
```

### Run Tests in Both Environments

```bash
# Sequential testing against both SQLite and Neon
npm run test:both

# This:
# 1. Runs all tests with SQLite
# 2. Runs all tests with Neon
# 3. Reports results from both
```

### E2E Tests

```bash
# E2E tests (requires running backend)
npm run test:e2e

# E2E tests against production
FRONTEND_URL=https://yourdomain.com npm run test:e2e:prod
```

---

## Database Environment Differences

### SQLite (Development)

| Feature         | Details                         |
| --------------- | ------------------------------- |
| **Setup**       | Automatic, no external service  |
| **Connection**  | Local file `database.sqlite`    |
| **Concurrency** | Limited, good for development   |
| **Backups**     | Copy database.sqlite file       |
| **Performance** | Fast for <1000 concurrent users |
| **Cost**        | Free                            |

**Commands:**

```bash
# Create/reset database
npm run migrate:dev

# View database with UI
npm run db:studio

# Export data
npm run db:export > backup.sql
```

### PostgreSQL/Neon (Production)

| Feature         | Details                                |
| --------------- | -------------------------------------- |
| **Setup**       | Requires Neon account (free tier OK)   |
| **Connection**  | Secure TLS connection to Neon          |
| **Concurrency** | Handles 1000+ concurrent users         |
| **Backups**     | Neon automatic backups, manual via CLI |
| **Performance** | Optimized for multi-tenant SaaS        |
| **Cost**        | Free tier or $19-99/month              |

**Commands:**

```bash
# Create/reset Neon database
npm run migrate:prod

# Neon CLI commands
neon databases list --project-id <id>
neon branches list --project-id <id>
neon branches create --project-id <id>
neon branches merge dev1 main --project-id <id>

# Export data from Neon
pg_dump postgresql://user:pass@host/db > backup.sql
```

---

## Storage Environment Differences

### Local Storage (Development)

| Feature            | Details                                 |
| ------------------ | --------------------------------------- |
| **Location**       | `uploads/` directory                    |
| **File Format**    | Direct storage, JSON metadata sidecar   |
| **Presigned URLs** | Not supported, uses direct file serving |
| **Cleanup**        | Manual deletion of files                |
| **Cost**           | Free (uses local disk)                  |

**Testing:**

```bash
# View uploaded files
ls -la uploads/

# Test upload endpoint
curl -X POST http://localhost:3001/api/upload/direct \
  -F "file=@test.csv"
```

### R2 Storage (Production)

| Feature            | Details                                      |
| ------------------ | -------------------------------------------- |
| **Location**       | Cloudflare R2 bucket                         |
| **File Format**    | Binary objects with metadata                 |
| **Presigned URLs** | Supported, 1-hour expiry default             |
| **Cleanup**        | Automatic via lifecycle rules                |
| **Cost**           | Free tier: 10GB storage + 1M API calls/month |

**Testing:**

```bash
# Test from CLI
wrangler r2 object get <bucket> <key>

# Verify bucket and lifecycle rules
# See: docs/cloudflare-setup.md#r2-setup
```

---

## Troubleshooting

### SQLite Connection Issues

**Problem:** `database.sqlite` not found or corrupted

**Solution:**

```bash
# Reset database
npm run migrate:reset

# This will:
# 1. Drop database
# 2. Recreate schema
# 3. Seed test data
```

### Neon Connection Issues

**Problem:** `Error: connect ECONNREFUSED` or authentication error

**Solution:**

```bash
# Verify connection string
echo $DATABASE_URL

# Test connection from CLI
psql $DATABASE_URL -c "SELECT 1"

# Check Neon dashboard
# https://console.neon.tech/app/projects

# Verify database is not suspended (free tier suspends after 1 week inactivity)
neon projects list
```

### Environment Variable Not Being Applied

**Problem:** Changed `.env` file but changes not reflected

**Solution:**

```bash
# Clear environment and restart
unset NODE_ENV
unset DATABASE_URL
unset STORAGE_PROVIDER

# Remove cache
rm -rf node_modules/.cache

# Restart server
npm run dev
```

### Tests Failing in One Environment But Not Other

**Problem:** Tests pass in SQLite but fail in PostgreSQL

**Likely Causes:**

- Type differences (SQLite is lenient with types)
- JSON handling differences
- Transaction behavior differences
- Decimal precision differences

**Solution:**

```bash
# Run tests for each environment separately
NODE_ENV=development npm test
NODE_ENV=production npm test

# Compare output to find differences
# Most commonly: ensure all strings, dates, decimals are properly typed
```

### R2 Upload Failures

**Problem:** 403 Forbidden or CORS errors

**Solution:**

1. Verify R2 credentials in Workers Secrets
2. Check R2 bucket CORS policy
3. Verify presigned URL hasn't expired
4. See: [docs/troubleshooting.md#r2-upload-failures](troubleshooting.md#r2-upload-failures)

---

## Best Practices

### Development

- ✅ Always use `npm run dev` (enables hot reload)
- ✅ Check `npm test` before committing
- ✅ Use `npm run db:studio` to inspect data
- ❌ Don't commit `.env` files
- ❌ Don't use production credentials in development

### Testing Both Environments

- ✅ Run `npm run test:both` before deploying
- ✅ Test actual Neon connection in CI/CD pipeline
- ✅ Compare results between SQLite and PostgreSQL
- ❌ Don't assume SQLite behavior matches PostgreSQL

### Production

- ✅ Always use `NODE_ENV=production`
- ✅ Store secrets in Wrangler, never in `.env`
- ✅ Monitor database performance
- ✅ Have rollback procedure ready
- ❌ Don't test in production directly (use staging)
