# Database Migrations Guide

> **⚠️ This is not the production migration path.**
>
> Production schema changes are applied **only** by the migration runner documented in
> [`docs/migrations.md`](./migrations.md) — `src/database/migrations/` against the authoritative
> history in `database/migrations/`, run by `.github/workflows/migration-prep.yml`.
>
> **`prisma db push` and `prisma migrate deploy` are not how production schema changes are
> applied.** The production sections below are retained for historical reference and are wrong
> as operator instructions.
>
> The rest of this document is scoped to the **Express/Prisma/SQLite backend** (`backend/`),
> which is retained only as the rollback backend until it is removed. The SQLite/development
> half remains accurate for local work.

This guide covers database migrations for the Date Management App, supporting both local SQLite development and Neon PostgreSQL production.

## Table of Contents

1. [Overview](#overview)
2. [Development Environment (SQLite)](#development-environment-sqlite)
3. [Production Environment (Neon PostgreSQL)](#production-environment-neon-postgresql)
4. [Neon Database Branching](#neon-database-branching)
5. [Migration Workflow](#migration-workflow)
6. [Rollback Procedures](#rollback-procedures)
7. [Best Practices](#best-practices)

---

## Overview

The application uses a dual-database strategy:

| Environment | Database        | Schema File                | Connection     |
| ----------- | --------------- | -------------------------- | -------------- |
| Development | SQLite          | `schema.prisma`            | File-based     |
| Production  | Neon PostgreSQL | `production/schema.prisma` | Connection URL |

Both schemas define identical models - only the datasource provider differs.

---

## Development Environment (SQLite)

### Setup

SQLite requires no external database server. The database file is created automatically.

```bash
cd backend

# Apply schema to SQLite (creates database.sqlite)
npx prisma db push

# Or run migrations
npx prisma migrate dev
```

### Configuration

```bash
# backend/.env
DATABASE_URL=file:./database.sqlite
```

### Common Commands

```bash
# Reset database (drops all data)
npx prisma migrate reset

# View database in browser
npx prisma studio

# Generate Prisma client
npx prisma generate
```

---

## Production Environment (Neon PostgreSQL)

### Setup

1. Create a Neon account at https://neon.tech
2. Create a new project and database
3. Copy the connection string

### Configuration

```bash
# .env (root or backend/.env)
DATABASE_URL=postgresql://user:password@host/database?sslmode=require
```

### Applying Schema to Neon

```bash
cd backend

# Quick sync (no migration history)
DATABASE_URL="your-neon-url" npx prisma db push --schema=./prisma/production/schema.prisma

# Or with migration tracking
DATABASE_URL="your-neon-url" npx prisma migrate deploy --schema=./prisma/production/schema.prisma
```

### Viewing Production Data

```bash
DATABASE_URL="your-neon-url" npx prisma studio --schema=./prisma/schema.neon.prisma
```

---

## Neon Database Branching

Neon supports Git-like database branching for safe migrations.

### Why Use Branching?

- **Safe migrations**: Test schema changes before applying to production
- **Instant rollback**: Delete branch if migration fails
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

```bash
# Get branch connection string from Neon dashboard
# Apply migrations to branch first
DATABASE_URL="branch-connection-string" npx prisma db push --schema=./prisma/production/schema.prisma

# Test your application against the branch
DATABASE_URL="branch-connection-string" npm run dev
```

### Promoting a Branch

After testing, apply the same migration to production:

```bash
# Apply to production main branch
   DATABASE_URL="production-connection-string" npx prisma db push --schema=./prisma/production/schema.prisma
```

### Deleting a Branch

After successful promotion, delete the development branch:

**Via Dashboard:** Branches → Select branch → Delete

**Via CLI:**

```bash
neonctl branches delete dev/feature-xyz --project-id your-project-id
```

---

## Migration Workflow

### Adding a New Field

1. **Update Prisma Schema**

   ```prisma
   // schema.prisma AND production/schema.prisma
   model Product {
     // ... existing fields
     newField String? @map("new_field")  // Add new field
   }
   ```

2. **Test Locally (SQLite)**

   ```bash
   npx prisma migrate dev --name add-new-field
   npm test
   ```

3. **Create Neon Branch**
   - Create `dev/add-new-field` branch in Neon dashboard

4. **Test on Branch**

   ```bash
   DATABASE_URL="branch-url" npx prisma db push --schema=./prisma/production/schema.prisma
   DATABASE_URL="branch-url" npm test
   ```

5. **Apply to Production**

   ```bash
   DATABASE_URL="production-url" npx prisma db push --schema=./prisma/production/schema.prisma
   ```

6. **Clean Up**
   - Delete development branch
   - Commit schema changes to git

### Adding a New Table

Same workflow as above. For tables with foreign keys, ensure parent tables exist first.

### Removing a Field/Table

⚠️ **Destructive operations require extra care:**

1. Deploy code that no longer uses the field
2. Wait for all instances to update
3. Remove field from schema
4. Apply migration

---

## Rollback Procedures

### SQLite (Development)

```bash
# Reset to last migration
npx prisma migrate reset

# Or restore from backup
cp database.sqlite.backup database.sqlite
```

### Neon (Production)

**Option 1: Point-in-Time Recovery (PITR)**

- Neon supports PITR within retention window
- Dashboard → Project → Restore → Select timestamp

**Option 2: Branch Rollback**

- If using branches, simply delete the problematic branch
- Production remains unaffected

**Option 3: Manual Rollback**

```sql
-- Generate rollback SQL
-- Reverse the migration manually
ALTER TABLE products DROP COLUMN new_field;
```

### Emergency Rollback Script

Save rollback SQL alongside migrations:

```
prisma/neon-sql/
├── 0001_initial.sql
├── 0001_initial_rollback.sql  # Reverses 0001
├── 0002_add_field.sql
└── 0002_add_field_rollback.sql  # Reverses 0002
```

---

## Best Practices

### Schema Changes

1. ✅ Always update both `schema.prisma` AND `production/schema.prisma`
2. ✅ Test migrations locally before production
3. ✅ Use Neon branches for risky migrations
4. ✅ Keep migration SQL files for audit trail
5. ✅ Add rollback scripts for complex migrations

### Naming Conventions

```
Migrations:
  0001_initial.sql
  0002_add_user_email.sql
  0003_add_product_category.sql

Branches:
  dev/feature-name
  staging
  hotfix/issue-123
```

### Connection String Security

1. ❌ Never commit connection strings to git
2. ✅ Use environment variables
3. ✅ Use Neon's connection pooling URL for serverless
4. ✅ Rotate credentials periodically

### Performance Considerations

1. **Add indexes** for frequently queried columns
2. **Use connection pooling** for serverless (Neon provides this)
3. **Batch large migrations** to avoid timeouts
4. **Monitor query performance** via Neon dashboard

---

## Troubleshooting

### "Connection refused"

- Check DATABASE_URL is correct
- Verify Neon project is active (not suspended)
- Check SSL mode (`sslmode=require`)

### "Migration failed"

- Check for conflicting changes
- Verify foreign key constraints
- Review migration SQL for syntax errors

### "Timeout during migration"

- Large data migrations may timeout
- Use Neon's direct connection (non-pooled) for migrations
- Break migration into smaller steps

### "Schema drift"

If production schema differs from Prisma schema:

```bash
# Generate diff to see what's different
npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel ./prisma/production/schema.prisma --script
```

---

## Related Documentation

- [Cloudflare Setup](cloudflare-setup.md) - R2 storage configuration
- [Storage Patterns](../backend/docs/storage-patterns.md) - File storage abstraction
- [Prisma Documentation](https://www.prisma.io/docs) - Official Prisma docs
- [Neon Documentation](https://neon.tech/docs) - Neon PostgreSQL docs
