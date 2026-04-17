# System Architecture

## High-Level Topology

The platform is split into an API backend, an edge API layer, and managed storage/data services.

- Backend API (`backend/src/`): Express + TypeScript, Prisma, domain services, webhooks, scheduling.
- Edge API (`workers/src/`): Cloudflare Workers handlers for low-latency API access.
- Database: Neon Postgres in production, SQLite for local/test workflows.
- Object Storage: Cloudflare R2 for CSV uploads and processed artifacts.
- Observability: Sentry, application monitoring services, Workers metrics middleware.

## Component Diagram

```text
React PWA / Admin UI
	|
	| HTTPS
	v
Cloudflare Worker Edge API (workers/src)
	|
	| JWT auth + org context + feature gates + rate limit
	v
Express Backend API (backend/src)
	|
	| ServiceProvider (request-scoped DI)
	v
Services -> Repositories/Prisma -> Neon Postgres
	|
	+-> CSV upload pipeline -> R2 object storage
	|
	+-> Scheduler jobs -> subscription, dunning, trial expiry, backups
	|
	+-> Monitoring services -> Sentry + metrics snapshots
```

## Request Flow

1. Client sends request to Workers or backend API.
2. Authentication middleware verifies JWT and resolves organization context.
3. Feature gates and usage limit middleware enforce subscription-tier boundaries.
4. Route delegates to service layer via ServiceProvider (DI container).
5. Service layer calls repositories or Prisma models.
6. Response and telemetry are emitted through error/metrics middleware.

## Security and Isolation Enforcement Points

- Authentication boundary: JWT is validated before protected route execution.
- Tenant boundary: `organizationId` is required for all tenant data reads/writes.
- Authorization boundary: role and feature gates are evaluated before mutation endpoints.
- Usage boundary: quota middleware prevents writes once plan limits are reached.
- Data boundary: all Prisma/repository queries are org-scoped unless explicitly global.

## Multi-Tenant Boundaries

- Organization context is required for protected operations.
- Data access is organization-scoped in services and query filters.
- Tier limits and feature flags are enforced before write-heavy actions.
- Webhook processing validates organization metadata and maps Stripe events to tenant records.

## Runtime Components

- `ServiceProvider`: Request-scoped dependency container for auth, users, upload, analytics, reporting, subscriptions.
- `SchedulerService`: Starts periodic jobs for markdown refresh, backup, trial lifecycle, dunning, and Stripe sync.
- `WebhookService`: Signature verification, idempotency, event dispatch, monitoring signals.

## Scheduler Responsibilities

- `SchedulerService.initialize()` registers cron schedules and starts background jobs.
- Markdown refresh jobs perform bulk updates first, then safe per-item retry fallback.
- Subscription lifecycle jobs (`trialExpiration`, `dunning`, `stripe sync`) are independent and non-fatal.
- Backup job errors are logged and do not terminate process runtime.

# Error Handling Patterns

## Error Taxonomy

Use custom errors for predictable API behavior:

- Validation/authn/authz/not-found/conflict/internal errors in `backend/src/errors/`.
- Middleware maps typed errors to consistent JSON responses.
- Unexpected errors are captured with context and redaction-safe metadata.

## Handling Rules

- Validate early at route/middleware boundary.
- Throw domain-specific errors from services.
- Catch at orchestration boundaries only when adding context or fallback behavior.
- Never swallow errors silently; record metrics/Sentry when recovery occurs.

## Error Response Contract

- API errors are normalized through global middleware.
- Business errors return explicit HTTP status and stable message codes.
- Unexpected errors return generic client-safe responses and full server-side telemetry.

## Retry and Recovery Policy

- Webhooks: retry only for transient server failures.
- Background jobs: continue processing remaining units after per-item failure.
- Sync jobs: log divergence and recover state on next interval rather than hard-failing process.

## Recoverable vs Non-Recoverable (Webhook)

- Non-recoverable data issues: return success response to stop retries and log with warning context.
- Transient system failures: return retriable failure and capture error details.
- Idempotency checks must run before side-effecting updates.

## Observability Requirements

- Every error path includes organization-aware context when available.
- Structured logs avoid secrets and include correlation-friendly fields.
- Sentry capture is required at orchestration boundaries where retries/rollbacks are decided.

# Dependency Injection Patterns

## Container Usage

`ServiceProvider` is the canonical composition root for routes.

- Construct per request with organization context.
- Use factory methods in tests (`forTesting`, `withClients`, `forOrganization`).
- Resolve services lazily to keep startup overhead low.

## ServiceProvider Lifecycle

- One provider instance per request scope.
- Provider instances must not be shared across requests.
- Services are cached per provider instance only.
- Test factories:
  - `forOrganization` for org-scoped behavior
  - `forTesting` for controlled auth bypass
  - `withClients` for full dependency injection

## Service Construction Rules

- Services accept explicit dependencies (`PrismaClient`, storage provider, collaborator services).
- Avoid direct singleton access in route handlers when DI is available.
- Keep constructors side-effect free where possible.

## Anti-Patterns to Avoid

- Instantiating services directly in routes when ServiceProvider already composes them.
- Using process-global mutable singletons for tenant-scoped dependencies.
- Injecting partially initialized clients that bypass org scoping.

## Testing Strategy for DI

- Unit tests verify constructor and factory method contracts.
- Integration tests verify dependency wiring and singleton-per-provider behavior.
- Route integration tests verify organization-scoped ServiceProvider usage.

## DI Verification Checklist

- Service instances are lazy-created.
- Service instances are singleton-per-provider, not singleton-per-process.
- Provider isolation across organizations is verified in tests.
- Prisma calls from org-scoped services include `organizationId` in filters.
