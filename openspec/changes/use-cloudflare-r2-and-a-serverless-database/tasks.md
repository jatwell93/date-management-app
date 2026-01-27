# Implementation Tasks

## 1. Project Setup & Dependencies

- [x] 1.1 Install Prisma ORM (`npm install @prisma/client @prisma/adapter-planetscale`)
- [x] 1.2 Install AWS SDK for R2 (`npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner`)
- [ ] 1.3 Install Wrangler CLI globally (`npm install -g wrangler`)
- [x] 1.4 Install CSV parsing library (`npm install csv-parse`)
- [x] 1.5 Install Workers types (`npm install -D @cloudflare/workers-types`)
- [x] 1.6 Create `workers/` directory for production deployment code
- [x] 1.7 Update `.env.example` with Cloudflare and PlanetScale variables
- [x] 1.8 Create `wrangler.toml` configuration file

## 2. Storage Abstraction Layer

- [x] 2.1 Create `backend/src/storage/storage-provider.interface.ts` with StorageProvider interface
- [x] 2.2 Implement `backend/src/storage/local-storage.provider.ts` for development (filesystem)
- [x] 2.3 Implement `backend/src/storage/r2-storage.provider.ts` for production (Cloudflare R2)
- [x] 2.4 Create `backend/src/storage/storage-factory.ts` with environment detection
- [x] 2.5 Add custom error types (FileNotFoundError, FileSizeLimitError, StorageProviderError)
- [x] 2.6 Write unit tests for LocalStorageProvider (upload, download, delete, exists)
- [x] 2.7 Write unit tests for R2StorageProvider (upload, download, delete, exists, presignedUrl)
- [x] 2.8 Write integration tests for storage factory environment switching
- [x] 2.9 Document storage abstraction in `docs/storage-patterns.md`

## 3. Database Abstraction Layer

- [x] 3.1 Create `backend/prisma/schema.prisma` with Product model
- [x] 3.2 Add database-agnostic indexes (expiryDate, storeArea, SKU unique)
- [x] 3.3 Configure Prisma for SQLite in development (provider = "sqlite")
- [x] 3.4 Generate initial Prisma client (`npx prisma generate`)
- [x] 3.5 Create `backend/src/database/database-factory.ts` with environment-based client creation
- [x] 3.6 Configure connection pooling for PlanetScale (production only)
- [ ] 3.7 Update existing migration files to use Prisma format
- [x] 3.8 Write unit tests for database factory
- [ ] 3.9 Write integration tests for Prisma client (both SQLite and MySQL)
- [x] 3.10 Document database abstraction in `docs/database-patterns.md`

## 4. Refactor Services to Use Abstractions

- [ ] 4.1 Update `backend/src/services/csv-upload.service.ts` to inject StorageProvider
- [ ] 4.2 Replace direct `fs` calls with `storageProvider.upload()` / `download()`
- [ ] 4.3 Update `backend/src/services/inventory.service.ts` to use Prisma client
- [ ] 4.4 Update `backend/src/services/product.service.ts` to use Prisma client
- [ ] 4.5 Remove all direct SQLite `db.run()` calls from services
- [ ] 4.6 Update service constructors to accept provider dependencies
- [ ] 4.7 Update existing unit tests to inject mock providers
- [ ] 4.8 Verify all existing tests pass without modification to test assertions
- [ ] 4.9 Run linter and fix any TypeScript errors (`npm run lint`)

## 5. Streaming CSV Parser

- [ ] 5.1 Create `backend/src/services/csv-parser.service.ts` with streaming parser
- [ ] 5.2 Implement line-by-line processing using `csv-parse` streaming API
- [ ] 5.3 Add CSV header validation (required columns: sku, name, expiryDate, storeArea)
- [ ] 5.4 Implement row validation (SKU format, date parsing, store area sanitization)
- [ ] 5.5 Add batch accumulation logic (100 rows per batch)
- [ ] 5.6 Implement database insertion with Prisma transactions
- [ ] 5.7 Add CSV injection protection (sanitize =, +, -, @ prefixes)
- [ ] 5.8 Implement progress reporting (emit event every 1000 rows)
- [ ] 5.9 Add error collection and reporting (row-level errors)
- [ ] 5.10 Implement duplicate SKU detection and handling
- [ ] 5.11 Write unit tests for CSV parser with sample fixtures
- [ ] 5.12 Write integration tests for large file processing (10,000 lines)
- [ ] 5.13 Verify memory usage stays constant during processing

## 6. Cloudflare R2 Setup

- [ ] 6.1 Create R2 bucket via Cloudflare dashboard (name: `csv-uploads-prod`)
- [ ] 6.2 Generate R2 API token with read/write permissions
- [ ] 6.3 Configure R2 bucket CORS policy for presigned URL uploads
- [ ] 6.4 Test R2 connection from local machine using AWS SDK
- [ ] 6.5 Implement presigned URL generation in R2StorageProvider
- [ ] 6.6 Add file size limit validation (10MB max)
- [ ] 6.7 Configure R2 lifecycle rules (delete files >24 hours for successful uploads)
- [ ] 6.8 Set up R2 bucket encryption at rest
- [ ] 6.9 Document R2 setup in `docs/cloudflare-setup.md`

## 7. PlanetScale Database Setup

- [ ] 7.1 Create PlanetScale account and organization
- [ ] 7.2 Create database (name: `date-management-prod`, region: closest to users)
- [ ] 7.3 Create `main` branch (production branch)
- [ ] 7.4 Configure Prisma schema for MySQL (provider = "mysql")
- [ ] 7.5 Generate initial migration SQL from Prisma schema
- [ ] 7.6 Apply migration to PlanetScale main branch
- [ ] 7.7 Create PlanetScale service token for application access
- [ ] 7.8 Set up connection string in `.env` (development branch for testing)
- [ ] 7.9 Enable PlanetScale Query Insights
- [ ] 7.10 Configure alerts for slow queries (>200ms)
- [ ] 7.11 Document PlanetScale schema branching workflow in `docs/database-migrations.md`

## 8. Cloudflare Workers Implementation

- [ ] 8.1 Create `workers/src/index.ts` entry point
- [ ] 8.2 Implement Express-compatible adapter for Workers
- [ ] 8.3 Import existing Express routes from `backend/src/routes/`
- [ ] 8.4 Configure CORS headers for production frontend domain
- [ ] 8.5 Add error handling middleware for Workers environment
- [ ] 8.6 Implement request validation middleware
- [ ] 8.7 Add rate limiting (10 requests/minute per IP, 100 for authenticated)
- [ ] 8.8 Implement health check endpoint (`/health`)
- [ ] 8.9 Configure Workers Secrets for R2 and PlanetScale credentials
- [ ] 8.10 Add request/response logging (exclude sensitive data)
- [ ] 8.11 Configure Wrangler routes in `wrangler.toml`
- [ ] 8.12 Write Workers-specific tests using Miniflare
- [ ] 8.13 Test Workers locally with `wrangler dev`

## 9. Upload Flow Enhancement

- [ ] 9.1 Create upload initiation endpoint (`POST /api/upload/initiate`)
- [ ] 9.2 Implement file size check (>2MB → presigned URL, <2MB → direct upload)
- [ ] 9.3 Generate presigned R2 URLs for large files (1 hour expiry)
- [ ] 9.4 Add direct upload endpoint (`POST /api/upload/direct`) for small files
- [ ] 9.5 Implement upload completion callback (`POST /api/upload/complete`)
- [ ] 9.6 Update frontend to handle presigned URL upload flow
- [ ] 9.7 Add client-side file size validation (reject >10MB)
- [ ] 9.8 Implement upload progress tracking with WebSocket or polling
- [ ] 9.9 Add retry logic for failed uploads (exponential backoff)
- [ ] 9.10 Write end-to-end tests for upload flow (both direct and presigned)

## 10. Environment Configuration

- [ ] 10.1 Create environment detection utility (`backend/src/config/environment.ts`)
- [ ] 10.2 Add `NODE_ENV` checks (development vs production)
- [ ] 10.3 Configure separate `.env.development` and `.env.production` files
- [ ] 10.4 Set up Workers Secrets via Wrangler CLI (`wrangler secret put DATABASE_URL`)
- [ ] 10.5 Add R2 credentials to Workers Secrets (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY)
- [ ] 10.6 Document required environment variables in `docs/environment-setup.md`
- [ ] 10.7 Create `.env.example` with all required variables (no secrets)
- [ ] 10.8 Verify development works without any production credentials

## 11. Testing & Quality Assurance

- [ ] 11.1 Write integration tests for storage abstraction (local and R2)
- [ ] 11.2 Write integration tests for database abstraction (SQLite and PlanetScale)
- [ ] 11.3 Create test fixtures for CSV files (valid, invalid, large)
- [ ] 11.4 Write end-to-end tests for CSV upload flow
- [ ] 11.5 Add load tests for 1000 concurrent uploads
- [ ] 11.6 Verify test coverage >90% for abstraction layers
- [ ] 11.7 Run all tests in both development and production modes
- [ ] 11.8 Test Workers deployment to preview environment
- [ ] 11.9 Verify UBS scan passes (`ubs backend/src/`)
- [ ] 11.10 Run linter and fix all errors (`npm run lint`)

## 12. Monitoring & Observability

- [ ] 12.1 Enable Cloudflare Analytics for Workers
- [ ] 12.2 Configure custom metrics (CSV processing time, upload size)
- [ ] 12.3 Set up PlanetScale Query Insights alerts
- [ ] 12.4 Create dashboard for key metrics (response times, error rates, upload counts)
- [ ] 12.5 Configure alerts for error rate >1%
- [ ] 12.6 Configure alerts for 95th percentile response time >500ms
- [ ] 12.7 Set up PlanetScale row read alerts at 80% of monthly limit
- [ ] 12.8 Add structured logging to Workers (JSON format)
- [ ] 12.9 Document monitoring setup in `docs/monitoring.md`

## 13. Security Hardening

- [ ] 13.1 Implement CSV injection sanitization in parser
- [ ] 13.2 Add input validation for all API endpoints
- [ ] 13.3 Configure rate limiting on upload endpoints
- [ ] 13.4 Enable TLS-only connections to PlanetScale
- [ ] 13.5 Verify no secrets in codebase (use git-secrets or similar)
- [ ] 13.6 Configure CORS to whitelist production domain only
- [ ] 13.7 Add request size limits (10MB max)
- [ ] 13.8 Implement JWT token validation in Workers
- [ ] 13.9 Run security audit with `npm audit`
- [ ] 13.10 Document security measures in `docs/security.md`

## 14. Database Migrations

- [ ] 14.1 Keep existing SQLite migrations in `backend/migrations/` for development
- [ ] 14.2 Create PlanetScale branch for schema changes (`pscale branch create`)
- [ ] 14.3 Apply Prisma migrations to PlanetScale branch
- [ ] 14.4 Test migrations on branch before deploying to main
- [ ] 14.5 Create deploy request in PlanetScale (`pscale deploy-request create`)
- [ ] 14.6 Document migration workflow in `docs/database-migrations.md`
- [ ] 14.7 Add migration scripts to `package.json` (dev and prod)
- [ ] 14.8 Verify migrations work in both SQLite and MySQL

## 15. Production Deployment

- [ ] 15.1 Create production Cloudflare Workers service
- [ ] 15.2 Configure custom domain for production API
- [ ] 15.3 Set up DNS records pointing to Workers
- [ ] 15.4 Deploy Workers with `wrangler publish`
- [ ] 15.5 Verify health check endpoint accessible (`https://api.domain.com/health`)
- [ ] 15.6 Test CSV upload flow end-to-end in production
- [ ] 15.7 Monitor initial production traffic (first 24 hours)
- [ ] 15.8 Verify costs match projections (Cloudflare + PlanetScale)
- [ ] 15.9 Update frontend to use production API endpoint
- [ ] 15.10 Create rollback plan and document in `docs/rollback-procedure.md`

## 16. Documentation

- [ ] 16.1 Create `docs/dual-environment-guide.md` for developers
- [ ] 16.2 Document storage abstraction patterns
- [ ] 16.3 Document database abstraction patterns
- [ ] 16.4 Create `docs/cloudflare-setup.md` for infrastructure setup
- [ ] 16.5 Create `docs/planetscale-workflow.md` for schema branching
- [ ] 16.6 Update main README with production setup instructions
- [ ] 16.7 Document CSV upload API endpoints
- [ ] 16.8 Create troubleshooting guide for common issues
- [ ] 16.9 Document cost optimization strategies
- [ ] 16.10 Create runbook for production operations

## 17. Performance Optimization

- [ ] 17.1 Add indexes to Prisma schema (expiryDate, storeArea, SKU)
- [ ] 17.2 Optimize database queries (use Prisma select to limit fields)
- [ ] 17.3 Implement query result caching with Workers KV (optional, post-MVP)
- [ ] 17.4 Test Workers cold start times (<10ms target)
- [ ] 17.5 Optimize Workers bundle size (<1MB limit)
- [ ] 17.6 Add compression to API responses (gzip)
- [ ] 17.7 Implement connection pooling for PlanetScale
- [ ] 17.8 Run load tests and verify 95th percentile <200ms
- [ ] 17.9 Profile CSV parsing for 10,000-line files (<25s target)
- [ ] 17.10 Document performance benchmarks in `docs/performance.md`

## 18. Rollback & Disaster Recovery

- [ ] 18.1 Document rollback procedure to VPS deployment
- [ ] 18.2 Create script to export PlanetScale data to SQLite
- [ ] 18.3 Document R2 to local filesystem migration
- [ ] 18.4 Test rollback procedure in staging environment
- [ ] 18.5 Create backup strategy for PlanetScale (daily snapshots)
- [ ] 18.6 Document data retention policies
- [ ] 18.7 Create incident response plan
- [ ] 18.8 Set up status page for service availability
- [ ] 18.9 Document disaster recovery procedures in `docs/disaster-recovery.md`

## 19. Developer Experience

- [ ] 19.1 Ensure `npm run dev` works without Cloudflare credentials
- [ ] 19.2 Ensure `npm test` runs against SQLite (no cloud dependencies)
- [ ] 19.3 Create setup script for new developers (`npm run setup`)
- [ ] 19.4 Add helpful error messages when environment variables missing
- [ ] 19.5 Document local development workflow
- [ ] 19.6 Create VS Code debug configuration for Workers
- [ ] 19.7 Add npm scripts for common tasks (migrate, test, deploy)
- [ ] 19.8 Verify onboarding time <30 minutes for new developers

## 20. Final Validation & Handoff

- [ ] 20.1 Run full test suite in both environments (`npm test`)
- [ ] 20.2 Verify all specs requirements have corresponding tests
- [ ] 20.3 Run load tests and verify performance targets met
- [ ] 20.4 Verify production deployment works end-to-end
- [ ] 20.5 Confirm monthly costs match projections (±10%)
- [ ] 20.6 Review all documentation for completeness
- [ ] 20.7 Conduct security audit checklist review
- [ ] 20.8 Perform user acceptance testing with sample CSVs
- [ ] 20.9 Get approval from stakeholders for production release
- [ ] 20.10 Archive OpenSpec change with `openspec archive use-cloudflare-r2-and-a-serverless-database`
