## 1. Setup and Configuration

- [x] 1.1 Create `frontend/src/config/handheld.ts` with device detection patterns (Zebra, Honeywell, CipherLab UA strings), screen dimension thresholds, and config constants (keyboard wedge timing threshold: 50ms, dedup window: 2s, haptic duration: 50ms)
- [x] 1.2 Create `frontend/src/types/handheld.ts` with TypeScript interfaces: `HandheldDetectionResult`, `HardwareScanResult`, `GS1ParseResult`, `SyncStrategy`
- [x] 1.3 Create React Context for handheld detection state in `frontend/src/contexts/HandheldContext.tsx` with `IHandheldContext` and `useHandheldDetection` hook
- [x] 1.4 Create `frontend/src/lib/gs1-parser.ts` with pure function `parseGS1Barcode(barcode: string)` supporting AIs (01), (10), (17), (21) with unit tests

## 2. Device Detection Hook

- [x] 2.1 Implement `frontend/src/hooks/useHandheldDetection.ts` hook that:
  - Checks localStorage for `forceHandheld` override flag
  - Falls back to user agent pattern matching (Zebra/Honeywell/CipherLab)
  - Falls back to screen dimension heuristic (≤600×800)
  - Returns `{ isHandheld: boolean }`
- [x] 2.2 Add `useHandheldDetection` hook provider wrapper to `App.tsx` context
- [x] 2.3 Write unit tests for detection hook covering all three detection methods (override, UA, dimensions)
- [x] 2.4 Add localStorage override via query param handler: `?forceHandheld=true` sets localStorage for testing on desktop

## 3. Hardware Barcode Input

- [x] 3.1 Implement `frontend/src/hooks/useHardwareScan.ts` hook that:
  - Listens for `keydown` events on the document
  - Accumulates keystroke characters within the 50ms timing window
  - Detects Enter key as end marker
  - Distinguishes from human typing by timing threshold (multiple keystrokes within 50ms = hardware scan)
  - Emits `onScan(barcode)` callback
  - **📚 Before starting:** Use refs to search for "React hooks state management keyboard events" and "Web API keydown event handling" for patterns
- [x] 3.2 Update `useHardwareScan` to handle GS1-128 barcodes by passing raw string to `parseGS1Barcode()`
- [x] 3.3 Write keyboard wedge input simulator test utility for unit testing hardware scan behavior
- [x] 3.4 Write unit tests for `useHardwareScan` covering:
  - Rapid keystroke assembly with 50ms threshold
  - Slow typing does NOT trigger hardware scan path
  - Enter key termination
  - GS1-128 barcode detection and parsing
  - Duplicate keystroke prevention (no double-submission on rapid Enter)
- [x] 3.5 Write unit tests for `parseGS1Barcode` with pharmacy barcode fixtures:
  - GTIN extraction from (01)
  - Batch/lot extraction from (10)
  - Expiry date extraction from (17) with YYMMDD → ISO date conversion
  - Serial number extraction from (21)
  - Non-GS1 fallback (returns raw barcode)
  - **📚 Before starting:** Use refs to search for "GS1-128 barcode application identifiers" and "Jest pure function testing patterns" for implementation and test examples

## 4. Component Updates: Camera and Scanner

- [x] 4.1 Update `frontend/src/components/CameraScanner.tsx`:
  - Add `continuous?: boolean` prop (defaults to false)
  - Change Quagga initialization to respect `continuous` prop (don't call `Quagga.stop()` after detection if continuous=true)
  - Add debounce utility to track recent barcode scans (last 2 seconds)
  - In continuous mode, skip submitting duplicate barcodes within 2-second window
  - Add barcode tracking for debugging (optional console logging for development)
  - **📚 Before starting:** Refer to existing CameraScanner implementation in codebase; use refs to search "Quagga barcode scanner configuration" if extending detection logic
- [x] 4.2 Update `frontend/src/components/Scanner.tsx`:
  - Add `defaultMode?: 'text' | 'camera'` prop (defaults to 'text')
  - Update `useHardwareScan` hook call to listen for hardware barcode input whenever component is mounted
  - Route hardware scan input through the same `onScan(barcode)` callback as camera and text input
  - Update JSX to respect `defaultMode` prop (show camera first if defaultMode='camera' on handheld)
- [x] 4.3 Write component tests for Scanner with mocked hardware scan events
  - **📚 Before starting:** Use refs to search "Jest React component testing mocking keyboard events" for mock patterns
- [x] 4.4 Update existing `CameraScanner.test.tsx` to cover continuous mode scenarios
  - **📚 Before starting:** Use refs to search "Jest React component snapshot testing" for testing video/camera components
- [x] 4.5 Update existing `Scanner.test.tsx` to cover handheld mode rendering with hardware input
  - **📚 Before starting:** Use refs to search "React Testing Library conditional rendering" for handheld detection mocking patterns

## 5. Handheld UI Components

- [ ] 5.1 Create `frontend/src/components/HandheldScanner.tsx` that wraps `Scanner` with:
  - `defaultMode='camera'` on handheld devices
  - Larger button styling (48px+ touch targets)
  - Full-screen scan area override
  - Removal of secondary features (manual entry toggle is less prominent)
- [ ] 5.2 Create `frontend/src/components/HandheldScanToolbar.tsx` with:
  - Current user display
  - Floating sync status indicator (bottom-right: "Syncing...", "Synced", "Offline", "Sync Failed")
  - "Sync Now" button (disabled when queue empty)
  - Settings gear icon for accessing other pages (dashboard, reports, etc.)
  - Sync strategy selector (real-time, batch 10-min, manual)
- [ ] 5.3 Create `frontend/src/layouts/HandheldLayout.tsx` that:
  - Replaces the full navigation bar with `HandheldScanToolbar`
  - Sets main content to full viewport height
  - Wraps children with full-screen layout (no max-width container on PDT)
- [ ] 5.4 Write component tests for HandheldScanner, HandheldScanToolbar, HandheldLayout with handheld detection mocked

## 6. Handheld Styling

- [ ] 6.1 Create `frontend/src/styles/handheld.css` with media queries for:
  - Small screens: `@media (max-width: 600px) and (max-height: 900px)`
  - Base font size increased to 16px (from default 14px)
  - Button minimum size 48×48 px with adequate padding
  - Input fields minimum height 44px (exceeds 48px but ensures readability)
  - Card padding/margins slightly tighter to maximize vertical space (12px instead of 16px)
  - Form labels and help text slightly larger (14px, line-height 1.4)
- [ ] 6.2 Add CSS to hide non-essential UI on handheld (if `isHandheld` class on body):
  - Markdown calculator link (not a handheld workflow)
  - Reports dropdown (accessible via menu but not primary nav)
  - User management / store area links (hidden unless Manager, then in dropdown)
- [ ] 6.3 Add full-screen scan area CSS (height: 100vh - header height when in camera mode)
- [ ] 6.4 Import handheld.css in App.tsx or globals.css

## 7. Sync Strategy Implementation

- [ ] 7.1 Update `frontend/src/lib/offline-sync.ts` to add `SyncStrategy` type and class:
  - Add `currentStrategy: 'real-time' | 'batch' | 'manual'` property
  - Add `setSyncStrategy(strategy)` method to change strategies at runtime
  - Persist selected strategy in localStorage
  - **📚 Before starting:** Use refs to search "localforage API configuration" and "exponential backoff retry pattern JavaScript" for storage and retry logic examples
- [ ] 7.2 Modify sync interval logic:
  - Real-time: trigger `performSync()` directly after each `onScan()` success
  - Batch: change interval from 30s to 600s (10 minutes)
  - Manual: disable automatic interval, only sync on `performSync()` call
- [ ] 7.3 Add exponential backoff retry logic to `performSync()`:
  - On first failure, retry in 5 seconds
  - On second failure, retry in 10 seconds
  - On third failure, retry in 20 seconds
  - If all three fail, retain items in queue and wait for next sync cycle
- [ ] 7.4 Update offline sync manager to call `setSyncStrategy()` when handheld context changes
- [ ] 7.5 In `ScanPage.tsx`, detect sync strategy changes and update the manager
- [ ] 7.6 Write unit tests for offline sync strategies: real-time immediate sync, batch interval accumulation, manual trigger

## 8. ScanPage Integration

- [ ] 8.1 Update `frontend/src/pages/ScanPage.tsx`:
  - Detect `isHandheld` from context at top of component
  - Conditionally render `HandheldScanner` instead of `Scanner` when `isHandheld=true`
  - Auto-populate expiry date field if GS1 parse result contains `expiryDate`
  - Display sync strategy selector and "Sync Now" button in toolbar (mobile/handheld) or sidebar (desktop)
- [ ] 8.2 Update `ScanPage` to pass parsed GS1 data to product lookup and inventory creation
- [ ] 8.3 Update error handling to display friendly messages on 5" screens (or scroll error message into view)

## 9. App.tsx Integration

- [ ] 9.1 Wrap `App.tsx` main content with `HandheldLayout` when `isHandheld=true`
- [ ] 9.2 Update default route on app init: if `isHandheld=true`, redirect `/` to `/scan`
- [ ] 9.3 Ensure handheld detection context provider wraps entire Router tree
- [ ] 9.4 Update `manifest.json`:
  - Consider setting `start_url: "/scan"` for handheld "Add to Home Screen" installs (optional based on open question #1)
  - Ensure `display: "standalone"` and `orientation: "portrait"` are set

## 10. Haptic Feedback

- [ ] 10.1 Create `frontend/src/lib/haptic.ts` utility:
  - Export `triggerHaptic(durationMs: number = 50)` function
  - Use Vibration API if available: `navigator.vibrate(durationMs)`
  - Gracefully handle devices without Vibration API (try-catch, no console errors)
- [ ] 10.2 Call `triggerHaptic()` in `useHardwareScan` hook on successful barcode assembly (after Enter detected)
- [ ] 10.3 Call `triggerHaptic()` in `CameraScanner` on successful barcode detection (when `onDetected` fires)
- [ ] 10.4 Add unit tests for haptic utility (mock Vibration API)

## 11. Testing and Validation

- [ ] 11.1 Run `npm test` with coverage to verify:
  - **📚 Reference:** Use refs to search "Jest coverage configuration" and "React PWA testing patterns" for testing best practices
  - Device detection hook coverage >90%
  - Hardware scan hook coverage >90%
  - GS1 parser coverage >95%
  - Offline sync strategy coverage >85%
  - New components coverage >80%
- [ ] 11.2 Update `frontend/src/tests/ScanPage.test.tsx` to mock handheld detection and test both camera and handheld rendering
- [ ] 11.3 Create `frontend/src/tests/useHardwareScan.test.ts` for keyboard wedge event simulation
- [ ] 11.4 Create `frontend/src/tests/gs1-parser.test.ts` with pharmacy barcode fixtures
- [ ] 11.5 Create `frontend/src/tests/useHandheldDetection.test.ts` for all detection methods
- [ ] 11.6 Create `frontend/src/tests/offline-sync-strategy.test.ts` for real-time/batch/manual modes
- [ ] 11.7 Run UBS scan on new/modified frontend code: `ubs frontend/src/`
- [ ] 11.8 Run linter: `npm run lint` and fix any issues

## 12. PWA Configuration

- [ ] 12.1 Verify `frontend/public/manifest.json` has:
  - `"display": "standalone"`
  - `"orientation": "portrait"`
  - `"start_url": "/"` (or `/scan` if answering open question #1)
- [ ] 12.2 Test PWA "Add to Home Screen" flow on a real Android device (or Android emulator with Chrome)
- [ ] 12.3 Verify service worker caching includes new handheld.css and component bundles

## 13. Documentation and Config Guides

- [ ] 13.1 Create `docs/handheld-devices.md` with per-vendor configuration guides:
  - **Zebra TC21-HC**: DataWedge config steps (keyboard wedge mode, standard format), troubleshooting
  - **Honeywell CT45 XP**: Honeywell Settings app config steps, troubleshooting
  - **CipherLab RS36**: CipherLab Reader Config steps, troubleshooting
- [ ] 13.2 Create `docs/handheld-debug-guide.md` with:
  - How to enable debug mode (`localStorage.setItem('forceHandheld', 'true')`)
  - Test scan diagnostic page (displays raw keyboard events for troubleshooting)
  - How to inspect browser network timing for sync performance
- [ ] 13.3 Update `frontend/README.md` with handheld PWA setup instructions
- [ ] 13.4 Create troubleshooting section in docs for common issues:
  - Keyboard wedge not working (device config required)
  - Duplicate scans (timing threshold may need adjustment)
  - GS1 separator characters stripped (document fallback behavior)

## 14. Pharmacy A Pilot Testing (Week 4)

- [ ] 14.1 Schedule 1-2 hour session at Pharmacy A during low-traffic period
- [ ] 14.2 Create test account with Manager role for pilot pharmacy
- [ ] 14.3 Prepare test barcodes: 5-10 EAN-13 codes for common pharmacy items + 5-10 GS1-128 pharmaceutical barcodes
- [ ] 14.4 **Morning Setup (30 min):**
  - Log into app on Zebra TC21-HC device
  - Verify handheld UI layout and button responsiveness
  - Test barcode scanner permission grant
  - Confirm WiFi connection and initial sync
- [ ] 14.5 **Basic Scanning (1 hour):**
  - Scan 20 product barcodes
  - Verify correct product lookup for each
  - Monitor sync timing (target: <2s per scan in real-time mode)
  - Check battery impact (observe drain rate over 60 min)
  - Test low-light scanning (pharmacy areas with varied lighting)
- [ ] 14.6 **GS1-128 Expiry Testing (30 min):**
  - Scan 5 pharmaceutical barcodes with GS1-128 format
  - Verify expiry date is auto-populated in the form field
  - Confirm batch/lot number is captured (if required by Pharmacy A workflow)
- [ ] 14.7 **Offline Scenario (30 min):**
  - Disconnect WiFi, perform 5 scans offline
  - Verify data persists in IndexedDB
  - Reconnect WiFi and verify sync completes
  - Test manual "Sync Now" button
- [ ] 14.8 **Performance Observations (ongoing):**
  - Measure battery drain: expected 20-30% over 2 hours
  - Measure sync time per item: target <2s in real-time mode
  - Note any keyboard wedge reliability issues (missed characters, phantom scans)
  - Observe staff interaction with 48px+ buttons (gloved hand usability)
- [ ] 14.9 **Post-Pilot Debrief:**
  - Gather informal feedback from 1-2 pharmacy staff
  - Document any UX issues or feature requests
  - Plan iteration or refinements for Phase 1B (optional)

## 15. Post-MVP Optional Features (Defer to Phase 1B+)

- [ ] 15.1 Audio feedback on scan events (requires Web Audio API or pre-recorded audio files)
- [ ] 15.2 Feature gating: Gate `pdt_scanning` behind Premium/Concierge tier using backend feature-gate middleware
- [ ] 15.3 `deviceId` field on inventory items for audit/fleet analytics (requires backend schema change)
- [ ] 15.4 Vendor SDK integration for advanced hardware control (Zebra Enterprise Browser, Honeywell Mobility SDK, CipherLab HTML5 API)
- [ ] 15.5 WebSocket bridge for bi-directional hardware communication (aimer, illumination, symbology config)
- [ ] 15.6 NFC/RFID scanning support (future pharmacy use cases)

## 16. Deployment Checklist

- [ ] 16.1 All tests passing: `npm run test:coverage` with >80% coverage on new code
- [ ] 16.2 Linter clean: `npm run lint` exit code 0
- [ ] 16.3 UBS scan passed: `ubs frontend/src/` no CRITICAL findings
- [ ] 16.4 Build successful: `npm run build` exit code 0
- [ ] 16.5 Bundle size check: `npm run build` and verify no significant increase
- [ ] 16.6 Code review completed
- [ ] 16.7 Feature flag documented (if we end up gating PDT behind Premium tier)
- [ ] 16.8 README updated with handheld setup instructions
- [ ] 16.9 Branch pushed and PR created for review
- [ ] 16.10 Merged to main after approval

---

**Estimated Effort:** 120–160 hours (6–8 weeks for one developer)

**Critical Path Priority:** Setup → Detection → Hardware Input → Components → Styling → Sync Strategy → Pilot Testing

**Parallel work:** Can run in parallel with `plan-saas-monetization-model` (multi-tenant auth) and `use-cloudflare-r2-and-a-serverless-database` (R2/Neon/Workers) — PDT integration is frontend-scoped with no backend dependencies.
