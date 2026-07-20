## Why

Catalogue imports currently perform one database call per row inside the upload request, which exceeds Cloudflare subrequest limits and cannot reliably handle launch-tier catalogue sizes. Launch pricing also needs stable SKU and active-expiry quotas that match the product promise.

## What Changes

- Persist catalogue import jobs and return `202 Accepted` after storing the source in R2 and enqueueing the job.
- Process imports in a Cloudflare Queue consumer with validation and batched set-based PostgreSQL upserts.
- Expose resumable job progress, row errors, and authenticated error-report downloads.
- Enforce one active catalogue import per organization, tier file-size limits, post-import unique SKU limits, and active unresolved expiry limits.
- Replace legacy tier names and prices with Free, Starter, Professional, and Enterprise launch tiers.
- Poll queued import status in the CSV upload page for up to 30 minutes.
- Restrict new Stripe Checkout purchases to Starter and Professional monthly/annual test prices while preserving legacy webhook tier normalization.
- Validate deploy-time Stripe price configuration and provision the Cloudflare Queue resources required by the Worker bindings.

## Capabilities

### New Capabilities
- `queued-catalogue-imports`: Asynchronous, resumable, organization-isolated catalogue import jobs with set-based product upserts and progress reporting.
- `launch-tiers-and-quotas`: Launch pricing, catalogue limits, active-expiry limits, trials, annual pricing, and configurable Enterprise caps.

### Modified Capabilities

## Impact

- Worker upload routes, queue entry point, R2 objects, Neon SQL, and Wrangler bindings.
- Prisma upload persistence and migration SQL.
- Shared/backend/frontend subscription tier types and limit displays.
- CSV upload polling and import result UI.
- Stripe test catalog, webhook event configuration, Doppler price mappings, and deployment guardrails.

## Reuse Strategy

- Extend `backend/src/services/subscription-billing.helpers.ts` as the existing Checkout price catalog and allowlist source.
- Extend `frontend/src/pages/SubscriptionSettingsPage.tsx` and `frontend/src/components/TrialUpgradeFlow.tsx` instead of adding a second billing flow.
- Extend `.github/workflows/workers-deploy.yml` with configuration validation used before Wrangler deployment.
- Reuse the existing `Pharmacy Expiry Management SaaS` Stripe test product and archive obsolete prices without deleting history.

## Operational Gates

- Stripe remains in test mode in development, staging, and production until a separate launch gate.
- Production `CATALOGUE_QUEUE_ENABLED` remains `false` until development telemetry is reviewed and explicitly approved.
- Cloudflare Queues are available on the account without a Workers Paid subscription, so no paid-plan mutation is required for this rollout.
- Production queue enablement requires human approval before changing `CATALOGUE_QUEUE_ENABLED` from `false`.
