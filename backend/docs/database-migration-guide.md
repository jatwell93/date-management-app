# Database Migration Guide

## Quick Start

1. **Set your Neon connection string:**
   ```bash
   # Update your .env.production file with real values:
   NEON_CONNECTION_STRING=postgresql://your-actual-neon-connection-string
   ```

2. **Verify the connection:**
   ```bash
   cd backend
   npm run verify:neon
   ```

3. **Run the migration:**
   ```bash
   npm run migrate:prod
   ```

## What the Migration Does

1. Tests Neon PostgreSQL connection
2. Generates Prisma client for PostgreSQL
3. Pushes schema to Neon (creates all tables)
4. Seeds tier feature flags (20 records)
5. Verifies all tables are created

## Schema Details

The production schema uses PostgreSQL with these key differences from SQLite:
- UUID primary keys for better performance
- Native PostgreSQL indexes
- Proper foreign key constraints with cascading deletes
- JSONB support for metadata fields (future use)

## Verification

After migration, you should see:
- ✅ All 14 tables created
- ✅ 20 tier feature flags seeded
- ✅ Database ready for production

## Troubleshooting

### Connection Failed
- Check NEON_CONNECTION_STRING is correct
- Ensure Neon database is active
- Verify SSL is enabled (required by Neon)

### Permission Denied
- Ensure database user has CREATE TABLE permissions
- Check if connection string includes correct user/password

### Tables Already Exist
- Migration is designed to be safe for existing tables
- It will update schema if needed
- Always backup before migration

## Next Steps

After successful migration:
1. Deploy Cloudflare Workers
2. Configure production secrets
3. Deploy frontend
4. Update Stripe webhooks
