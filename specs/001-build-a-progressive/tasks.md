# Implementation Tasks: Progressive Web Application for Retail Inventory Date Management

**Branch**: `001-build-a-progressive` | **Date**: 2025-09-25 | **Spec**: [./spec.md](./spec.md) | **Plan**: [./plan.md](./plan.md)

## Phase 3: Task Generation

This document outlines the detailed tasks required to implement the Progressive Web Application for Retail Inventory Date Management, based on the refined specification and plan.

---

### Backend Development Tasks

#### User Management & Authentication (FR-013, FR-014, FR-015, FR-016)
- [x] **Task 3.1.1**: Implement user model and database interactions for `users` table (CRUD operations).
- [x] **Task 3.1.2**: Implement PIN hashing and verification logic in `auth.service.ts`.
- [x] **Task 3.1.3**: Create API endpoints for user login (`POST /auth/login`).
- [x] **Task 3.1.4**: Create API endpoints for user management (create, read, update, delete users: `POST /users`, `GET /users`, `GET /users/:id`, `PUT /users/:id`, `DELETE /users/:id`).
- [x] **Task 3.1.5**: Implement role-based access control (RBAC) middleware for user management endpoints (only Managers can access).
- [x] **Task 3.1.6**: Seed initial manager user account in the database for testing.
- [x] **Task 3.1.7**: Write unit tests for user service and integration tests for user management API endpoints.

#### Core Inventory Management
- [x] **Task 3.2.1**: Implement product model and database interactions for `products` table (CRUD operations).
- [x] **Task 3.2.2**: Create API endpoints for product management (create, read, update, delete products: `POST /products`, `GET /products`, `GET /products/:id`, `PUT /products/:id`, `DELETE /products/:id`).
- [x] **Task 3.2.3**: Implement inventory item model and database interactions for `inventory_items` table (CRUD operations).
- [x] **Task 3.2.4**: Create API endpoints for inventory item management (add, update expiry, update location: `POST /inventory-items`, `PUT /inventory-items/:id`).
- [x] **Task 3.2.5**: Implement store area model and database interactions for `store_areas` table (CRUD operations).
- [x] **Task 3.2.6**: Create API endpoints for store area management (create, read, update, delete store areas: `POST /store-areas`, `GET /store-areas`, `GET /store-areas/:id`, `PUT /store-areas/:id`, `DELETE /store-areas/:id`).
- [x] **Task 3.2.7**: Implement logic for automated markdown calculations (FR-003).
- [x] **Task 3.2.8**: Implement audit logging for all inventory changes (FR-008).
- [x] **Task 3.2.9**: Implement CSV upload and SQLite migration for product updates (FR-007, FR-011).
- [x] **Task 3.2.10**: Write unit and integration tests for core inventory management APIs.

#### Reporting & Analytics
- [x] **Task 3.3.1**: Implement logic for monthly expiry reports (FR-004).
- [x] **Task 3.3.2**: Create API endpoint for monthly expiry reports (`GET /reports/expiry`).
- [x] **Task 3.3.3**: Implement logic for basic analytics dashboard data (FR-005).
- [x] **Task 3.3.4**: Create API endpoints for analytics dashboard data (`GET /dashboard/analytics`).
- [x] **Task 3.3.5**: Implement logic for usage reports (FR-009).
- [x] **Task 3.3.6**: Create API endpoint for usage reports (`GET /reports/usage`).
- [x] **Task 3.3.7**: Write unit and integration tests for reporting and analytics APIs.

---

### Frontend Development Tasks

#### Authentication & User Management (FR-013, FR-014, FR-015, FR-016)
- [x] **Task 3.4.1**: Update `LoginPage.tsx` to integrate with backend login API (`POST /auth/login`).
- [x] **Task 3.4.2**: Implement token storage (e.g., localStorage) and retrieval for authenticated sessions.
- [x] **Task 3.4.3**: Create a `UserManagementPage.tsx` component (for Managers only).
- [x] **Task 3.4.4**: Implement UI for creating new users (form with PIN, role selection).
- [x] **Task 3.4.5**: Implement UI for editing existing users (form with role, PIN reset).
- [x] **Task 3.4.6**: Implement UI for deleting users.
- [x] **Task 3.4.7**: Integrate `UserManagementPage.tsx` with backend user management APIs.
- [x] **Task 3.4.8**: Implement client-side role-based access control for navigation and UI elements.
- [x] **Task 3.4.9**: Write unit tests for `LoginPage.tsx` and `UserManagementPage.tsx`.

#### Core Inventory Features
- [x] **Task 3.5.1**: Develop mobile-first scanning interface in `ScanPage.tsx` (FR-001).
- [x] **Task 3.5.2**: Integrate `ScanPage.tsx` with backend product and inventory item APIs.
- [x] **Task 3.5.3**: Implement manual product addition for unknown barcodes (edge case).
- [x] **Task 3.5.4**: Develop UI for store area management (FR-002, FR-010).
- [x] **Task 3.5.5**: Integrate store area management UI with backend APIs.
- [x] **Task 3.5.6**: Implement simple markdown calculator (FR-012).
- [x] **Task 3.5.7**: Write unit tests for `ScanPage.tsx` and store area management components.

#### Reporting & Analytics
- [x] **Task 3.6.1**: Develop UI for monthly expiry reports in `ReportsPage.tsx` (FR-004).
- [x] **Task 3.6.2**: Integrate `ReportsPage.tsx` with backend reporting API.
- [x] **Task 3.6.3**: Develop UI for analytics dashboard in `DashboardPage.tsx` (FR-005).
- [x] **Task 3.6.4**: Integrate `DashboardPage.tsx` with backend analytics API.
- [x] **Task 3.6.5**: Develop UI for usage reports in `UsageReportPage.tsx` (FR-009).
- [x] **Task 3.6.6**: Integrate `UsageReportPage.tsx` with backend usage report API.
- [x] **Task 3.6.7**: Write unit tests for `ReportsPage.tsx`, `DashboardPage.tsx`, and `UsageReportPage.tsx`.

#### PWA & Offline Capabilities (FR-006)
- [x] **Task 3.7.1**: Configure service worker for offline asset caching.
- [x] **Task 3.7.2**: Implement IndexedDB or similar for offline data storage.
- [x] **Task 3.7.3**: Implement background synchronization logic for offline data.
- [x] **Task 3.7.4**: Handle offline data conflicts (last synced wins).
- [x] **Task 3.7.5**: Test offline functionality.

---

### General Tasks

- [x] **Task 3.8.1**: Review and update `quickstart.md` with instructions for setting up and running the application, including initial user setup.
- [x] **Task 3.8.2**: Perform end-to-end testing of all features.
- [x] **Task 3.8.3**: Address any remaining vulnerabilities reported by `npm audit` in both frontend and backend. (Note: Frontend has vulnerabilities that require `npm audit fix --force`, which may introduce breaking changes. Manual review recommended.)
- [x] **Task 3.8.4**: Ensure all code adheres to project conventions and style guides (linting, formatting).
- [x] **Task 3.8.5**: Update `README.md` with deployment instructions and any other relevant information. Information should be in depth and focused on lay people