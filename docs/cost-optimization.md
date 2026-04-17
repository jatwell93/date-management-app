# Cost Optimization Guide

Strategies to minimize cloud costs on Cloudflare, Neon, and Stripe while maintaining performance and reliability.

## Table of Contents

1. [Cost Overview](#cost-overview)
2. [Cloudflare Optimization](#cloudflare-optimization)
3. [Neon Database Optimization](#neon-database-optimization)
4. [Stripe Cost Management](#stripe-cost-management)
5. [Monitoring & Alerts](#monitoring--alerts)
6. [Regional Optimization](#regional-optimization)
7. [Reserved Capacity](#reserved-capacity)

---

## Cost Overview

### Expected Monthly Costs (MVP - Low Traffic)

| Service                | Free Tier           | Cost         | Notes                      |
| ---------------------- | ------------------- | ------------ | -------------------------- |
| **Cloudflare Workers** | 100,000 req/day     | $0           | Sufficient for launch      |
| **Cloudflare R2**      | 10GB + 1M API calls | $0           | Sufficient for launch      |
| **Neon PostgreSQL**    | 3 branches, 256MB   | $0           | Free tier adequate for MVP |
| **Stripe**             | No free tier        | 2.9% + $0.30 | Per-transaction cost       |
| **Total**              | With free tiers     | ~$0          | (excluding Stripe)         |

### Expected Monthly Costs (Growth - Medium Traffic)

| Service                | Estimated Usage               | Monthly Cost |
| ---------------------- | ----------------------------- | ------------ |
| **Cloudflare Workers** | 10M requests                  | $5.00        |
| **Cloudflare R2**      | 100GB storage + 50M API calls | $23.00       |
| **Neon PostgreSQL**    | 2 projects, 10GB storage, CPU | $39.00       |
| **Stripe**             | $10,000 transactions          | $290         |
| **Total**              | -                             | $357         |

---

## Cloudflare Optimization

### Workers Optimization

**Cost Driver:** API requests (beyond free tier)

#### 1. Minimize Request Count

```typescript
// Bad: Single request per operation
async function getUserProfile(userId: string) {
  const user = await db.user.findUnique({ where: { id: userId } });
  const subscription = await db.subscription.findUnique({ where: { userId } });
  const analytics = await db.analytics.findMany({ where: { userId } });
  return { user, subscription, analytics };
}
// 3 database requests

// Good: Batch in single query
async function getUserProfile(userId: string) {
  const [user, subscription, analytics] = await Promise.all([
    db.user.findUnique({
      where: { id: userId },
      include: { subscription: true, analytics: true },
    }),
  ]);
  return { user, subscription, analytics };
}
// 1 database request
```

#### 2. Enable Response Caching

```typescript
// Cache static endpoints for 1 hour
app.get('/api/products', cache({ ttl: 3600 }), (req, res) => {
  // Reduces database hits for high-traffic endpoints
});

// Cache user profile for 5 minutes
app.get('/api/user/profile', authenticateToken, cache({ ttl: 300 }), (req, res) => {
  // Cache per user ID for security
});
```

#### 3. Use Workers KV for Repeated Reads

```typescript
// Store tier limits in KV (rarely changes)
async function getTierLimits(tier: string) {
  // First request: store in KV
  const cached = await KV.get(`tier:${tier}`);
  if (cached) return JSON.parse(cached);

  const limits = await db.tierLimit.findUnique({ where: { tier } });
  await KV.put(`tier:${tier}`, JSON.stringify(limits), {
    expirationTtl: 86400, // 24 hours
  });
  return limits;
}
```

#### 4. Optimize Bundle Size

Every byte downloaded costs bandwidth. Target < 500KB for Workers.

```bash
# Check bundle size
npm run build:workers
ls -lh workers/dist/

# Current size should be < 300KB
# Minification provides 40-50% reduction
```

### R2 Storage Optimization

**Cost Drivers:** Storage, API calls, data transfer

#### 1. Implement Lifecycle Rules

Already configured in [docs/cloudflare-setup.md](#lifecycle-rules).

**Auto-delete uploads after 90 days:**

```json
{
  "Rules": [
    {
      "Action": { "Delete": {} },
      "Condition": { "DaysGreaterThan": 90 },
      "Filter": { "Prefix": "uploads/" }
    }
  ]
}
```

**Savings:** $0.015 per GB after 1 year if not deleted

#### 2. Compress Files Before Upload

```typescript
// Compress CSV before uploading to R2
import { gzip } from 'zlib';

async function uploadCompressed(filename: string, data: Buffer) {
  const compressed = await new Promise((resolve, reject) => {
    gzip(data, (err, result) => (err ? reject(err) : resolve(result)));
  });

  await storage.upload(`${filename}.gz`, compressed, 'application/gzip');

  // Typical savings: 60-80% for CSV files
}
```

#### 3. Use R2 CDN Caching Headers

```typescript
// Cache frequently accessed files
await storage.upload('key', data, 'text/csv', {
  'Cache-Control': 'public, max-age=86400', // 1 day
  'Content-Encoding': 'gzip',
});
```

#### 4. Batch API Operations

```typescript
// Bad: Individual API calls
for (const file of files) {
  await r2.delete(file.key); // 1 API call per file × 1000 files = 1000 calls
}

// Good: Batch operations (if supported) or batch delete
const keys = files.map((f) => f.key);
// Most delete operations are per-object, so unavoidable
// Instead: set lifecycle rules to auto-delete old files
```

#### 5. Monitor R2 Metrics

```bash
# Check R2 usage in Cloudflare Dashboard
# https://dash.cloudflare.com/
# R2 → Analytics → Storage & API calls

# Alerts: If API calls exceed 2M/month, optimize
```

---

## Neon Database Optimization

**Cost Drivers:** Compute hours, data storage, backup storage

### 1. Right-Size Compute

Neon charges for compute hours (CPU time).

```sql
-- Check compute usage
-- In Neon dashboard: Monitoring → Compute
-- Look for consistently low CPU usage

-- If using shared tier and CPU is low:
-- Free tier is sufficient, no upgrade needed
```

Estimates:

- **Free tier (1 CPU):** Perfect for MVP, supports ~100 concurrent users
- **Standard (2 CPU):** $19/month, supports ~500 concurrent users
- **Professional (4 CPU):** $49/month, supports ~1000 concurrent users

### 2. Implement Database Indexes Strategically

**High-impact indexes** (already deployed):

```sql
-- Existing indexes benefiting most queries
CREATE INDEX idx_products_organizationid ON products(organization_id);
CREATE INDEX idx_products_expiry ON products(expiry_date DESC);
CREATE INDEX idx_inventory_sku ON inventory(sku);
CREATE INDEX idx_inventory_area ON inventory(store_area_id);
```

**Cost Savings:** Prevent full table scans

- Each missing index causes ~10x more database work
- Storage cost: ~0.1MB per index (negligible)

### 3. Use Connection Pooling with Hyperdrive

**Already configured!** Hyperdrive reduces connection overhead.

Without pooling:

- Each Worker cold start = new Neon connection
- Connection overhead: 50-100ms per connection
- Cost: More compute for connection management

With Hyperdrive:

- Connections pooled at edge (50+ concurrent reuse)
- Connection overhead: <5ms (cached)
- Cost: Dramatically reduced

**Usage already optimized** in `workers/src/index.ts`

### 4. Archive Old Data

For historical data, implement archiving:

```typescript
// Move old data to archive table (monthly job)
async function archiveOldData() {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  // Move to archive
  const oldRecords = await db.inventory.findMany({
    where: { createdAt: { lt: thirtyDaysAgo } },
  });

  await db.inventoryArchive.createMany({
    data: oldRecords,
  });

  // Delete from main table
  await db.inventory.deleteMany({
    where: { createdAt: { lt: thirtyDaysAgo } },
  });

  // Savings: Queries on active data are faster, smaller index size
}
```

### 5. Monitor Query Performance

```bash
# In Neon Dashboard → Monitoring → Query Performance
# Sort by: Duration × Call count

# Optimize top offenders with indexes
# Target queries: >100ms × 1000 calls = 100s total

# Commands to check slow queries:
SELECT query, calls, mean_exec_time
FROM pg_stat_statements
ORDER BY mean_exec_time * calls DESC
LIMIT 10;
```

### 6. Configure Autoscaling Limits

Neon can auto-scale compute but has limits:

```bash
# In Neon → Project Settings → Auto-scaling
# Recommended:
# - Min compute: Free tier (1 CPU)
# - Max compute: Standard (2 CPU)
# - Prevents runaway costs from traffic spikes
```

### 7. Use Read Replicas for Analytics

For heavy read workloads (analytics queries):

```typescript
// Instead of hitting main database
// Create read replica for analytics
const analyticsDb = new PrismaClient({
  datasourceUrl: ANALYTICS_DATABASE_URL, // Read-only replica
});

// Metrics queries go to replica
const dailyStats = await analyticsDb.analytics.groupBy({
  by: ['organizationId'],
  _count: true,
});
// Frees main database for transactional workload
```

Cost: Read replicas are cheaper ($5/month) than increasing main compute

---

## Stripe Cost Management

**Cost Driver:** Transaction fees (2.9% + $0.30 per transaction)

### 1. Batch Invoicing

```typescript
// Bad: Invoice immediately on every subscription change
await stripe.invoices.create({
  customer: customerId,
  auto_advance: true, // Cost: immediate payment attempt
});

// Good: Batch invoices daily
// Let Stripe's automatic billing handle it
// Reduces invoice attempts, payment failures, retries
```

### 2. Use Metered Billing for Usage Charges

For usage-based pricing (CSV uploads), use metered billing:

```typescript
// Report usage at upload time (included transaction)
await stripe.invoiceItems.create({
  customer: customerId,
  amount: Math.round(fileSize * pricePerGB * 100),  // in cents
  currency: 'usd',
  description: `CSV upload: ${filename}`,
  invoice: existingInvoice  // Add to next invoice
});

// vs. separate charge:
await stripe.charges.create({
  amount: ...,
  customer: customerId
});
// Metered = no new transaction fee, just invoiced at period end
```

### 3. Set Payment Method Defaults

Reduce failed payment retries:

```typescript
// Ensure each customer has valid default payment method
await stripe.customers.update(customerId, {
  invoice_settings: {
    default_payment_method: paymentMethodId,
    custom_fields: [{ name: 'Organization ID', value: orgId }],
  },
});

// Savings: Reduces retry attempts, customer support tickets
```

### 4. Monitor Failed Payments

```typescript
// Failed payments cost per retry attempt
// Check webhook: invoice.payment_failed
// Alert after 3 failures:
if (invoice.attempt_count >= 3) {
  notify.sendCustomerAlert({
    customerId,
    message: 'Automatic payment failed. Please update payment method.',
    link: '/account/billing',
  });
  // Reduce unnecessary retry attempts
}
```

### 5. Use Coupons Strategically

```typescript
// Offer discount coupons instead of manual adjustments
const discount = await stripe.coupons.create({
  percent_off: 10,
  duration: 'repeating',
  duration_in_months: 3,
  max_redemptions: 100,
});

// vs. creating individual credits/invoices per customer
// Coupons are free, credits have admin overhead
```

---

## Monitoring & Alerts

### Auto-Alerting on Cost Anomalies

```bash
# Set up cost monitoring in each platform

# Cloudflare:
# 1. Dashboard → Notifications
# 2. Create alert: "R2 API calls > 2,000,000/month"
# 3. Create alert: "Workers requests > 1,000,000/day"

# Neon:
# 1. Dashboard → Monitoring
# 2. Watch: Compute hours > 30/month
# 3. Watch: Storage > 5GB

# Stripe:
# 1. Not automated, but review monthly invoices
# 2. Check for unusual payment failure rates
```

### Weekly Cost Review

```bash
# Every Monday, check:

# 1. Cloudflare costs
curl https://api.cloudflare.com/client/v4/accounts/{id}/billing/profile

# 2. Neon costs
neon projects list | grep compute

# 3. Stripe MRR
# https://dashboard.stripe.com → Billing → Overview

# Create simple script for automated reporting
npm run report:costs
```

---

## Regional Optimization

### Neon Region Selection

Choose closest region to users:

| Region                  | Latency            | Best For            |
| ----------------------- | ------------------ | ------------------- |
| US East (N. Virginia)   | <20ms from US East | Default, most users |
| US West (N. California) | <20ms from US West | West Coast users    |
| EU (Frankfurt)          | <20ms from Europe  | EU-based users      |

**Cost:** Same regardless of region

### Cloudflare Workers Global Distribution

Workers are automatically deployed globally at no extra cost.

**Response times:**

- Within edge location: <10ms
- Within region: 20-50ms
- Cross-region: 50-150ms

**Optimization:** No action needed, inherent to Cloudflare

---

## Reserved Capacity

### When to Reserve

Once traffic patterns stabilize (after 3+ months):

**Neon Commitments:**

- Not available for free tier
- Consider after usage exceeds free tier limits

**Cloudflare:**

- Pre-pay discounts not available for Workers/R2
- Buy in bulk for enterprise accounts only (10M+ requests/month)

### Current Recommendation

For MVP (< 1 year):

- ✅ Use free tiers exclusively
- ✅ No long-term commitments
- ✅ Switch to paid tiers as usage grows
- ⚠️ Only commit if usage is > $1000/month (requires 2+ year commitment)

---

## Checklist: Cost Optimization

Before production launch:

- [ ] Cloudflare Workers caching enabled for static endpoints
- [ ] R2 lifecycle rules configured (auto-delete 90+ day uploads)
- [ ] Database indexes created for all query paths
- [ ] Hyperdrive connection pooling enabled
- [ ] Stripe payment method default configured
- [ ] Cost alerts set up on all platforms
- [ ] Weekly cost review process documented
- [ ] Archive strategy planned for old data
- [ ] Bundle size optimized (<500KB)
- [ ] Query performance profiling baseline collected

**Result:** Expected cost < $50/month at MVP scale, scaling linearly with traffic.
