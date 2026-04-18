# R2 Data Recovery Procedure

## Overview

This procedure documents how to recover files from Cloudflare R2 to local filesystem in case of emergency or disaster. Use this when:

- R2 bucket becomes inaccessible from Workers
- Need to restore R2 files to local storage for VPS rollback
- Emergency data recovery required
- Disaster recovery drill or testing

**Expected Duration**: 15-60 minutes (depending on data size)  
**Data Loss Risk**: None (data remains in R2 until manually deleted)  
**Required Tools**: AWS CLI, R2 API credentials

---

## Prerequisites

Before executing recovery, ensure:

- [ ] AWS CLI installed locally (`aws --version`)
- [ ] R2 credentials available (Access Key ID, Secret Access Key, Account ID)
- [ ] Local storage has sufficient disk space for CSV files (minimum: R2 bucket size + 20%)
- [ ] Network connectivity to Cloudflare R2 (test with `curl https://r2.youraccount.cloudflare.com`)
- [ ] Credentials NOT committed to Git (never hardcode in .env)

---

## Step-by-Step Recovery

### Phase 1: AWS CLI Setup (5 minutes)

**1.1 Install AWS CLI (if not installed)**

```bash
# macOS
brew install awscli

# Ubuntu/Debian
sudo apt-get install awscli

# Windows (via Chocolatey)
choco install awscli

# Verify installation
aws --version
# Output: aws-cli/2.x.x ...
```

**1.2 Configure AWS CLI for R2**

```bash
aws configure --profile r2

# When prompted, enter:
# AWS Access Key ID: [Your R2 Access Key]
# AWS Secret Access Key: [Your R2 Secret Key]
# Default region: us-east-1 (R2 uses us-east-1 as default)
# Default output format: json
```

**1.3 Verify R2 credentials**

```bash
# Test connectivity to R2
aws s3 ls --endpoint-url https://<account-id>.r2.cloudflarestorage.com \
  --profile r2

# Should list your R2 buckets
# Output:
# 2026-03-07 12:00:00 csv-uploads-prod
```

---

### Phase 2: Download CSV Files from R2 (10-40 minutes)

**2.1 Sync entire R2 bucket to local directory**

```bash
# Create local directory for recovery
mkdir -p ./uploads/r2-recovery

# Sync all files from R2 to local
aws s3 sync s3://csv-uploads-prod ./uploads/r2-recovery \
  --endpoint-url https://<account-id>.r2.cloudflarestorage.com \
  --profile r2 \
  --no-progress

# Monitor progress (add --dryrun to preview without downloading)
aws s3 sync s3://csv-uploads-prod ./uploads/r2-recovery \
  --endpoint-url https://<account-id>.r2.cloudflarestorage.com \
  --profile r2 \
  --dryrun
```

**Example Output**:

```
download: s3://csv-uploads-prod/2026-03-01/inventory-123.csv to uploads/r2-recovery/2026-03-01/inventory-123.csv
download: s3://csv-uploads-prod/2026-03-02/inventory-456.csv to uploads/r2-recovery/2026-03-02/inventory-456.csv
...
Completed 1,234 objects with 5.2 GB
```

**2.2 Selective Recovery (if needed)**

If only specific files are needed:

```bash
# Download single file
aws s3 cp s3://csv-uploads-prod/2026-03-01/inventory-123.csv \
  ./uploads/r2-recovery/inventory-123.csv \
  --endpoint-url https://<account-id>.r2.cloudflarestorage.com \
  --profile r2

# Download files matching pattern (e.g., specific date)
aws s3 sync s3://csv-uploads-prod/2026-03-01 ./uploads/r2-recovery/2026-03-01 \
  --endpoint-url https://<account-id>.r2.cloudflarestorage.com \
  --profile r2
```

---

### Phase 3: Verification (5-10 minutes)

**3.1 Verify file count and sizes**

```bash
# Count downloaded files
find ./uploads/r2-recovery -type f | wc -l

# Calculate total size
du -sh ./uploads/r2-recovery

# Compare with R2 stats
aws s3api list-objects-v2 --bucket csv-uploads-prod \
  --endpoint-url https://<account-id>.r2.cloudflarestorage.com \
  --profile r2 \
  --query '[Contents] | length(Contents)' \
  --output text
```

**Expected**: File counts should match, total sizes should be approximately equal

**3.2 Verify file integrity**

```bash
# Generate checksums of downloaded files
find ./uploads/r2-recovery -type f -exec md5sum {} \; > r2-recovery-checksums.txt

# Compare with R2 objects
# (R2 provides ETag matching S3 MD5 for single-part uploads)
aws s3api list-objects-v2 --bucket csv-uploads-prod \
  --endpoint-url https://<account-id>.r2.cloudflarestorage.com \
  --profile r2 \
  --query 'Contents[].[Key, ETag]' \
  --output text > r2-objects-etags.txt

# Manual spot-check: Open a few CSV files and verify structure
head -5 ./uploads/r2-recovery/2026-03-01/inventory-123.csv
```

**Expected**: Files are readable, contain expected CSV structure (headers + data)

**3.3 Document recovery metadata**

```bash
# Create recovery manifest
cat > ./uploads/r2-recovery-manifest.json << EOF
{
  "recoveryDate": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "source": "s3://csv-uploads-prod",
  "destination": "./uploads/r2-recovery",
  "totalFiles": $(find ./uploads/r2-recovery -type f | wc -l),
  "totalSize": "$(du -sh ./uploads/r2-recovery | cut -f1)",
  "checksumFile": "r2-recovery-checksums.txt",
  "etagFile": "r2-objects-etags.txt",
  "status": "completed"
}
EOF

cat ./uploads/r2-recovery-manifest.json
```

---

### Phase 4: Integration with Application (5 minutes)

**4.1 Configure application to use recovered files**

If rolling back to VPS/Express with local filesystem:

```bash
# Ensure Express app uses local filesystem storage
# In backend .env or config:

NODE_ENV=production
STORAGE_PROVIDER=local  # Switch from 'r2' to 'local'
UPLOAD_DIR=./uploads/r2-recovery  # Point to recovered files
```

**4.2 Restart application with recovered files**

```bash
# On VPS
ssh root@your-vps-ip

# Update .env with UPLOAD_DIR pointing to recovered files
nano /home/date-management-app/.env

# Restart Express server
pm2 restart app

# Verify application loads files
curl http://localhost:3000/api/products
# Should return products with file references to recovered CSVs
```

---

## Incremental Recovery (Large Datasets)

For very large R2 buckets (>100GB), use incremental sync:

```bash
# First sync - may take hours
aws s3 sync s3://csv-uploads-prod ./uploads/r2-recovery \
  --endpoint-url https://<account-id>.r2.cloudflarestorage.com \
  --profile r2 \
  --max-items 1000

# Subsequent syncs - only copies new/changed files
# Safe to pause and resume multiple times
aws s3 sync s3://csv-uploads-prod ./uploads/r2-recovery \
  --endpoint-url https://<account-id>.r2.cloudflarestorage.com \
  --profile r2 \
  --exact-timestamps  # Only re-upload if timestamps differ
```

---

## Failure Recovery

**If sync fails partway through:**

```bash
# Check sync status to identify last successful file
tail -100 sync-log.txt

# Restart sync - AWS CLI will skip already-downloaded files
aws s3 sync s3://csv-uploads-prod ./uploads/r2-recovery \
  --endpoint-url https://<account-id>.r2.cloudflarestorage.com \
  --profile r2

# Should continue from last successful file
```

**If network timeout occurs:**

```bash
# Reduce parallelism and increase timeout
aws configure set default.s3.max_concurrent_requests 5
aws configure set default.s3.max_bandwidth 10MB/s

# Retry sync with throttled settings
aws s3 sync s3://csv-uploads-prod ./uploads/r2-recovery \
  --endpoint-url https://<account-id>.r2.cloudflarestorage.com \
  --profile r2
```

---

## Automated Recovery Script

**Create `backend/scripts/recover-r2-to-local.sh`**

```bash
#!/bin/bash

# R2 Recovery Script
# Usage: bash scripts/recover-r2-to-local.sh

set -e

# Configuration
R2_BUCKET=${R2_BUCKET:-csv-uploads-prod}
R2_ACCOUNT_ID=${R2_ACCOUNT_ID:-your-account-id}
OUTPUT_DIR=${OUTPUT_DIR:-./uploads/r2-recovery}
PROFILE=${PROFILE:-r2}
LOG_FILE="r2-recovery-$(date +%Y%m%d-%H%M%S).log"

echo "=== R2 Recovery Starting ===" | tee -a $LOG_FILE
echo "Bucket: $R2_BUCKET" | tee -a $LOG_FILE
echo "Output: $OUTPUT_DIR" | tee -a $LOG_FILE
echo "Log: $LOG_FILE" | tee -a $LOG_FILE

# Verify credentials
echo "Verifying R2 credentials..." | tee -a $LOG_FILE
aws s3 ls --endpoint-url https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com \
  --profile $PROFILE >> $LOG_FILE 2>&1 || {
  echo "ERROR: R2 credentials invalid" | tee -a $LOG_FILE
  exit 1
}

# Create output directory
mkdir -p "$OUTPUT_DIR"

# Sync files
echo "Starting sync..." | tee -a $LOG_FILE
aws s3 sync "s3://${R2_BUCKET}" "$OUTPUT_DIR" \
  --endpoint-url "https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com" \
  --profile "$PROFILE" \
  2>&1 | tee -a $LOG_FILE

# Verify
FILE_COUNT=$(find "$OUTPUT_DIR" -type f | wc -l)
TOTAL_SIZE=$(du -sh "$OUTPUT_DIR" | cut -f1)

echo "" | tee -a $LOG_FILE
echo "=== Recovery Complete ===" | tee -a $LOG_FILE
echo "Files downloaded: $FILE_COUNT" | tee -a $LOG_FILE
echo "Total size: $TOTAL_SIZE" | tee -a $LOG_FILE
echo "Output location: $OUTPUT_DIR" | tee -a $LOG_FILE
```

**Execute recovery:**

```bash
chmod +x backend/scripts/recover-r2-to-local.sh
bash backend/scripts/recover-r2-to-local.sh
```

---

## Recovery Checklist (Copy & Paste)

```markdown
## R2 Recovery Execution Checklist - [DATE/TIME]

### Prerequisites

- [ ] AWS CLI installed (aws --version)
- [ ] R2 credentials available (not in Git)
- [ ] Local disk space verified (minimum 2x R2 bucket size)
- [ ] Network connectivity tested

### Setup

- [ ] AWS CLI configured for R2 (aws configure --profile r2)
- [ ] R2 credentials verified (aws s3 ls --profile r2 ...)

### Recovery

- [ ] Local recovery directory created (./uploads/r2-recovery)
- [ ] AWS S3 sync started (aws s3 sync ...)
- [ ] Sync completed without errors
- [ ] File count verified and matches R2
- [ ] File sizes verified and approximately match R2
- [ ] Spot-check: Several CSV files opened and verified readable

### Integration

- [ ] Application .env updated to use local storage provider
- [ ] Application pointed to recovered files directory
- [ ] Application restarted
- [ ] API endpoints tested (GET /api/products works)
- [ ] Files accessible through application

### Documentation

- [ ] Recovery manifest created (r2-recovery-manifest.json)
- [ ] Checksums saved (r2-recovery-checksums.txt)
- [ ] Logs captured (r2-recovery-\*.log)

**Recovery Completed**: **\_** (timestamp)  
**Executed By**: **\_** (name)  
**Verified By**: **\_** (name)  
**Total Files Recovered**: **\_**  
**Total Size**: **\_**
```

---

## Related Procedures

- **[Rollback Procedure](./rollback-procedure.md)** - Revert to VPS (often used with R2 recovery)
- **[Neon Backup & Restore](./neon-backup-restore.md)** - Recover database
- **[Master Disaster Recovery Plan](./disaster-recovery.md)** - Complete failure scenarios

---

## R2 Configuration Reference

| Parameter            | Value                                                            | Notes                                             |
| -------------------- | ---------------------------------------------------------------- | ------------------------------------------------- |
| **Endpoint URL**     | `https://<account-id>.r2.cloudflarestorage.com`                  | Replace with your account ID                      |
| **Region**           | `us-east-1`                                                      | R2 is region-agnostic but AWS CLI requires region |
| **Bucket Name**      | `csv-uploads-prod`                                               | Verify current bucket name                        |
| **API Resource URL** | `https://<account-id>.r2.cloudflarestorage.com/csv-uploads-prod` | Direct access URL                                 |

---

**Last Updated**: March 7, 2026  
**Next Review**: Quarterly (before each disaster recovery drill)  
**Owner**: DevOps / On-Call Engineer
