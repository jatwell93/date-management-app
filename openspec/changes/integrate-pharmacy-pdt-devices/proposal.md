## Why

Our platform currently relies exclusively on camera-based barcode scanning via Quagga.js (640×480, software decoding) which achieves 95–98% detection rates with 1–3 second decode times per scan. Pharmacy operations using professional Portable Data Terminals (PDTs) from Zebra, Honeywell, and CipherLab demand 99.9% accuracy at <100ms decode times — a gap that camera scanning cannot close. Hardware scan engines use dedicated optics and ASICs that outperform software decoders in low light, at extreme angles, and on damaged barcodes commonly found on pharmaceutical vials.

Australian pharmacies processing hundreds of items per delivery need the throughput and reliability that only hardware PDTs provide. With our SaaS monetization model in progress and Cloudflare R2/Neon infrastructure maturing, now is the time to extend the platform for professional-grade hardware — differentiating our offering for the pharmacy vertical and enabling the Premium/Concierge tiers to include PDT support as a value-add feature.

## What Changes

- **Add hardware scan input pathway**: Detect when the app is running on a PDT device (Zebra TC21-HC, Honeywell CT45 XP, CipherLab RS36) and accept hardware-triggered barcode data via keyboard wedge events, replacing or supplementing camera scanning
- **Add handheld-optimized UI layer**: Layout and component adaptations for 5" rugged screens — 48px+ touch targets for gloved hands, full-screen scan area, simplified navigation, and floating sync status indicator
- **Add handheld device detection**: Runtime detection of PDT devices via user agent, screen dimensions, and manual override flag to switch between standard and handheld UX modes
- **Add configurable sync strategy for PDT workflows**: Extend existing 30-second sync interval with PDT-specific modes — real-time sync on individual scans, 10-minute batch sync for bulk sessions, and manual "Sync Now" for unreliable connectivity
- **Add GS1-128 barcode parsing**: Parse multi-field pharmaceutical barcodes containing GTIN (AI 01), batch/lot number (AI 10), and expiry date (AI 17) from a single scan, enabling automatic expiry date population
- **Add haptic and audio feedback**: Vibration and optional audio confirmation on successful scans for noisy pharmacy environments where visual feedback alone is insufficient
- **Add continuous scan mode**: Optional mode for stock audits where scanning does not pause after each detection — enabling rapid sequential scanning during bulk inventory operations
- **Retain camera fallback**: Existing Quagga.js camera scanning remains fully functional as the default and automatic fallback when hardware scanning is unavailable

## Capabilities

### New Capabilities

- `pdt-device-detection`: Runtime detection of PDT hardware via user agent fingerprinting, screen dimension analysis, and manual override. Determines whether to activate handheld-optimized UX and hardware scan input. Provides `isHandheld` flag consumed by layout and scanner components.
- `hardware-barcode-input`: Accept barcode data from PDT hardware scan engines delivered as keyboard wedge events (rapid keystroke sequences terminated by Enter). Supports EAN-13, Code 128, GS1-128, UPC-A/E, Code 39, and Codabar symbologies. Includes GS1-128 Application Identifier parsing to extract GTIN, batch, and expiry date fields.
- `handheld-scan-ux`: Handheld-optimized scan interface with full-screen scan area, 48px+ glove-friendly touch targets, simplified navigation, floating sync status, haptic/audio feedback on scan events, and continuous scan mode for bulk operations. Wraps existing Scanner interface so `onScan(barcode)` contract is preserved.
- `pdt-sync-strategy`: PDT-specific synchronization modes extending the existing offline sync infrastructure — real-time sync (immediate on scan), 10-minute batch sync (bulk sessions), and manual sync trigger. Configurable per session. Includes retry with exponential backoff (5s, 10s, 20s) and sync queue persistence in IndexedDB.

### Modified Capabilities

- `storage-abstraction-layer`: No requirement changes — PDT integration reuses existing offline storage (IndexedDB via localforage) without modification.
- `csv-upload-processing`: No requirement changes — PDT scanning feeds into existing inventory item creation flow, not CSV upload.

_(No existing spec requirements are changing. All PDT functionality is additive via new capabilities.)_

## Impact

**Frontend code:**
- `frontend/src/components/CameraScanner.tsx` — Parameterize resolution, add continuous scan mode prop
- `frontend/src/components/Scanner.tsx` — Add `defaultMode` prop, accept hardware keyboard wedge input
- `frontend/src/pages/ScanPage.tsx` — Swap to handheld scanner component when `isHandheld` detected
- `frontend/src/App.tsx` — Conditional handheld layout wrapper based on device detection
- New: `frontend/src/components/HandheldScanner.tsx` — Composition of Scanner + handheld tweaks
- New: `frontend/src/hooks/useHandheldDetection.ts` — Device detection hook
- New: `frontend/src/hooks/useHardwareScan.ts` — Keyboard wedge event listener hook
- New: `frontend/src/layouts/HandheldLayout.tsx` — Full-height simplified layout for 5" screens
- New: `frontend/src/config/handheld.ts` — Constants and detection helpers for PDT config
- New: `frontend/src/styles/handheld.css` — Media queries and overrides for rugged 5" displays

**Sync infrastructure:**
- `frontend/src/lib/offline-sync.ts` — Add configurable sync interval (PDT modes)
- `frontend/src/lib/sync-manager.ts` — Add PDT sync strategy configuration

**PWA manifest:**
- `frontend/public/manifest.json` — Consider `start_url: "/scan"` for PDT "Add to Home Screen" installs

**Backend:** No changes required. PDT scans flow through existing product lookup and inventory item creation endpoints. The `deviceId` field may be added to audit logs in a future phase.

**Dependencies:**
- No new npm packages required for MVP (keyboard wedge is native DOM events, GS1 parsing is custom)
- Quagga.js remains for camera fallback
- Future: Vendor SDKs (Zebra Enterprise Browser JS API, Honeywell Mobility SDK for Web, CipherLab HTML5 API) for advanced hardware control beyond keyboard wedge

**Parallel work with active specs:**
- `plan-saas-monetization-model`: PDT support can be **gated as a Premium/Concierge tier feature** using the feature-gate middleware (Phase 5, already complete). No blocking dependency — PDT work runs in parallel. Integration point: add `pdt_scanning` feature flag to `tier_feature_flags` seed data.
- `use-cloudflare-r2-and-a-serverless-database`: PDT integration is **entirely frontend-scoped** and does not touch storage abstraction, database layer, or Workers. Fully parallel. Both share the same backend API surface — PDT scans hit the same `/products/by-barcode/:barcode` and `/inventory-items` POST endpoints already deployed.

**Testing:**
- Unit tests for device detection hook, keyboard wedge hook, GS1 parser
- Component tests for HandheldScanner rendering and mode switching
- Integration tests at Pharmacy A on Zebra TC21-HC (baseline performance on real device)
- Update existing `ScanPage.test.tsx` and `Scanner.test.tsx` with handheld mode coverage

**Risks:**
- Keyboard wedge reliability varies by vendor configuration (DataWedge, Honeywell Settings) — mitigation: document required device configuration per vendor
- Android 14 intent delay (500ms) on newer Zebra devices — mitigation: recommend `sendOrderedBroadcast()` in device config
- 5" screen real estate constrains product detail display — mitigation: progressive disclosure, scroll-below-fold for secondary info
