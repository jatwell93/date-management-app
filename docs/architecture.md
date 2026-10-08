# System Architecture

## High-Level Topology

The platform is one API (a Cloudflare Worker), a React frontend, and managed storage/data services. The earlier Express/Prisma/SQLite backend is retired; its last revision is the tag `express-sqlite-last` (see [`express-retirement-recovery.md`](./express-retirement-recovery.md)).

- API (`workers/src/`): Cloudflare Worker. One entry point, `index-minimal.ts`, handles routing, auth, rate limiting, webhooks, and scheduled jobs.
- Database: Neon Postgres, reached through Hyperdrive. Production schema changes are applied only by the migration runner in `src/database/migrations/` — see [`docs/migrations.md`](./migrations.md). Real-SQL tests run the same migrations in pglite (`npm run test:db`).
- Object Storage: Cloudflare R2 for CSV uploads and processed artifacts.
- Queues: catalogue import and notification email, declared in `workers/wrangler.toml`.
- Observability: Sentry (`@sentry/cloudflare`), Workers logs and metrics.

## Component Diagram

```text
React PWA / Admin UI
	|
	| HTTPS
	v
Cloudflare Worker (workers/src/index-minimal.ts)
	|
	| security headers -> rate limit -> Clerk auth -> org entitlement gate -> handler
	v
workers/src/database.ts (org-scoped SQL) -> Neon Postgres (via Hyperdrive)
	|
	+-> CSV upload pipeline -> R2 object storage
	|
	+-> Queues -> catalogue import, notification emails
	|
	+-> Cron (hourly) -> scheduled/dispatcher.ts -> jobs (markdown, Stripe reconciliation, trial emails, ...)
	|
	+-> Sentry
```

## Request Flow

1. Client sends a request to the Worker.
2. Rate limiting runs (`utils/minimal-rate-limit.ts`), with separate limits for authenticated and unauthenticated requests.
3. `authenticateApiRequest` verifies the Clerk token, then reads `organization_id` and `role` from the `users` row.
4. `checkOrganizationEntitlement` gates the request on the organization's subscription state.
5. The handler calls `database.ts` methods. Each tenant method takes `organizationId` first.
6. Security headers are applied to every response, including ones Sentry synthesizes for an unhandled throw.

## Security and Isolation Enforcement Points

- Authentication boundary: the Clerk token is verified before any protected handler runs.
- Tenant boundary: `organizationId` comes from the `users` row, never from the client, and is a required first parameter on every tenant method in `database.ts`.
- Authorization boundary: role checks run in the handler before mutations.
- Usage boundary: per-tier limits are enforced by counting rows in the same statement that inserts (`utils/usage-limits.ts`). The cap is soft under concurrency; see that file's header.
- Data boundary: every query on a tenant table carries an `organization_id` predicate. Tenant-isolation tests (`database.tenant-isolation*.pglite.node.test.ts`) seed a second organization and assert none of its rows appear.

## Multi-Tenant Boundaries

- Organization context is required for protected operations.
- Data access is organization-scoped in the SQL itself, including joins (`p.organization_id = ii.organization_id`).
- Tier limits and entitlement are checked before write-heavy actions.
- Stripe webhook events map to tenant records through the subscription's organization metadata.

## Runtime Components

- `index-minimal.ts`: the `fetch`, `scheduled` and `queue` handlers.
- `database.ts`: all SQL for tenant data.
- `clerk/` and `stripe/`: token verification, bootstrap, billing handlers, and the two webhook receivers.
- `scheduled/dispatcher.ts` and `scheduled/schedule.ts`: the hourly cron dispatcher and its job table.
- `notifications/`: the email queue and trial emails.

## Scheduler Responsibilities

- One Cron Trigger (`0 * * * *`, production only) wakes the Worker hourly. `schedule.ts` decides which jobs are due; a daily job becomes due at its UTC hour and a delayed tick still catches up.
- Each job is claimed with a row lease in `scheduled_job_runs` (migration 0016) before it runs, so overlapping ticks do not run a job twice. The Neon HTTP driver has no session, so advisory locks are not available.
- Jobs run one at a time. A failing job is recorded and retried on the next tick; it does not stop the others.
- Set the secret `SCHEDULED_JOBS_DISABLED="true"` to stop all jobs without a deploy.

# Error Handling Patterns

## Error Taxonomy

- Handlers return explicit HTTP statuses through `errorResponse` (`utils/worker-response.ts`): validation 400, unauthenticated 401, forbidden 403, not found 404, conflict 409, rate limit 429.
- Database errors are classified in `db-errors.ts`. A unique violation (SQLSTATE 23505) becomes a 409, for example a duplicate inventory item or store area.
- Unexpected errors are captured in Sentry and return a generic client-safe response.

## Handling Rules

- Validate early, at the top of the handler.
- Throw or return domain-specific errors from `database.ts`; map them to a status once, in the handler.
- Catch only to add context or a fallback.
- Never swallow errors silently; record to Sentry or the job summary when recovery occurs.

## Error Response Contract

- Business errors return an explicit HTTP status and a stable message.
- Unexpected errors return a generic message; full detail goes to server-side telemetry only.

## Retry and Recovery Policy

- Webhooks: the receivers verify the signature, claim the event in a ledger table, process it, then mark it complete. A failed delivery releases its claim so the provider's retry is processed.
- Scheduled jobs: continue after a per-item failure and report `failed: true` in the job result so the run is retried on the next tick.
- Queue consumers: retry then dead-letter (see the `*-dlq` queues in `wrangler.toml`).

## Recoverable vs Non-Recoverable (Webhook)

- Non-recoverable data issues: acknowledge so the provider stops retrying, and log with warning context.
- Transient system failures: return a retriable failure and capture the error.
- Unhandled event types are acknowledged and logged, not dropped silently.
- The claim ledger (`processed_webhook_events` for Stripe, `clerk_webhook_events` for Clerk) runs before any side effect, which makes redelivery idempotent.

## Observability Requirements

- Error paths include organization-aware context when available.
- Logs avoid secrets and include correlation-friendly fields.
- Sentry capture is required where retries or rollbacks are decided.

# Data Access Patterns

## Composition

There is no dependency-injection container. The Worker builds a `Database` from the request's environment (`utils/db-connection.ts`) and passes it to handlers. Handlers and jobs take their collaborators as explicit arguments, which is what lets tests substitute pglite.

## Rules

- Add tenant queries to `database.ts` with `organizationId` as the first, required parameter, so a call site that forgets it fails to compile.
- Filter `organization_id` in every query, including each side of a join to another tenant table.
- Do not read a counter column to enforce a limit; count rows in the statement that inserts.
- Do not share mutable module state between requests.

## Testing Strategy

- Handler tests inject a fake `Database` and assert status and body.
- Real-SQL tests (`*.pglite.node.test.ts`, `npm run test:db`) run the actual migrations and queries. Use them for anything in `database.ts`.
- A new isolation test is not evidence until you remove the `organization_id` predicate and watch it fail.
