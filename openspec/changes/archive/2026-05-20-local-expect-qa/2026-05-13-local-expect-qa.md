# Local Expect QA Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make local Expect browser QA repeatable with a working backend, real Clerk auth, visible role/bootstrap diagnostics, and documented Stripe test setup.

**Architecture:** Keep Clerk as the primary auth source. Add an explicitly enabled, non-production QA diagnostics panel to the existing app shell that reports current frontend auth context and backend bootstrap results for Expect assertions. Document startup and Stripe setup instead of adding a frontend Clerk bypass.

**Tech Stack:** React/CRA, Clerk React SDK, Express backend, OpenSpec, Stripe CLI, Expect MCP browser QA.

---

### Task 1: Add Dev-Only QA Diagnostics

**Files:**
- Modify: `frontend/src/App.tsx`
- Test: `frontend/src/App.test.tsx`

**Steps:**

1. Add failing tests proving diagnostics are hidden by default and visible when `REACT_APP_EXPECT_QA_STATUS=true`.
2. Render a stable diagnostics region only when the flag is true and `NODE_ENV !== 'production'`.
3. Include auth state, frontend role, bootstrap role, org ID, token presence, and API base URL.
4. Verify with `npm test -- --runTestsByPath src/App.test.tsx --watchAll=false --runInBand`.

### Task 2: Document Operator Setup

**Files:**
- Create: `docs/local-expect-qa.md`

**Steps:**

1. Document backend and frontend startup commands.
2. Document real Clerk admin/member user setup and why this is preferred over bypass.
3. Document Stripe CLI commands to list/create recurring prices and map returned IDs to env vars.
4. Document backend `TEST_AUTH_BYPASS` as a fallback only for non-auth checks.

### Task 3: Validate

**Commands:**
- `npm test -- --runTestsByPath src/App.test.tsx --watchAll=false --runInBand`
- `npm run lint --prefix frontend`
- `openspec validate local-expect-qa --strict`
