# Neon Database Workflow

Complete guide to the Neon PostgreSQL branching workflow used for schema changes and production migrations.

## Table of Contents

1. [Overview](#overview)
2. [Setting Up Neon](#setting-up-neon)
3. [Branching Strategy](#branching-strategy)
4. [Creating Feature Branches](#creating-feature-branches)
5. [Testing Migrations](#testing-migrations)
6. [Merging to Production](#merging-to-production)
7. [Backup & Recovery](#backup--recovery)
8. [Troubleshooting](#troubleshooting)

---

## Overview

Neon provides PostgreSQL database branching, enabling safe schema migrations without affecting production.

> **Applying migrations to production is documented separately.** This guide covers Neon branching
> and local workflows; the authoritative production migration path — the runner, the ordered
> `migrate:*` commands, and the deploy workflow — is [`docs/migrations.md`](./migrations.md). The
> `prisma migrate dev` steps below apply to feature branches and local development, not to
> production.

### Benefits

- **Testing:** Test migrations on a branch before production
- **Isolation:** Complete database copy, independently deployable
- **Rollback:** Keep parent branch unchanged if child branch fails
- **Collaboration:** Multiple team members can work on different branches
- **Cost:** Branches deleted after merge, no storage overhead

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Neon Project                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│   ┌──────────────────────┐      ┌──────────────────┐  │
│   │   main branch        │      │ feature-1 branch │  │
│   ├──────────────────────┤      ├──────────────────┤  │
│   │ Production database  │◄─────│ Test migrations  │  │
│   │ Date: 2026-03-09     │      │ Date: 2026-03-09 │  │
│   │ Schema: v1.2.3       │      │ Schema: v1.2.4   │  │
│   │ Size: 2.5GB          │      │ (After migration)│  │
│   └──────────────────────┘      └──────────────────┘  │
│                                          │             │
│                                   Merge after validation           │
│                                          ▼                         │
└─────────────────────────────────────────────────────────┘
```

---

## Setting Up Neon

### 1. Create Neon Account

1. Go to https://neon.tech/
2. Sign up (free)
3. Create project: `date-management-prod`
4. Create database: `postgres`

### 2. Install Neon CLI

```bash
npm install -g @neondatabase/neon-cli

# Or use with npx
npx neon --help
```

### 3. Authenticate

```bash
neon auth login
# Redirects to browser for authentication
# Saves credentials to ~/.neon/config

# Verify
neon projects list
```

### 4. Get Connection String

```bash
# List projects
neon projects list

# Get connection string for project
neon connection-string date-management-prod

# Format:
# postgresql://user:password@host/dbname?sslmode=require
```

### 5. Store Connection String

```bash
# Add to .env
DATABASE_URL=postgresql://...

# Or for Wrangler (Workers)
wrangler secret put DATABASE_URL
wrangler secret put NEON_CONNECTION_STRING
```

---

## Branching Strategy

### Branch Naming Convention

```
main                    # Production database, never modify directly
├── feature-1           # Feature branch for schema changes
│   └── feature-1-test  # Optional: testing branch
├── feature-2
└── hotfix-critical
```

**Naming Pattern:** `{type}-{description}`

| Type           | Use Case                     | Example                 |
| -------------- | ---------------------------- | ----------------------- |
| `feature`      | New features or improvements | `feature-multi-tenant`  |
| `bugfix`       | Bug fixes                    | `bugfix-csv-import`     |
| `hotfix`       | Production emergency fixes   | `hotfix-security-patch` |
| `experimental` | Trying approaches            | `experimental-new-ui`   |

### Branch Scope

**Each branch should:**

- Address ONE feature or bugfix
- Include related tests
- Be mergeable within 1 week
- Not accumulate 100+ commits

**Example: Good branch scope**

```
feature-subscription-tiers
├── Migrations: Add subscription table
├── Models: Subscription model update
├── Routes: Subscription API endpoints
├── Tests: Subscription service tests
└── Docs: Tier limits documentation
```

---

## Creating Feature Branches

### Step 1: Create Branch from Main

```bash
# List existing branches
neon branches list --project-id demo-prod

# Create new branch
neon branches create feature-subscription \
  --project-id demo-prod \
  --parent main

# Output:
# ID: br_0a1b2c3d4e5f
# Name: feature-subscription
# Parent: main
# Connection string: postgresql://...
```

### Step 2: Connect to Branch

```bash
# Get branch connection string
neon connection-string feature-subscription --project-id demo-prod

# Update local .env
DATABASE_URL=postgresql://user:password@host/dbname?branch=feature-subscription

# Or set temporarily
export DATABASE_URL=postgresql://...?branch=feature-subscription

# Verify connection
psql $DATABASE_URL -c "SELECT 1"
```

### Step 3: Make Schema Changes

Using Prisma migrations:

```bash
# Generate migration from schema changes
npx prisma migrate dev --name add_subscription_fields

# This creates:
# prisma/migrations/20260309120000_add_subscription_fields/migration.sql

# Migration is applied to feature branch database
```

**Or manually with SQL:**

```bash
# Apply raw SQL to branch
psql $DATABASE_URL -f migration.sql

# Verify changes
psql $DATABASE_URL -d postgres -c "\dt"  # List tables
```

---

## Testing Migrations

### Verify Schema Changes

```bash
# Connect to branch
branch_db_url=$(neon connection-string feature-subscription --project-id demo-prod)

# Check new tables/columns
psql $branch_db_url -c "\d+"

# Verify data (if seeding)
psql $branch_db_url -c "SELECT COUNT(*) FROM subscriptions;"
```

### Run Tests Against Branch

```bash
# Point tests at feature branch
DATABASE_URL=$(neon connection-string feature-subscription --project-id demo-prod) \
npm run test:prod

# Or with .env
echo "DATABASE_URL=$(neon connection-string feature-subscription --project-id demo-prod)" > .env.feature

# Run tests
npm run test:prod
```

### Load Testing Migration

```bash
# Generate test data on branch
npm run seed:feature-branch

# Test with realistic data volume
DATABASE_URL=$(neon connection-string feature-subscription --project-id demo-prod) \
npm run test:load

# Monitor: Check query performance
psql $branch_db_url -c "SELECT * FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 10;"
```

### Validation Checklist

Before merging to main:

- [ ] Schema changes applied successfully
- [ ] All new tables/columns created
- [ ] Constraints and indexes in place
- [ ] Tests pass: `npm run test:prod`
- [ ] Performance acceptable (queries <200ms)
- [ ] No data loss in migration
- [ ] Rollback plan documented

---

## Merging to Production

### Step 1: Final Validation

```bash
# Run final tests on feature branch
branch_db_url=$(neon connection-string feature-subscription)
DATABASE_URL=$branch_db_url npm run test:prod

# Check for conflicts with main
neon branches diff feature-subscription main --project-id demo-prod

# Expected output: Schema differences only (new tables/columns)
```

### Step 2: Create Backup

Before merging, backup main branch:

```bash
# Export current main database
pg_dump $(neon connection-string main --project-id demo-prod) \
  > backup-before-merge-$(date +%Y%m%d-%H%M).sql

# Store in safe location
cp backup-*.sql ~/backups/
```

### Step 3: Merge Branch to Main

```bash
# Merge feature branch into main
neon branches merge feature-subscription main \
  --project-id demo-prod

# Output:
# Branch 'feature-subscription' merged into 'main'
# Computes endpoint reset

# Branch is automatically deleted after merge
```

### Step 4: Verify Merge

```bash
# Connect to main
main_db_url=$(neon connection-string main --project-id demo-prod)

# Verify new schema
psql $main_db_url -c "\dt"

# Test with production data
DATABASE_URL=$main_db_url npm run health-check
```

### Step 5: Update Downstream Services

If using multiple databases:

```bash
# Update backend connection string
echo "DATABASE_URL=$main_db_url" > backend/.env.production

# Update Workers connection string
wrangler secret put DATABASE_URL --env production --path $main_db_url

# Restart services
npm run deploy:workers
npm run restart:backend
```

---

## Backup & Recovery

### Automatic Backups

Neon automatically backs up all branches:

- **Retention:** 7 days (free tier)
- **Frequency:** Continuous
- **Access:** Via Neon dashboard

### Manual Backup

```bash
# Export database to SQL file
pg_dump $(neon connection-string main --project-id demo-prod) \
  --no-owner \
  --no-acl \
  > backup-$(date +%Y%m%d).sql

# Compress
gzip backup-*.sql

# Store securely
cp backup-*.sql.gz ~/backups/
```

### Restore from Backup

```bash
# If branch is corrupted, restore from backup

# Option 1: Delete and recreate branch
neon branches delete feature-broken --project-id demo-prod
neon branches create feature-broken --project-id demo-prod --parent main

# Option 2: Restore from point-in-time recovery
# Via Neon dashboard → Projects → Backups
# Select timestamp, create recovery branch

# Option 3: Restore from SQL file
gunzip backup-20260309.sql.gz
psql $(neon connection-string main --project-id demo-prod) < backup-20260309.sql
```

---

## Troubleshooting

### Branch Won't Merge

**Symptoms:** `merge conflicts` or `schema conflict`

**Causes:**

- Another branch modified the same table
- Migration was applied to main separately

**Solution:**

```bash
# Option 1: Check what's different
neon branches diff feature-x main --project-id demo-prod

# Option 2: Rebase feature branch onto latest main
neon branches reset feature-x main --project-id demo-prod
# ⚠️ Caution! This discards feature branch changes

# Option 3: Apply changes manually
# Export feature branch schema
pg_dump --schema-only $(neon connection-string feature-x) > feature.sql

# Merge manually into main
psql $(neon connection-string main) < feature.sql
```

### Connection Timeout

**Symptoms:** `Error: timeout` connecting to branch

**Solution:**

```bash
# 1. Check branch status
neon branches list --project-id demo-prod

# 2. Check compute status
# https://console.neon.tech → Projects → Branching → feature-x

# 3. Reset compute if stuck
neon branches reset feature-x --project-id demo-prod

# 4. Reconnect
export DATABASE_URL=$(neon connection-string feature-x --project-id demo-prod)
psql $DATABASE_URL -c "SELECT 1"
```

### Lost Connection to Branch

**Symptoms:** App can't connect to feature branch database

**Solution:**

```bash
# Get fresh connection string
connection=$(neon connection-string feature-x --project-id demo-prod)
echo $connection

# Update .env
echo "DATABASE_URL=$connection" > .env.feature

# Restart app
npm run dev
```

### Migration Fails to Apply

**Symptoms:** `ERROR: relation already exists` or migration rollback

**Solution:**

```bash
# 1. Check migration status
npx prisma migrate status --preview-features

# 2. If stuck, reset feature branch to parent state
neon branches reset feature-x main --project-id demo-prod

# 3. Reapply migrations carefully
npx prisma migrate deploy

# 4. If still failing, delete branch and start over
neon branches delete feature-x --project-id demo-prod
neon branches create feature-x --project-id demo-prod --parent main
```

---

## Neon CLI Reference

```bash
# Projects
neon projects list
neon projects create --name my-project
neon projects delete --project-id <id>

# Branches
neon branches list --project-id <id>
neon branches create --name feature-x --project-id <id>
neon branches create --name feature-x --project-id <id> --parent main
neon branches delete --project-id <id> --branch feature-x
neon branches merge feature-x main --project-id <id>
neon branches reset feature-x main --project-id <id>
neon branches diff feature-x main --project-id <id>

# Connection strings
neon connection-string main --project-id <id>
neon connection-string feature-x --project-id <id>
neon connection-string main --project-id <id> --role-name postgres

# Computes (endpoints)
neon computes list --project-id <id>
neon computes suspend --project-id <id> --compute <compute-id>
neon computes resume --project-id <id> --compute <compute-id>

# Database operations
neon databases list --project-id <id>
neon roles list --project-id <id>
```

---

## Best Practices

### DO ✅

- ✅ Create a feature branch for every migration
- ✅ Test migrations on branch before merging
- ✅ Merge frequently (at least weekly)
- ✅ Delete merged branches to keep project clean
- ✅ Back up main branch before major merges
- ✅ Document migration in commit message
- ✅ Run tests: `npm run test:prod` before merge
- ✅ Keep branches focused on single feature

### DON'T ❌

- ❌ Modify main branch directly (always use feature branch)
- ❌ Run risky DDL on main (use feature branch first)
- ❌ Leave branches unmerged for >1 week
- ❌ Accumulate 100+ commits on one branch
- ❌ Delete main branch accidentally
- ❌ Share branch with multiple features
- ❌ Skip testing before merge
- ❌ Merge without backup
