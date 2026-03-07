# Developer Guide

**Complete guide for daily development on the Date Management App**

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [Daily Workflow](#daily-workflow)
3. [Running Tests](#running-tests)
4. [Database Management](#database-management)
5. [Common Tasks](#common-tasks)
6. [Debugging](#debugging)
7. [Git Workflow](#git-workflow)
8. [Production Deployment](#production-deployment)
9. [Troubleshooting](#troubleshooting)

---

## Getting Started

### First-Time Setup

**Prerequisites:**
- Node.js ≥18.x
- npm ≥9.x
- Git

**Quick Setup (30 minutes):**

```bash
# 1. Clone the repository
git clone <repository-url>
cd date-management-app

# 2. Run automated setup
cd backend
npm run setup

# This script will:
# - Check Node.js version
# - Install dependencies
# - Create .env from .env.example
# - Run database migrations
# - Seed test data
# - Run initial tests
```

**Manual Setup (if needed):**

```bash
# Install dependencies
npm install

# Set up environment
cp .env.example .env

# Review and update .env with your settings
# At minimum, ensure these are set:
# - NODE_ENV=development
# - JWT_SECRET=dev-secret-change-in-production
# - PORT=3001

# Run migrations
npm run migrate

# Seed test data
npm run seed
npm run seed:tier-flags

# Verify setup
npm test
```

---

## Daily Workflow

### Starting Development

```bash
# Start backend development server (from backend/)
npm run dev

# Server runs on http://localhost:3001
# Auto-reloads on file changes
```

### Environment Variables

The app loads environment variables from:
1. `.env` - General settings
2. `.env.development` - Development-specific (loaded when NODE_ENV=development)
3. `.env.production` - Production-specific (loaded when NODE_ENV=production)

**Development defaults:**
- Database: SQLite (`database.sqlite`)
- Storage: Local filesystem (`./uploads`)
- Auth: Clerk (development keys)

### Auto-Reload

The dev server uses `nodemon` to watch for changes:
- **Watches:** `src/`, `.env`, `.env.development`
- **Extensions:** `.ts`, `.json`
- **Debounce:** 2 seconds

**Tip:** If auto-reload isn't working, restart the dev server.

---

## Running Tests

### Test Commands

```bash
# Run all tests (development database - SQLite)
npm run test:dev

# Run tests with coverage report
npm run test:coverage

# Run only tests that changed (fast CI)
npm run test:diff

# Run tests in watch mode (re-run on file change)
npm run test:watch

# Run tests with verbose output
npm run test:verbose

# Run tests against production database (PostgreSQL via Neon)
npm run test:prod

# Run tests on both databases (comprehensive)
npm run test:both
```

### Writing Tests

**Follow TDD (Test-Driven Development):**

1. **RED:** Write a failing test
2. **GREEN:** Write minimal code to pass
3. **REFACTOR:** Clean up without breaking tests

**Test structure:**

```typescript
// src/__tests__/services/my-service.test.ts
import { MyService } from '../../services/my-service';

describe('MyService', () => {
  describe('methodName', () => {
    it('should do expected behavior', () => {
      // Arrange
      const service = new MyService();
      const input = { /* test data */ };

      // Act
      const result = service.methodName(input);

      // Assert
      expect(result).toBe(expected);
    });

    it('should handle edge case', () => {
      // Test edge cases, errors, boundaries
    });
  });
});
```

**Testing guidelines:**
- ✅ Test business logic in services
- ✅ Test validation logic
- ✅ Test error handling
- ✅ Mock external dependencies
- ✅ Use descriptive test names
- ❌ Don't test implementation details
- ❌ Don't test external libraries

### Test Coverage

**Target:** >80% coverage for new code

```bash
# Generate coverage report
npm run test:coverage

# Open coverage report in browser
open coverage/lcov-report/index.html
```

---

## Database Management

### Migrations

```bash
# Run pending migrations
npm run migrate
# or
npm run db:migrate

# Check migration status
npm run migrate:status
# or
npm run db:status

# Rollback last migration
npm run migrate:rollback
# or
npm run db:rollback

# Reset database (delete + migrate + seed)
npm run db:reset
```

### Seeding Data

```bash
# Seed default users
npm run seed

# Seed tier feature flags
npm run seed:tier-flags

# Reset and seed everything
npm run db:reset
```

### Prisma Studio (Database GUI)

```bash
# Open Prisma Studio
npm run db:studio

# Opens browser at http://localhost:5555
# Browse tables, edit data, run queries
```

### Creating Migrations

```bash
# 1. Modify prisma/schema.prisma
# 2. Generate migration
npx prisma migrate dev --name description-of-change

# 3. Migration files created in prisma/migrations/
# 4. Commit migration files to git
```

---

## Common Tasks

### Add a New API Endpoint

1. **Define route:** `src/routes/resource.routes.ts`
   ```typescript
   router.post('/resources', authenticateToken, resourceController.create);
   ```

2. **Create controller:** `src/controllers/resourceController.ts`
   ```typescript
   export const resourceController = {
     async create(req: Request, res: Response) {
       try {
         const data = await resourceService.create(req.body);
         res.status(201).json(data);
       } catch (error) {
         res.status(400).json({ error: error.message });
       }
     }
   };
   ```

3. **Create service:** `src/services/resourceService.ts`
   ```typescript
   export class ResourceService {
     async create(data: CreateResourceDTO): Promise<Resource> {
       // Validation
       // Business logic
       // Database operations
       return resource;
     }
   }
   ```

4. **Write tests:** `src/__tests__/services/resourceService.test.ts`

5. **Register route:** In `src/index.ts`:
   ```typescript
   import resourceRoutes from './routes/resource.routes';
   app.use('/api/resources', resourceRoutes);
   ```

### Add a Database Model

1. **Update Prisma schema:** `prisma/schema.prisma`
   ```prisma
   model Resource {
     id             Int      @id @default(autoincrement())
     name           String
     organizationId Int
     createdAt      DateTime @default(now())
     updatedAt      DateTime @updatedAt
     
     organization Organization @relation(fields: [organizationId], references: [id])
     
     @@index([organizationId])
     @@map("resources")
   }
   ```

2. **Generate migration:**
   ```bash
   npx prisma migrate dev --name add_resource_model
   ```

3. **Generate Prisma client:**
   ```bash
   npx prisma generate
   ```

4. **Create TypeScript types:** `src/types/Resource.ts`
   ```typescript
   export interface Resource {
     id: number;
     name: string;
     organizationId: number;
     createdAt: Date;
     updatedAt: Date;
   }

   export interface CreateResourceDTO {
     name: string;
     organizationId: number;
   }
   ```

### Format Code

```bash
# Format all TypeScript files
npm run format

# Check code style
npm run lint

# Fix auto-fixable issues
npm run lint:fix

# Type-check without compiling
npm run type-check
```

---

## Debugging

### VS Code Debugging

**Press F5** to start debugging with these configurations:

1. **Debug Backend (Node.js)** - Start dev server with debugger attached
2. **Debug Current Test File** - Debug the currently open test file
3. **Debug All Tests** - Debug entire test suite
4. **Debug Workers (Wrangler)** - Debug Cloudflare Workers locally

**Breakpoints:**
- Click left gutter in editor to add breakpoint
- Breakpoints work in both TypeScript source and tests

### Console Logging

```typescript
// Development logging
console.log('Debug info:', { variable });

// Use Sentry for production
import * as Sentry from '@sentry/node';
Sentry.captureMessage('Something happened', 'info');
```

### Database Debugging

```bash
# Check database state
npm run db:studio

# Check migration status
npm run db:status

# View database file directly (SQLite)
sqlite3 database.sqlite
.schema
SELECT * FROM migrations;
.quit
```

---

## Git Workflow

### Branch Naming

```
feature/<feature-name>     - New features
fix/<bug-description>      - Bug fixes
chore/<task-description>   - Maintenance tasks
docs/<doc-update>          - Documentation
```

### Commit Messages

**Use conventional commits:**

```
feat(area): brief description

- Detail 1
- Detail 2

Refs: <change-id>
```

**Types:**
- `feat:` - New feature
- `fix:` - Bug fix
- `chore:` - Maintenance
- `docs:` - Documentation
- `test:` - Test changes
- `refactor:` - Code refactoring

### Standard Workflow

```bash
# 1. Create feature branch
git checkout -b feature/my-feature

# 2. Make changes, commit frequently
git add .
git commit -m "feat(component): add new feature"

# 3. Push branch
git push origin feature/my-feature

# 4. Create pull request via GitHub

# 5. After PR approval and merge, clean up
git checkout main
git pull
git branch -d feature/my-feature
```

### Before Committing

**Run quality checks:**

```bash
# 1. Run tests
npm test

# 2. Check linting
npm run lint

# 3. Type check
npm run type-check

# 4. Scan for bugs (optional but recommended)
ubs $(git diff --name-only)
```

---

## Production Deployment

### Pre-Deployment Checklist

- [ ] All tests pass locally (`npm test`)
- [ ] Linter clean (`npm run lint`)
- [ ] OpenSpec validated (`openspec validate --all`)
- [ ] Environment variables set (Doppler/Wrangler)
- [ ] Database migration plan ready
- [ ] Rollback procedure documented

### Deployment Steps

**Backend (Node.js):**

```bash
# 1. Merge to main branch
git checkout main
git pull

# 2. Run production migrations
npm run migrate:prod

# 3. Deploy (varies by hosting provider)
# See deployment-specific docs
```

**Workers (Cloudflare):**

```bash
# Deploy to development
npm run workers:deploy:dev

# Deploy to production
npm run workers:deploy:prod

# Set secrets if needed
cd ../workers
wrangler secret put DATABASE_URL
wrangler secret put JWT_SECRET
```

### Post-Deployment

1. **Smoke test:** Verify critical paths work
2. **Monitor Sentry:** Watch for errors for 15 minutes
3. **Check logs:** Ensure no unexpected warnings
4. **Test key features:** Login, upload, data operations

### Rollback Procedure

If deployment fails:

```bash
# 1. Revert code
git revert <commit-hash>
git push

# 2. Roll back database if needed
npm run migrate:rollback

# 3. Redeploy previous version
npm run workers:deploy:prod
```

See [docs/rollback-procedure.md](./rollback-procedure.md) for detailed steps.

---

## Troubleshooting

### Common Issues

#### Port Already in Use

**Error:** `Error: listen EADDRINUSE: address already in use :::3001`

**Solutions:**

```bash
# Option 1: Kill process using port 3001
# macOS/Linux:
lsof -ti:3001 | xargs kill -9

# Windows:
netstat -ano | findstr :3001
taskkill /PID <PID> /F

# Option 2: Use different port
# Edit .env:
PORT=3002
```

#### Database Locked

**Error:** `SQLITE_BUSY: database is locked`

**Solutions:**

```bash
# Option 1: Close Prisma Studio
# (Prisma Studio holds a lock)

# Option 2: Close all Node processes
# macOS/Linux:
killall node

# Windows:
taskkill /F /IM node.exe

# Option 3: Delete lock files
rm -f database.sqlite-shm database.sqlite-wal
```

#### Migration Failures

**Error:** `Migration failed to apply`

**Solutions:**

```bash
# Option 1: Check migration status
npm run db:status

# Option 2: Reset database (CAUTION: deletes all data)
npm run db:reset

# Option 3: Manually fix and retry
# 1. Check database state with Prisma Studio
# 2. Fix inconsistencies
# 3. Mark migration as applied (if safe)
```

#### Module Not Found

**Error:** `Cannot find module 'X'`

**Solutions:**

```bash
# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install

# Regenerate Prisma client
npx prisma generate

# Clear Jest cache
npx jest --clearCache
```

#### Test Failures

**Error:** Tests failing unexpectedly

**Solutions:**

```bash
# 1. Clear test cache
npx jest --clearCache

# 2. Run tests in isolation
npm test -- --runInBand

# 3. Check database state
npm run db:reset
npm test

# 4. Verify environment
echo $NODE_ENV  # Should be "test" during tests
```

#### TypeScript Errors

**Error:** `TS2307: Cannot find module`

**Solutions:**

```bash
# 1. Regenerate Prisma client
npx prisma generate

# 2. Restart TypeScript server (VS Code)
# Command Palette > TypeScript: Restart TS Server

# 3. Check tsconfig.json paths
npm run type-check
```

#### Environment Variable Missing

**Error:** `❌ JWT_SECRET environment variable is missing or empty`

**Solutions:**

```bash
# 1. Check .env file exists
ls -la .env

# 2. Copy from example if missing
cp .env.example .env

# 3. Verify variable is set
cat .env | grep JWT_SECRET

# 4. For development, set:
JWT_SECRET=dev-secret-change-in-production
```

### Getting Help

1. **Check documentation:**
   - [README.md](../backend/README.md) - Project overview
   - [environment-setup.md](./environment-setup.md) - Environment configuration
   - [AGENTS.md](../AGENTS.md) - Development standards

2. **Search codebase:**
   ```bash
   # Find similar patterns
   grep -r "pattern" src/

   # Find how something is used
   grep -r "functionName" src/
   ```

3. **Check git history:**
   ```bash
   # See recent changes to a file
   git log -p path/to/file

   # Find when something broke
   git bisect start
   ```

4. **Ask the team:**
   - Include error message
   - Include steps to reproduce
   - Include environment (OS, Node version)

---

## Quick Reference

### Most Used Commands

| Task | Command |
|------|---------|
| Start dev server | `npm run dev` |
| Run tests | `npm test` |
| Run tests (watch) | `npm run test:watch` |
| Database GUI | `npm run db:studio` |
| Run migration | `npm run migrate` |
| Format code | `npm run format` |
| Check style | `npm run lint` |
| Fix style | `npm run lint:fix` |

### File Locations

| Type | Location |
|------|----------|
| Routes | `src/routes/` |
| Controllers | `src/controllers/` |
| Services | `src/services/` |
| Database Models | `prisma/schema.prisma` |
| Migrations | `prisma/migrations/` |
| Tests | `src/__tests__/` |
| Config | `src/config/` |
| Types | `src/types/` |

---

## Additional Resources

- [Testing Guide](./TESTING.md) - Comprehensive testing documentation
- [Multi-Tenant Guide](./multi-tenant-guide.md) - Multi-tenancy patterns
- [Security Guide](./security.md) - Security best practices  
- [Operational Runbook](./operational-runbook.md) - Production operations

---

**Need more help?** Check the project README or ask a team member.
