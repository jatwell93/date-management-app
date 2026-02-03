# Technical Design: Dual-Environment Architecture with Cloudflare

## Context

### Current State
The application currently runs as a Node.js/Express server with SQLite database and local filesystem storage. This architecture works well for development but has limitations for production:
- SQLite is file-based (single point of failure, no horizontal scaling)
- Local filesystem doesn't support multi-region deployments
- Server requires ongoing maintenance (patching, monitoring, capacity planning)
- Costs scale linearly with infrastructure needs

### Constraints
1. **Development Simplicity**: New developers must be able to run the app locally without cloud accounts or external dependencies
2. **No Breaking Changes**: Existing Express/SQLite dev workflow must continue working
3. **Test Continuity**: Current Jest test suite must run unchanged
4. **Cost Optimization**: Production costs must scale efficiently (target: <$500/month at 50k users)
5. **Global Performance**: Support users worldwide with <200ms API response times
6. **Portability**: Avoid vendor lock-in; must be able to migrate if needed

### Stakeholders
- **Developers**: Need simple local development experience
- **DevOps**: Need reliable, low-maintenance production deployment
- **Users**: Need fast, reliable service globally
- **Business**: Need cost-effective scaling and quick time-to-market

## Goals / Non-Goals

**Goals:**
- Implement provider pattern for storage and database access with environment-based switching
- Deploy production infrastructure on Cloudflare Workers + R2 + Neon PostgreSQL
- Maintain 100% backward compatibility with existing development workflow
- Achieve 87% cost reduction compared to traditional VPS/cloud deployment at scale
- Enable zero-downtime deployments with automatic global replication
- Reduce operational burden from 5-7 hours/month to 3-4 hours/month
- Support streaming CSV processing for files up to 10MB (10,000+ lines)
- Implement comprehensive monitoring and alerting for production environment

**Non-Goals:**
- Migrating development environment to Cloudflare (keep Express + SQLite)
- Rewriting existing business logic (only add abstraction layer)
- Supporting multiple production deployment targets simultaneously (Cloudflare only initially)
- Implementing advanced features like real-time collaboration or WebSockets (future work)
- Migrating existing SQLite data to Neon (fresh start for production)
- Supporting offline-first or edge computing for end users (server-side only)

## Decisions

### Decision 1: Provider Pattern for Abstraction Layer

**Choice**: Implement TypeScript interface-based provider pattern with environment detection

**Alternatives Considered**:
1. **Conditional imports at call sites**: Simpler but spreads environment logic throughout codebase
2. **Build-time compilation**: Separate builds for dev/prod but complicates testing and development
3. **Feature flags at runtime**: More flexible but adds overhead to every operation

**Rationale**: 
- Provider pattern centralizes environment switching logic in one place
- TypeScript interfaces ensure both implementations have identical APIs
- Dependency injection enables easy testing with mock providers
- Single codebase reduces maintenance burden
- Enables future addition of new providers (AWS S3, Azure Blob, etc.) without touching business logic

**Implementation**:
```typescript
// backend/src/storage/storage-provider.interface.ts
export interface StorageProvider {
  upload(file: Buffer, key: string): Promise<string>;
  download(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  getPresignedUrl(key: string, expiresIn: number): Promise<string>;
}

// backend/src/storage/storage-factory.ts
export function createStorageProvider(): StorageProvider {
  const env = process.env.NODE_ENV || 'development';
  
  if (env === 'production') {
    return new R2StorageProvider({
      accountId: process.env.R2_ACCOUNT_ID!,
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      bucket: process.env.R2_BUCKET_NAME!
    });
  }
  
  return new LocalStorageProvider({
    baseDir: process.env.UPLOAD_DIR || './uploads'
  });
}
```

### Decision 2: Cloudflare Workers with Express Compatibility Layer

**Choice**: Use Cloudflare Workers for production with an Express-compatible adapter

**Alternatives Considered**:
1. **Rewrite all controllers for Workers**: Complete rewrite, high effort, divergent codebases
2. **Use Vercel/Netlify serverless**: Similar benefits but higher costs (no R2 equivalent)
3. **Keep VPS deployment**: Lower risk but misses cost savings and edge performance

**Rationale**:
- Workers provide best cost-to-performance ratio (82% cheaper than AWS at scale)
- Express adapter allows reusing existing controller/route code
- Edge deployment provides 50ms faster global latency
- Zero-downtime deployments built-in
- Automatic scaling without configuration

**Implementation**:
```typescript
// workers/src/index.ts
import { Router } from 'itty-router';
import { createExpressAdapter } from './express-adapter';

// Import existing Express routes
import authRoutes from '../../backend/src/routes/auth.routes';
import inventoryRoutes from '../../backend/src/routes/inventory.routes';

const router = Router();
const expressAdapter = createExpressAdapter();

// Wrap Express routes for Workers environment
router.all('/api/auth/*', expressAdapter(authRoutes));
router.all('/api/inventory/*', expressAdapter(inventoryRoutes));

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return router.handle(request, env);
  }
};
```

### Decision 3: Streaming CSV Parser for Workers CPU Limits

**Choice**: Line-by-line streaming parser with chunked processing

**Alternatives Considered**:
1. **Load entire CSV into memory**: Simple but exceeds Workers 128MB memory limit for large files
2. **Split client-side before upload**: Adds complexity to frontend, poor UX
3. **Use Durable Objects for long-running processing**: More complex, higher cost ($5/million requests)

**Rationale**:
- Streaming parser keeps memory usage constant regardless of file size
- Workers 30s CPU limit allows processing ~10,000 lines when streaming
- Chunked database inserts (100 rows at a time) optimize for PlanetScale's query limits
- Fail gracefully with partial import status for very large files

**Implementation**:
```typescript
// backend/src/services/csv-parser.service.ts
import { parse } from 'csv-parse';

export async function processCSVStream(
  fileStream: ReadableStream,
  onRow: (row: ProductRow) => Promise<void>
): Promise<ProcessResult> {
  const parser = parse({ 
    columns: true, 
    skip_empty_lines: true,
    max_record_size: 1024 * 10 // 10KB per row max
  });
  
  let processed = 0;
  let errors: RowError[] = [];
  const batchSize = 100;
  let batch: ProductRow[] = [];
  
  for await (const row of fileStream.pipeThrough(parser)) {
    batch.push(row);
    
    if (batch.length >= batchSize) {
      await processBatch(batch, onRow, errors);
      processed += batch.length;
      batch = [];
    }
  }
  
  // Process remaining rows
  if (batch.length > 0) {
    await processBatch(batch, onRow, errors);
    processed += batch.length;
  }
  
  return { processed, errors };
}
```

### Decision 4: Neon PostgreSQL with Hyperdrive Connection Pooling

**Choice**: Use Neon PostgreSQL with Cloudflare Hyperdrive for edge connection pooling, Prisma as ORM

**Alternatives Considered**:
1. **Cloudflare D1**: Native to Workers but lacks transactions (ACID broken), single-threaded (queuing under load), 500MB limit on free tier
2. **Neon with serverless driver (@neondatabase/serverless)**: Works but adds ~50-100ms latency per connection
3. **PlanetScale**: Similar to Neon but no Hyperdrive integration, MySQL-based (Prisma PostgreSQL support is better)
4. **Direct Neon connection without pooling**: Cold start latency for each connection, connection exhaustion risk

**Rationale**:
- **Hyperdrive provides lowest possible latency** per Cloudflare docs: performs connection pooling across Cloudflare's edge network
- **Full transaction support** (D1 does NOT support transactions - critical for CSV batch imports)
- **Multi-threaded PostgreSQL** handles concurrent users (D1 is single-threaded, queues requests)
- **Prisma full support** including migrations (D1 has limited Prisma support, no local migrations)
- **PostgreSQL features** (JSONB, full-text search, extensions) vs SQLite dialect limitations
- **Existing Neon migrations** already in `backend/prisma/migrations/neon/` - lower migration effort

**Key Limitation of D1 (Why We Avoided It)**:
> "Cloudflare D1 currently does not support transactions. Implicit & explicit transactions will be ignored and run as individual queries, which breaks the guarantees of the ACID properties of transactions." — [Prisma D1 docs](https://www.prisma.io/docs/orm/overview/databases/cloudflare-d1)

This is critical for our CSV import feature which does batch upserts - a partial failure without transactions could leave the database in an inconsistent state.

**Hyperdrive Benefits**:
- Connection pooling at Cloudflare edge (no cold start penalty)
- Native database driver support (pg, Prisma)
- Global distribution matches Workers deployment
- Included in Workers paid plan ($5/month)

**Implementation**:
```typescript
// workers/src/index.ts - Hyperdrive configuration
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Hyperdrive provides connection string via binding
    const connectionString = env.HYPERDRIVE.connectionString;
    
    // Use standard pg or Prisma with Hyperdrive-provided connection
    const client = new Client({ connectionString });
    await client.connect();
    
    // ... handle request
  }
};

// wrangler.toml - Hyperdrive binding
[[hyperdrive]]
binding = "HYPERDRIVE"
id = "<hyperdrive-config-id>"
```

```bash
# Create Hyperdrive configuration
npx wrangler hyperdrive create date-management-db \
  --connection-string="postgres://user:pass@ep-xxx.us-east-1.aws.neon.tech/neondb"
```

### Decision 4b: Database Factory with Hyperdrive Support

**Implementation**:
```typescript
// backend/src/database/database-factory.ts
import { PrismaClient } from '@prisma/client';

export function createDatabaseClient(env?: Env): PrismaClient {
  const nodeEnv = process.env.NODE_ENV || 'development';
  
  if (nodeEnv === 'production' && env?.HYPERDRIVE) {
    // Production: Use Hyperdrive connection string (edge-pooled)
    return new PrismaClient({
      datasources: {
        db: {
          url: env.HYPERDRIVE.connectionString
        }
      },
      log: ['error'],
    });
  }
  
  if (nodeEnv === 'production') {
    // Production fallback: Direct Neon connection
    return new PrismaClient({
      datasources: {
        db: {
          url: process.env.NEON_CONNECTION_STRING
        }
      },
      log: ['error'],
    });
  }
  
  // Development: SQLite
  return new PrismaClient({
    datasources: {
      db: {
        url: 'file:./database.sqlite'
      }
    },
    log: ['query', 'info', 'warn', 'error']
  });
}
```

### Decision 5: R2 Presigned URLs for Large Uploads

**Choice**: Generate presigned upload URLs for files >2MB, direct upload for smaller files

**Alternatives Considered**:
1. **All uploads through Workers**: Simple but hits CPU time limits for large files
2. **All uploads via presigned URLs**: Adds latency for small files unnecessarily
3. **Use Cloudflare Images**: Not suitable for CSV files (image-specific optimization)

**Rationale**:
- Presigned URLs bypass Workers CPU limits (R2 handles upload directly)
- 2MB threshold balances simplicity (small files) with performance (large files)
- R2 presigned URLs expire in 1 hour (security best practice)
- Frontend handles multipart upload for files >10MB automatically

**Implementation**:
```typescript
// backend/src/storage/r2-storage.provider.ts
export class R2StorageProvider implements StorageProvider {
  async getPresignedUrl(key: string, expiresIn: number = 3600): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: 'text/csv'
    });
    
    return await getSignedUrl(this.s3Client, command, { 
      expiresIn,
      signatureVersion: 'v4'
    });
  }
}

// backend/src/controllers/upload.controller.ts
export async function initiateUpload(req: Request, res: Response) {
  const { fileName, fileSize } = req.body;
  
  if (fileSize > 2 * 1024 * 1024) { // >2MB
    // Use presigned URL for large files
    const key = `uploads/${Date.now()}-${fileName}`;
    const uploadUrl = await storageProvider.getPresignedUrl(key);
    
    return res.json({ 
      method: 'presigned',
      uploadUrl, 
      key 
    });
  }
  
  // Small files upload directly through API
  return res.json({ 
    method: 'direct',
    uploadEndpoint: '/api/upload/direct' 
  });
}
```

### Decision 6: Schema Migration Strategy

**Choice**: Maintain separate migration paths with Prisma schema as source of truth

**Alternatives Considered**:
1. **Single migration path**: Doesn't work (SQLite and PostgreSQL have different syntax)
2. **Generate PostgreSQL from SQLite schema**: Lossy conversion, missing PostgreSQL-specific optimizations
3. **Dual schema files**: Redundant, error-prone to keep in sync

**Rationale**:
- Prisma schema language is database-agnostic (supports both SQLite and PostgreSQL)
- `prisma migrate dev` generates SQLite migrations for development
- `prisma migrate deploy` works with Neon branches for production
- Schema stays in sync automatically through single source of truth
- Neon database branching provides safe preview environment for testing (Git-like workflow)

**Implementation**:
```prisma
// backend/prisma/schema.prisma
datasource db {
  provider = "sqlite" // Changed to "postgresql" in production
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model Product {
  id          Int      @id @default(autoincrement())
  sku         String   @unique
  name        String
  expiryDate  DateTime
  storeArea   String
  notes       String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  
  @@index([expiryDate])
  @@index([storeArea])
}
```

Development workflow:
```bash
# Development: SQLite migrations
npx prisma migrate dev --name add_notes_field

# Production: Create Neon branch
neon branches create --name add_notes_field

# Apply migrations to branch
DATABASE_URL="postgresql://..." npx prisma migrate deploy

# Test on branch, then merge to main
neon branches merge add_notes_field
```

## Risks / Trade-offs

### Risk 1: Cloudflare Service Outage
**Risk**: Global Cloudflare outage takes down production (probability: 1-2x/year based on history)

**Mitigation**:
- Implement health check endpoint that returns cached data during outage
- Document VPS rollback procedure (20-40 hours to redeploy on traditional hosting)
- Set up StatusPage integration to notify users of service disruptions
- Consider multi-cloud failover for mission-critical deployments (future enhancement)

**Trade-off Accepted**: Single-cloud dependency is acceptable given Cloudflare's 99.99% uptime SLA and significant cost savings

### Risk 2: Neon Usage Limits on Free/Starter Tier
**Risk**: Exceeding Neon free tier limits (0.5GB storage, 3GB data transfer) or paid tier compute hours

**Mitigation**:
- Implement query optimization from day 1 (indexes on expiry_date, store_area)
- Monitor database size via Neon dashboard weekly
- Set up usage alerts at 80% of storage/compute limits
- Batch operations where possible (bulk inserts, single query for multiple items)
- Neon's autoscaling means only pay for actual compute usage (no idle costs)

**Trade-off Accepted**: Usage-based pricing ensures cost efficiency; monitoring prevents surprise costs

### Risk 3: Workers CPU Time Limit for Large CSVs
**Risk**: CSV files >10MB may timeout during processing (30s limit on paid Workers plan)

**Mitigation**:
- Implement client-side file size validation (reject files >10MB at upload)
- Add streaming parser with progress reporting (partial success on timeout)
- Document recommended file size limit in user documentation
- Consider Workers Durable Objects for files >10MB (future enhancement)

**Trade-off Accepted**: 10MB limit covers 99% of use cases (10,000 lines); power users can split files

### Risk 4: Development/Production Environment Drift
**Risk**: SQLite and PostgreSQL have subtle differences that could cause production-only bugs

**Mitigation**:
- Use Prisma ORM to abstract database-specific syntax
- Run integration tests against both SQLite and Neon PostgreSQL in CI pipeline
- Document known differences in `docs/database-compatibility.md`
- Require production testing in staging environment (Neon dev branch) before deploy
- Use Neon's branching to test migrations in isolation before merging

**Trade-off Accepted**: Prisma abstracts most differences; PostgreSQL and SQLite are more similar than MySQL

**Trade-off Accepted**: Rare edge cases may appear, but abstraction layer minimizes risk

### Risk 5: R2 S3 API Compatibility Gaps
**Risk**: R2 claims S3 compatibility but some features may be missing or behave differently

**Mitigation**:
- Test all S3 operations during implementation (upload, download, presigned URLs, delete)
- Use well-tested S3 SDK (@aws-sdk/client-s3) rather than custom HTTP clients
- Document tested operations in `docs/r2-compatibility.md`
- Keep local filesystem provider as fallback option
- Monitor Cloudflare's R2 changelog for API changes

**Trade-off Accepted**: R2 is 90%+ S3-compatible; edge cases can be worked around or provider can be swapped

### Risk 6: Express-to-Workers Adapter Complexity
**Risk**: Express middleware and Workers environment have different request/response models

**Mitigation**:
- Use battle-tested adapter library (e.g., `@worker-tools/express`) if available
- Implement comprehensive test suite for adapter layer
- Limit use of Express-specific features (file system, sessions, complex middleware)
- Document unsupported Express features in `docs/workers-limitations.md`
- Plan for gradual Workers-native rewrite of critical paths (future work)

**Trade-off Accepted**: Adapter adds small overhead (<5ms) but enables code reuse during transition

### Risk 7: Vendor Lock-in to Cloudflare
**Risk**: Future pricing changes or service deprecation could force expensive migration

**Mitigation**:
- Abstraction layers allow swapping providers without touching business logic
- R2 uses S3-compatible API (migrate to AWS S3 in ~20 hours)
- Neon uses standard PostgreSQL (migrate to RDS/self-hosted in ~20 hours)
- Workers code is vanilla TypeScript (adapt to Vercel/Netlify in ~40 hours)
- Document migration paths in `docs/disaster-recovery.md`

**Trade-off Accepted**: All cloud providers have lock-in risk; Cloudflare uses more open standards than Firebase/AWS proprietary services

## Migration Plan

### Phase 1: Abstraction Layer Implementation (Week 1-2, ~30 hours)

**Tasks**:
1. Create storage provider interface and implementations
   - `StorageProvider` interface with upload/download/delete/exists methods
   - `LocalStorageProvider` using Node.js `fs/promises`
   - `R2StorageProvider` using `@aws-sdk/client-s3`
   - Unit tests for both providers with mock data

2. Create database provider abstraction
   - Install and configure Prisma ORM
   - Define schema in `prisma/schema.prisma`
   - Generate Prisma client for SQLite (development)
   - Create database factory with environment detection

3. Refactor services to use abstractions
   - Update `csv-upload.service.ts` to use `StorageProvider`
   - Update `inventory.service.ts` and `product.service.ts` to use Prisma
   - Remove direct `fs` and SQLite calls from service layer
   - Update existing unit tests to inject mock providers

**Validation**:
- All existing tests pass with no changes to test code
- `npm run dev` works locally without Cloudflare credentials
- New abstraction layer tests achieve 100% coverage

### Phase 2: Cloudflare Infrastructure Setup (Week 2-3, ~20 hours)

**Tasks**:
1. Provision Cloudflare and Neon resources
   - Create R2 bucket via Cloudflare dashboard
   - Generate R2 API tokens with appropriate scopes
   - Set up Neon database (Starter plan, $19/month or free tier initially)
   - Create Neon API key for programmatic access

2. Configure Workers project
   - Install Wrangler CLI (`npm install -g wrangler`)
   - Create `wrangler.toml` configuration
   - Set up Workers Secrets for credentials
   - Configure custom domain/subdomain for production API

3. Implement Workers entry point
   - Create `workers/src/index.ts` with Express adapter
   - Import existing routes from backend codebase
   - Add CORS configuration for frontend domain
   - Implement error handling for Workers environment

**Validation**:
- R2 bucket accessible via S3 SDK
- Neon PostgreSQL connection works from local machine
- Workers deploy successfully with `wrangler publish`
- Health check endpoint returns 200 OK

### Phase 3: CSV Streaming Parser (Week 3-4, ~15 hours)

**Tasks**:
1. Implement streaming CSV parser
   - Use `csv-parse` library with streaming API
   - Add row validation logic (SKU format, date parsing)
   - Implement chunked database inserts (100 rows/batch)
   - Add progress reporting for frontend

2. Add presigned URL support
   - Implement presigned URL generation in R2StorageProvider
   - Add upload initiation endpoint (decides direct vs presigned)
   - Update frontend to handle presigned URL uploads
   - Add file size validation (10MB limit)

3. Handle CSV injection attacks
   - Sanitize formulas (`=`, `+`, `-`, `@` at start of cells)
   - Add allowlist for permitted cell prefixes
   - Document security measures in code comments

**Validation**:
- 10,000-line CSV uploads in <25s (within Workers CPU limit)
- Large files use presigned URLs successfully
- CSV injection tests pass
- Progress reporting updates every 1000 rows

### Phase 4: Database Migration System (Week 4-5, ~20 hours)

**Tasks**:
1. Set up dual migration workflow
   - Keep existing SQLite migrations in `backend/migrations/`
   - Create PlanetScale schema in Prisma format
   - Generate initial PlanetScale migration from Prisma schema
   - Document PlanetScale branching workflow

2. Migrate existing schema to PlanetScale
   - Create production database in PlanetScale
   - Apply Prisma migrations to main branch
   - Add indexes for performance (expiry_date, store_area, SKU)
   - Set up PlanetScale connection pooling

3. Configure environment switching
   - Update `.env.example` with both SQLite and PlanetScale URLs
   - Add `DATABASE_URL` to Workers Secrets
   - Test database factory switches correctly based on `NODE_ENV`

**Validation**:
- Prisma generates correct client for both databases
- Schema identical between SQLite (dev) and PlanetScale (prod)
- Migrations apply successfully to PlanetScale branches
- Query performance meets <50ms target for simple queries

### Phase 5: Testing & Monitoring (Week 5-6, ~20 hours)

**Tasks**:
1. Expand test coverage
   - Add integration tests for storage abstraction (both providers)
   - Add integration tests for database abstraction (both providers)
   - Create Workers-specific tests using Miniflare
   - Add end-to-end tests for CSV upload flow

2. Set up production monitoring
   - Configure Cloudflare Analytics for Workers
   - Enable Neon monitoring dashboard
   - Set up alerts for error rate >1%
   - Add custom metrics for CSV processing time

3. Load testing
   - Simulate 1000 concurrent CSV uploads
   - Verify Workers auto-scaling handles load
   - Check Neon query performance under load
   - Measure 95th percentile response times

**Validation**:
- Test coverage >90% for abstraction layers
- Load test completes without errors
- Monitoring dashboards show real-time data
- Alert system triggers test notifications correctly

### Phase 6: Production Deployment (Week 6, ~10 hours)

**Tasks**:
1. Frontend configuration
   - Add production API URL environment variable
   - Update upload flow to support presigned URLs
   - Add loading states for long-running operations
   - Test against production Workers endpoint

2. Deploy to production
   - Run `wrangler publish` to deploy Workers
   - Update DNS records to point to Workers domain
   - Verify health check endpoint accessible
   - Monitor initial production traffic

3. Documentation
   - Create `docs/dual-environment-guide.md` for developers
   - Document production deployment process in `docs/deployment.md`
   - Update README with production setup instructions
   - Create runbook for common production issues

**Validation**:
- Production endpoint accessible from public internet
- CSV uploads work end-to-end
- Database queries return correct data
- Frontend connects to production successfully

### Rollback Strategy

If critical issues arise post-deployment:

1. **Immediate**: Revert DNS to old VPS server (5 minutes downtime)
2. **Data**: Export Neon data and import to SQLite if needed (4-8 hours)
3. **Code**: Git revert abstraction layer commits (2 hours to test)
4. **Lessons**: Document issues in post-mortem, create mitigation plan

**Rollback triggers**:
- Error rate >5% for >10 minutes
- 95th percentile response time >500ms for >30 minutes
- Data corruption detected
- Cloudflare announces multi-hour outage

## Open Questions

1. **Workers Bundle Size**: Will Express adapter + existing routes fit within 1MB Workers script limit?
   - **Resolution**: Measure bundle size after Phase 3, consider code splitting if >800KB

2. **Neon Connection Pooling**: How should we configure connection pooling for serverless environment?
   - **Resolution**: ✅ RESOLVED - Use Cloudflare Hyperdrive for edge connection pooling. Hyperdrive eliminates cold start penalty and provides lowest latency. See Decision 4 and Tasks 7.12-7.17.

3. **CORS Configuration**: Should we allow uploads from any origin or restrict to production domain?
   - **Resolution**: Start with production domain only, add CORS allowlist if needed

4. **Rate Limiting Strategy**: What rate limits should we apply to CSV upload endpoint?
   - **Resolution**: Start with 10 uploads/minute per IP, adjust based on abuse patterns

5. **Caching Strategy**: Should we cache product data in Workers KV for faster reads?
   - **Resolution**: Implement in Phase 7 (post-MVP) if query costs exceed $100/month

6. **Authentication in Workers**: How to handle JWT validation without filesystem?
   - **Resolution**: Use Workers Secrets for JWT signing key, verify tokens in memory

## Success Metrics

### Performance Targets
- API response time: <200ms 95th percentile
- CSV upload processing: <30s for 10,000 lines
- Database query time: <50ms for simple queries, <200ms for complex

### Cost Targets
- Monthly infrastructure cost at 1k users: <$50
- Monthly infrastructure cost at 10k users: <$100
- Monthly infrastructure cost at 50k users: <$500

### Reliability Targets
- Production uptime: >99.9% (exclude Cloudflare-wide outages)
- Error rate: <0.1% of requests
- Zero data loss events

### Development Experience
- New developer onboarding: <30 minutes to local dev environment
- Test suite execution time: <5 minutes
- Local development: Zero cloud dependencies required
## Appendix A: Cloudflare D1 Evaluation

### Overview
Cloudflare D1 was evaluated as an alternative to Neon PostgreSQL. D1 is a SQLite-based serverless database native to Cloudflare Workers, which would provide tighter integration and potentially lower latency.

### Evaluation Findings

**Advantages of D1:**
- Native Cloudflare integration (no external network calls)
- SQLite compatibility with existing local development
- Generous free tier (5M reads/day, 100K writes/day, 5GB total storage)
- Simpler migration from existing SQLite database
- Automatic replication and zero-downtime deploys

**Critical Limitations of D1:**

1. **No Transaction Support (DEAL BREAKER)**
   > "Cloudflare D1 currently does not support transactions. Implicit & explicit transactions will be ignored and run as individual queries, which breaks the guarantees of the ACID properties of transactions." 
   — [Prisma D1 Docs](https://www.prisma.io/docs/orm/overview/databases/cloudflare-d1)
   
   This breaks our CSV import feature which performs batch upserts. Without transactions, a partial failure during import would leave the database in an inconsistent state.

2. **Single-Threaded Architecture**
   > "Each individual D1 database is inherently single-threaded, and processes queries one at a time."
   — [D1 Limits Docs](https://developers.cloudflare.com/d1/platform/limits/)
   
   Under high concurrency, requests queue and can return "overloaded" errors. Our application serves multiple concurrent users uploading CSVs.

3. **Limited Prisma Support**
   - No transaction API support
   - No local migration support (must use Wrangler)
   - Interactive transactions ignored, run as individual queries

4. **Storage Limits**
   - Free tier: 500MB per database (not 5GB as initially stated)
   - Paid tier: 10GB max per database (no horizontal scaling)

### Decision Rationale

We chose **Neon PostgreSQL + Hyperdrive** over D1 because:

| Requirement | D1 | Neon + Hyperdrive |
|-------------|-----|-------------------|
| Transaction support | ❌ Not supported | ✅ Full ACID |
| Concurrent users | ❌ Single-threaded, queues | ✅ Multi-threaded |
| Prisma support | ⚠️ Limited | ✅ Full support |
| Edge latency | ✅ Native (~1-2ms) | ✅ Hyperdrive pooling (~5-10ms) |
| Existing migrations | ✅ SQLite compatible | ✅ Already have Neon migrations |
| Free tier storage | 500MB | 500MB |

**The lack of transaction support in D1 is a fundamental limitation that cannot be worked around for our use case.** CSV batch imports require atomicity - either all rows are inserted, or none are.

### References
- [Prisma D1 Limitations](https://www.prisma.io/docs/orm/overview/databases/cloudflare-d1)
- [D1 Database Limits](https://developers.cloudflare.com/d1/platform/limits/)
- [Neon + Hyperdrive Integration](https://neon.tech/docs/guides/cloudflare-hyperdrive)