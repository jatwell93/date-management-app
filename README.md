# Date Management Application

Full-stack date management system with React (frontend), Node.js/Express (backend), dual database support (SQLite dev + Neon PostgreSQL prod), and Cloudflare Workers edge compute.

**Phase 11 Status**: ✅ Complete — Dual environment testing, R2 storage, Workers deployment verified

## Quick Start

For developers, see the **Backend README** for comprehensive setup:

👉 **[backend/README.md](backend/README.md)** ← Start here for development & testing instructions

**For new developers:**
- 🚀 **Quick setup**: Run `cd backend && npm run setup` (< 30 minutes)
- 📖 **Developer guide**: See [docs/developer-guide.md](docs/developer-guide.md) for daily workflow, debugging, and troubleshooting

**Highlights:**
- **Rapid Development**: `npm run dev` (SQLite, < 5s test cycles)
- **Production Testing**: `npm run test:prod` (PostgreSQL via Neon)
- **Storage**: Local filesystem (dev) or Cloudflare R2 (prod)
- **Workers**: Edge compute deployment ready

## Project Structure

```
.
├── backend/
│   ├── src/
│   │   ├── index.ts         # Main server file
│   │   └── database.ts      # Database setup and initialization
│   ├── package.json
│   └── tsconfig.json
├── frontend/
│   ├── src/
│   │   ├── App.tsx
│   │   └── index.tsx
│   ├── package.json
│   └── tsconfig.json
└── README.md
```

## Features

- **User Management & Authentication**: Secure user login with PIN, role-based access control (Manager/Team Member).
- **Core Inventory Management**: CRUD operations for products, inventory items, and store areas. Automated markdown calculations and audit logging for all inventory changes.
- **Reporting & Analytics**: Monthly expiry reports, basic analytics dashboard, and usage reports.
- **Progressive Web Application (PWA) & Offline Capabilities**: Mobile-first scanning interface, offline data storage with IndexedDB, and background synchronization.
- **Dual Database Support** (Phase 11): SQLite for development, Neon PostgreSQL for production. Test compatibility with `npm run test:both`.
- **Scalable Storage** (Phase 11): Local filesystem for development, Cloudflare R2 for production. Presigned URL support for secure uploads.
- **Edge Compute** (Phase 11): Cloudflare Workers for serverless deployment, authentication middleware, and performance optimization.
- **Multi-Tenant Architecture** (Phase 14): Organization isolation with tenant-scoped queries and per-org roles.
- **Security Hardening** (Phase 13): Input validation, rate limiting, CORS, secrets scanning, TLS/SSL enforcement.
- RESTful API endpoints for all data operations.
- TypeScript for type safety and developer experience.
- React frontend for a responsive user interface.

## Security

For comprehensive security documentation, see **[docs/security.md](docs/security.md)** which covers:
- Input validation and CSV injection prevention
- Authentication & token management
- Rate limiting and CORS security
- Database and transport security
- Error handling and secrets management
- Best practices for developers

### Secrets Scanning (Task 6.5)

This project uses [git-secrets](https://github.com/awslabs/git-secrets) to prevent committing sensitive data like API keys, passwords, and tokens.

**Quick Start:**
```bash
# Install git-secrets (required once)
# macOS:
brew install git-secrets

# Ubuntu/Debian:
sudo apt-get install git-secrets

# Windows (Git Bash):
# See: https://github.com/awslabs/git-secrets#installing-git-secrets

# Setup for this repository (required once)
bash scripts/setup-git-secrets.sh

# Scan before committing (recommended)
npm run secrets-scan

# Pre-commit hook automatically runs on every commit
```

**What gets scanned:**
- AWS Access Keys & Secret Keys
- API tokens (GitHub, OpenAI, Slack, etc.)
- Database connection strings with passwords
- Private keys (RSA, DSA, EC, OpenSSH)
- JWT secrets
- Cloudflare R2 credentials
- Neon Database API keys

**Important Notes:**
- ✅ Pre-commit hook blocks commits containing secrets
- ✅ GitHub Actions workflow scans on every push
- ✅ `.env.example` files are allowed (safe templates)
- ✅ Test fixtures with fake credentials are allowed
- ⚠️ To bypass (NOT RECOMMENDED): `git commit --no-verify`

For more details, see [`.git-secrets-config`](.git-secrets-config) for the full list of patterns and exceptions.

## Technologies Used

### Backend (Node.js/Express/TypeScript)
- **Framework**: Express.js with TypeScript
- **Database**: SQLite (development), Neon PostgreSQL (production)
- **ORM**: Prisma with dual provider support
- **Storage**: Local filesystem (development), Cloudflare R2 (production)
- **Edge Compute**: Cloudflare Workers for serverless functions
- **Testing**: Jest with dual-environment setup (SQLite + PostgreSQL)
- **Security**: Helmet, CORS, JWT, bcrypt, rate limiting

### Frontend (React/TypeScript)
- **Framework**: React with TypeScript
- **Build Tool**: Create React App
- **Styling**: CSS with Tailwind support
- **Offline Support**: IndexedDB for offline data persistence
- **PWA**: Service Worker for offline capabilities

### Infrastructure (Phase 11+)
- **Databases**: Neon (PostgreSQL), better-sqlite3 (local dev)
- **Storage**: Cloudflare R2 with presigned URLs
- **Deployment**: Cloudflare Workers for edge compute
- **Observability**: Sentry for error tracking

## Setup Instructions

### Backend Setup (Phase 11+: Dual Environment)

**Comprehensive guide**: See [backend/README.md](backend/README.md) for complete setup, testing, storage, and deployment instructions.

**Quick Start**:
```bash
cd backend
npm install
cp .env.example .env         # Configure development database
npm run dev                  # Start server (SQLite)
```

**Testing in Both Environments**:
```bash
npm run test:dev             # Test with SQLite
npm run test:prod            # Test with PostgreSQL (requires NEON_CONNECTION_STRING)
npm run test:both            # Comprehensive test suite
```

**Dual Database Support**:
- **Development**: SQLite (fast, local, no setup)
- **Production**: Neon PostgreSQL (managed, scalable, tested via `npm run test:prod`)

### Frontend Setup
1. Navigate to the frontend directory:
   ```bash
   cd frontend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the development server:
   ```bash
   npm start
   ```

## API Endpoints

  If you're seeing unexpected classifications:
  - In the detailed expiry report (which recalculates statuses
   dynamically based on expiry dates), check that the expiry 
  dates are accurate.
  - In the overview reports page (which uses stored statuses),
   the counts might be outdated—use the new endpoint to 
  refresh them.


  To trigger the update, you can make a POST request to 
  http://localhost:3000/reports/update-statuses with your 
  auth token (adjust port if needed). Alternatively, 
  restarting the backend will cause the daily scheduler to 
  run and update statuses.

The backend provides the following API endpoints:

Public Routes
- POST /auth/login - User authentication

Protected Routes (require authentication token)

Products
- GET /products - Get all products
- GET /products/:id - Get a specific product by ID
- GET /products/by-barcode/:barcode - Get a specific product
   by barcode
- GET /products/by-sku/:sku - Get a specific product by SKU
- POST /products - Create a new product
- PUT /products/:id - Update a product
- DELETE /products/:id - Delete a product
- POST /products/upload-csv - Upload and process a
   CSV/XLSX/XLS file of products

Inventory Items
- GET /inventory-items - Get all inventory items
- GET /inventory-items/:id - Get a specific inventory item
   by ID
- GET /inventory-items/product/:productId - Get inventory
   items for a specific product
- GET /inventory-items/by-barcode/:barcode - Get inventory
   items for a specific product by barcode
- GET /inventory-items/recent/product/:productId - Get the
   most recent inventory items for a specific product
- GET /inventory-items/location/:locationId - Get inventory
   items for a specific location
- POST /inventory-items - Create a new inventory item
- PUT /inventory-items/:id - Update an inventory item
- DELETE /inventory-items/:id - Delete an inventory item

Store Areas
- GET /store-areas - Get all store areas
- GET /store-areas/:id - Get a specific store area by ID
- GET /store-areas/name/:name - Get store areas by name
- POST /store-areas - Create a new store area
- PUT /store-areas/:id - Update a store area
- DELETE /store-areas/:id - Delete a store area

Reports
- GET /reports/expiry - Get monthly expiry report
- GET /reports/expiry-details - Get detailed expiry report
   for next 90 days
- GET /reports/monthly-markdown - Get monthly markdown report
- GET /reports/usage - Get usage report
- GET /reports/daily-usage - Get daily usage report for past
   90 days
- GET /reports/analytics - Get dashboard analytics data


Dashboard
- GET /dashboard - Get dashboard data

Users (Manager role only)
- GET /users - Get all users
- GET /users/:id - Get a specific user by ID
- POST /users - Create a new user
- PUT /users/:id - Update a user
- DELETE /users/:id - Delete a user

Root
- GET / - Server health check

## Database Schema

The application uses the following tables:

### `products` table
- `id`: INTEGER PRIMARY KEY AUTOINCREMENT
- `barcode`: TEXT UNIQUE NOT NULL
- `sku`: TEXT UNIQUE NOT NULL
- `name`: TEXT NOT NULL
- `cost_price`: REAL NOT NULL
- `created_at`: TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
- `updated_at`: TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP

### `inventory_items` table
- `id`: INTEGER PRIMARY KEY AUTOINCREMENT
- `product_id`: INTEGER NOT NULL (FOREIGN KEY to `products`)
- `expiry_date`: TEXT NOT NULL
- `location_id`: INTEGER NOT NULL (FOREIGN KEY to `store_areas`)
- `status`: TEXT NOT NULL DEFAULT 'Normal'
- `created_at`: TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
- `updated_at`: TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP

### `store_areas` table
- `id`: INTEGER PRIMARY KEY AUTOINCREMENT
- `name`: TEXT UNIQUE NOT NULL
- `last_checked`: TEXT
- `created_at`: TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
- `updated_at`: TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP

### `users` table
- `id`: INTEGER PRIMARY KEY AUTOINCREMENT
- `pin`: TEXT NOT NULL
- `role`: TEXT NOT NULL
- `created_at`: TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
- `updated_at`: TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP

### `audit_log` table
- `id`: INTEGER PRIMARY KEY AUTOINCREMENT
- `user_id`: INTEGER NOT NULL (FOREIGN KEY to `users`)
- `inventory_item_id`: INTEGER NOT NULL (FOREIGN KEY to `inventory_items`)
- `change_description`: TEXT NOT NULL
- `created_at`: TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP

## Running Tests

```bash
# Development (SQLite - fast)
cd backend
npm run test:dev

# Production (PostgreSQL - requires Neon)
npm run test:prod

# Both environments (comprehensive)
npm run test:both

# Coverage report
npm run test:coverage
```

**Phase 11 Results**:
- ✅ Backend: 37 test suites, 297 tests passing
- ✅ Frontend: 15 test suites, 78 tests passing  
- ✅ Workers: 3 test files, 19 tests passing
- ✅ Security: 0 critical UBS issues
- ✅ Type Safety: 0 linting errors

See [backend/README.md](backend/README.md#testing-dual-environment-strategy) for detailed testing guide.

## Building for Production

### Backend
```bash
cd backend
npm run build
```

### Frontend
```bash
cd frontend
npm run build
```

5624 is the default pin

## Phase 11 Completion Summary (Current)

**What's New**:

✅ **Dual Environment Testing**
- SQLite for rapid development iteration (< 5 seconds per test)
- PostgreSQL (Neon) for production-like testing
- `npm run test:both` ensures compatibility across both databases
- Full migration support for both environments

✅ **Cloudflare R2 Storage Integration**
- Local filesystem for development (fast, no setup)
- Production-ready Cloudflare R2 with presigned URLs
- Automatic provider switching via `STORAGE_PROVIDER` config
- CSV upload support with streaming parser

✅ **Workers Edge Compute Deployment**
- Cloudflare Workers for serverless edge functions
- Local Miniflare testing environment
- Authentication middleware at edge
- Performance optimizations ready

✅ **Quality Assurance Complete**
- 37 backend test suites (297 tests) passing
- 15 frontend test suites (78 tests) passing
- 3 Workers test files (19 tests) passing
- 0 critical security issues (UBS scan)
- 125 linting errors fixed, 0 remaining critical errors

**Documentation Updated**:
- [backend/README.md](backend/README.md) — Complete setup and testing guide
- [backend/docs/](backend/docs/) — Deep-dive documentation on patterns and operations
- [tech-debt.md](tech-debt.md) — Remediation plan for Phases 12-20

## Deployment

### Development Deployment
See [backend/README.md](backend/README.md#deployment--production) for quick start.

```bash
# Backend
cd backend
npm install
npm run dev

# Frontend (in separate terminal)
cd frontend
npm install
npm start
```

### Production Deployment (Phase 11+)

For complete production deployment guide with Neon PostgreSQL and R2 storage:
👉 [backend/docs/deployment.md](backend/docs/deployment.md)

**Key Steps**:
1. Build frontend: `cd frontend && npm run build`
2. Build backend: `cd backend && npm run build`
3. Configure production .env (PostgreSQL, R2, JWT secret)
4. Run migrations: `npm run migrate`
5. Start server: `npm start`

**Infrastructure**:
- **Database**: Neon PostgreSQL (managed, auto-scaling)
- **Storage**: Cloudflare R2 (scalable, cost-effective)
- **Edge Compute**: Cloudflare Workers (low-latency functions)
- **Monitoring**: Sentry for error tracking

See [backend/docs/deployment.md](backend/docs/deployment.md) for complete CI/CD pipeline, environment setup, and production operations.

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a pull request

See [AGENTS.md](AGENTS.md) for detailed development standards and patterns.

## Resources & Documentation

**Getting Started**:
- 👉 [backend/README.md](backend/README.md) — Backend setup, testing, deployment
- [docs/dual-environment-guide.md](docs/dual-environment-guide.md) — Complete development vs. production environment guide
- [docs/environment-setup.md](docs/environment-setup.md) — Environment configuration guide
- [docs/testing-both-environments.md](docs/testing-both-environments.md) — Dual database testing

**Architecture & Patterns**:
- [backend/docs/database-patterns.md](backend/docs/database-patterns.md) — Prisma patterns, queries, optimization
- [backend/docs/storage-patterns.md](backend/docs/storage-patterns.md) — Local vs. R2 storage, presigned URLs
- [docs/neon-workflow.md](docs/neon-workflow.md) — Neon database branching strategy and migrations
- [AGENTS.md](AGENTS.md) — Express/TypeScript development standards

**Operations & Deployment**:
- [docs/operational-runbook.md](docs/operational-runbook.md) — Production operations including Cloudflare Workers
- [docs/cloudflare-setup.md](docs/cloudflare-setup.md) — R2, Workers, Hyperdrive configuration
- [backend/docs/deployment.md](backend/docs/deployment.md) — Production deployment, CI/CD
- [backend/docs/monitoring-alerting.md](backend/docs/monitoring-alerting.md) — Observability setup, Sentry
- [backend/docs/operational-runbooks.md](backend/docs/operational-runbooks.md) — Production procedures

**Troubleshooting & Cost**:
- [docs/troubleshooting.md](docs/troubleshooting.md) — Common issues and solutions
- [docs/cost-optimization.md](docs/cost-optimization.md) — Cloud cost management strategies
- [docs/rollback-procedure.md](docs/rollback-procedure.md) — Emergency rollback procedures

**Advanced Topics**:
- [docs/workers-deployment.md](docs/workers-deployment.md) — Cloudflare Workers edge compute
- [docs/csv-upload-format.md](docs/csv-upload-format.md) — CSV/XLSX upload specifications
- [backend/docs/backup-recovery.md](backend/docs/backup-recovery.md) — Backup strategies
- [docs/security.md](docs/security.md) — Security hardening and best practices
- [tech-debt.md](tech-debt.md) — Technical debt remediation plan (Phases 12-20)

## License

This project is licensed under the MIT License.