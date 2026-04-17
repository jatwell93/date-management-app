## Context

The platform is a React (CRA) + Node.js/Express pharmacy inventory management PWA. Barcode scanning is implemented via Quagga.js in `CameraScanner.tsx`, wrapped by `Scanner.tsx` which toggles between text input and camera modes. `ScanPage.tsx` orchestrates product lookup, inventory creation, and offline save. Offline sync uses localforage (IndexedDB) with a 30-second polling interval in `offline-sync.ts` and a separate `sync-manager.ts` for pending inventory items.

The app is already PWA-capable with Workbox service worker, `manifest.json` (`display: standalone`, `orientation: portrait`), and API response caching. Auth uses JWT stored in localStorage.

PDT devices (Zebra TC21-HC, Honeywell CT45 XP, CipherLab RS36) run Android with Chrome browser. Their hardware scan engines deliver decoded barcode data to the active application via configurable output methods — the most universal being "keyboard wedge" mode, where the scanner emits rapid keystrokes followed by an Enter key. This requires zero native app installation and works in any browser.

Two parallel changes are active: `plan-saas-monetization-model` (multi-tenant auth + Stripe billing, 56/153 tasks) and `use-cloudflare-r2-and-a-serverless-database` (Cloudflare Workers + Neon + R2, 164/253 tasks). PDT integration is entirely frontend-scoped and has no blocking dependency on either.

## Goals / Non-Goals

**Goals:**

- Accept hardware barcode input from PDT scan engines via keyboard wedge without requiring native apps, WebSocket bridges, or vendor SDKs
- Provide a handheld-optimized UI that works on 5" rugged screens with gloved hands
- Parse GS1-128 pharmaceutical barcodes to auto-populate expiry dates from a single scan
- Support configurable sync strategies suited to pharmacy workflow patterns (real-time, batch, manual)
- Preserve the existing `onScan(barcode)` contract so all downstream logic (product lookup, inventory creation, offline save) works unchanged
- Run fully in parallel with SaaS monetization and Cloudflare R2 workstreams

**Non-Goals:**

- Native Android app or vendor-specific SDK integration (Zebra DataWedge Intent API, Honeywell Mobility SDK, CipherLab Reader API) — these require native bridges and are deferred to a future phase
- WebSocket bridge architecture — adds a native component on the device, maintenance overhead, and CSWSH security risks
- Industrial browser deployment (Zebra Enterprise Browser) — requires paid licenses and locks to a single vendor
- Backend API changes — PDT scans use the same endpoints as camera scans
- Multi-device session management or device fleet provisioning
- Barcode generation or label printing
- NFC/RFID scanning support

## Decisions

### Decision 1: Keyboard Wedge as Primary Input Method

**Choice:** Use keyboard wedge (DOM `keydown` events) as the sole hardware scan input method for MVP.

**Alternatives considered:**

- _WebSocket bridge_: Higher performance (real-time bidirectional control), but requires installing a native app on each device, introduces CSWSH security vulnerabilities, and adds ongoing maintenance burden.
- _Vendor SDKs (Zebra Enterprise Browser JS, Honeywell Mobility SDK for Web)_: Gives direct hardware control (aimer, illumination, symbology config), but locks to a specific vendor, requires paid licenses or custom firmware, and fragments the codebase.
- _Android Intent-based communication_: Highest performance on Android, but inaccessible from a standard browser — requires Enterprise Browser or native bridge.

**Rationale:** Keyboard wedge is universally supported across all three target vendors, works in standard Chrome on Android, requires zero installation, and is the recommended approach for web-app-first integrations. All target devices (Zebra DataWedge, Honeywell Settings, CipherLab Reader Config) support configuring their scan engines to output as keyboard wedge with Enter suffix. The tradeoff is no programmatic scanner control (trigger, aimer) — acceptable for MVP where the physical trigger button on the device initiates scans.

**Implementation:** A `useHardwareScan` hook listens for rapid keystroke sequences (`keydown` events) that accumulate characters within a timing window (<50ms between keystrokes) and submit on Enter. This distinguishes hardware scans from human typing. The hook emits the assembled barcode string via the same `onScan(barcode)` callback used by camera scanning.

### Decision 2: CSS Media Queries + Detection Hook (Not Separate App Build)

**Choice:** Use a `useHandheldDetection` hook plus CSS media queries to conditionally render handheld UI — not a separate build target, route tree, or subdomain.

**Alternatives considered:**

- _Separate `/handheld` route tree_: Clean separation, but duplicates route logic, requires maintaining two parallel UIs, and complicates shared state (auth, sync).
- _Separate build target_: Maximum optimization, but doubles CI/CD complexity and diverges codebases over time.
- _User agent detection only_: Simple, but unreliable as UA strings vary across Android versions and device firmware updates.

**Rationale:** A hook combining three signals — user agent patterns (Zebra/TC, Honeywell/CT, CipherLab), screen dimensions (width ≤600px, height ≤800px), and a `localStorage` override flag — provides reliable detection without build complexity. Components conditionally render handheld variants (larger buttons, full-screen scan area, simplified nav). CSS media queries handle the styling layer. The `isHandheld` flag is a React context value consumed throughout the component tree.

**Detection precedence:** `localStorage` manual override > user agent match > screen dimension heuristic. This ensures testing flexibility — developers can force handheld mode on any device via `localStorage.setItem('forceHandheld', 'true')` or query param `?handheld=true`.

### Decision 3: GS1-128 Parsing as a Pure Function

**Choice:** Implement GS1-128 Application Identifier parsing as a standalone pure function (`parseGS1Barcode`), not a class or external library.

**Alternatives considered:**

- _External library (gs1-barcode-parser-ts)_: Less code to maintain, but adds a dependency for a small, stable specification. GS1 AI parsing is a string-splitting algorithm.
- _Integrated into Scanner component_: Reduces import overhead, but violates SRP and makes the parser untestable in isolation.

**Rationale:** GS1-128 encoding uses well-defined Application Identifiers (AIs) with fixed or variable-length fields separated by FNC1/GS characters. The parsing logic is ~50 lines of code covering the pharmacy-relevant AIs: `(01)` GTIN-14, `(10)` batch/lot, `(17)` expiry date (YYMMDD), `(21)` serial number. A pure function is trivially unit-testable, has no dependencies, and can be reused anywhere in the codebase.

**Data flow:** Hardware scan → `useHardwareScan` hook → `parseGS1Barcode(rawString)` → returns `{ gtin?, batchLot?, expiryDate?, serialNumber?, rawBarcode }` → `ScanPage` uses `gtin` for product lookup and auto-populates `expiryDate` field if present.

### Decision 4: Sync Strategy as a Configuration Object

**Choice:** Extend `OfflineSyncService` with a `SyncStrategy` configuration that selects between real-time, batch (10-minute), and manual modes. The strategy is stored in `localStorage` and defaults to real-time for handheld sessions.

**Alternatives considered:**

- _New SyncService class for PDT_: Clean separation, but duplicates queue management, retry logic, and IndexedDB persistence that already exist in `OfflineSyncService`.
- _Fixed 10-minute interval for handheld_: Simpler, but doesn't serve the single-scan-at-a-time use case where immediate feedback is expected.

**Rationale:** The existing `OfflineSyncService` already has queue management, online/offline detection, and retry logic. Adding a strategy pattern avoids reimplementation. Real-time mode triggers `performSync()` directly after each scan. Batch mode changes the interval from 30s to 600s (10 minutes). Manual mode disables the interval timer and only syncs when the user taps "Sync Now". Strategy is switchable at runtime via a settings toggle in `HandheldScanToolbar`.

**Retry:** Exponential backoff at 5s, 10s, 20s (3 attempts) on failure, matching the existing `break`-on-failure pattern but adding delay between retries.

### Decision 5: Continuous Scan Mode via CameraScanner Prop Extension

**Choice:** Add a `continuous` boolean prop to `CameraScanner` and extend the `useHardwareScan` hook to support continuous listening. In continuous mode, the scanner does not stop after detection — it continues scanning and debounces duplicate barcodes within a 2-second window.

**Alternatives considered:**

- _Separate ContinuousScanner component_: Avoids modifying existing component, but duplicates 90% of `CameraScanner` code.
- _Always continuous on handheld_: Simpler, but confuses single-item workflows where the user expects the scanner to pause after each scan for data entry.

**Rationale:** Adding a prop keeps the component DRY and lets the existing ScanPage and HandheldScanner control the mode. Debounce prevents duplicate submissions when the same barcode is in the scan field. A 2-second window is sufficient — pharmacy barcodes are physically moved between scans, and hardware decoders typically won't re-fire on a stationary barcode.

### Decision 6: Handheld Layout as Wrapper Component

**Choice:** `HandheldLayout` wraps the existing route content when `isHandheld` is true, applied at the `App.tsx` level. It replaces the standard nav with a minimal header (current user, sync status, "Manual Entry" toggle) and sets full-height layout.

**Implementation in `App.tsx`:**

```js
const { isHandheld } = useHandheldDetection();
// Wraps <main> content — routes remain the same
{
  isHandheld ? (
    <HandheldLayout>{children}</HandheldLayout>
  ) : (
    <StandardLayout>{children}</StandardLayout>
  );
}
```

The nav is simplified to: scan page as primary, settings accessible via a gear icon, other pages reachable but not prominently linked. On PDTs, `/scan` is the 95%+ use case.

### Decision 7: No Backend Changes for MVP

**Choice:** PDT scans hit the existing `/products/by-barcode/:barcode` and `POST /inventory-items` endpoints unchanged. No `deviceId` field, no device-specific logging, no new API surface.

**Rationale:** The backend can't distinguish a PDT scan from a camera scan or manual text entry — they all result in the same barcode string and inventory item payload. Device-level audit logging (`deviceId`, `inputMethod`) adds value for fleet analytics but is not required for functional MVP. Deferring to a future phase keeps this change purely frontend-scoped.

## Risks / Trade-offs

**[Keyboard wedge timing sensitivity]** → The 50ms inter-keystroke threshold distinguishes hardware scans from human typing, but could misfire on very fast typists or slow Bluetooth connections. **Mitigation:** Make the timing threshold configurable via `handheld.ts` config. Test on actual hardware during Pharmacy A pilot. The threshold only applies when `isHandheld` is true, so standard users are unaffected.

**[Vendor-specific keyboard wedge configuration]** → Each vendor has different configuration tools (Zebra: DataWedge, Honeywell: Settings app, CipherLab: Reader Config). Misconfigured devices may send barcodes without Enter suffix, with wrong prefix/suffix, or in the wrong symbology mode. **Mitigation:** Create per-vendor configuration guides in `docs/handheld-devices.md` with screenshots. Include a "Test Scan" diagnostic page that displays raw input events for troubleshooting.

**[Android 14 intent delay on Zebra]** → Zebra devices on Android 14 exhibit a 500ms delay in DataWedge output due to OS-level intent processing changes. **Mitigation:** This only affects Intent-based output, not keyboard wedge output. If keyboard wedge is also affected, document the workaround (`sendOrderedBroadcast()`). Verify during Pharmacy A testing on TC21-HC firmware version.

**[GS1-128 separator character handling]** → Keyboard wedge mode may strip FNC1 / GS (ASCII 29) separator characters used in variable-length GS1-128 fields. **Mitigation:** Parse assuming both GS-separated and fixed-length formats. Test with Pharmacy A's actual medication barcodes to validate. If separators are stripped, fall back to fixed-length AI parsing which covers the primary AIs (01, 10, 17).

**[5" screen real estate]** → Product detail display, expiry date entry, and location selection are cramped on 720×1280 screens. **Mitigation:** Progressive disclosure — show product name and barcode immediately, expand details on tap. Place expiry date and location inputs below the fold. Test spacing during Pharmacy A pilot and iterate.

**[Battery drain from continuous scan mode]** → Continuous camera scanning is CPU-intensive; hardware scanning is negligible. Camera fallback in continuous mode could drain a non-PDT device quickly. **Mitigation:** Continuous mode is only available when `isHandheld` is true and defaults to off. For camera users, continuous mode is not exposed in the UI.

**[Parallel work coordination]** → The `plan-saas-monetization-model` change adds `organizationId` to all models and JWT payloads. If PDT code merges before multi-tenant auth, the JWT shape will change. **Mitigation:** PDT code only reads the token for API auth headers — it doesn't decode JWT fields. The `apiService.post()` / `apiService.get()` calls pass the token opaquely. No code change needed when multi-tenant JWT lands.

## Open Questions

1. **PWA manifest `start_url`** — Should we change `start_url` from `"/"` to `"/scan"` for all installs, or only for PDT "Add to Home Screen"? Changing it globally affects existing PWA users who may expect to land on dashboard.

2. **Feature gating** — Should PDT scanning be gated behind Premium/Concierge tiers from day one, or available to all tiers during pilot phase? The `feature-gate.middleware.ts` is ready on the backend, but gating a frontend-only feature requires a different mechanism (check tier in JWT + conditionally enable handheld mode).

3. **Audio feedback** — Which sounds for success/error? Should we use Web Audio API (fully custom) or pre-recorded audio files? Audio files are simpler but add to bundle size. Web Audio API is more flexible but harder to get right.

4. **Continuous scan deduplication scope** — Should the 2-second deduplication window be per-barcode or global? Per-barcode allows scanning different items in rapid succession. Global prevents all scans for 2 seconds. Per-barcode is better for mixed-item workflows but requires maintaining a small map of recent scans.
