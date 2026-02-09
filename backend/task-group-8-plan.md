# Task Group 8: Service Refactoring (Prisma + Dependency Injection) - Implementation Plan

## Overview
Refactor AnalyticsService and ReportService to use Prisma client with dependency injection pattern, following the existing ServiceProvider architecture.

---

## Current Architecture Analysis

### ServiceProvider Pattern (Already Exists)
```typescript
// backend/src/services/service-provider.ts
export class ServiceProvider {
  constructor(prismaClient?: PrismaClient, storageProvider?: StorageProvider) {
    this.prisma = prismaClient ?? getDefaultDatabaseClient();
    // ...
  }

  getAuthService(): AuthService {
    if (!this.authService) {
      this.authService = new AuthService(this.prisma); // ← DI pattern
    }
    return this.authService;
  }
}
```

### Current Service Issues
1. **AnalyticsService** - singleton pattern, direct database access via `getDb()`
2. **ReportService** - static methods, hard-coded SQL queries, no DI
3. No repositories - business logic mixed with data access

---

## Implementation Tasks

### Task 8.1: Refactor AnalyticsService for DI

**Changes:**
- Remove singleton pattern
- Accept Prisma client via constructor
- Change from sync to async methods (Prisma is async)
- Keep existing AnalyticsEventType, AnalyticsEvent, UserSession interfaces

**Before:**
```typescript
export class AnalyticsService {
  private static instance: AnalyticsService;
  
  private constructor() { /* ... */ }
  
  public static getInstance(): AnalyticsService {
    if (!AnalyticsService.instance) {
      AnalyticsService.instance = new AnalyticsService();
    }
    return AnalyticsService.instance;
  }

  async recordEvent(event: AnalyticsEvent): Promise<void> {
    const db = await getDb(); // ← Bad: hardcoded database access
    // ... direct SQL
  }
}
```

**After:**
```typescript
export class AnalyticsService {
  constructor(private prisma: PrismaClient) {}

  // No singleton - DI will handle creation
  
  async recordEvent(event: AnalyticsEvent): Promise<void> {
    // Use injected Prisma client
    await this.analyticsRepository.recordEvent(event); // ← Use repository
  }
}
```

---

### Task 8.2: Create AnalyticsRepository

**File:** `backend/src/repositories/analytics.repository.ts`

**Purpose:** Handle all analytics data access

**Methods:**
- `recordEvent(event: AnalyticsEvent): Promise<void>`
- `startSession(session: UserSession): Promise<void>`
- `endSession(sessionId: string): Promise<void>`
- `getMetrics(from: Date, to: Date): Promise<AnalyticsMetrics>`
- `getEventsByType(type: AnalyticsEventType, limit: number): Promise<AnalyticsEvent[]>`

**Example:**
```typescript
export class AnalyticsRepository {
  constructor(private prisma: PrismaClient) {}

  async recordEvent(event: AnalyticsEvent): Promise<void> {
    await this.prisma.analyticsEvent.create({
      data: {
        userId: event.userId,
        eventType: event.eventType,
        eventCategory: event.eventCategory,
        eventAction: event.eventAction,
        timestamp: event.timestamp,
        metadata: event.metadata || {},
      },
    });
  }

  async getMetrics(from: Date, to: Date): Promise<AnalyticsMetrics> {
    const dailyActiveUsers = await this.getDailyActiveUsers(from, to);
    // ... more metrics
    return { dailyActiveUsers, /* ... */ };
  }
}
```

---

### Task 8.3: Update AnalyticsService to Use Repository

**Changes:**
- Accept repository via constructor or create it
- Replace all `getDb()` calls with repository method calls
- Convert from sync/singleton to async DI-based service

**Example:**
```typescript
export class AnalyticsService {
  private repository: AnalyticsRepository;

  constructor(
    private prisma: PrismaClient,
  ) {
    this.repository = new AnalyticsRepository(prisma);
  }

  async recordEvent(event: AnalyticsEvent): Promise<void> {
    // Validate
    if (!event.eventType) {
      throw new Error('Event type is required');
    }

    // Use repository
    await this.repository.recordEvent(event);
  }

  async getMetrics(from: Date, to: Date): Promise<AnalyticsMetrics> {
    return this.repository.getMetrics(from, to);
  }
}
```

---

### Task 8.4: Refactor ReportService for DI

**Changes:**
- Remove static methods
- Accept Prisma client via constructor
- Create instance methods
- Change from sync to async

**Before:**
```typescript
export class ReportService {
  async getMonthlyExpiryReport(): Promise<MonthlyExpiryReport[]> {
    const db = await getDb(); // ← Direct database access
    const stmt = db.prepare(`SELECT ...`); // ← Raw SQL
    return stmt.all();
  }
}
```

**After:**
```typescript
export class ReportService {
  private repository: ReportRepository;

  constructor(private prisma: PrismaClient) {
    this.repository = new ReportRepository(prisma);
  }

  async getMonthlyExpiryReport(): Promise<MonthlyExpiryReport[]> {
    return this.repository.getMonthlyExpiryReport(); // ← Use repository
  }
}
```

---

### Task 8.5: Create ReportRepository

**File:** `backend/src/repositories/report.repository.ts`

**Purpose:** All report data access using Prisma

**Methods:**
- `getMonthlyExpiryReport(): Promise<MonthlyExpiryReport[]>`
- `getOverallExpiryReport(): Promise<MonthlyExpiryReport>`
- `getMonthlyMarkdownReport(): Promise<MonthlyMarkdownReport[]>`
- `getUsageReport(): Promise<UsageReport[]>`
- `getDailyUsageReport(from: Date, to: Date): Promise<DailyUsageReportItem[]>`
- `getLossBySkuReport(): Promise<LossBySkuReportItem[]>`
- `getLossByDepartmentReport(): Promise<LossByDepartmentReportItem[]>`
- `getItemsByUserReport(): Promise<ItemsByUserReportItem[]>`
- `getItemsByDateReport(from: Date, to: Date): Promise<ItemsByDateReportItem[]>`

**Example:**
```typescript
export class ReportRepository {
  constructor(private prisma: PrismaClient) {}

  async getMonthlyExpiryReport(): Promise<MonthlyExpiryReport[]> {
    // Convert SQL to Prisma queries
    const items = await this.prisma.inventoryItem.groupBy({
      by: ['expiryDate', 'status'],
      _count: { id: true },
      where: {
        expiryDate: { not: null },
      },
    });

    // Transform to expected format
    return items.map(item => ({
      month: formatMonth(item.expiryDate),
      total_expiring: item._count.id,
      // ... other fields
    }));
  }
}
```

---

### Task 8.6: Update ReportService to Use Repository

**Changes:**
- All methods call repository methods
- Client-side sorting/filtering if needed (Prisma handles most)
- Proper error handling

**Example:**
```typescript
export class ReportService {
  private repository: ReportRepository;

  constructor(private prisma: PrismaClient) {
    this.repository = new ReportRepository(prisma);
  }

  async getMonthlyExpiryReport(): Promise<MonthlyExpiryReport[]> {
    const reports = await this.repository.getMonthlyExpiryReport();
    // Optional: post-processing if needed
    return reports.sort((a, b) => b.month.localeCompare(a.month));
  }

  async getDashboardAnalytics(): Promise<DashboardAnalytics> {
    // Combine multiple repository calls
    const items = await this.prisma.inventoryItem.findMany();
    const expiredCount = items.filter(i => i.status === 'Expired').length;
    return {
      totalProducts: await this.prisma.product.count(),
      totalInventoryItems: items.length,
      expiredItems: expiredCount,
      // ... more
    };
  }
}
```

---

### Task 8.7: Update ServiceProvider

**File:** `backend/src/services/service-provider.ts`

**Add methods:**
```typescript
export class ServiceProvider {
  private analyticsService?: AnalyticsService;
  private reportService?: ReportService;

  getAnalyticsService(): AnalyticsService {
    if (!this.analyticsService) {
      this.analyticsService = new AnalyticsService(this.prisma);
    }
    return this.analyticsService;
  }

  getReportService(): ReportService {
    if (!this.reportService) {
      this.reportService = new ReportService(this.prisma);
    }
    return this.reportService;
  }
}
```

---

### Task 8.8: Update Controllers & Tests

**Controllers:**
- Use `serviceProvider.getAnalyticsService()` instead of `AnalyticsService.getInstance()`
- Use `serviceProvider.getReportService()` instead of direct instantiation

**Tests:**
- Mock repositories instead of database
- Create service instances with mock Prisma client
- Use `jest.fn()` for repository methods

**Example:**
```typescript
describe('ReportService', () => {
  let service: ReportService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      inventoryItem: {
        findMany: jest.fn(),
        count: jest.fn(),
        groupBy: jest.fn(),
      },
      product: {
        count: jest.fn(),
      },
    };

    service = new ReportService(mockPrisma);
  });

  it('gets monthly expiry report', async () => {
    mockPrisma.inventoryItem.groupBy.mockResolvedValue([
      { expiryDate: new Date('2024-01'), status: 'Expired', _count: { id: 5 } },
    ]);

    const report = await service.getMonthlyExpiryReport();
    
    expect(report).toHaveLength(1);
    expect(report[0].expired_count).toBeGreaterThan(0);
  });
});
```

---

## TypeScript Strict Types (Task 8.6)

**Ensure all services export proper types:**
```typescript
// Service-level types
export interface IAnalyticsService {
  recordEvent(event: AnalyticsEvent): Promise<void>;
  getMetrics(from: Date, to: Date): Promise<AnalyticsMetrics>;
}

export interface IReportService {
  getMonthlyExpiryReport(): Promise<MonthlyExpiryReport[]>;
  getDashboardAnalytics(): Promise<DashboardAnalytics>;
}

// Repository interfaces for DI
export interface IAnalyticsRepository {
  recordEvent(event: AnalyticsEvent): Promise<void>;
  getMetrics(from: Date, to: Date): Promise<AnalyticsMetrics>;
}

export interface IReportRepository {
  getMonthlyExpiryReport(): Promise<MonthlyExpiryReport[]>;
  getOverallExpiryReport(): Promise<MonthlyExpiryReport>;
}
```

**Benefits:**
- Easier testing with mocks
- Better IDE autocomplete
- Compile-time type checking
- Clearer contracts between layers

---

## Migration Checklist

### Phase 1: Repositories
- [ ] Create `AnalyticsRepository` with all data access methods
- [ ] Create `ReportRepository` with all data access methods
- [ ] Test repositories with Prisma client

### Phase 2: Services
- [ ] Update `AnalyticsService` - Remove singleton, add DI
- [ ] Update `ReportService` - Add DI, use repositories
- [ ] Update method signatures (all async)
- [ ] Add proper error handling

### Phase 3: Integration
- [ ] Update `ServiceProvider` - Add getter methods
- [ ] Update all controllers using these services
- [ ] Update route handlers
- [ ] Test integration end-to-end

### Phase 4: Testing
- [ ] Create repository unit tests with Prisma mocks
- [ ] Create service unit tests with repository mocks
- [ ] Update integration tests
- [ ] Verify test coverage >80%

### Phase 5: Cleanup
- [ ] Remove old `getDb()` calls from services
- [ ] Delete old raw SQL scripts
- [ ] Update documentation
- [ ] Verify no regressions

---

## Benefits of This Refactoring

1. **Dependency Injection**
   - Services are testable with mocked dependencies
   - Easier to swap implementations (e.g., different storage)
   - Clear contracts between layers

2. **Prisma ORM**
   - Type-safe database queries
   - Migration management
   - Automatic schema generation
   - Better query optimization

3. **Repository Pattern**
   - Data access separated from business logic
   - Easier to refactor database layer
   - Reusable across services

4. **Async/Await**
   - Aligned with modern Node.js async patterns
   - Better concurrency handling
   - Cleaner error handling

5. **TypeScript Safety**
   - Strict types throughout
   - Compile-time error detection
   - Better IDE support

---

## Affected Files

### New Files to Create
- `backend/src/repositories/analytics.repository.ts` (Task 8.2)
- `backend/src/repositories/report.repository.ts` (Task 8.5)

### Modified Files
- `backend/src/services/analytics.service.ts` (Task 8.3)
- `backend/src/services/report.service.ts` (Task 8.4, 8.6)
- `backend/src/services/service-provider.ts` (Task 8.7)
- `backend/src/controllers/*.ts` (Task 8.7)
- `backend/src/**/__tests__/*.test.ts` (Task 8.8)

### Dependencies
- `@prisma/client` - Already installed ✅
- `jest` - For testing ✅

---

## Estimated Implementation Time

- Task 8.1-8.2: 30 minutes (AnalyticsService refactoring)
- Task 8.3-8.4: 30 minutes (ReportService refactoring)
- Task 8.5-8.6: 30 minutes (Repository creation)
- Task 8.7-8.8: 45 minutes (Controller/test updates)

**Total: ~2.25 hours**

---

## Progress Tracking

```
Phase 13: Security Hardening
Groups 1-7: ✅ Complete (41/83 tasks)
Group 8: 🔄 In Progress (8 tasks)
  8.1: [ ] Refactor AnalyticsService for DI
  8.2: [ ] Create AnalyticsRepository
  8.3: [ ] Update AnalyticsService to use repository
  8.4: [ ] Refactor ReportService for DI
  8.5: [ ] Create ReportRepository
  8.6: [ ] Add strict TypeScript annotations
  8.7: [ ] Update controllers with DI
  8.8: [ ] Update tests for mocks + coverage
```
