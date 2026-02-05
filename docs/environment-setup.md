# Environment Setup

## Overview
This project supports two environments:
- **Development (Node.js + SQLite + Local Storage)**
- **Production (Cloudflare Workers + Neon + R2)**

The backend loads configuration from `.env.development` or `.env.production` based on `NODE_ENV`.

## Development
1. Copy the template:
   - Use backend/.env.development as a starting point.
2. Ensure the following minimum values are set:
   - `NODE_ENV=development`
   - `PORT=3001`
   - `JWT_SECRET=dev-secret`

Development does **not** require Neon or R2 credentials.

## Production (Template)
1. Use backend/.env.production as a template.
2. Replace placeholders with real values:
   - `JWT_SECRET`
   - `DATABASE_URL` / `NEON_CONNECTION_STRING`
   - `R2_*` credentials

## Key Variables
- `DATABASE_PROVIDER`: `sqlite` (dev) or `postgresql` (prod)
- `STORAGE_PROVIDER`: `local` (dev) or `r2` (prod)
- `FRONTEND_URL` / `CORS_ORIGIN`: allowed frontend origins
- `MAX_UPLOAD_SIZE_BYTES`: max upload size
- `DIRECT_UPLOAD_THRESHOLD_BYTES`: switch between direct vs presigned uploads

## Workers Secrets
Production secrets must be added via Wrangler (do **not** store them in Git).

Example:
- `wrangler secret put DATABASE_URL`
- `wrangler secret put R2_ACCOUNT_ID`
- `wrangler secret put R2_ACCESS_KEY_ID`
- `wrangler secret put R2_SECRET_ACCESS_KEY`
