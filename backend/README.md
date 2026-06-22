# Backend: Date Management Application

Complete Node.js/Express backend with support for SQLite (development) and Neon PostgreSQL (production), Cloudflare R2 storage, and Workers deployment.

## Quick Start

### Prerequisites

- **Node.js** ≥22.x
- **npm** ≥9.x
- **SQLite3** (optional, for local development)

### Development Setup (5 minutes)

```bash
# 1. Install dependencies
npm install

# 2. Copy environment template
cp .env.example .env

npm run seed  # Creates default users

# 3. Start development server (SQLite)
npm run dev

# Server runs on http://localhost:3001
```

#### First Time Setup: Database Migrations

```bash
# Run all pending migrations
npm run migrate

# Check migration status
npm run migrate:status
```

---

## Testing: Dual Environment Strategy

This project supports testing against **two databases** to ensure compatibility across environments:

| Environment     | Database            | Use Case                      | Command             |
| --------------- | ------------------- | ----------------------------- | ------------------- |
| **Development** | SQLite              | Local development, fast tests | `npm run test:dev`  |
| **Production**  | Neon PostgreSQL     | Production-like testing       | `npm run test:prod` |
| **Both**        | SQLite → PostgreSQL | Verify compatibility          | `npm run test:both` |

### Running Tests

```bash
# Test against SQLite (development database)
npm run test:dev

# Test against Neon PostgreSQL (production database)
# Requires: NEON_CONNECTION_STRING in .env
npm run test:prod

# Test both sequentially (comprehensive)
npm run test:both

# Run with coverage report
npm run test:coverage

# Run only changed tests (CI optimization)
npm run test:diff
```

### Production Test Setup (PostgreSQL via Neon)

To enable `npm run test:prod`, configure Neon connection:

```bash
# 1. Get your Neon connection string from https://console.neon.tech/
#    Format: postgresql://user:password@host/database?sslmode=require

# 2. Add to .env
NEON_CONNECTION_STRING=postgresql://user:password@host/database?sslmode=require

# 3. Run tests against production database
npm run test:prod
```

**Why two test environments?**

- **SQLite**: Fast iteration during development (< 5s per test run)
- **PostgreSQL**: Catch database-specific issues before production (e.g., transaction semantics, index behavior)

For detailed testing guide, see [docs/testing-both-environments.md](../docs/testing-both-environments.md)

---

## Environment Configuration

### Core Variables

```bash
# Run mode
NODE_ENV=development        # development | production | test | staging

# Database selection
DATABASE_PROVIDER=sqlite    # sqlite (dev) | postgresql (prod)
DATABASE_PATH=./database.sqlite        # Runtime SQLite file (backend/database.sqlite)
DATABASE_URL=file:../database.sqlite   # Prisma local SQLite URL, resolved from backend/prisma/
# DATABASE_URL=...                     # Neon PostgreSQL connection string (prod)

# Storage provider
STORAGE_PROVIDER=local      # local (dev) | r2 (prod)

# API
PORT=3001
JWT_SECRET=your-secret-key-here
```

### Development

Copy `.env.development` as a template:

```bash
cp .env.development .env
```

### Production

See [.env.production](./.env.production) and [docs/deployment.md](./docs/deployment.md)

Detailed guide: [docs/environment-setup.md](../docs/environment-setup.md)

---

## Storage: Local vs. Cloudflare R2

### Development: Local Filesystem

Default configuration. Uploads stored in `./uploads/`:

```bash
STORAGE_PROVIDER=local
UPLOAD_DIR=./uploads
```

Files are persisted on disk for development and testing.

### Production: Cloudflare R2

For scalable production storage, configure Cloudflare R2:

```bash
STORAGE_PROVIDER=r2
R2_ACCOUNT_ID=your_account_id
R2_ACCESS_KEY_ID=your_access_key_id
R2_SECRET_ACCESS_KEY=your_secret_access_key
R2_BUCKET_NAME=csv-uploads-prod
```

**Setup Steps:**

1. Create R2 bucket at https://dash.cloudflare.com/
2. Generate API token with R2 permissions
3. Add credentials to `.env.production`

Complete guide: [docs/storage-patterns.md](./docs/storage-patterns.md)

---

## File Upload Configuration

All CSV uploads configured with sensible defaults:

```bash
# Upload size limits
MAX_FILE_SIZE=10485760             # 10MB
MAX_UPLOAD_SIZE_BYTES=10485760     # Redundant, mirrors MAX_FILE_SIZE
DIRECT_UPLOAD_THRESHOLD_BYTES=2097152  # 2MB

# CSV processing
CSV_BATCH_SIZE=100                 # Process 100 rows at a time

# Rate limiting
RATE_LIMIT_REQUESTS=100            # Requests per window
RATE_LIMIT_WINDOW_MS=900000        # 15-minute window
```

For CSV upload format details, see [docs/csv-upload-format.md](../docs/csv-upload-format.md)

---

## Database Migrations

### Running Migrations

```bash
# Execute pending migrations (runs automatically on startup)
npm run migrate

# Check migration status
npm run migrate:status

# Rollback last migration (dev only)
npm run migrate:rollback
```

### Database Patterns

Migrations use Prisma. For details and patterns, see:

- [backend/docs/database-patterns.md](./docs/database-patterns.md)
- [docs/database-migrations.md](../docs/database-migrations.md)

---

## NPM Scripts Reference

| Script                     | Purpose                           | Output                       |
| -------------------------- | --------------------------------- | ---------------------------- |
| `npm start`                | Run production server             | Server on port 3001          |
| `npm run dev`              | Run dev server (auto-reload)      | Server with hot-reload       |
| `npm run build`            | Compile TypeScript                | `dist/` folder               |
| `npm run test`             | Run all tests (SQLite by default) | Test results                 |
| `npm run test:dev`         | Run tests (SQLite)                | Test results                 |
| `npm run test:prod`        | Run tests (PostgreSQL)            | Test results (requires Neon) |
| `npm run test:both`        | Run tests (both databases)        | Test results x2              |
| `npm run test:coverage`    | Generate coverage report          | HTML report in `coverage/`   |
| `npm run test:diff`        | Run changed tests only            | Diff-based test results      |
| `npm run migrate`          | Run pending migrations            | Migration log                |
| `npm run migrate:status`   | Check migration status            | Status summary               |
| `npm run migrate:rollback` | Undo last migration               | Rollback confirmation        |

---

## Project Structure

```
backend/
├── src/
│   ├── index.ts                 # Application entry point
│   ├── config/                  # Configuration loading from .env
│   ├── controllers/             # HTTP request handlers
│   ├── routes/                  # RESTful route definitions
│   ├── services/                # Business logic (Prisma-based)
│   ├── database/                # Database connections & repositories
│   ├── middleware/              # Express middleware
│   ├── models/                  # Data models & types
│   ├── migrations/              # Database migration scripts
│   ├── storage/                 # Storage abstraction (Local/R2)
│   ├── utils/                   # Utility functions
│   └── tests/                   # Test files
├── prisma/
│   ├── schema.prisma            # Prisma ORM schema
│   └── migrations/              # Prisma migration history
├── docs/
│   ├── database-patterns.md     # Database architecture
│   ├── storage-patterns.md      # Storage abstraction
│   ├── deployment.md            # Production deployment
│   ├── monitoring-alerting.md   # Observability setup
│   ├── backup-recovery.md       # Backup strategies
│   ├── operational-runbooks.md  # Production runbooks
│   └── reverse-proxy-setup.md   # Nginx configuration
├── .env.example                 # Environment template
├── package.json                 # Dependencies & scripts
└── tsconfig.json                # TypeScript configuration
```

---

## Code Quality & Testing

### Verify Code Quality

```bash
# Run linter
npm run lint

# Fix linting issues
npm run lint --fix

# Run security scan (UBS ignores patterns in .ubsignore and ubs.config.json)
ubs .

# Full quality check (UBS will skip files matched by .ubsignore)
npm run test:coverage && npm run lint && ubs .
```

> Note: add or update `.ubsignore` at the repository root to silence scanner noise from generated files (coverage/, dist/, build/) and `.env` examples. A sample `.ubsignore` and `ubs.config.json` are included in the repo.

**Expected Results:**

- ✅ **Tests**: All suites passing (37+ backend suites, 297+ tests)
- ✅ **Linter**: 0 critical errors
- ✅ **Security (UBS)**: 0 critical issues

---

## Deployment & Production

### Production Deployment

For complete deployment guide, see:

- [docs/deployment.md](./docs/deployment.md) - CI/CD pipelines, environment setup
- [docs/monitoring-alerting.md](./docs/monitoring-alerting.md) - Production observability

#### Quick Deploy to Production

```bash
# 1. Set production environment
NODE_ENV=production

# 2. Build
npm run build

# 3. Run migrations
npm run migrate

# 4. Start server
npm start
```

---

## Workers Deployment (Cloudflare Edge)

Cloudflare Workers provides serverless compute for edge functions (presigned URLs, middleware, etc.).

### Deploy to Production

```bash
# From root workspace directory
cd workers

# Deploy Workers code to production
npm run deploy:prod
```

### Local Testing

See [docs/workers-deployment.md](../docs/workers-deployment.md) for:

- Local Miniflare testing
- Test suite running (`npm run test`)
- Deployment verification

---

## Troubleshooting

### Common Issues

| Problem                        | Symptom                   | Solution                                                           |
| ------------------------------ | ------------------------- | ------------------------------------------------------------------ |
| **Tests Failing (SQLite)**     | `npm run test:dev` fails  | Check `.env` has `DATABASE_PATH=./database.sqlite`; run migrations |
| **Tests Failing (PostgreSQL)** | `npm run test:prod` fails | Verify `NEON_CONNECTION_STRING` in `.env`; ensure database exists  |
| **Build Errors**               | `npm run build` fails     | Run `npm install`; check Node.js version ≥22.x                     |
| **Port Already In Use**        | Server won't start        | Change `PORT` in `.env` or kill existing process                   |
| **Database Locked**            | SQLite errors             | Close other connections; restart server                            |
| **R2 Upload Fails**            | Storage provider error    | Check R2 credentials and bucket name in `.env`                     |

For operational runbooks, see [docs/operational-runbooks.md](./docs/operational-runbooks.md)

---

## Documentation

| Document                                                                             | Purpose                                                    |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| [docs/database-patterns.md](./docs/database-patterns.md)                             | Database architecture, Prisma patterns, query optimization |
| [docs/storage-patterns.md](./docs/storage-patterns.md)                               | Local vs. R2 storage, presigned URLs, multipart uploads    |
| [docs/deployment.md](./docs/deployment.md)                                           | CI/CD, environment setup, production config                |
| [docs/monitoring-alerting.md](./docs/monitoring-alerting.md)                         | Sentry, error tracking, observability                      |
| [docs/operational-runbooks.md](./docs/operational-runbooks.md)                       | Production procedures, incident response                   |
| [../docs/testing-both-environments.md](../docs/testing-both-environments.md)         | Dual DB testing, strategies                                |
| [../docs/workers-deployment.md](../docs/workers-deployment.md)                       | Cloudflare Workers, edge compute                           |
| [../docs/DOCUMENTATION_QUICK_REFERENCE.md](../docs/DOCUMENTATION_QUICK_REFERENCE.md) | Project-wide documentation index                           |

---

## Architecture Overview

### Layered Architecture

```
┌─────────────────────────────────────────┐
│  HTTP Layer (Express Routes)            │
│  src/routes/                            │
└──────────────┬──────────────────────────┘
               ↓
┌─────────────────────────────────────────┐
│  Controller Layer (Request Handling)    │
│  src/controllers/                       │
└──────────────┬──────────────────────────┘
               ↓
┌─────────────────────────────────────────┐
│  Service Layer (Business Logic)         │
│  src/services/ (Prisma-based)           │
└──────────────┬──────────────────────────┘
               ↓
┌─────────────────────────────────────────┐
│  Data Access Layer (Repositories)       │
│  src/database/ (Prisma Client)          │
└──────────────┬──────────────────────────┘
               ↓
┌─────────────────────────────────────────┐
│  Storage & Database Abstraction         │
│  LocalStorage / R2 (storage/)           │
│  Prisma / Neon PostgreSQL (db/)         │
└─────────────────────────────────────────┘
```

---

## Getting Help

- **Local Development**: Check [.env.example](./.env.example) for all config options
- **Testing**: See [../docs/testing-both-environments.md](../docs/testing-both-environments.md)
- **Database**: See [docs/database-patterns.md](./docs/database-patterns.md)
- **Storage**: See [docs/storage-patterns.md](./docs/storage-patterns.md)
- **Production**: See [docs/deployment.md](./docs/deployment.md)
- **Documentation Index**: See [../docs/DOCUMENTATION_QUICK_REFERENCE.md](../docs/DOCUMENTATION_QUICK_REFERENCE.md)

---

## Contributing

When adding new features or services, follow:

- ✅ TDD: Write tests first
- ✅ Use Prisma for data access (never raw SQL)
- ✅ Inject dependencies (no hardcoded `new Service()`)
- ✅ Services use type-safe Prisma queries
- ✅ Error handling via custom error classes
- ✅ Maintain >80% test coverage for new code

See [AGENTS.md](../AGENTS.md) for detailed development standards.
