# Cloudflare R2 Setup Guide

This guide covers setting up Cloudflare R2 for production file storage in the Date Management App.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Creating an R2 Bucket](#creating-an-r2-bucket)
3. [Generating API Tokens](#generating-api-tokens)
4. [Configuring CORS](#configuring-cors)
5. [Lifecycle Rules](#lifecycle-rules)
6. [Encryption](#encryption)
7. [Environment Variables](#environment-variables)
8. [Testing Connectivity](#testing-connectivity)
9. [Troubleshooting](#troubleshooting)

---

## Prerequisites

Before setting up R2, you need:

- [ ] Cloudflare account (sign up at https://dash.cloudflare.com/sign-up)
- [ ] Email verified
- [ ] Payment method added (required for R2, but free tier is generous)

### Cloudflare Account ID

Your Account ID is required for API access:

1. Log in to Cloudflare Dashboard
2. Look in the right sidebar under **Account ID**
3. Copy the 32-character hex string (e.g., `a1b2c3d4e5f6...`)

---

## Creating an R2 Bucket

### Step 1: Navigate to R2

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Select **R2** from the left sidebar
3. Click **Create bucket**

### Step 2: Configure Bucket

1. **Bucket name**: `csv-uploads-prod` (or your preferred name)
   - Must be globally unique
   - Lowercase letters, numbers, and hyphens only
   - 3-63 characters

2. **Location**: Choose the region closest to your users
   - `WNAM` - Western North America
   - `ENAM` - Eastern North America
   - `WEUR` - Western Europe
   - `EEUR` - Eastern Europe
   - `APAC` - Asia Pacific

3. Click **Create bucket**

### Bucket Naming Convention

```
csv-uploads-prod     # Production bucket
csv-uploads-staging  # Staging bucket (optional)
csv-uploads-dev      # Development testing (optional)
```

---

## Generating API Tokens

R2 uses S3-compatible API tokens for programmatic access.

### Step 1: Create API Token

1. Go to **R2** → **Manage R2 API Tokens**
2. Click **Create API Token**

### Step 2: Configure Token

1. **Token name**: `date-management-api` (descriptive name)

2. **Permissions**:
   - ✅ Object Read & Write (required)
   - ❌ Admin Read (not needed)
   - ❌ Admin Write (not needed)

3. **Specify bucket(s)**:
   - Select **Apply to specific buckets only**
   - Choose your bucket (`csv-uploads-prod`)

4. **TTL**: Leave as **Forever** or set an expiry for rotation

5. Click **Create API Token**

### Step 3: Save Credentials

After creation, you'll see:

```
Access Key ID:     <32-character string>
Secret Access Key: <64-character string>
```

⚠️ **IMPORTANT**: The Secret Access Key is shown only once. Save it securely!

Store these in a password manager or secure vault. Never commit to git.

---

## Configuring CORS

CORS configuration is required for presigned URL uploads from the browser.

### Step 1: Navigate to Bucket Settings

1. Go to **R2** → Click your bucket name
2. Select **Settings** tab
3. Find **CORS Policy** section

### Step 2: Add CORS Rules

Click **Add CORS policy** and enter:

```json
[
  {
    "AllowedOrigins": [
      "https://yourdomain.com",
      "https://www.yourdomain.com",
      "http://localhost:3000"
    ],
    "AllowedMethods": [
      "GET",
      "PUT",
      "POST",
      "DELETE",
      "HEAD"
    ],
    "AllowedHeaders": [
      "*"
    ],
    "ExposeHeaders": [
      "ETag",
      "Content-Length",
      "Content-Type"
    ],
    "MaxAgeSeconds": 3600
  }
]
```

### CORS Configuration Notes

| Field | Purpose |
|-------|---------|
| `AllowedOrigins` | Domains that can make requests. Include localhost for development. |
| `AllowedMethods` | HTTP methods allowed. PUT is required for presigned uploads. |
| `AllowedHeaders` | Request headers allowed. Use `*` for flexibility. |
| `ExposeHeaders` | Response headers accessible to JavaScript. |
| `MaxAgeSeconds` | How long browsers cache CORS preflight responses. |

### Production CORS (Stricter)

For production, remove localhost:

```json
[
  {
    "AllowedOrigins": [
      "https://yourdomain.com",
      "https://www.yourdomain.com"
    ],
    "AllowedMethods": ["GET", "PUT", "DELETE", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag", "Content-Length", "Content-Type"],
    "MaxAgeSeconds": 86400
  }
]
```

---

## Lifecycle Rules

Lifecycle rules automatically clean up temporary files.

### Step 1: Navigate to Lifecycle Rules

1. Go to **R2** → Click your bucket name
2. Select **Settings** tab
3. Find **Object lifecycle rules** section

### Step 2: Create Cleanup Rule

Click **Add rule** and configure:

**Rule 1: Delete temporary upload files after 24 hours**

```
Rule name:        cleanup-temp-uploads
Prefix filter:    temp/
Action:           Delete objects
Days after upload: 1
```

**Rule 2: Delete failed processing files after 7 days (optional)**

```
Rule name:        cleanup-failed-processing
Prefix filter:    failed/
Action:           Delete objects
Days after upload: 7
```

### File Organization

Use consistent prefixes to leverage lifecycle rules:

```
csv-uploads-prod/
├── uploads/           # Permanent uploaded CSVs
│   └── 2024-01-15-products.csv
├── temp/              # Temporary files (auto-deleted after 24h)
│   └── processing-abc123.tmp
├── failed/            # Failed processing (auto-deleted after 7d)
│   └── 2024-01-15-error-xyz.csv
└── processed/         # Successfully processed (permanent)
    └── 2024-01-15-products-validated.csv
```

---

## Encryption

### Encryption at Rest

R2 automatically encrypts all objects at rest using **AES-256** encryption. 

✅ **No additional configuration required.**

This is enabled by default and cannot be disabled.

### Encryption in Transit

All R2 API requests use **HTTPS/TLS 1.2+**.

✅ **No additional configuration required.**

### Key Management

R2 uses Cloudflare-managed encryption keys. Customer-managed keys (CMK) are not currently supported.

For compliance requirements:
- SOC 2 Type II: ✅ Compliant
- GDPR: ✅ EU regions available
- HIPAA: ⚠️ Consult Cloudflare documentation
- PCI DSS: ⚠️ Don't store card data in R2

---

## Environment Variables

Add these to your `.env` file (never commit actual values to git):

```bash
# Storage Provider
STORAGE_PROVIDER=r2

# Cloudflare R2 Configuration
R2_ACCOUNT_ID=your_cloudflare_account_id
R2_ACCESS_KEY_ID=your_access_key_id
R2_SECRET_ACCESS_KEY=your_secret_access_key
R2_BUCKET_NAME=csv-uploads-prod

# Optional: Maximum file size (default: 10MB)
MAX_FILE_SIZE=10485760
```

### Environment Variable Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `STORAGE_PROVIDER` | Yes | Set to `r2` for production |
| `R2_ACCOUNT_ID` | Yes | Your Cloudflare account ID (32 chars) |
| `R2_ACCESS_KEY_ID` | Yes | R2 API token access key |
| `R2_SECRET_ACCESS_KEY` | Yes | R2 API token secret key |
| `R2_BUCKET_NAME` | Yes | Your R2 bucket name |
| `MAX_FILE_SIZE` | No | Max upload size in bytes (default: 10MB) |

### For Cloudflare Workers (Production)

Use Wrangler secrets instead of environment variables:

```bash
# Set secrets for Workers
wrangler secret put R2_ACCESS_KEY_ID
wrangler secret put R2_SECRET_ACCESS_KEY
```

Configure in `wrangler.toml`:

```toml
[[r2_buckets]]
binding = "CSV_BUCKET"
bucket_name = "csv-uploads-prod"
```

---

## Testing Connectivity

### Using the Test Script

Run the R2 connection test from the backend directory:

```bash
cd backend
npx ts-node scripts/test-r2-connection.ts
```

Expected output:

```
╔════════════════════════════════════════════════════════════╗
║          Cloudflare R2 Connection Test Suite               ║
╚════════════════════════════════════════════════════════════╝

Configuration:
  Account ID: a1b2c3d4...
  Bucket: csv-uploads-prod
  Access Key: ABCD1234...

🔄 Test 1: Initializing R2StorageProvider...
✅ Provider initialized

🔄 Test 2: Uploading test file...
✅ Uploaded: test/r2-connection-test-1706745600000.txt

... (additional tests)

╔════════════════════════════════════════════════════════════╗
║ Total: 9 passed, 0 failed                                  ║
╚════════════════════════════════════════════════════════════╝

🎉 All tests passed! R2 is configured correctly.
```

### Manual Testing with AWS CLI

R2 is S3-compatible, so you can use AWS CLI:

```bash
# Configure AWS CLI for R2
aws configure set aws_access_key_id YOUR_R2_ACCESS_KEY
aws configure set aws_secret_access_key YOUR_R2_SECRET_KEY
aws configure set region auto

# Test upload
echo "test" | aws s3 cp - s3://csv-uploads-prod/test.txt \
  --endpoint-url https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com

# Test download
aws s3 cp s3://csv-uploads-prod/test.txt - \
  --endpoint-url https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com

# Test delete
aws s3 rm s3://csv-uploads-prod/test.txt \
  --endpoint-url https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com
```

---

## Troubleshooting

### Common Errors

#### "Access Denied" or "InvalidAccessKeyId"

**Cause**: Invalid or expired API token

**Solution**:
1. Verify `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` are correct
2. Check token hasn't expired
3. Verify token has Object Read & Write permissions
4. Confirm token applies to your bucket

#### "NoSuchBucket"

**Cause**: Bucket name doesn't match

**Solution**:
1. Verify `R2_BUCKET_NAME` matches exactly (case-sensitive)
2. Check bucket exists in Cloudflare dashboard
3. Verify Account ID is correct

#### "CORS Error" in Browser

**Cause**: CORS policy not configured or missing origin

**Solution**:
1. Add your frontend domain to AllowedOrigins
2. Include `http://localhost:3000` for development
3. Wait 1-2 minutes for CORS changes to propagate

#### "SignatureDoesNotMatch"

**Cause**: Secret key is wrong or has extra whitespace

**Solution**:
1. Regenerate the API token
2. Copy secret key exactly (no trailing spaces)
3. Check for encoding issues if copying from password manager

#### Slow Uploads

**Cause**: Distance to R2 region or file size

**Solution**:
1. Choose R2 region closest to your users
2. Use presigned URLs for direct browser uploads
3. Consider chunked uploads for files >50MB

### Debug Logging

Enable debug logging to troubleshoot:

```bash
# Enable AWS SDK debug logging
DEBUG=aws-sdk* npx ts-node scripts/test-r2-connection.ts
```

### Getting Help

- [Cloudflare R2 Documentation](https://developers.cloudflare.com/r2/)
- [Cloudflare Community Forum](https://community.cloudflare.com/)
- [R2 Discord Channel](https://discord.gg/cloudflaredev)

---

## Cost Estimation

R2 pricing is simple and predictable:

| Resource | Price | Free Tier |
|----------|-------|-----------|
| Storage | $0.015/GB/month | 10 GB |
| Class A Operations (write) | $4.50/million | 1 million |
| Class B Operations (read) | $0.36/million | 10 million |
| Egress | **$0.00** | Unlimited |

### Example Monthly Cost

For a typical application with:
- 10 GB stored CSV files
- 100,000 uploads/month
- 1,000,000 downloads/month

**Cost**: ~$0.50/month (mostly within free tier)

Compare to AWS S3:
- Same storage + operations: ~$5/month
- Plus egress for downloads: ~$90/month (1TB @ $0.09/GB)

**R2 Savings: ~99%** due to zero egress fees.

---

## Security Best Practices

1. **Rotate API tokens** every 90 days
2. **Use bucket-specific tokens** (not account-wide)
3. **Enable audit logging** via Cloudflare Logpush
4. **Restrict CORS origins** to production domains only
5. **Use presigned URLs** with short expiration (1 hour max)
6. **Never commit credentials** to version control
7. **Use Wrangler secrets** for Workers deployments

---

## Hyperdrive Setup (Database Connection Pooling)

Hyperdrive provides edge connection pooling for Neon PostgreSQL, dramatically reducing latency for database queries from Workers.

### Why Hyperdrive?

- **Lowest latency**: Connection pooling at Cloudflare's edge (not origin)
- **No cold starts**: Persistent connections eliminate connection setup time
- **Free tier**: 100,000 queries/day included (sufficient for MVP)
- **Paid tier**: $5/month Workers Paid plan includes unlimited queries

### Prerequisites

- Neon PostgreSQL database created and migrated
- Neon connection string (from Neon Dashboard → Connection Details)
- Wrangler CLI installed (`npm install -g wrangler`)

### Step 1: Create Hyperdrive Configuration

Run from your project root:

```bash
npx wrangler hyperdrive create date-management-db \
  --connection-string="postgresql://user:pass@ep-xxx.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require"
```

**Important**: Use your actual Neon connection string from `.env` or Neon Dashboard.

The command will output:

```
✅ Created new Hyperdrive config
 {
   "id": "a1b2c3d4e5f6789012345678abcdef90",
   "name": "date-management-db",
   "origin": {
     "host": "ep-xxx.us-east-1.aws.neon.tech",
     "port": 5432,
     "database": "neondb"
   }
 }
```

**Save the `id` value** - you'll need it for `wrangler.toml`.

### Step 2: Add Hyperdrive ID to Environment

Add to your `.env` file (local development reference):

```bash
HYPERDRIVE_CONFIG_ID=a1b2c3d4e5f6789012345678abcdef90  # Replace with your actual ID
```

⚠️ **Note**: While Hyperdrive IDs are not secrets (they don't contain credentials), use your actual ID from the previous step.

⚠️ **Note**: The Hyperdrive binding is configured in `wrangler.toml`, not as a secret.

### Step 3: Configure Wrangler Bindings

The Hyperdrive binding should be configured in `workers/wrangler.toml`:

```toml
# Production Environment
[[env.production.hyperdrive]]
binding = "HYPERDRIVE"
id = "a1b2c3d4e5f6789012345678abcdef90"  # Your Hyperdrive config ID from Step 1

# Development Environment
[[env.development.hyperdrive]]
binding = "HYPERDRIVE"
id = "a1b2c3d4e5f6789012345678abcdef90"  # Same ID for both environments
```

**Note**: It's safe to commit the Hyperdrive ID to git - it's a resource identifier, not a credential. The actual database credentials are stored securely by Cloudflare.

### Step 4: Use Hyperdrive in Workers Code

Hyperdrive is automatically available via the `env.HYPERDRIVE` binding:

```typescript
import { createDatabaseClient } from '../../backend/src/database/database-factory';

export function createWorkersDatabase(env: Env) {
  return createDatabaseClient({
    environment: 'production',
    hyperdriveConnectionString: env.HYPERDRIVE.connectionString,
    enableLogging: env.NODE_ENV === 'development',
  });
}
```

The database factory handles the Hyperdrive connection automatically.

### Step 5: Test Hyperdrive Connection

Test locally with Wrangler dev server:

```bash
cd workers
npx wrangler dev
```

Then test a database query:

```bash
curl http://localhost:8787/api/health
```

Check the console output for:

```
[Database] Connecting via Cloudflare Hyperdrive (edge pooling)
```

### Troubleshooting Hyperdrive

#### Error: "Hyperdrive configuration not found"

**Solution**: Verify the configuration ID is correct in `wrangler.toml`. List all Hyperdrive configs:

```bash
npx wrangler hyperdrive list
```

#### Error: "Connection to origin failed"

**Solution**: Check Neon connection string is correct and database is accessible:

1. Verify connection string in Neon Dashboard
2. Ensure database is not paused (Neon Free tier auto-pauses after 7 days inactivity)
3. Check Neon compute endpoint is running

#### Workers not using Hyperdrive

**Solution**: Ensure you're using the `env.HYPERDRIVE.connectionString` in your database factory:

```typescript
// ✅ Correct
hyperdriveConnectionString: env.HYPERDRIVE.connectionString

// ❌ Wrong
connectionUrl: process.env.NEON_CONNECTION_STRING
```

#### High latency despite Hyperdrive

**Solution**: 

1. Check Hyperdrive region matches Neon region (ap-southeast-2 in your case)
2. Verify you're not using direct Neon connections in parallel
3. Monitor Hyperdrive metrics in Cloudflare Dashboard → Workers → Hyperdrive

### Hyperdrive Metrics

Monitor Hyperdrive performance in Cloudflare Dashboard:

1. Go to **Workers & Pages** → **Hyperdrive**
2. Select your configuration (`date-management-db`)
3. View metrics:
   - Query count
   - Average latency
   - Cache hit rate
   - Connection pool usage

### Cost Comparison

| Tier | Queries/Day | Cost |
|------|-------------|------|
| **Free** | 100,000 | $0 |
| **Paid** | Unlimited | $5/month (Workers Paid plan) |

**Note**: The Workers Paid plan ($5/month) includes Hyperdrive plus:
- Unmetered requests (vs 100k/day free)
- Longer CPU time limits
- Additional features

For most applications, the free tier is sufficient for development and early production.

---

## Related Documentation

- [Storage Patterns](../backend/docs/storage-patterns.md) - Storage abstraction layer
- [Deployment Guide](../backend/docs/deployment.md) - Production deployment
- [Environment Variables](../backend/.env.example) - Configuration reference
- [Neon Database Branching](./database-migrations.md) - Database workflow
- [Hyperdrive Documentation](https://developers.cloudflare.com/hyperdrive/) - Official Cloudflare docs
