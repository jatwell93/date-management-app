# Proposal: One active admin per organization

## Why

Until #474 the Worker decided "is this the first admin?" with a read followed by a write. Neon's
HTTP driver has no transaction, and two first sign-ins insert different `clerk_user_id` values that
contend on no common row, so both could read zero admins and both were stored as `admin`. Two paths
(`POST /api/users`, `PUT /api/users/:id`) also minted a second admin on purpose. Only the database
can close that race.

The reviewer decided on 2026-10-10 that one admin per organization is the model. The decision was
implemented across #605 (migration 0020 and the Clerk-driven writes) and #611 (the `/api/users`
gate) but never written into the specs, which still say `manager` is "dev-only until Clerk plan
upgrade" and that a manager has member management. Both statements are now false and one of them
described a takeover path (a manager demotes the sole admin through `PUT /api/users/:id`, then
promotes themselves into the freed slot).

This change records the implemented behaviour so the specs stop contradicting the code. No new
behaviour is introduced here.

## What changes

Spec deltas only:

- `organization-rbac-admin-manager-team-member`: `manager` is a production role (a second Clerk
  `org:admin` is stored as `manager`); user management through `/api/users` is admin-only; a new
  requirement states the one-active-admin invariant and how each path meets it.
- `clerk-org-first-login-bootstrap`: the first-login requirement now says what happens when the
  admin slot is taken, including under concurrent first sign-ins. It also drops the word
  "transactional": the Worker's Neon HTTP driver has no transaction, so the previous wording
  promised something the code never delivered, and the unique index is what actually guarantees
  the outcome.

## Scope

In scope: the two spec deltas above and a tasks file recording the implementing changes.

Out of scope:

- Any code change. Migration 0020, `resolveAdminSlotRole` / `withAdminSlotFallback` and the
  `canManageUsers` gate are already merged.
- An admin-transfer flow. Changing the admin today is a demote-then-promote done by the current
  admin, and the second step answers 409 until the first has happened.
- Re-granting admin to a zero-admin organization from the API. Recovery relies on the next Clerk
  membership event or a manual `UPDATE`.

## Implemented by

- #605: migration 0020 (`users_one_active_admin_per_org`), Clerk-driven fallback to `manager`,
  409 on the HTTP paths.
- #611: `/api/users` management gated to admin only; markdown configuration split to a separate
  admin-and-manager gate.
