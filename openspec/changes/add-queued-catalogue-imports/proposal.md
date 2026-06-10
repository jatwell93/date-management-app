## Why

Catalogue imports currently perform one database call per row inside the upload request, which exceeds Cloudflare subrequest limits and cannot reliably handle launch-tier catalogue sizes. Launch pricing also needs stable SKU and active-expiry quotas that match the product promise.

## What Changes

- Persist catalogue import jobs and return `202 Accepted` after storing the source in R2 and enqueueing the job.
- Process imports in a Cloudflare Queue consumer with validation and batched set-based PostgreSQL upserts.
- Expose resumable job progress, row errors, and authenticated error-report downloads.
- Enforce one active catalogue import per organization, tier file-size limits, post-import unique SKU limits, and active unresolved expiry limits.
- Replace legacy tier names and prices with Free, Starter, Professional, and Enterprise launch tiers.
- Poll queued import status in the CSV upload page for up to 30 minutes.

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

