## Why

Complete the Dependency Injection (DI) pattern across the backend to achieve consistent service instantiation, improved testability, and flexible dependency management. Currently, ServiceProvider exists but only covers 7 of 16 services, leading to inconsistent patterns where some routes use DI while others hardcode `new Service()` calls. This creates technical debt (Issue #4 in tech-debt.md) and makes testing/mocking difficult.

## What Changes

- **Extend ServiceProvider** to include 9 missing services:
  - `ProductService` (has Prisma DI, heavily used)
  - `InventoryService` (has Prisma DI, heavily used)
  - `StoreAreaService` (has Prisma DI)
  - `ExpiredItemService` (basic getter)
  - `DashboardService` (basic getter)
  - `DatabaseBackupService` (with optional config parameter)
  - `ApplicationMonitoringService` (singleton access)
  - `DatabaseMonitoringService` (singleton access)
  - `SchedulerService` (needs refactoring to use DI)

- **Refactor routes** from hardcoded service instantiation to ServiceProvider:
  - `product.routes.ts` - Replace `const productService = new ProductService()`
  - `inventory.routes.ts` - Replace `new InventoryService()` and inline `new ProductService()`
  - `store-area.routes.ts` - Use ServiceProvider pattern
  - `expired-item.routes.ts` - Use ServiceProvider pattern
  - `database.backup.routes.ts` - Use ServiceProvider pattern
  - `dashboard.routes.ts` - Use ServiceProvider pattern
  - Any other routes currently using hardcoded instantiation

- **Update SchedulerService** from static service creation to DI pattern (receives services via ServiceProvider)

- **Add comprehensive tests** for ServiceProvider service creation and singleton behavior

## Capabilities

### New Capabilities
_None - This is an architectural refactoring that doesn't introduce new user-facing capabilities._

### Modified Capabilities
_None - This change improves code quality and maintainability without altering existing API contracts or user-facing behavior._

## Impact

**Affected Code:**
- `backend/src/services/service-provider.ts` - Add 9 new service getters
- `backend/src/routes/product.routes.ts` - Refactor to use ServiceProvider
- `backend/src/routes/inventory.routes.ts` - Refactor to use ServiceProvider
- `backend/src/routes/store-area.routes.ts` - Refactor to use ServiceProvider
- `backend/src/routes/expired-item.routes.ts` - Refactor to use ServiceProvider
- `backend/src/routes/database.backup.routes.ts` - Refactor to use ServiceProvider
- `backend/src/routes/dashboard.routes.ts` - Refactor to use ServiceProvider
- `backend/src/services/scheduler.service.ts` - Convert from static to DI pattern
- Test files for affected routes and ServiceProvider

**APIs:** No changes to HTTP endpoints or responses

**Dependencies:** No new dependencies

**Systems:** No infrastructure changes

**Testing Impact:** Improves testability by enabling proper mock injection for all services

**Risk Level:** 🟡 Medium - Refactoring existing working code, but all changes are internal with comprehensive test coverage to catch regressions
