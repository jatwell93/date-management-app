# Deployment Guide for Date Management Application

## Overview

Production deploys through Cloudflare Workers for the API edge, Neon PostgreSQL for the database, Cloudflare R2 for upload storage, and the frontend Pages/static deployment path. Local backend development continues to use SQLite and local filesystem storage for fast iteration.

This guide intentionally does not describe PM2, Nginx, or a production SQLite file. Those are not the current production runtime.

## Runtime Matrix

| Environment | API runtime | Database | Storage | Primary verification |
| --- | --- | --- | --- | --- |
| Local development | Express via `ts-node` | SQLite file from `DATABASE_URL=file:...` | Local filesystem via `STORAGE_PROVIDER=local` | `npm run test:dev --prefix backend` |
| Backend test | Jest with `NODE_ENV=test` | SQLite test database by default | Local/test doubles | `npm run test --prefix backend` |
| Production-like backend test | Jest Neon config | Neon PostgreSQL via `DATABASE_URL` or `NEON_CONNECTION_STRING` | R2-capable configuration | `npm run test:prod --prefix backend` |
| Workers development | Cloudflare Workers dev runtime | Neon/Hyperdrive binding when enabled | R2 dev bucket binding; local provider defaults in vars | `npm test --prefix workers` |
| Production | Cloudflare Workers | Neon PostgreSQL through Hyperdrive/secret connection string | Cloudflare R2 production bucket | Workers deploy checks, health endpoint, and smoke tests |

## Required Configuration

### Backend Local Development

Use [backend/.env.example](../.env.example) as the source of truth:

```bash
NODE_ENV=development
DATABASE_PROVIDER=sqlite
DATABASE_URL=file:./database.sqlite
DATABASE_PATH=./database.sqlite
STORAGE_PROVIDER=local
UPLOAD_DIR=./uploads
```

Run:

```bash
npm install --prefix backend
npm run migrate --prefix backend
npm run dev --prefix backend
```

### Production Secrets

Production secrets must be set in Cloudflare/Doppler, not committed:

```bash
wrangler secret put NEON_CONNECTION_STRING --env production
wrangler secret put JWT_SECRET --env production
wrangler secret put CLERK_SECRET_KEY --env production
wrangler secret put CLERK_WEBHOOK_SECRET --env production
wrangler secret put R2_ACCOUNT_ID --env production
wrangler secret put R2_ACCESS_KEY_ID --env production
wrangler secret put R2_SECRET_ACCESS_KEY --env production
wrangler secret put R2_BUCKET_NAME --env production
wrangler secret put WORKERS_SENTRY_DSN --env production
```

Non-secret Workers variables and bindings live in [workers/wrangler.toml](../../workers/wrangler.toml). Production must keep `NODE_ENV=production`, `STORAGE_PROVIDER=r2`, the `CSV_UPLOADS` R2 binding, the Hyperdrive binding, and rate-limit/analytics bindings aligned with the deployed account.

## Deployment Process

1. Verify local backend behavior:

   ```bash
   npm run test:dev --prefix backend
   npm run type-check --prefix backend
   npm run lint --prefix backend
   ```

2. Verify production-like database behavior when Neon credentials are available:

   ```bash
   npm run test:prod --prefix backend
   ```

3. Verify Workers:

   ```bash
   npm test --prefix workers
   npm run build --prefix workers
   ```

4. Deploy Workers:

   ```bash
   npm run workers:deploy:prod --prefix backend
   ```

5. Deploy the frontend through the existing Pages/static deployment path after confirming the frontend build:

   ```bash
   npm run build --prefix frontend
   ```

## Post-Deployment Verification

- [ ] Production health endpoint returns healthy status.
- [ ] Deep health check validates database and storage connectivity where enabled.
- [ ] Authenticated API request succeeds with Clerk-authenticated context.
- [ ] Upload initiation uses R2-backed flow for production-sized files.
- [ ] Workers logs show expected environment and no startup exceptions.
- [ ] Sentry environment is `production` and captures a controlled test event if configured.
- [ ] Frontend can reach the production API origin allowed by CORS.

## Release Readiness Checklist

- [ ] Local development starts with SQLite/local storage: `npm run dev --prefix backend`.
- [ ] SQLite backend tests pass: `npm run test:dev --prefix backend`.
- [ ] Neon production-like tests pass or are explicitly waived when credentials are unavailable: `npm run test:prod --prefix backend`.
- [ ] Dual database compatibility passes before a database-affecting release: `npm run test:both --prefix backend`.
- [ ] Workers tests and build pass: `npm test --prefix workers` and `npm run build --prefix workers`.
- [ ] Frontend build passes and points at the intended API origin: `npm run build --prefix frontend`.
- [ ] Production smoke checks cover `/health`, one authenticated read, one upload initiation, and one report/dashboard read.
- [ ] Rollback target is identified in Workers deployment history before production deploy.

## Rollback Procedure

1. Identify the last known good deployment from Cloudflare Workers deployment history.
2. Roll Workers back to that deployment in the Cloudflare dashboard or redeploy the last known good commit.
3. If a database migration was involved, follow the migration-specific rollback plan before redeploying application code.
4. Verify:

   ```bash
   curl https://<production-api-host>/health
   wrangler tail --env production --format pretty
   ```

5. Confirm frontend/API compatibility after rollback with a smoke login and one read-only inventory/report request.

## Troubleshooting

| Issue | Likely cause | Check |
| --- | --- | --- |
| Worker deploy fails | Wrangler configuration or missing secret | `workers/wrangler.toml`, `wrangler secret list --env production` |
| Database connection errors | Neon URL/Hyperdrive secret mismatch | `NEON_CONNECTION_STRING`, Hyperdrive binding, Neon console status |
| Upload failures | R2 credentials or bucket binding mismatch | `CSV_UPLOADS` binding, R2 bucket name, R2 access key scope |
| CORS failures | Production origin not allowed | Workers/backend CORS vars and allowed origin configuration |
| Local tests use wrong database | `DATABASE_URL` overrides SQLite default | `backend/src/tests/setup-env.ts`, `.env`, shell environment |

## Maintenance

- Keep `.env.example`, `workers/wrangler.toml`, and this deployment guide aligned when runtime variables change.
- Prefer Neon branching or a disposable test database for production-like test runs.
- Do not restore production to SQLite as a rollback path; rollback code and migrations instead.
