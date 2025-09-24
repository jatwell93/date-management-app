# Tasks: Build a Progressive Web Application for Retail Inventory Date Management

**Input**: Design documents from `C:/Users/josha/spec-kit/date-management-app/specs/001-build-a-progressive/`
**Prerequisites**: plan.md, research.md, data-model.md, contracts/api.md, quickstart.md

## Phase 3.1: Setup & Configuration
- [x] T001 Initialize backend Node.js project: `cd backend && npm install express sqlite3 jsonwebtoken bcrypt cors`
- [x] T002 Initialize frontend React project: `cd frontend && npm install`
- [x] T003 [P] Configure linting and formatting for backend (ESLint/Prettier) in `backend/.eslintrc.json`
- [x] T004 [P] Configure linting and formatting for frontend (ESLint/Prettier) in `frontend/.eslintrc.json`
- [x] T005 Create database setup script in `backend/src/database/setup.ts` to initialize SQLite tables based on `data-model.md`
- [x] T006 Implement database connection module in `backend/src/database/index.ts`
- [x] T007 Implement nightly backup script as per `research.md` in `backend/scripts/backup.sh`

## Phase 3.2: Tests First (TDD) ⚠️ MUST COMPLETE BEFORE 3.3
**CRITICAL: These tests MUST be written and MUST FAIL before ANY implementation**
- [ ] T008 [P] Contract test `POST /auth/login` in `backend/src/tests/contract/auth.test.ts`
- [ ] T009 [P] Contract test `GET /products?barcode=` in `backend/src/tests/contract/products.test.ts`
- [ ] T010 [P] Contract test `POST /inventory-items` in `backend/src/tests/contract/inventory.test.ts`
- [ ] T011 [P] Contract test `GET /reports/monthly-markdown` in `backend/src/tests/contract/reports.test.ts`
- [ ] T011a [P] Contract test `GET /reports/usage` in `backend/src/tests/contract/reports.test.ts`
- [ ] T012 [P] Contract test `GET /dashboard` in `backend/src/tests/contract/dashboard.test.ts`
- [ ] T013 [P] Contract test `POST /products/upload-csv` in `backend/src/tests/contract/products.test.ts`
- [ ] T013a [P] Contract test `POST /products` in `backend/src/tests/contract/products.test.ts`
- [ ] T014 [P] Integration test for "Scan & Save" scenario from `quickstart.md` in `backend/src/tests/integration/scan.test.ts`
- [ ] T015 [P] Integration test for "Manager Report" scenario from `quickstart.md` in `backend/src/tests/integration/reports.test.ts`
- [ ] T016 [P] Integration test for "Manager Dashboard" scenario from `quickstart.md` in `backend/src/tests/integration/dashboard.test.ts`

## Phase 3.3: Core Implementation (ONLY after tests are failing)
### Backend
- [ ] T017 [P] Create data model for `users` in `backend/src/models/user.model.ts`
- [ ] T018 [P] Create data model for `products` in `backend/src/models/product.model.ts`
- [ ] T019 [P] Create data model for `inventory_items` in `backend/src/models/inventory-item.model.ts`
- [ ] T020 [P] Create data model for `store_areas` in `backend/src/models/store-area.model.ts`
- [ ] T021 [P] Create data model for `audit_log` in `backend/src/models/audit-log.model.ts`
- [ ] T022 Implement `AuthService` for user authentication logic in `backend/src/services/auth.service.ts`
- [ ] T023 Implement `ProductService` for product lookups in `backend/src/services/product.service.ts`
- [ ] T024 Implement `InventoryService` for managing inventory items in `backend/src/services/inventory.service.ts`
- [ ] T025 Implement `ReportService` for generating reports in `backend/src/services/report.service.ts`
- [ ] T025a Implement usage report generation in `ReportService` in `backend/src/services/report.service.ts`
- [ ] T026 Implement `DashboardService` for dashboard data aggregation in `backend/src/services/dashboard.service.ts`
- [ ] T027 Implement `POST /auth/login` endpoint in `backend/src/routes/auth.routes.ts`
- [ ] T028 Implement `GET /products`, `POST /products/upload-csv` endpoints in `backend/src/routes/product.routes.ts`
- [ ] T028a Add `createProduct` method to `ProductService` in `backend/src/services/product.service.ts`
- [ ] T028b Implement `POST /products` endpoint in `backend/src/routes/product.routes.ts`
- [ ] T029 Implement `POST /inventory-items` endpoint in `backend/src/routes/inventory.routes.ts`
- [ ] T030 Implement `GET /reports/monthly-markdown` endpoint in `backend/src/routes/report.routes.ts`
- [ ] T030a Implement `GET /reports/usage` endpoint in `backend/src/routes/report.routes.ts`
- [ ] T031 Implement `GET /dashboard` endpoint in `backend/src/routes/dashboard.routes.ts`
### Frontend
- [ ] T032 [P] Implement Login page UI component in `frontend/src/components/LoginPage.tsx` (using get_component)
- [ ] T033 [P] Implement Barcode scanning component in `frontend/src/components/Scanner.tsx` (using get_component)
- [ ] T034 [P] Implement Main scanning page UI in `frontend/src/pages/ScanPage.tsx` (using get_component)
- [ ] T035 [P] Implement Manager dashboard UI in `frontend/src/pages/DashboardPage.tsx` (using get_component)
- [ ] T036 [P] Implement Manager reports UI in `frontend/src/pages/ReportsPage.tsx` (using get_component)
- [ ] T036a [P] Implement Manager usage report UI in `frontend/src/pages/UsageReportPage.tsx` (using get_component)
- [ ] T036b [P] Implement manual markdown calculator component in `frontend/src/components/MarkdownCalculator.tsx` (using get_component)
- [ ] T037 Implement frontend routing in `frontend/src/App.tsx`

## Phase 3.4: Integration
- [ ] T038 Implement JWT authentication middleware in `backend/src/middleware/auth.middleware.ts` and apply to protected routes.
- [ ] T039 Connect backend services to the database, replacing any mock data.
- [ ] T040 Connect frontend components to backend API endpoints.
- [ ] T041 Implement global error handling middleware in `backend/src/middleware/error.middleware.ts`
- [ ] T042 Configure and enable CORS in `backend/src/index.ts`

## Phase 3.5: Polish & Deployment
- [ ] T043 [P] Add unit tests for backend services in `backend/src/tests/unit/`
- [ ] T044 [P] Add component tests for frontend UI in `frontend/src/tests/`
- [ ] T045 [P] Finalize and verify API documentation in `specs/001-build-a-progressive/contracts/api.md`
- [ ] T046 Set up CI/CD pipeline (GitHub Actions) in `.github/workflows/deploy.yml`
- [ ] T047 Perform final manual testing based on `quickstart.md` scenarios.

## Dependencies
- **Setup (T001-T007)** must be done before all other phases.
- **Tests (T008-T016)** must be written and failing before **Core Implementation (T017-T037)**.
- **Models (T017-T021)** block **Services (T022-T026)**.
- **Services (T022-T026)** block **Endpoints (T027-T031)**.
- **Backend Endpoints (T027-T031)** block **Frontend Integration (T040)**.
- **Core Implementation (T017-T037)** blocks **Integration (T038-T042)**.
- **Integration (T038-T042)** blocks **Polish (T043-T047)**.

## Parallel Example
```
# The following contract tests can be developed simultaneously:
Task: "T008 [P] Contract test POST /auth/login in backend/src/tests/contract/auth.test.ts"
Task: "T009 [P] Contract test GET /products?barcode= in backend/src/tests/contract/products.test.ts"
Task: "T010 [P] Contract test POST /inventory-items in backend/src/tests/contract/inventory.test.ts"

# The following data models can be created simultaneously:
Task: "T017 [P] Create data model for users in backend/src/models/user.model.ts"
Task: "T018 [P] Create data model for products in backend/src/models/product.model.ts"
Task: "T019 [P] Create data model for inventory_items in backend/src/models/inventory-item.model.ts"
```
