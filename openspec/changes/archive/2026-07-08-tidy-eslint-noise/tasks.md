## 1. Baseline and Scope

- [x] 1.1 Capture root, frontend, and backend lint baselines by rule and top file.
- [x] 1.2 Review existing lint config and relevant Agentlens module memory before edits.

## 2. Root Lint Noise

- [x] 2.1 Exclude non-runtime local tooling/reference folders from root lint.
- [x] 2.2 Add Vitest-aware globals for frontend tests in root flat config without weakening production lint rules.
- [x] 2.3 Verify root lint no longer reports irrelevant `.windsurf` diagnostics or test-global false positives.

## 3. Backend Warnings

- [x] 3.1 Remove unused backend imports and rename intentionally unused Express parameters with `_` prefixes.
- [x] 3.2 Replace backend `any` warnings with concrete narrow types or `unknown` plus narrowing.
- [x] 3.3 Verify backend lint and backend build; `test:backend:diff` is blocked by existing CSV parser integration failures.

## 4. Frontend Warnings

- [x] 4.1 Replace frontend test/mocking `any` warnings with concrete helper types or safer `unknown` handling.
- [x] 4.2 Prefer Testing Library accessible queries over direct container/node access where practical.
- [x] 4.3 Remove unused frontend test values and non-null assertions.
- [x] 4.4 Verify frontend lint, changed frontend tests, and frontend build.

## 5. Final Verification

- [x] 5.1 Run final root lint and OpenSpec validation.
- [x] 5.2 Record the lint-cleanup pattern in project memory.
