# Developer Guide

**Complete guide for daily development on the Date Management App**

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [Daily Workflow](#daily-workflow)
3. [Running Tests](#running-tests)
4. [Database Management](#database-management)
5. [Common Tasks](#common-tasks)
6. [Debugging](#debugging)
7. [Git Workflow](#git-workflow)
8. [Production Deployment](#production-deployment)
9. [Troubleshooting](#troubleshooting)

---

## Getting Started

### First-Time Setup

**Prerequisites:**

- Node.js ≥22.x
- npm ≥9.x
- Git

**Setup:**

```bash
# 1. Clone the repository
git clone <repository-url>
cd date-management-app

# 2. Install dependencies for each package
npm install
(cd workers && npm install)
(cd frontend && npm install)

# 3. Configure the Worker (your own Neon branch)
cd workers
cp .dev.vars.example .dev.vars
# Fill in NEON_CONNECTION_STRING, JWT_SECRET, CLERK_SECRET_KEY.
# Keep secrets out of git.
cd ..

# 4. Apply migrations to YOUR development Neon branch. The migrate:* commands
#    need DATABASE_URL_UNPOOLED and the MIGRATION_* guards set (see
#    docs/migrations.md section 2). Never point them at production.
npm run migrate:status

# 5. Verify setup
npm run test:db
```

The Worker is the only API, and it runs against Postgres (Neon). There is no local SQLite database. See [`workers/README.md`](../workers/README.md) for what `npm run dev:local` simulates and what needs a real Neon branch, and [`migrations.md`](./migrations.md) for the migration commands and their environment contracts.

---

## Daily Workflow

### Starting Development

```bash
# Start the Worker as the local dev API (the frontend targets it on :8787):
npm run dev:local --prefix workers   # serves http://localhost:8787

# Start the frontend (separate terminal):
npm start --prefix frontend          # serves http://localhost:3002
```

### Environment Variables

- Worker: `workers/.dev.vars` (local) and `wrangler secret` / `workers/wrangler.toml` vars (deployed)
- Frontend: `frontend/.env` or Doppler `dev`
- Migration tooling: the shell environment (see `docs/migrations.md`)

**Development defaults:**

- Database: your own Neon branch
- Storage: `STORAGE_PROVIDER=local` (Miniflare's local R2 emulation)
- Auth: Clerk (development keys)

### Auto-Reload

`wrangler dev` reloads the Worker when you save. The frontend dev server reloads on save too.

**Tip:** If auto-reload isn't working, restart the dev server.

---

## Running Tests

### Test Commands

```bash
# Worker unit and handler tests (vitest)
(cd workers && npm test)

# Real-SQL tests against the authoritative migrations (pglite)
npm run test:db

# Type-check the Worker including test files (CI runs this)
(cd workers && npm run typecheck)

# Frontend tests for changed files
npm run test:frontend:diff

# Migration runner tests, and operator-tool tests
npm run test:migrations
npm run test:operations

# Repo tooling tests
npm run test:tooling
```

Do not run `npm run test:prod` or `npm run test:both`: they target the production database. There is no root `npm test`; it errors by design.

### Writing Tests

**Follow TDD (Test-Driven Development):**

1. **RED:** Write a failing test
2. **GREEN:** Write minimal code to pass
3. **REFACTOR:** Clean up without breaking tests

**Where tests go:**

- Pure logic shared with the frontend: `shared/domain/*.test.ts`
- Handler behavior with a fake `Database`: `workers/src/*.test.ts`
- Anything in `workers/src/database.ts`: a real-SQL test, `workers/src/*.pglite.node.test.ts`, run by `npm run test:db`

**Real-SQL test shape:**

```typescript
// workers/src/database.my-feature.pglite.node.test.ts
import { createPgliteHarness, seedOrganization } from './__tests__/pglite-db';

describe('my feature', () => {
  it('does not return another organization rows', async () => {
    const harness = await createPgliteHarness();
    await seedOrganization(harness.pg, 'org-a');
    await seedOrganization(harness.pg, 'org-b');
    // Seed a row for org-b that WOULD be returned if the predicate regressed,
    // then act as org-a and assert on identity, not just count.
  });
});
```

**Testing guidelines:**

- ✅ Test business logic and validation
- ✅ Test error handling
- ✅ Seed a second organization for any tenant data
- ✅ Prove a new test can fail: remove the line it guards and watch it fail
- ✅ Use descriptive test names
- ❌ Don't test implementation details
- ❌ Don't test external libraries

### Test Coverage

**Target:** >80% coverage for new code

```bash
# Worker coverage
npm run test:coverage --prefix workers

# Frontend coverage
npm run test:frontend:coverage
```

---

## Database Management

### Migrations

Schema changes are numbered SQL migrations applied by the runner in `src/database/migrations/`. Production changes go through the deploy workflow only; see [`migrations.md`](./migrations.md).

```bash
# Check applied and pending migrations
npm run migrate:status

# Apply pending migrations (needs the MIGRATION_* environment from docs/migrations.md)
npm run migrate:apply

# Verify the database matches the expected schema
npm run migrate:verify

# Seed reference data (tier feature flags)
npm run migrate:seed
```

There is no automated rollback. Down migrations are manual-only and destructive; recover with a forward-fix migration (see [`rollback-procedure.md`](./rollback-procedure.md)).

### Seeding Data

```bash
# Tier feature flags
npm run migrate:seed

# Master catalogue (operator tool)
npm run seed:master-catalogue
```

### Database GUI

Use the Neon console, or `psql` against your Neon branch.

### Creating Migrations

```bash
# 1. Add database/migrations/NNNN_description.up.sql and .down.sql
#    Make it idempotent: IF NOT EXISTS on every object, foreign keys inline in CREATE TABLE
# 2. Add the entry to database/migrations/manifest.json
# 3. Regenerate the catalog fingerprint (do not hand-edit it)
npm run compile && node scripts/regenerate-catalog-fingerprint.js
# 4. Update the hard-coded id lists in the migration tests (runner, adopt, e2e)
npm run test:migrations
# 5. Run the full real-SQL suite: a new constraint can break fixtures in other tests
npm run test:db
# 6. Commit the SQL, manifest, fingerprint and test changes together
```

`docs/migrations.md` describes each gate and what it checks.

---

## Common Tasks

### Add a New API Endpoint

1. **Add the query:** in `workers/src/database.ts`, with `organizationId` as the first parameter and an `organization_id` predicate in the SQL.

   ```typescript
   async findResources(organizationId: string) {
     return this.sql`SELECT id, name FROM resources WHERE organization_id = ${organizationId}`;
   }
   ```

2. **Write the handler:** in `workers/src/index-minimal.ts` (or a module it imports). Take the organization from `auth.organizationId`, never from the request.

   ```typescript
   const auth = await authenticateApiRequest(request, env, db);
   if (auth instanceof Response) return auth;
   const rows = await db.findResources(auth.organizationId);
   return jsonResponse(rows, 200, env, requestOrigin);
   ```

3. **Register the route:** add a `[method, path, handler]` entry to the route table in `workers/src/minimal-api-routes.ts`.

4. **Write tests:** a handler test with a fake `Database`, and a real-SQL isolation test in `workers/src/*.pglite.node.test.ts` that seeds a second organization.

### Add a Database Table

1. **Write the migration:** `database/migrations/NNNN_add_resources.up.sql` and `.down.sql`. Include `organization_id` NOT NULL with a foreign key to `organizations(id)`, and an index on it.

   ```sql
   CREATE TABLE IF NOT EXISTS resources (
     id              SERIAL PRIMARY KEY,
     name            TEXT NOT NULL,
     organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
     created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
     updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
   );
   CREATE INDEX IF NOT EXISTS resources_organization_id_idx ON resources (organization_id);
   ```

2. **Register and verify it:** follow "Creating Migrations" above. The tenant-scope invariant test fails if a new table has no constrained `organization_id` and is not listed as unscoped with a reason.

3. **Add types:** next to the handler, or in `shared/domain/` if the frontend uses them.

### Format Code

```bash
# Format all TypeScript files
npm run format

# Check code style
npm run lint

# Fix auto-fixable issues
npm run lint:fix

# Type-check without compiling
npm run compile
(cd workers && npm run typecheck)
```

---

## Debugging

### Debugging the Worker

`npm run dev:local --prefix workers` runs `wrangler dev`, which prints request logs and `console.log` output. Pass wrangler flags after `--`, for example `-- --log-level debug`. To debug a single test, run it with vitest and a breakpoint in your editor.

### Console Logging

```typescript
// Development logging
console.log('Debug info:', { variable });

// Use Sentry for production
import * as Sentry from '@sentry/cloudflare';
Sentry.captureMessage('Something happened', 'info');
```

### Database Debugging

```bash
# Check migration status
npm run migrate:status

# Look at data: use the Neon console, or psql against your Neon branch
psql "$DATABASE_URL" -c '\dt'
```

Never point debugging tools at the production database from a development shell.

---

## Git Workflow

### Branch Naming

```
feature/<feature-name>     - New features
fix/<bug-description>      - Bug fixes
chore/<task-description>   - Maintenance tasks
docs/<doc-update>          - Documentation
```

### Commit Messages

**Use conventional commits:**

```
feat(area): brief description

- Detail 1
- Detail 2

Refs: <change-id>
```

**Types:**

- `feat:` - New feature
- `fix:` - Bug fix
- `chore:` - Maintenance
- `docs:` - Documentation
- `test:` - Test changes
- `refactor:` - Code refactoring

### Standard Workflow

```bash
# 1. Create feature branch
git checkout -b feature/my-feature

# 2. Make changes, commit frequently
git add .
git commit -m "feat(component): add new feature"

# 3. Push branch
git push origin feature/my-feature

# 4. Create pull request via GitHub

# 5. After PR approval and merge, clean up
git checkout main
git pull
git branch -d feature/my-feature
```

### Before Committing

**Run quality checks:**

```bash
# 1. Run tests
npm test

# 2. Check linting
npm run lint

# 3. Type check
npm run type-check

# 4. Scan for bugs (optional but recommended)
ubs $(git diff --name-only)
```

---

## Production Deployment

### Pre-Deployment Checklist

- [ ] All tests pass locally (`npm test`)
- [ ] Linter clean (`npm run lint`)
- [ ] OpenSpec validated (`openspec validate --all`)
- [ ] Environment variables set (Doppler/Wrangler)
- [ ] Database migration plan ready
- [ ] Rollback procedure documented

### Deployment Steps

**Worker (Cloudflare):**

Merging to `main` runs `.github/workflows/workers-deploy.yml`: migration prep first, then the Worker deploy (about 35 minutes in total). You do not run production migrations or deploys by hand. See [`migrations-deploy-runbook.md`](./migrations-deploy-runbook.md).

```bash
# Deploy to the development environment (manual)
npm run deploy:dev --prefix workers

# Set a secret if needed
cd workers
wrangler secret put CLERK_SECRET_KEY --env production
```

### Frontend Pages Deployment Flow (Current Setup)

Frontend deploys are managed by [pages-deploy.yml](../.github/workflows/pages-deploy.yml).

### Branch Workflow (Keep This)

1. Create a feature branch from main.
2. Open a PR into main.
3. Preview deploy runs automatically from the PR.
4. Test the preview URL: `https://pr-<number>.date-management-frontend.pages.dev`.
5. Merge PR to main only after preview validation.
6. Production deploy runs from main.

Note: You do not need a separate long-lived preview branch for this workflow.

### Preview vs Production Rules

- Preview deploy:
  - Trigger: pull requests targeting main
  - Clerk key requirement: `REACT_APP_CLERK_PUBLISHABLE_KEY` must be `pk_test_*`
- Production deploy:
  - Trigger: push to main (or workflow_dispatch on main)
  - Clerk key requirement: `REACT_APP_CLERK_PUBLISHABLE_KEY` must be `pk_live_*`

### Required GitHub Secrets

Set `DOPPLER_TOKEN` as an environment secret in both GitHub Environments:

1. `preview` environment:

- Secret name: `DOPPLER_TOKEN`
- Doppler config must return `pk_test_*` for `REACT_APP_CLERK_PUBLISHABLE_KEY`

2. `production` environment:

- Secret name: `DOPPLER_TOKEN`
- Doppler config must return `pk_live_*` for `REACT_APP_CLERK_PUBLISHABLE_KEY`

If only a repository-level `DOPPLER_TOKEN` is set, both jobs may use the same Doppler config.

### Common Mistakes and Symptoms

1. Preview uses `pk_live_*`:

- Symptom: Clerk sign-in panel fails or Clerk API origin errors on `pages.dev`.
- Fix: Ensure preview environment `DOPPLER_TOKEN` points to preview Doppler config with `pk_test_*`.

2. Production uses `pk_test_*`:

- Symptom: Production deployment fails during validation.
- Fix: Ensure production environment `DOPPLER_TOKEN` points to production Doppler config with `pk_live_*`.

3. Preview updated but production did not:

- Symptom: Different JS bundle hashes between preview and production.
- Fix: Check the main workflow run status (queued/failed) and rerun after resolving the blocking error.

4. Changes merged but no frontend deploy:

- Symptom: No new Pages deployment run.
- Fix: Confirm changed files matched workflow paths (`frontend/**` or `.github/workflows/pages-deploy.yml`).

### Quick Verification Commands

```bash
# Production key mode
prod_asset=$(curl -sS https://www.expirymate.com.au/login | tr '"' '\n' | grep '/static/js/main\.' | head -n1)
curl -sS "https://www.expirymate.com.au${prod_asset}" | rg -o 'pk_(test|live)_[A-Za-z0-9_]+' -N | sort -u

# Preview key mode (replace 96 with your PR number)
pre_asset=$(curl -sS https://pr-96.date-management-frontend.pages.dev/login | tr '"' '\n' | grep '/static/js/main\.' | head -n1)
curl -sS "https://pr-96.date-management-frontend.pages.dev${pre_asset}" | rg -o 'pk_(test|live)_[A-Za-z0-9_]+' -N | sort -u
```

### Post-Deployment

1. **Smoke test:** Verify critical paths work
2. **Monitor Sentry:** Watch for errors for 15 minutes
3. **Check logs:** Ensure no unexpected warnings
4. **Test key features:** Login, upload, data operations

### Rollback Procedure

If deployment fails, follow [docs/rollback-procedure.md](./rollback-procedure.md). In short: redeploy a known-good SHA with the `Deploy Workers API` workflow (`workflow_dispatch`), or revert the merge commit. Do not use a down migration; use a forward-fix migration if the schema is wrong.

---

## Troubleshooting

### Common Issues

See [troubleshooting.md](./troubleshooting.md) for the full guide. The most common ones:

#### Port Already in Use

`wrangler dev` uses 8787 and the frontend 3002. Find and stop the process, or pass `-- --port 8788` to `npm run dev:local`.

#### Migration Failures

```bash
npm run migrate:status
npm run migrate:verify
```

Do not hand-edit a production schema. Fix forward with a new migration.

#### Module Not Found

```bash
# Reinstall dependencies in the affected package
rm -rf node_modules package-lock.json && npm install
```

Restore `package-lock.json` from git afterwards if you did not mean to change it.

#### Test Failures

```bash
# Run one real-SQL file
(cd workers && npx vitest run --config vitest.node.config.mts src/database.tenant-isolation.pglite.node.test.ts)

# Run the full real-SQL suite
npm run test:db
```

#### TypeScript Errors

```bash
npm run compile
(cd workers && npm run typecheck)
```

In VS Code, run "TypeScript: Restart TS Server".

#### Environment Variable Missing

```bash
# Worker: confirm workers/.dev.vars exists and has the keys from .dev.vars.example
ls workers/.dev.vars
```

### Getting Help

1. **Check documentation:**
   - [README.md](../README.md) - Project overview
   - [environment-setup.md](./environment-setup.md) - Environment configuration
   - [AGENTS.md](../AGENTS.md) - Development standards

2. **Search codebase:**

   ```bash
   # Find similar patterns
   grep -r "pattern" workers/src shared

   # Find how something is used
   grep -r "functionName" workers/src shared
   ```

3. **Check git history:**

   ```bash
   # See recent changes to a file
   git log -p path/to/file

   # Find when something broke
   git bisect start
   ```

4. **Ask the team:**
   - Include error message
   - Include steps to reproduce
   - Include environment (OS, Node version)

---

## Quick Reference

### Most Used Commands

| Task                | Command                              |
| ------------------- | ------------------------------------ |
| Start the Worker    | `npm run dev:local --prefix workers` |
| Start the frontend  | `npm start --prefix frontend`        |
| Real-SQL tests      | `npm run test:db`                    |
| Worker typecheck    | `(cd workers && npm run typecheck)`  |
| Frontend diff tests | `npm run test:frontend:diff`         |
| Migration status    | `npm run migrate:status`             |
| Migration tests     | `npm run test:migrations`            |
| Format code         | `npm run format`                     |
| Lint                | `npm run lint`                       |
| Fix style           | `npm run lint:fix`                   |

### File Locations

| Type             | Location                                   |
| ---------------- | ------------------------------------------ |
| Routes           | `workers/src/minimal-api-routes.ts`        |
| Handlers         | `workers/src/index-minimal.ts` and modules |
| SQL              | `workers/src/database.ts`                  |
| Migrations       | `database/migrations/`                     |
| Migration runner | `src/database/migrations/`                 |
| Shared logic     | `shared/domain/`                           |
| Worker tests     | `workers/src/`                             |
| Worker config    | `workers/wrangler.toml`                    |

---

## Additional Resources

- [Testing Guide](./TESTING.md) - Comprehensive testing documentation
- [Multi-Tenant Guide](./multi-tenant-guide.md) - Multi-tenancy patterns
- [Security Guide](./security.md) - Security best practices
- [Operational Runbook](./operational-runbook.md) - Production operations

---

**Need more help?** Check the project README or ask a team member.
