# Technical Debt Remediation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduce production regressions by splitting the highest-risk backend flows into smaller, testable units while preserving the current route contracts and response shapes.

**Architecture:** Start with the worst CodeScene scores first: product import and CSV parsing, then webhook lifecycle handling, then excess-product export, then inventory hardening. Keep routes and external API responses stable while moving decision-making into services and helpers. Use short TDD loops so each slice can be verified in isolation before moving on.

**Tech Stack:** TypeScript, Express, Prisma, Jest, tsyringe, existing helper modules in `backend/src/services/`.

---

## Execution Order

1. Product import pipeline.
2. Webhook lifecycle.
3. Excess-product export.
4. Inventory hardening.
5. Focused verification and handoff.

---

### Task 1: Product Import Pipeline

**Files:**
- Modify: `backend/src/services/product.service.ts`
- Modify: `backend/src/services/csv-parser.service.ts`
- Modify: `backend/src/services/product-import.helpers.ts`
- Modify: `backend/src/services/expiry-import-date-parser.ts`
- Modify: `backend/src/tests/unit/product.service.test.ts`
- Modify: `backend/src/tests/unit/csv-parser.service.test.ts`
- Modify: `backend/src/tests/unit/product-import.helpers.test.ts`
- Modify: `backend/src/tests/integration/csv-parser.test.ts`

**Step 1: Write the failing test**

Add tests that lock down the current import contract before changing any logic. Cover malformed headers, missing required columns, duplicate SKU/barcode detection, expiry-row rejection, and parity between the CSV and XLSX paths. Use the existing fixtures in `backend/src/tests/fixtures/` so the tests describe real edge cases instead of synthetic happy paths.

**Step 2: Run test to verify it fails**

Run:

```bash
cd backend && npm test -- --runInBand src/tests/unit/product.service.test.ts src/tests/unit/csv-parser.service.test.ts src/tests/unit/product-import.helpers.test.ts src/tests/integration/csv-parser.test.ts
```

Expected: FAIL with assertion mismatches or missing helper behavior, not unrelated environment errors.

**Step 3: Write minimal implementation**

Move pure row normalization into `product-import.helpers.ts` and `expiry-import-date-parser.ts`. Keep `processCSVUploadInternal` and `processXLSXUpload` in `product.service.ts` as orchestration only: detect file format, call the parser, collect counts, and return the existing response shape. Shift row parsing and batch accounting branches out of the main service body and into `csv-parser.service.ts` where they can be tested directly.

**Step 4: Run test to verify it passes**

Run the same command again.

Expected: PASS with the import summary counts and error arrays unchanged.

**Step 5: Commit**

```bash
git add backend/src/services/product.service.ts backend/src/services/csv-parser.service.ts backend/src/services/product-import.helpers.ts backend/src/services/expiry-import-date-parser.ts backend/src/tests/unit/product.service.test.ts backend/src/tests/unit/csv-parser.service.test.ts backend/src/tests/unit/product-import.helpers.test.ts backend/src/tests/integration/csv-parser.test.ts
git commit -m "refactor: split product import parsing and batch orchestration"
```

---

### Task 2: Webhook Lifecycle

**Files:**
- Modify: `backend/src/services/webhook.service.ts`
- Modify: `backend/src/services/webhook-event-dispatcher.ts`
- Modify: `backend/src/services/webhook-subscription.helpers.ts`
- Modify: `backend/src/tests/unit/webhook.service.test.ts`
- Modify: `backend/src/tests/unit/webhook-event-dispatcher.test.ts`
- Modify: `backend/src/tests/integration/webhook.edge-cases.test.ts`

**Step 1: Write the failing test**

Add tests for the event families that keep regressing: subscription created, subscription deleted, payment success, payment failure, creation-lock handling, missing metadata, and duplicate event replay. The tests should prove that metadata validation, idempotency, and status transitions are still stable after the split.

**Step 2: Run test to verify it fails**

Run:

```bash
cd backend && npm test -- --runInBand src/tests/unit/webhook.service.test.ts src/tests/unit/webhook-event-dispatcher.test.ts src/tests/integration/webhook.edge-cases.test.ts
```

Expected: FAIL until the dispatcher and shared helpers are wired to the smaller handler functions.

**Step 3: Write minimal implementation**

Keep signature verification and request-context validation in `webhook.service.ts`, then hand the parsed event to `webhook-event-dispatcher.ts`. Split the event family logic so subscription state changes, payment state changes, and creation-lock behavior are independent branches. Reuse `webhook-subscription.helpers.ts` for shared transition and idempotency logic rather than duplicating transaction code in each handler.

**Step 4: Run test to verify it passes**

Run the same command again.

Expected: PASS with the same external webhook behavior and smaller function bodies.

**Step 5: Commit**

```bash
git add backend/src/services/webhook.service.ts backend/src/services/webhook-event-dispatcher.ts backend/src/services/webhook-subscription.helpers.ts backend/src/tests/unit/webhook.service.test.ts backend/src/tests/unit/webhook-event-dispatcher.test.ts backend/src/tests/integration/webhook.edge-cases.test.ts
git commit -m "refactor: split webhook event handling by responsibility"
```

---

### Task 3: Excess-Product Export

**Files:**
- Modify: `backend/src/controllers/product.controller.ts`
- Modify: `backend/src/services/product.service.ts`
- Modify: `backend/src/tests/unit/product.routes.test.ts`
- Modify: `backend/src/tests/unit/migrated-controllers.test.ts`
- Modify: `backend/src/tests/unit/product.service.test.ts`

**Step 1: Write the failing test**

Add test coverage for `exportExcess` across the three meaningful states: unlimited tier, within-limit tier, and over-limit tier. Check both response modes: JSON and CSV. The test should assert that the controller returns the same metadata and row shape as today while no longer needing to own the SKU-limit math itself.

**Step 2: Run test to verify it fails**

Run:

```bash
cd backend && npm test -- --runInBand src/tests/unit/product.routes.test.ts src/tests/unit/migrated-controllers.test.ts src/tests/unit/product.service.test.ts
```

Expected: FAIL until the export model is moved into the service boundary.

**Step 3: Write minimal implementation**

Move the SKU-limit, current-count, and excess-count calculations into `product.service.ts` and return a compact export view model. Keep the controller thin: resolve organization context, call the service, and serialize JSON or CSV using the existing CSV escaping utility. Do not change the external payload shape for unlimited, within-limit, or over-limit responses.

**Step 4: Run test to verify it passes**

Run the same command again.

Expected: PASS with unchanged response contracts and less controller logic.

**Step 5: Commit**

```bash
git add backend/src/controllers/product.controller.ts backend/src/services/product.service.ts backend/src/tests/unit/product.routes.test.ts backend/src/tests/unit/migrated-controllers.test.ts backend/src/tests/unit/product.service.test.ts
git commit -m "refactor: move excess product export logic into service"
```

---

### Task 4: Inventory Hardening

**Files:**
- Modify: `backend/src/services/inventory.service.ts`
- Modify: `backend/src/services/inventory-markdown.helpers.ts`
- Modify: `backend/src/tests/unit/inventory.service.test.ts`
- Modify: `backend/src/tests/unit/inventory-markdown.helpers.test.ts`
- Modify: `backend/src/tests/unit/inventory-markdown-consistency.test.ts`
- Modify: `backend/src/tests/contract/inventory.test.ts`

**Step 1: Write the failing test**

Add edge-case tests that pin down inventory update behavior and markdown boundary behavior. Include schema-drift coverage for the mapping path so a Prisma shape change is caught by the test/type-check loop instead of leaking into runtime. Keep the existing status mapping intact in the assertions.

**Step 2: Run test to verify it fails**

Run:

```bash
cd backend && npm test -- --runInBand src/tests/unit/inventory.service.test.ts src/tests/unit/inventory-markdown.helpers.test.ts src/tests/unit/inventory-markdown-consistency.test.ts src/tests/contract/inventory.test.ts
```

Then run:

```bash
cd backend && npm run type-check
```

Expected: FAIL until the `any` mapping is replaced and the helper boundaries are in place.

**Step 3: Write minimal implementation**

Replace the remaining `any`-typed Prisma mapping in `inventory.service.ts` with a concrete payload type or a guarded adapter type. Pull the markdown and update-condition branches into `inventory-markdown.helpers.ts` so the main update method becomes linear and easier to verify. Keep the existing error/status translation behavior unchanged.

**Step 4: Run test to verify it passes**

Run the same test command and the type-check command again.

Expected: PASS with no type errors and no status mapping regressions.

**Step 5: Commit**

```bash
git add backend/src/services/inventory.service.ts backend/src/services/inventory-markdown.helpers.ts backend/src/tests/unit/inventory.service.test.ts backend/src/tests/unit/inventory-markdown.helpers.test.ts backend/src/tests/unit/inventory-markdown-consistency.test.ts backend/src/tests/contract/inventory.test.ts
git commit -m "refactor: harden inventory mapping and markdown helpers"
```

---

### Task 5: Focused Verification and Handoff

**Files:**
- Review only: `backend/src/services/product.service.ts`
- Review only: `backend/src/services/webhook.service.ts`
- Review only: `backend/src/controllers/product.controller.ts`
- Review only: `backend/src/services/inventory.service.ts`

**Step 1: Run the focused backend slices**

Re-run the four targeted test commands above, one slice at a time. Keep the loops narrow so failures are attributable to the slice that changed.

**Step 2: Run lint and type-check**

Run:

```bash
cd backend && npm run lint
cd backend && npm run type-check
```

Expected: PASS for the touched backend slice.

**Step 3: Run OpenSpec validation**

Run:

```bash
openspec validate --all
```

Expected: the existing unrelated failure in `change/fix-launch-blockers` may still appear; do not widen scope to fix it unless this change set depends on it.

**Step 4: Handoff**

Document which slice changed, which targeted tests were run, and which helper modules were reused. If any one slice still fails its targeted tests after three iterations, stop and reassess the boundary instead of widening the refactor.

---

## Definition of Done

- Product import is split into smaller parsing and orchestration units, and the targeted tests prove CSV/XLSX parity.
- Webhook handling is split by event family, and replay/idempotency tests stay green.
- Excess-product export is moved out of controller-owned business logic.
- Inventory no longer uses the remaining `any` mapping path, and the type-check passes.
- Each slice has a narrow, passing test loop before the next slice starts.