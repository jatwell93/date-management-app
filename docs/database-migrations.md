# Database Migrations Guide

> **The authoritative migration path is [`docs/migrations.md`](./migrations.md).**
> Production schema changes are applied only by the migration runner in `src/database/migrations/`, against the history in `database/migrations/`, run by `.github/workflows/migration-prep.yml`. This guide is the developer-facing companion: how to work on a Neon development branch, how to write a migration, and what to do when something goes wrong.
>
> The Express/Prisma/SQLite backend is retired. `prisma db push`, `prisma migrate` and a local `database.sqlite` no longer exist in this repository. Its last revision is the tag `express-sqlite-last`; see [`express-retirement-recovery.md`](./express-retirement-recovery.md).

This guide covers database migrations for the Date Management App on Neon PostgreSQL.

## Table of Contents

1. [Overview](#overview)
2. [Development Environment (Neon branch)](#development-environment-neon-branch)
3. [Production Environment (Neon PostgreSQL)](#production-environment-neon-postgresql)
4. [Neon Database Branching](#neon-database-branching)
5. [Migration Workflow](#migration-workflow)
6. [Rollback Procedures](#rollback-procedures)
7. [Best Practices](#best-practices)

---

## Overview

There is one database technology everywhere: PostgreSQL on Neon.

| Environment | Database                        | Schema source                       | Connection                               |
| ----------- | ------------------------------- | ----------------------------------- | ---------------------------------------- |
| Development | Your own Neon branch            | `database/migrations/*.up.sql`      | Direct (non-pooled) URL                  |
| Real-SQL    | pglite (in-process, tests only) | The same migrations                 | In memory                                |
| Production  | Neon PostgreSQL                 | The same migrations, via the runner | Hyperdrive (Worker), direct URL (runner) |

The schema is defined by the ordered SQL history in `database/migrations/` and its `manifest.json`. There is no ORM schema file to keep in sync.

---

## Development Environment (Neon branch)

### Setup

Create a Neon branch for your work (see [Neon Database Branching](#neon-database-branching)) and use its connection string. pglite covers SQL correctness in tests (`npm run test:db`), but it cannot stand in for the live driver, real concurrency or role grants; see `workers/README.md`.

### Configuration

```bash
# workers/.dev.vars  (never commit)
NEON_CONNECTION_STRING=postgresql://user:password@host/database?sslmode=require
```

The migration commands read their own environment (`DATABASE_URL_UNPOOLED` and the `MIGRATION_*` guards). See [`migrations.md`](./migrations.md) section 2.

### Common Commands

```bash
# Show applied and pending migrations
npm run migrate:status

# Apply pending migrations to the database in your environment
npm run migrate:apply

# Check the database matches the expected schema
npm run migrate:verify

# Run the real-SQL tests against the authoritative migrations (pglite)
npm run test:db
```

---

## Production Environment (Neon PostgreSQL)

Production schema changes are never applied by hand. A merge to `main` runs the deploy workflow, which runs migration prep (status, preflight, apply, seed, verify) and then deploys the Worker. See [`migrations-deploy-runbook.md`](./migrations-deploy-runbook.md).

Credentials are stored in Doppler and GitHub environments. Do not copy a production connection string into a development shell.

---

## Neon Database Branching

Neon supports Git-like database branching for safe migrations.

### Why Use Branching?

- **Safe migrations**: Test schema changes before they reach production
- **Instant rollback**: Delete the branch if a migration fails
- **Preview environments**: Create database branches for PR previews
- **Zero data risk**: Production data is never modified during testing

### Branch Workflow

```
main (production)
  │
  ├── dev/feature-xyz (development branch)
  │     └── Test migrations here first
  │
  └── staging (optional staging branch)
        └── Integration testing
```

### Creating a Branch

**Via Neon Dashboard:**

1. Go to your Neon project
2. Click **Branches** → **Create Branch**
3. Name: `dev/feature-name`
4. Parent: Select `main`
5. Click **Create**

**Via Neon CLI:**

```bash
neonctl branches create --name dev/feature-xyz --project-id your-project-id
```

### Using a Branch

Point your environment at the branch's direct connection string, run the migration commands against it, and run the Worker with `npm run dev:local --prefix workers`.

### Promoting a Branch

You do not apply a branch to production by hand. Merge the migration PR; the deploy workflow applies it to production.

### Deleting a Branch

After the PR merges, delete the development branch:

**Via Dashboard:** Branches → Select branch → Delete

**Via CLI:**

```bash
neonctl branches delete dev/feature-xyz --project-id your-project-id
```

---

## Migration Workflow

### Adding a Field or Table

1. **Write the migration**: add `database/migrations/NNNN_description.up.sql` and `.down.sql`. Make it idempotent: `IF NOT EXISTS` on every object, and declare foreign keys inline inside `CREATE TABLE`. Tenant tables need `organization_id` NOT NULL with a foreign key.

   ```sql
   ALTER TABLE products ADD COLUMN IF NOT EXISTS new_field TEXT;
   ```

2. **Register it**: add the entry to `database/migrations/manifest.json`, then regenerate the catalog fingerprint (do not hand-edit it):

   ```bash
   npm run compile && node scripts/regenerate-catalog-fingerprint.js
   ```

3. **Update the hard-coded id lists** in the migration tests, then run them:

   ```bash
   npm run test:migrations
   ```

4. **Run the real-SQL suite**: a new constraint can break fixtures in other tests.

   ```bash
   npm run test:db
   ```

5. **Try it on a Neon branch**: apply it with the migration commands against your development branch.

6. **Open the PR**: commit the SQL, manifest, fingerprint and test changes together. Merging deploys it.

For tables with foreign keys, make sure the parent tables exist first.

### Removing a Field/Table

⚠️ **Destructive operations require extra care.** Use the expand/contract pattern:

1. Deploy code that no longer uses the field
2. Wait for all instances to update
3. Add a contract migration that removes the field (the manifest declares the plan)
4. Merge and deploy

---

## Rollback Procedures

There is no automated rollback. Down migrations are `manual-only` and `destructive`. Work the layers in order, and see [`rollback-procedure.md`](./rollback-procedure.md) and [`migrations-deploy-runbook.md`](./migrations-deploy-runbook.md) Step 4:

1. **Worker rollback**: redeploy a known-good SHA. Migrations are expand-compatible, so the previous Worker runs against the current schema.
2. **Forward-fix**: a new migration that corrects the problem. This is the primary recovery path for a bad schema change.
3. **Neon restore** (catastrophic only): restore from a pre-migration snapshot or point-in-time. See [`neon-backup-restore.md`](./neon-backup-restore.md).

On a development branch, deleting the branch is the rollback.

---

## Best Practices

### Schema Changes

1. ✅ One migration per logical change, with a `.down.sql`
2. ✅ Make migrations idempotent
3. ✅ Test on a Neon branch before the PR merges
4. ✅ Keep the manifest and catalog fingerprint in the same commit
5. ✅ Run the full `npm run test:db` after adding a constraint

### Naming Conventions

```
Migrations:
  0019_inventory_items_active_triple_unique.up.sql
  0019_inventory_items_active_triple_unique.down.sql

Branches:
  dev/feature-name
  staging
  hotfix/issue-123
```

### Connection String Security

1. ❌ Never commit connection strings to git
2. ✅ Use environment variables or Doppler
3. ✅ Use the direct (non-pooled) URL for migrations; the runner rejects the pooled endpoint
4. ✅ Rotate credentials periodically

### Performance Considerations

1. **Add indexes** for frequently queried columns, and for `organization_id` on tenant tables
2. **Batch large data migrations** to avoid timeouts
3. **Monitor query performance** via the Neon dashboard

---

## Troubleshooting

### "Connection refused"

- Check the connection string is correct
- Verify the Neon project is active (not suspended)
- Check SSL mode (`sslmode=require`)

### "Migration failed"

- Run `npm run migrate:status` to see what applied
- Check for conflicting changes and foreign key constraints
- The runner reports ledger problems such as `ledger-inconsistent`; see `migrations.md` for each one

### "Timeout during migration"

- Large data migrations may time out
- Migrations always use the direct (non-pooled) connection
- Break the migration into smaller steps

### "Schema drift"

`npm run migrate:verify` compares the database against the catalog fingerprint produced by the migration history, and reports the differences.

---

## Related Documentation

- [Migrations (authoritative)](./migrations.md) - runner, commands, environment, gates
- [Migrations deploy runbook](./migrations-deploy-runbook.md) - production deploy and rollback
- [Cloudflare Setup](cloudflare-setup.md) - R2 storage configuration
- [Neon Documentation](https://neon.tech/docs) - Neon PostgreSQL docs
