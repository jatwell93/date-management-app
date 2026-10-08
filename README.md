# Date Management Application

Full-stack expiry and inventory management app for pharmacy operations. The workspace contains a React frontend, the Cloudflare Workers API (the only backend), Neon PostgreSQL with a SQL migration runner, and Cloudflare R2 upload storage. The earlier Express/Prisma/SQLite backend is retired (tag `express-sqlite-last`).

## Start Here

For daily development, use:

- [frontend/README.md](frontend/README.md) - frontend setup and CRA workflow
- [workers/README.md](workers/README.md) - Cloudflare Workers API: local dev, configuration, deployment
- [docs/migrations.md](docs/migrations.md) - database migration runner
- [docs/DOCUMENTATION_QUICK_REFERENCE.md](docs/DOCUMENTATION_QUICK_REFERENCE.md) - documentation index by role and task
- [AGENTS.md](AGENTS.md) - project rules for AI-assisted work

## Quick Setup

```bash
# Workers API (needs workers/.dev.vars; see workers/README.md)
cd workers
npm install
cp .dev.vars.example .dev.vars
npm run dev:local
```

```bash
# Frontend
cd frontend
npm install
npm start
```

```bash
# Workers checks
cd workers
npm install
npm run test
npm run build
```

## Project Structure

```text
.
├── src/
│   ├── database/migrations/  # Migration runner and CLIs
│   └── operations/           # Operator scripts (webhook diagnostics, catalogue seed)
├── database/migrations/      # Numbered .up.sql / .down.sql history
├── shared/                   # Domain logic shared by frontend and Workers
├── frontend/
│   └── src/
│       ├── components/       # React UI components
│       ├── pages/            # Route-level views
│       ├── lib/              # API/offline/sync clients
│       ├── hooks/            # React hooks
│       └── theme/            # Semantic design tokens
├── workers/
│   └── src/                  # Cloudflare Workers API: routes, SQL, auth, billing, jobs
├── docs/                     # Project documentation and runbooks
└── openspec/                 # Active and archived project change specs
```

## Core Capabilities

- Inventory, product, store-area, expiry, and markdown workflows.
- CSV/XLSX upload processing with validation, storage quota checks, and R2/local storage support.
- Multi-tenant organization isolation with Clerk-backed auth context, tenant-scoped queries, and role-aware access control.
- Subscription, trial, billing, dunning, and Stripe webhook flows.
- Reporting, dashboard, usage, monitoring, and operational metrics.
- PWA/offline scanning workflows, handheld scanner support, and semantic brand token enforcement.
- Cloudflare Workers API deployment path with middleware for auth, CORS, rate limiting, security headers, metrics, and health checks.

## Common Commands

Run these from the repository root unless noted.

| Task                   | Command                          |
| ---------------------- | -------------------------------- |
| Workers SQL tests      | `npm run test:db`                |
| Migration tests        | `npm run test:migrations`        |
| Frontend changed tests | `npm run test:frontend:diff`     |
| Frontend coverage      | `npm run test:frontend:coverage` |
| Frontend build         | `npm run build:frontend`         |
| Workers build          | `npm run build:workers`          |
| E2E tests              | `npm run test:e2e`               |
| Lint all packages      | `npm run lint`                   |
| TypeScript compile     | `npm run compile`                |
| OpenSpec validation    | `openspec validate --all`        |

## Documentation

The durable documentation index lives at [docs/DOCUMENTATION_QUICK_REFERENCE.md](docs/DOCUMENTATION_QUICK_REFERENCE.md). Use it instead of old phase-summary files for current setup, operations, security, billing, deployment, and troubleshooting references.

Key references:

- [docs/developer-guide.md](docs/developer-guide.md)
- [docs/architecture.md](docs/architecture.md)
- [docs/security.md](docs/security.md)
- [docs/operational-runbook.md](docs/operational-runbook.md)
- [docs/troubleshooting.md](docs/troubleshooting.md)
- [docs/stripe-integration.md](docs/stripe-integration.md)
- [docs/local-expect-qa.md](docs/local-expect-qa.md)

## Development Rules

- Work from feature branches, not `main`.
- Track scoped changes in OpenSpec.
- Tenant data access goes through `workers/src/database.ts`, with `organizationId` as the first parameter.
- Schema changes are numbered migrations in `database/migrations/` (see `docs/migrations.md`).
- Write tests before production code for behavior changes.
- Do not commit secrets or production credentials.

## License

Licensing is currently defined per workspace package rather than by a single root license file.
Check each package's `license` field and accompanying documentation for the applicable terms.
This README does not claim a repository-wide Apache-2.0 license until the root `LICENSE` file and package metadata are aligned.
