# Environment Setup

## Overview

This project runs one API, the Cloudflare Worker, in two environments:

- **Development**: `npm run dev:local --prefix workers` (Wrangler dev) against your own Neon branch, with local R2 emulation
- **Production**: Cloudflare Workers + Neon + R2

The Worker reads its configuration from `workers/wrangler.toml` (vars), Wrangler secrets (deployed) and `workers/.dev.vars` (local). The earlier Express backend and its `.env.development` / `.env.production` files are retired.

## Development

1. Copy the template:
   - `cp workers/.dev.vars.example workers/.dev.vars`
2. Ensure the following minimum values are set:
   - `NEON_CONNECTION_STRING` — the pooled URL for YOUR OWN Neon development branch. Never production.
   - `JWT_SECRET` — any random local value
   - `CLERK_SECRET_KEY` — from the same Clerk instance as the frontend's `REACT_APP_CLERK_PUBLISHABLE_KEY`
   - `FRONTEND_URL` — the frontend dev origin

Development needs a Neon branch and Clerk keys. It does not need R2 credentials: `STORAGE_PROVIDER=local` uses Miniflare's local R2 emulation.

## Production (Template)

Production values are set as Wrangler secrets and in `workers/wrangler.toml`; see [`cloudflare-setup.md`](./cloudflare-setup.md). Replace placeholders with real values:

- `NEON_CONNECTION_STRING` (and the Hyperdrive binding)
- `JWT_SECRET`, `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SECRET`
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- `R2_*` credentials where the S3 API is used

## Key Variables

- `STORAGE_PROVIDER`: `local` (dev) or `r2` (prod)
- `FRONTEND_URL`: the allowed frontend origin for CORS and the Clerk authorized parties. Set it before a production deploy; if it is unset the Worker reflects any origin.
- `MAX_FILE_SIZE`, `ENTERPRISE_MAX_FILE_SIZE`: maximum upload size in bytes
- `MAX_JSON_BODY_BYTES`: maximum JSON request body (default 1 MiB)
- `RATE_LIMIT_WINDOW`, `RATE_LIMIT_MAX_REQUESTS`, `RATE_LIMIT_MAX_AUTHENTICATED`: rate limiting
- `SCHEDULED_JOBS_DISABLED`: set to `true` to stop the hourly jobs without a deploy

## Production CORS Notes

- Production allows only `FRONTEND_URL`, with credentials.
- Non-production, or an unset `FRONTEND_URL`, reflects any origin. That is for development only.
- See [`security.md`](./security.md#cors--cross-origin-security).

## Workers Secrets

Production secrets must be added via Wrangler (do **not** store them in Git).

Example:

- `wrangler secret put NEON_CONNECTION_STRING`
- `wrangler secret put R2_ACCOUNT_ID`
- `wrangler secret put R2_ACCESS_KEY_ID`
- `wrangler secret put R2_SECRET_ACCESS_KEY`
