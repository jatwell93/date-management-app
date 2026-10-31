# Subscription Tiers and Limits

Reference for the tiers an organization can be on, the caps each tier carries, and how the Worker
applies them. Numbers come from `workers/src/utils/usage-limits.ts` (what the Worker enforces and reports)
and `shared/types/subscription.ts` (prices, and a second copy of the caps). Trial behaviour is in [trial-system.md](./trial-system.md);
Stripe plumbing is in [stripe-integration.md](./stripe-integration.md).

> **Provisional numbers.** The caps are provisional until the in-store usage trial has produced
> data (see the comment on `isUsageEnforcementEnabled`). Treat them as the current defaults, not
> a commercial promise.

## Interface

### Tiers and caps

The Worker works with four launch tiers (`LaunchTier` in `usage-limits.ts`).

| Tier         | SKUs (products) | Active expiries (inventory items) | Users | Storage |
| ------------ | --------------- | --------------------------------- | ----- | ------- |
| `free`       | 500             | 500                               | 1     | 1 GB    |
| `starter`    | 5 000           | 5 000                             | 3     | 10 GB   |
| `professional` | 50 000        | 50 000                            | 10    | 10 GB   |
| `enterprise` | 250 000         | 250 000                           | 10    | 1 000 GB |

- `normalizeLaunchTier` maps the legacy names `premium` to `professional` and `concierge` to
  `enterprise`. Any unknown or empty value becomes `free`.
- The `enterprise` SKU and active-expiry caps can be raised per deployment with the Worker vars
  `ENTERPRISE_MAX_SKUS` and `ENTERPRISE_MAX_ACTIVE_EXPIRIES`. A value that is not a positive
  number is ignored and the default applies (`parsePositiveIntEnv`).
- Seats have no env override.
- Storage has no per-organization column. The cap comes from the tier alone
  (`STORAGE_LIMIT_BYTES_BY_TIER`). **The Worker's 1/10/1000 GB values are the enforced ones.**
  `TIER_LIMITS.storage_bytes` in `shared/types/subscription.ts` lists 100 GB for `professional`
  and `enterprise`; treat that value as legacy and not enforced by the Worker. The code comments
  record the disagreement as an open product decision, so nothing here is contractual.

### Prices

`TIER_PRICES` and `TIER_ANNUAL_PRICES` in `shared/types/subscription.ts` hold the standard
prices in cents, used for MRR calculations:

| Tier           | Monthly | Annual  |
| -------------- | ------- | ------- |
| `free`         | $0      | $0      |
| `starter`      | $39     | $390    |
| `professional` | $99     | $990    |
| `enterprise`   | contact | contact |

### Routes that read or enforce limits

| Route                                     | Cap applied                                    |
| ----------------------------------------- | ---------------------------------------------- |
| `POST /api/products`                      | SKU cap, inside the INSERT                     |
| `POST /api/inventory-items`               | Active-expiry cap, inside the INSERT           |
| `POST /api/users`                         | Seat cap, counting live users                  |
| Catalogue import (queued)                 | SKU cap, from `max_skus_snapshot` taken at queue time |
| `GET /api/organization/usage`             | Reports used and limit for each resource       |
| `GET /api/storage-quota/:userId`          | Reports storage; warns at 80 % (`STORAGE_WARNING_THRESHOLD_PERCENT`) |

Subscription state routes: `GET /api/subscription/current`, `GET /api/subscription/trial-status`,
`POST /api/subscription/create-checkout-session`, `POST /api/subscription/cancel` and
`POST /api/subscription/create-portal-session`.

## Configuration

| Variable                      | Default | Effect                                                                 |
| ----------------------------- | ------- | ---------------------------------------------------------------------- |
| `USAGE_LIMITS_ENFORCE`        | off     | `"true"` (exact match) makes the tier caps above refuse writes         |
| `SUBSCRIPTION_GATE_ENFORCE`   | off     | `"true"` refuses creation for a creation-locked or trial-expired organization |
| `ENTERPRISE_MAX_SKUS`         | 250 000 | Overrides the `enterprise` SKU cap                                     |
| `ENTERPRISE_MAX_ACTIVE_EXPIRIES` | 250 000 | Overrides the `enterprise` active-expiry cap                        |

With a flag off, the gate still resolves the tier and detects a write it would have refused. It
logs `usage_limit_reached` and allows the write. Neither flag is set in a fresh
`workers/.dev.vars`; both appear commented out in `workers/.dev.vars.example`.

## Examples

Read an organization's usage and limits:

```bash
curl -H "Authorization: Bearer $CLERK_SESSION_TOKEN" "$API_URL/api/organization/usage"
```

Run the real-SQL tests that cover the caps:

```bash
npm run test:db
```

The relevant suite is `workers/src/database.usage-limits.pglite.node.test.ts`.

## Related

- [trial-system.md](./trial-system.md) - how a new organization starts on a 30-day professional trial
- [tier-downgrade-guide.md](./tier-downgrade-guide.md) - downgrade behaviour
- [past-due-recovery.md](./past-due-recovery.md) - failed-payment handling
- [stripe-integration.md](./stripe-integration.md) - webhook and billing integration
