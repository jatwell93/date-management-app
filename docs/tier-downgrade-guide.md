# Tier Downgrade Guide

## Overview

When your subscription tier is downgraded (either voluntarily or due to payment issues), you may find yourself with more products or inventory items than your new tier allows. This guide explains what happens during a downgrade and how to resolve creation lock scenarios.

## Table of Contents

1. [Understanding Tier Limits](#understanding-tier-limits)
2. [What Happens During Downgrade](#what-happens-during-downgrade)
3. [Creation Lock Explained](#creation-lock-explained)
4. [Resolving Over-Limit Scenarios](#resolving-over-limit-scenarios)
5. [Exporting Excess Products](#exporting-excess-products)
6. [SQL Reference for Admins](#sql-reference-for-admins)

---

## Understanding Tier Limits

Each subscription tier has specific limits for different resource types:

| Tier | Max SKUs (Products) | Max Users | Max Inventory Items | Storage |
|------|---------------------|-----------|---------------------|---------|
| **Starter** | 500 | 1 | 5,000 | 1 GB |
| **Professional** | 2,000 | 3 | 20,000 | 10 GB |
| **Premium** | Unlimited | 10 | Unlimited | 100 GB |
| **Concierge** | Unlimited | 10 | Unlimited | Unlimited |

### Important Limit Definitions

- **SKUs (Products)**: Count of unique products in your product catalog. Each unique SKU counts as one toward the limit.
- **Inventory Items**: Count of individual inventory tracking records (where products are stored, quantities, expiry dates).
- **Users**: Number of active user accounts in your organization.
- **Storage**: Total file size of all uploads (CSV files, reports, attachments).

These limits are **independent** - you can hit your SKU limit while having plenty of inventory item capacity remaining.

---

## What Happens During Downgrade

### Scenario 1: Downgrade Within Limits

If your current usage is below the new tier's limits:
- ✅ Downgrade proceeds immediately
- ✅ All existing data remains accessible
- ✅ You can continue creating new products/inventory
- ✅ Limits are updated to reflect new tier

### Scenario 2: Downgrade Exceeds Limits

If your current usage exceeds the new tier's limits:
- ⚠️ Downgrade proceeds but **creation lock** is applied
- ✅ All existing data remains accessible (read, update, delete)
- ❌ **New creations blocked** until usage drops below limits
- 📧 Warning email sent with instructions

### Common Downgrade Triggers

1. **Manual tier change**: You downgrade via Settings → Billing
2. **Subscription cancellation**: Account downgrades to Starter at period end
3. **Past due auto-downgrade**: 7 days past due triggers automatic downgrade
4. **Trial expiration**: Trial converts to Starter tier after 14 days

---

## Creation Lock Explained

### What Is Creation Lock?

Creation lock (`isCreationLocked` flag on your organization) is a safety mechanism that prevents new data creation when your usage exceeds tier limits. It ensures you don't accidentally create data you can't retain.

### What Is Blocked?

When creation lock is active:
- ❌ Creating new products (POST /products)
- ❌ Creating new inventory items (POST /inventory-items)
- ❌ Adding new users (POST /users)
- ❌ Uploading files that would exceed storage limit

### What Is Still Allowed?

- ✅ Viewing all existing data
- ✅ Updating existing products/inventory
- ✅ Deleting products/inventory (to reduce usage)
- ✅ Generating reports
- ✅ All read operations

### How to Check If You're Locked

**Via UI**: Look for the warning banner at the top of the page

**Via API**:
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  https://api.yourdomain.com/api/organization/usage
```

Response will include:
```json
{
  "isCreationLocked": true,
  "totalSkus": 1500,
  "maxSkus": 500,
  "excessSkus": 1000
}
```

---

## Resolving Over-Limit Scenarios

You have two options to resolve a creation lock:

### Option 1: Upgrade Your Tier (Fastest)

1. Go to **Settings → Billing**
2. Select a higher tier that accommodates your current usage
3. Complete payment
4. Creation lock is automatically removed immediately

### Option 2: Delete Excess Data

If you prefer to stay on your current tier, you must delete enough products/inventory to fall within limits.

#### Step-by-Step Process

1. **Check current usage**: 
   ```bash
   curl -H "Authorization: Bearer YOUR_TOKEN" \
     https://api.yourdomain.com/api/organization/usage
   ```

2. **Export excess products** (see [Exporting Excess Products](#exporting-excess-products) below)

3. **Identify deletion candidates**:
   - Products without inventory items (unused SKUs)
   - Oldest products (by `created_at` date)
   - Products with zero quantity across all areas

4. **Delete products** via UI or API:
   ```bash
   curl -X DELETE \
     -H "Authorization: Bearer YOUR_TOKEN" \
     https://api.yourdomain.com/api/products/123
   ```

5. **Verify lock removal**:
   After deletion, check usage again. Once `totalSkus <= maxSkus`, the lock is automatically removed.

### Priority Deletion Strategy

When deciding what to delete, prioritize:

1. **Unused SKUs**: Products never assigned to inventory
2. **Discontinued items**: Products marked as obsolete
3. **Duplicates**: Same product with multiple SKUs
4. **Oldest first**: Least recently created products

---

## Exporting Excess Products

Before deleting products, we recommend exporting a backup. The system provides a dedicated endpoint for exporting products that exceed your tier limit.

### Via API

```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  https://api.yourdomain.com/api/products/export-excess \
  -o excess-products-backup.csv
```

The export includes:
- Product ID
- SKU
- Name
- Category
- Barcode
- Cost price
- Created date
- Inventory count (how many areas it's stored in)

### Via CLI Script (Admins)

For administrators managing multiple organizations:

```bash
cd backend
npm run export:excess-products -- --org <organization-id> --tier starter
```

This generates a CSV file with all products sorted by creation date (oldest first), making it easy to identify deletion candidates.

### CSV Export Format

```csv
id,sku,name,category,barcode,costPrice,createdAt,inventoryCount
123,ASPIRIN-500,Aspirin 500mg,Pharmaceuticals,123456789,12.99,2024-01-15T10:30:00Z,3
124,IBUPROFEN-200,Ibuprofen 200mg,Pharmaceuticals,987654321,8.50,2024-01-16T14:22:00Z,0
```

---

## SQL Reference for Admins

### Check Organization Usage

```sql
-- View current usage vs limits
SELECT 
  o.id,
  o.name,
  o.isCreationLocked,
  ou.totalSkus,
  ou.maxSkus,
  ou.totalSkus - ou.maxSkus as excessSkus,
  ou.totalInventoryItems,
  ou.maxInventoryItems,
  ou.totalInventoryItems - ou.maxInventoryItems as excessInventory,
  st.tierLevel,
  st.status
FROM organizations o
JOIN organization_usages ou ON o.id = ou.organizationId
JOIN subscription_tiers st ON o.id = st.organizationId
WHERE o.id = 'YOUR_ORG_ID';
```

### Find Excess Products

```sql
-- Get products beyond Starter limit (oldest first)
SELECT 
  p.id,
  p.sku,
  p.name,
  p.created_at,
  COUNT(ii.id) as inventory_count
FROM products p
LEFT JOIN inventory_items ii ON p.id = ii.productId
WHERE p.organizationId = 'YOUR_ORG_ID'
ORDER BY p.created_at ASC
LIMIT 1000 OFFSET 500;  -- Skip first 500 (within limit)
```

### Find Products Without Inventory

```sql
-- Products that can be safely deleted (no inventory assigned)
SELECT 
  p.id,
  p.sku,
  p.name,
  p.created_at
FROM products p
LEFT JOIN inventory_items ii ON p.id = ii.productId
WHERE p.organizationId = 'YOUR_ORG_ID'
  AND ii.id IS NULL
ORDER BY p.created_at ASC;
```

### Manual Lock Removal (Emergency Only)

```sql
-- ⚠️ USE WITH CAUTION - Only when usage is actually within limits
UPDATE organizations 
SET isCreationLocked = false 
WHERE id = 'YOUR_ORG_ID';

-- Log the action
INSERT INTO audit_logs (organization_id, action, change_description)
VALUES ('YOUR_ORG_ID', 'manual_lock_removal', 'Creation lock manually removed by admin');
```

---

## Frequently Asked Questions

### Q: Will I lose data during a downgrade?
**A**: No. Downgrades never delete your existing data. You retain full read/update/delete access to all products and inventory. Only new creations are blocked until you reduce usage or upgrade.

### Q: How long do I have to resolve an over-limit situation?
**A**: There is no time limit. The creation lock persists until you either (1) delete enough products to fall within limits, or (2) upgrade to a tier that accommodates your current usage.

### Q: Can I partially resolve by deleting just enough products?
**A**: Yes. You only need to delete enough products to bring your `totalSkus` equal to or below your `maxSkus`. For example, if you have 1,500 products on Starter (500 limit), deleting 1,001 products will unlock creation.

### Q: What happens if I try to create while locked?
**A**: You'll receive a 403 Forbidden response with message: *"Your account is creation-locked because your current usage exceeds your subscription tier limits. Remove items or upgrade to re-enable creation."*

### Q: Does the lock affect CSV uploads?
**A**: Yes. CSV uploads that would create new products are blocked. The upload endpoint checks limits before processing.

### Q: Can I move products to another organization instead of deleting?
**A**: No. Products cannot be transferred between organizations. You must delete and recreate them in the target organization.

---

## Related Documentation

- [Subscription Tiers](./subscription-tiers.md) - Full tier comparison
- [SaaS Operational Runbook](./SAAS_OPERATIONAL_RUNBOOK.md) - Admin procedures
- [Webhook Troubleshooting](./webhook-troubleshooting.md) - Handling subscription changes

---

*Last updated: March 2026*
