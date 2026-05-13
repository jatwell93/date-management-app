## 1. Proposal and Design

- [x] 1.1 Analyze existing auth, bootstrap, API, and billing configuration surfaces.
- [x] 1.2 Create OpenSpec proposal and task list for local Expect QA setup.
- [x] 1.3 Add implementation plan documentation.

## 2. Real-Clerk QA Diagnostics

- [x] 2.1 RED: Add App tests proving QA diagnostics are hidden by default.
- [x] 2.2 RED: Add App tests proving QA diagnostics show frontend role, backend bootstrap role, org ID, bootstrap status, token presence, and API base URL when enabled.
- [x] 2.3 GREEN: Add the dev-only QA diagnostics panel without changing auth behavior or bypassing Clerk.

## 3. Operator Workflow

- [x] 3.1 Document local backend/frontend startup commands.
- [x] 3.2 Document Clerk admin/member test-user requirements.
- [x] 3.3 Document Stripe CLI commands for finding/creating recurring test prices and mapping them to frontend/backend env vars.
- [x] 3.4 Document when backend `TEST_AUTH_BYPASS` is acceptable and when it is not.

## 4. QA and Validation

- [x] 4.1 Run targeted frontend tests for App QA diagnostics.
- [x] 4.2 Run lint/build as needed for changed frontend/docs surfaces.
- [x] 4.3 Run `openspec validate local-expect-qa --strict`.
- [x] 4.4 Present remaining manual setup steps for real Clerk users and Stripe secrets.
