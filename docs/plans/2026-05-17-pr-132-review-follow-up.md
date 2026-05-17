# PR 132 Review Follow-up Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Resolve all seven PR 132 review comments while promoting neutral and disabled button semantics into the shared frontend `Button` primitive.

**Architecture:** Keep the change inside the existing semantic-token system. Extend the shared `Button` variants so pages consume reusable neutral/disabled styles, then make narrow page/test/doc corrections for the remaining reviewer comments.

**Tech Stack:** React, TypeScript, Tailwind CSS, Jest, class-variance-authority

---

### Task 1: Add regression coverage for the reviewed behaviors

**Files:**
- Modify: `frontend/src/components/ui/__tests__/phase-two-semantic-ui.test.tsx`
- Modify: `frontend/src/tests/frontend-startup-scripts.test.ts`
- Modify: `frontend/src/pages/__tests__/phase-three-semantic-pages.test.ts`

**Steps:**
1. Add a failing shared-button test that expects reusable neutral styling and readable disabled styling.
2. Update the startup-script test to expect a cross-platform script shape.
3. Broaden the Phase 3 inventory guardrail so any lingering `inventory-` text fails, not only direct quoted `className` strings.
4. Run the focused tests and confirm they fail for the current implementation.

### Task 2: Promote safer shared button semantics

**Files:**
- Modify: `frontend/src/components/ui/button.tsx`
- Modify: `frontend/src/pages/DetailedExpiryReportPage.tsx`
- Modify: `frontend/src/pages/CSVUploadPage.tsx`

**Steps:**
1. Add a neutral semantic button variant to the shared primitive.
2. Ensure disabled button styling remains readable in light mode.
3. Replace ad hoc reviewed button classes with the shared variants in the affected pages.
4. Run the focused tests and confirm they pass.

### Task 3: Address the remaining reviewer comments

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/src/pages/UsageReportPage.tsx`
- Modify: `frontend/src/tailwind-output.css`

**Steps:**
1. Replace the Windows-only dev server script with `cross-env`.
2. Align the Items-by-User chart border token with its fill token.
3. Correct the generated stylesheet header comment so it describes output rather than input.
4. Rebuild Tailwind output if needed and keep generated artifacts consistent.

### Task 4: Verify and record

**Files:**
- Modify if needed: `openspec/changes/align-app-with-brand-guidelines/tasks.md`

**Steps:**
1. Run the focused frontend tests for the touched areas.
2. Run the relevant frontend lint/build or broader verification commands available in-repo.
3. Record any new reusable project memory from the fix.
4. Summarize which review threads were addressed and any follow-up decisions still open.
