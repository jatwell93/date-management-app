## Context

The worker already authenticates uploads, stores CSV objects in `CSV_UPLOADS`, parses normalized product CSV, and writes products through Neon. The `uploads` table records progress but the direct upload handler still processes synchronously and performs row-by-row SQL. Spreadsheet normalization remains a frontend concern.

## Goals / Non-Goals

**Goals:**
- Accept uploads quickly and continue processing without an open browser.
- Validate the complete source before product mutation and reject quota breaches without partial writes.
- Resume safely after queue retries using a persisted row offset.
- Keep batch payloads below 2 MiB and use one set-based PostgreSQL statement per batch.
- Preserve existing CSV/XLS/XLSX aliases, cost parsing, and tenant isolation.

**Non-Goals:**
- Replacing frontend spreadsheet conversion.
- Removing historical expiry records.
- Marketing Enterprise as technically unbounded.

## Decisions

- Extend the existing `uploads` table rather than add a second job store. A partial unique PostgreSQL index enforces one active catalogue import per organization.
- Store source and full row-error reports as R2 objects; database rows retain progress, counters, the first 100 errors, and report keys.
- Queue messages contain only the upload identifier. The consumer reloads authoritative state and acknowledges duplicate terminal deliveries.
- Validation is a first pass over R2 content. Processing starts only after row count, malformed-row checks, and post-import unique SKU quota checks succeed.
- Batches default to 1,000 rows and shrink until serialized JSON is under 2 MiB. Each invocation processes at most 10,000 rows before requeueing.
- PostgreSQL `jsonb_to_recordset`, identifier conflict checks, and `IS DISTINCT FROM` classify inserted, updated, unchanged, and rejected rows in one statement.
- Launch tiers use stable keys `free`, `starter`, `professional`, and `enterprise`; Enterprise limits are numeric defaults overridden by organization configuration.
- `CATALOGUE_QUEUE_ENABLED` gates production enqueueing during rollout.

## Risks / Trade-offs

- [Large source decoding can consume Worker memory] -> Stream R2 bodies and cap source sizes by tier.
- [Queue redelivery can repeat work] -> Persist offsets after each committed batch and make upserts idempotent by organization plus SKU/barcode.
- [Legacy tier records exist] -> Normalize legacy starter/professional/premium/concierge values during reads and migrate configuration incrementally.
- [A batch can contain duplicate identifiers] -> Reject conflicting rows deterministically and include them in the error report.

## Migration Plan

1. Deploy schema and Queue bindings to development.
2. Deploy producer/consumer behind `CATALOGUE_QUEUE_ENABLED=false`.
3. Enable in development and PR preview, run tier-boundary and 50,000-row load verification.
4. Enable production imports after queue, R2, and Neon telemetry is confirmed.
5. Roll back by disabling the flag; queued jobs remain persisted for replay.

## Open Questions

- Production Enterprise file caps and SKU overrides remain contract-configured, with defaults of 100 MiB and 250,000 SKUs.

