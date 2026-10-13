# Tasks: One active admin per organization

> The behaviour is implemented and merged. This change records it in the specs.

## Phase 1 — Implementation (merged)

- [x] 1.1 Partial unique index `users_one_active_admin_per_org` on `users (organization_id)
      WHERE role = 'admin' AND deleted_at IS NULL` (migration 0020, #605).
- [x] 1.2 Clerk-driven grants (bootstrap and membership webhook) store `manager` when the slot is
      taken, including when a concurrent grant wins between the read and the write
      (`resolveAdminSlotRole`, `withAdminSlotFallback`, #605).
- [x] 1.3 `POST /api/users` and `PUT /api/users/:id` answer 409 when the slot is taken (#605).
- [x] 1.4 `/api/users` list, create, re-role and delete are admin-only; managers and team members
      get 403 and no database method is called (#611).
- [x] 1.5 Markdown configuration keeps an admin-and-manager gate (`canEditOrgSettings`, #611).
- [x] 1.6 Handler-level coverage for the `PUT /api/users/:id` error mapping (#613).

## Phase 2 — Specs

- [x] 2.1 Modify "Canonical organization role model" (`manager` is a production role; user
      management is admin-only).
- [x] 2.2 Add "At most one active admin per organization".
- [x] 2.3 Modify "First-login organization admin bootstrap" (slot taken, concurrent sign-ins).
- [x] 2.4 `openspec validate one-admin-per-organization --strict`.
