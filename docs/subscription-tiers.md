---
title: Subscription Tiers & Limits
phase: 5
week: 7
status: draft
---

# Subscription Tiers

| Tier             | Monthly Price (USD) | Max SKUs  | Max Users | Max Inventory Items | Support               | SLA     |
| ---------------- | ------------------- | --------- | --------- | ------------------- | --------------------- | ------- |
| **Starter**      | $0 (trial → $19)\*  | 500       | 1         | 5 000               | Community             | N/A     |
| **Professional** | $49                 | 5 000     | 5         | 50 000              | Email                 | 99.5 %  |
| **Premium**      | $199                | 20 000    | 20        | 500 000             | Priority Email        | 99.9 %  |
| **Concierge**    | Contact Sales       | Unlimited | Unlimited | Unlimited           | Dedicated CSM & Slack | 99.99 % |

\* Starter converts automatically after the 14-day trial. Cancel anytime during trial.

## Feature Comparison

- **All tiers** – Secure auth, barcode scanning, offline PWA, reports.
- **Professional+** – Multi-user collaboration, role management, org switcher.
- **Premium+** – Advanced analytics dashboard, custom exports, webhooks.
- **Concierge** – Dedicated account manager, custom limits, on-prem options.

## Upgrade / Downgrade Process

1. **Self-service** via **Settings → Billing** (frontend) – calls `/api/billing/change-tier`.
2. Backend creates/upgrades the Stripe subscription item accordingly.
3. Webhook `customer.subscription.updated` syncs DB → `SubscriptionTier` & `OrganizationUsage`.
4. On **downgrade**, background job checks usage vs. new limits and queues warnings.
5. If still over-limit after 7 days, account enters **Read-Only Mode** until usage compliant or tier upgraded again.

## Proration & Billing Periods

- Proration behavior: `proration_behavior='create_prorations'`.
- Billing cycles align to original subscription `billing_cycle_anchor`.
- Invoices generated immediately when upgrading; credits applied when downgrading.

## How Limits Are Enforced

| Resource        | Enforcement Point                                                |
| --------------- | ---------------------------------------------------------------- |
| SKUs            | `ProductService.create` → throws `LimitError` if count ≥ maxSkus |
| Users           | `UserInviteService.accept` → checks `OrganizationUsage`          |
| Inventory Items | `InventoryService.create`                                        |

Limits cached in `TierLimitsCache` (60 s) to keep lookups fast.

## Testing Matrix

Use `scripts/generate-usage-fixtures.ts` to create orgs at each limit boundary. Integration tests cover:

- Create @ limit → 409 `over_limit` error.
- Upgrade tier → retry create → 201 success.
- Downgrade tier below current usage → warning email queued.
