# Frontend Test Coverage Plan

## 1. Analysis Summary
The frontend codebase has significant gaps in test coverage (`~16%`), particularly in critical user flows, offline capabilities, and core business logic.

**High Risk Areas Identified:**
*   **Offline Functionality**: `src/lib/offline-sync.ts` has 0% coverage. This is critical for a PWA.
*   **Scanning Flow**: `src/components/CameraScanner.tsx` (0%) and `src/pages/ScanPage.tsx` (21%) are the core feature set.
*   **Application Root**: `src/App.tsx` (0%) handles authentication state and routing.
*   **Data Handling Pages**: CSV Upload and Report pages have zero or very low coverage.

## 2. Prioritized Testing Plan
We will classify files into three priorities based on risk and business value.

### Priority 1: Critical Core & Logic (Immediate Value)
These areas manage data integrity, offline capability, or the primary user workflow.

| File | Context | Strategy | Success Criteria |
| :--- | :--- | :--- | :--- |
| `src/lib/offline-sync.ts` | Handles data syncing when the app comes back online. High risk of data loss. | Unit tests mocking `localStorage` and `fetch`. Simulating online/offline events. | Verify that operations queued offline are executed exactly once when online. |
| `src/components/CameraScanner.tsx` | Core feature. Wraps QuaggaJS. | Component tests mocking QuaggaJS. | ensure `Quagga.init` is called, errors are handled, and `onDetected` callback fires on success. |
| `src/lib/utils.ts` | Shared utilities used everywhere. | Pure Unit tests. | 100% coverage on all helper functions. |

### Priority 2: Key User Flows (High Value)
These areas represent the main screens users interact with daily.

| File | Context | Strategy | Success Criteria |
| :--- | :--- | :--- | :--- |
| `src/pages/ScanPage.tsx` | Validates products and submits inventory items. | Integration tests rendering the page, mocking `CameraScanner` and API. | Verify product lookup displays data, and valid scans call the `addItem` API. |
| `src/pages/CSVUploadPage.tsx` | Batch data entry. Complex validation and file parsing. | Integration tests with mock file objects. | Verify file selection triggers parsing, invalid rows show errors, valid rows call upload API. |
| `src/App.tsx` | App shell, Authentication, Routing. | Integration tests ensuring protected routes redirect to login, and public routes render. | Verify "Manager" role can see protected routes vs "Team Member". |

### Priority 3: Reporting & Edge Cases (Medium Value)
Reporting logic is complex but readonly (less risk of data corruption).

| File | Context | Strategy | Success Criteria |
| :--- | :--- | :--- | :--- |
| `src/components/MarkdownCalculator.tsx` | Logic for pricing. | Unit/Component tests with various price inputs. | Check rounding logic and calculation accuracy. |
| `src/pages/DetailedExpiryReportPage.tsx` | Read-only report. | Snapshot/Render tests. | Ensure filters (date range, category) trigger new API calls. |

## 3. Testing Standards
To avoid "coverage for coverage sake," we will adhere to these rules:

1.  **Do Not Test UI Libraries**: We assume Shadcn/UI components work. Only test *our customizations* or *wrappers* around them.
2.  **Mock External Services**: QuaggaJS (Scanner) and `fetch`/axios must always be mocked.
3.  **Focus on Behavior**: Test "User clicks save -> API called -> Success message shown". Do not test "State variable X is set to Y".

## 4. Next Steps
1.  **Skeleton Setup**: Ensure `mockServiceWorker` or Jest mocks are ready for the Offline Sync service.
2.  **Execute P1 Tests**: Start with `offline-sync.ts` and `CameraScanner.tsx`.
3.  **Review**: Re-run coverage to verify impact.
