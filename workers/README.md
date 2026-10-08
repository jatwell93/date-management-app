# Cloudflare Workers Implementation Guide

## Overview

This directory is the Date Management API: a Cloudflare Worker backed by Neon Postgres (through Hyperdrive). It is the only API. The earlier Express/Prisma/SQLite backend is retired; its last revision is the tag `express-sqlite-last` (see `docs/express-retirement-recovery.md`).

## Architecture

```
workers/
├── src/
│   ├── index-minimal.ts      # Entry point: routing, auth, rate limiting, Sentry, security headers
│   ├── minimal-api-routes.ts # Route table
│   ├── database.ts           # All SQL; every tenant method takes organizationId first
│   ├── clerk/                # Clerk token verification, bootstrap, webhook
│   ├── stripe/               # Billing handlers and Stripe webhook
│   ├── scheduled/            # Hourly cron dispatcher and jobs
│   ├── notifications/        # Email queue and trial emails
│   ├── utils/                # Rate limit, security headers, body limits, env validation
│   └── health.ts             # /health endpoint
├── wrangler.toml             # Bindings, vars, queues, cron triggers
└── package.json
```

Shared domain logic lives in `shared/domain/`. Schema changes are numbered migrations in `database/migrations/`, applied by the runner in `src/database/migrations/` (see `docs/migrations.md`). Operator tools that read or seed the database (`npm run diagnose:webhook`, `npm run seed:master-catalogue`) live in the repo root `src/operations/`.

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

### Local development (wrangler dev)

`npm run dev:local` is the supported way to run the Worker as the local dev
API. It reads `workers/.dev.vars`, requires `NEON_CONNECTION_STRING`, and maps
it onto `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` so
`wrangler dev` connects directly to your own Neon branch and never touches the
Hyperdrive id declared in `wrangler.toml`.

```bash
cd workers
cp .dev.vars.example .dev.vars   # fill in NEON_CONNECTION_STRING, JWT_SECRET, CLERK_SECRET_KEY
npm install
npm run dev:local                # serves http://localhost:8787
```

The frontend dev server (Vite, port 3002) targets `http://localhost:8787` by
default — but any `REACT_APP_API_URL` or `REACT_APP_API_BASE_URL` set in
Doppler `dev` or a local `frontend/.env` overrides that. Point it at
`http://localhost:8787` or remove it, and confirm via the Expect QA panel's
`api-base-url` field (see `docs/local-expect-qa.md`). Extra args are forwarded
to wrangler: `npm run dev:local -- --log-level debug`.

**What is simulated locally:** the R2 `CSV_UPLOADS` bucket, the KV
`RATE_LIMITER` namespace, and the Queue binding run in Miniflare's local
emulation, and `STORAGE_PROVIDER=local` writes uploads to the local filesystem.
Clerk session verification still calls the real Clerk API, so
`CLERK_SECRET_KEY` must belong to the same Clerk instance as the frontend's
`REACT_APP_CLERK_PUBLISHABLE_KEY`.

**What needs the real Neon branch — pglite cannot model it.** `npm run
test:db` runs SQL correctness against the authoritative migrations in pglite,
but a WASM Postgres cannot stand in for the live driver and server:

- the `@neondatabase/serverless` transport and its pooling behaviour;
- real multi-connection concurrency, row locking, and advisory locks (the
  migration runner relies on `pg_advisory_lock`);
- runtime role grants (`app_runtime` vs the owner role used by migrations);
- extensions, collation, and query-planner differences from pglite;
- statement timeouts and real network latency/failure modes.

Run `npm run dev:local` against your Neon branch to exercise any of those.

**Known follow-up:** `[env.development]`'s Hyperdrive binding reuses the
production Hyperdrive id. `npm run dev:local` bypasses it via the local
connection-string env var, but `npm run deploy:dev` would still reach
production's Hyperdrive — create a separate dev Hyperdrive config before
anyone deploys the development environment.

### Test Commands

```bash
# Unit and handler tests (vitest, no database)
npm test

# Real-SQL tests against the authoritative migrations in pglite
npm run test:db          # also available from the repo root

# Type-check including test files (CI runs this)
npm run typecheck

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

Set in `wrangler.toml` under `[env.production.vars]` or `[env.development.vars]`. That file is the source of truth for values; the list below says what each one does.

- `NODE_ENV`: Environment name
- `STORAGE_PROVIDER`: Upload storage (`r2` for production, `local` for dev)
- `MAX_FILE_SIZE`, `ENTERPRISE_MAX_FILE_SIZE`: Maximum upload size in bytes
- `CSV_BATCH_SIZE`: Batch size for CSV processing
- `RATE_LIMIT_WINDOW`: Rate limit window in milliseconds
- `RATE_LIMIT_MAX_REQUESTS`: Max requests per window (unauthenticated)
- `RATE_LIMIT_MAX_AUTHENTICATED`: Max requests per window (authenticated)

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

## Request pipeline

`index-minimal.ts` handles every request. Order matters; read the file before changing it.

- **Security headers** are applied to every response, including ones Sentry synthesizes for an unhandled throw (`utils/security-headers.ts`).
- **Rate limiting** uses `utils/minimal-rate-limit.ts`, with separate limits for authenticated and unauthenticated requests. Responses carry `X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset`; a 429 adds `Retry-After`. Counters are keyed per client IP, in separate authenticated and unauthenticated buckets, and stored in the `RATE_LIMITER` KV namespace (in-memory fallback).
- **Auth** is `authenticateApiRequest`: verify the Clerk token, then read `organization_id` and `role` from the `users` row and check the organization's subscription entitlement. The client never supplies `organizationId`.
- **Errors** go to Sentry when `WORKERS_SENTRY_DSN` is set. Response bodies are sanitized.

### Scheduled jobs and queues

An hourly cron (`0 * * * *`) runs `scheduled/dispatcher.ts`, which runs the jobs in `scheduled/jobs/`. The catalogue import and notification email queues are declared in `wrangler.toml`; create them in Cloudflare before deploying.

## Testing

Unit and handler tests run with `npm test`. SQL behaviour, including tenant isolation, is tested against a real Postgres (pglite) with `npm run test:db`. Prefer a real-SQL test for anything that touches `database.ts`.

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

**Cause**: `RATE_LIMITER` KV binding missing, so the limiter falls back to per-isolate memory

**Fix**: Check the `RATE_LIMITER` binding in `wrangler.toml`

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

## Next Steps

1. **Load Testing**: Test with 1000+ concurrent requests (`npm run test:load` from the repo root)
2. **Custom Domain**: Configure production domain in Cloudflare dashboard

## Resources

- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [Wrangler CLI Docs](https://developers.cloudflare.com/workers/wrangler/)
- [R2 Docs](https://developers.cloudflare.com/r2/)
- [Workers Pricing](https://developers.cloudflare.com/workers/platform/pricing/)
