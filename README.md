# Date Management Application

Full-stack expiry and inventory management app for pharmacy operations. The workspace contains a React frontend, an Express/TypeScript backend, Cloudflare Workers edge API code, Prisma-backed data access, local SQLite development, Neon PostgreSQL production workflows, and Cloudflare R2 upload storage.

## Start Here

For daily development, use:

- [backend/README.md](backend/README.md) - backend setup, scripts, database, storage, and deployment notes
- [frontend/README.md](frontend/README.md) - frontend setup and CRA workflow
- [workers/README.md](workers/README.md) - Cloudflare Workers implementation and deployment
- [docs/DOCUMENTATION_QUICK_REFERENCE.md](docs/DOCUMENTATION_QUICK_REFERENCE.md) - documentation index by role and task
- [AGENTS.md](AGENTS.md) - project rules for AI-assisted Express/TypeScript work

## Quick Setup

```bash
# Backend
cd backend
npm install
cp .env.example .env
npm run migrate
npm run seed
npm run seed:tier-flags
npm run dev
```

```bash
# Frontend
cd frontend
npm install
npm start
```

```bash
# Workers
cd workers
npm install
npm run test
npm run build
```

## Project Structure

```text
.
├── backend/
│   ├── src/
│   │   ├── controllers/      # HTTP request handlers
│   │   ├── routes/           # Express route definitions
│   │   ├── services/         # Business logic
│   │   ├── repositories/     # Data access
│   │   ├── database/         # Database client factories
│   │   ├── middleware/       # Auth, validation, rate limiting
│   │   ├── storage/          # Local/R2 storage providers
│   │   └── tests/            # Jest tests
│   ├── prisma/               # Prisma schema and migrations
│   └── docs/                 # Backend-specific operations guides
├── frontend/
│   └── src/
│       ├── components/       # React UI components
│       ├── pages/            # Route-level views
│       ├── lib/              # API/offline/sync clients
│       ├── hooks/            # React hooks
│       └── theme/            # Semantic design tokens
├── workers/
│   └── src/                  # Cloudflare Workers API handlers and middleware
├── docs/                     # Project documentation and runbooks
├── openspec/                 # Active and archived project change specs
├── graphify-out/             # Generated project knowledge graph artifacts
└── .agentlens/               # Generated codebase navigation docs
```

## Core Capabilities

- Inventory, product, store-area, expiry, and markdown workflows.
- CSV/XLSX upload processing with validation, storage quota checks, and R2/local storage support.
- Multi-tenant organization isolation with Clerk-backed auth context, tenant-scoped services, and role-aware access control.
- Subscription, trial, billing, dunning, and Stripe webhook flows.
- Reporting, dashboard, usage, monitoring, and operational metrics.
- PWA/offline scanning workflows, handheld scanner support, and semantic brand token enforcement.
- Cloudflare Workers API deployment path with middleware for auth, CORS, rate limiting, security headers, metrics, and health checks.

## Common Commands

Run these from the repository root unless noted.

| Task                   | Command                          |
| ---------------------- | -------------------------------- |
| Backend tests          | `npm run test:backend`           |
| Backend changed tests  | `npm run test:backend:diff`      |
| Backend coverage       | `npm run test:backend:coverage`  |
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
- Keep controllers thin and put business logic in services.
- Prefer repositories/data-access helpers over direct database work in controllers.
- Write tests before production code for behavior changes.
- Do not commit secrets or production credentials.

## License

Licensing is currently defined per workspace package rather than by a single root license file.
Check each package's `license` field and accompanying documentation for the applicable terms.
This README does not claim a repository-wide Apache-2.0 license until the root `LICENSE` file and package metadata are aligned.
