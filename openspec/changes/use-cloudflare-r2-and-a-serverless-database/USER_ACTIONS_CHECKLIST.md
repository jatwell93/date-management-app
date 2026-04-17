# User Actions Required - Cloudflare R2 & Serverless Database

**Change ID:** `use-cloudflare-r2-and-a-serverless-database`  
**Purpose:** Manual steps that require Cloudflare/Neon dashboard access

---

## Before Production Deployment

### 1. Configure R2 CORS Rules (Phase 6.3)

**Why:** Allow frontend to upload files directly to R2 via presigned URLs

**Steps:**

1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Navigate to **R2** → Select bucket: `csv-uploads-prod`
3. Click **Settings** → **CORS policy**
4. Add the following CORS configuration:

```json
[
  {
    "AllowedOrigins": ["https://yourdomain.com", "http://localhost:3000"],
    "AllowedMethods": ["GET", "PUT", "POST", "DELETE"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

5. Click **Save**

**Verification:**

```bash
curl -X OPTIONS https://csv-uploads-prod.your-account.r2.cloudflarestorage.com \
  -H "Origin: https://yourdomain.com" \
  -H "Access-Control-Request-Method: PUT"
```

Expected: Response includes `Access-Control-Allow-Origin` header

**Estimated Time:** 5 minutes

---

### 2. Configure R2 Lifecycle Rules (Phase 6.7)

**Why:** Automatically delete old CSV files to control storage costs

**Steps:**

1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Navigate to **R2** → Select bucket: `csv-uploads-prod`
3. Click **Settings** → **Lifecycle rules**
4. Click **Create lifecycle rule**
5. Configure rule:
   - **Rule name:** `delete-old-uploads`
   - **Prefix:** `uploads/` (or leave blank for all objects)
   - **Action:** Delete objects
   - **Days after creation:** 90 (adjust based on retention policy)
6. Click **Save**

**Cost Impact:**

- Without lifecycle rule: Storage costs grow indefinitely (≈$0.015/GB/month)
- With 90-day retention: Limits storage to ≈3 months of uploads

**Estimated Time:** 5 minutes

---

### 3. Configure Workers Secrets (Phase 10.6)

**Why:** Deploy production JWT secret and database credentials securely

**Steps:**

#### 3a. Deploy JWT Secret

```bash
cd workers/
wrangler secret put JWT_SECRET --env production
```

When prompted, enter the production JWT secret (same as backend `JWT_SECRET`)

#### 3b. Deploy Database URL (if not using Hyperdrive binding)

```bash
wrangler secret put DATABASE_URL --env production
```

When prompted, enter Neon PostgreSQL connection string

**⚠️ Important:** Use the same `JWT_SECRET` as backend to ensure tokens are interchangeable.

**Verification:**

```bash
wrangler tail --env production
# Trigger a request, check logs for successful authentication
```

**Estimated Time:** 5 minutes

---

### 4. Enable Cloudflare Analytics Engine (Phase 12.1)

**Why:** Track custom metrics for monitoring and debugging

**Steps:**

1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Navigate to **Analytics & Logs** → **Workers Analytics Engine**
3. Click **Enable Analytics Engine**
4. Note the Dataset ID (will be displayed)
5. Add to `workers/wrangler.toml`:

```toml
[[analytics_engine_datasets]]
binding = "ANALYTICS"
```

**Optional: Add Custom Metrics**

Update `workers/src/index.ts`:

```typescript
// Track upload events
env.ANALYTICS.writeDataPoint({
  blobs: ['upload-success'],
  doubles: [fileSize],
  indexes: [organizationId],
});

// Track API latency
env.ANALYTICS.writeDataPoint({
  blobs: ['api-latency'],
  doubles: [duration],
  indexes: [endpoint],
});
```

**Cost:** Free tier includes 10M events/month

**Estimated Time:** 10 minutes

---

### 5. Review and Approve Neon Autoscaling Settings (Optional)

**Why:** Control database costs by setting compute limits

**Steps:**

1. Log in to [Neon Console](https://console.neon.tech)
2. Select project: `date-management-prod`
3. Navigate to **Settings** → **Compute**
4. Review autoscaling settings:
   - **Minimum compute units:** 0.25 (recommended)
   - **Maximum compute units:** 2.0 (adjust based on traffic)
   - **Autosuspend delay:** 5 minutes (recommended)

**Cost Impact:**

- Min 0.25, Max 2.0: $19-76/month depending on usage
- Higher max = better performance, higher cost

**Estimated Time:** 5 minutes

---

### 6. Create Status Page (Phase 18.8) - Optional

**Why:** Communicate service availability to users

**Options:**

#### Option A: Use Statuspage.io (Recommended)

1. Sign up at [statuspage.io](https://www.statuspage.io)
2. Create status page: `status.yourdomain.com`
3. Add components:
   - API (Cloudflare Workers)
   - Database (Neon PostgreSQL)
   - Storage (Cloudflare R2)
4. Configure incident templates
5. Add uptime monitoring

**Cost:** $29/month (14-day free trial)

#### Option B: Simple HTML Status Page

1. Use the ready-made page at `status-page/index.html` (already created)
2. In the page, set health URL to your Worker endpoint (recommended):

- `https://api.yourdomain.com/health?deep=true`

3. Deploy to Cloudflare Pages (free):

```bash
cd status-page
npx wrangler pages deploy . --project-name date-management-status
```

4. Map custom domain in Pages (optional): `status.yourdomain.com`
5. Ensure API CORS includes your status page origin if different from frontend origin
6. Update status manually during incidents (optional banner/message edits in `index.html`)

**Estimated Time:** 30 minutes (Statuspage.io) or 15 minutes (HTML)

---

## Verification Checklist

After completing all user actions, verify:

| Action             | Verification                     | Expected Result                              |
| ------------------ | -------------------------------- | -------------------------------------------- |
| R2 CORS            | `curl -X OPTIONS ...`            | `Access-Control-Allow-Origin` header present |
| R2 Lifecycle Rules | Check bucket settings            | Rule shows as "Active"                       |
| Workers Secrets    | `wrangler tail --env production` | No "JWT_SECRET is undefined" errors          |
| Analytics Engine   | Deploy Workers, trigger request  | Event appears in Analytics Dashboard         |
| Neon Autoscaling   | Check Neon Dashboard metrics     | Autoscaling working, no connection errors    |
| Status Page        | Visit `status.yourdomain.com`    | Page loads, shows current status             |

---

## Troubleshooting

### CORS not working after configuration

- **Symptom:** Browser shows CORS error
- **Fix:** Check that `AllowedOrigins` includes your exact domain (no trailing slash)
- **Fix:** Restart browser to clear CORS cache

### Workers Secrets not recognized

- **Symptom:** `env.JWT_SECRET is undefined` in logs
- **Fix:** Verify secret deployed: `wrangler secret list --env production`
- **Fix:** Redeploy Workers: `wrangler deploy --env production`

### Analytics Engine not recording events

- **Symptom:** No data in Analytics Dashboard
- **Fix:** Check binding name matches `wrangler.toml`: `env.ANALYTICS`
- **Fix:** Wait 5-10 minutes for data to appear (not real-time)

### Neon connection pool exhausted

- **Symptom:** `ERROR: remaining connection slots are reserved`
- **Fix:** Increase max connections in Neon settings
- **Fix:** Verify Hyperdrive is configured (connection pooling)

---

## Cost Summary After User Actions

**Monthly costs with recommended settings:**

- Cloudflare Workers: $0 (free tier)
- Cloudflare R2: $0-5 (with 90-day lifecycle rule)
- Neon PostgreSQL: $19 (autoscale 0.25-2.0 compute units)
- Analytics Engine: $0 (free tier)
- Statuspage.io (optional): $29
- **Total: $19-33/month**

**Comparison to original VPS approach:**

- VPS baseline: $50-100/month
- **Savings: 50-70%**

---

## Next Steps After User Actions

Once all user actions are complete:

1. **Resume OpenSpec work** starting with Phase 8B (Multi-Tenant Workers Support)
2. **Deploy to production** after Phase 15 tasks complete
3. **Monitor for first 48 hours** closely (check Sentry, Analytics Engine, Neon Dashboard)
4. **Review costs weekly** for first month to catch any unexpected usage

---

**Estimated Total Time for All User Actions:** 1-1.5 hours
