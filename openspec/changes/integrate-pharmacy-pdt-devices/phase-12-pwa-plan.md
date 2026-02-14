# PLAN: Phase 12 - PWA Configuration for PDT Integration

**Change ID:** `integrate-pharmacy-pdt-devices`  
**Phase:** 12 - PWA Configuration  
**Status:** 📋 PLAN (Analysis Complete)  
**Date:** February 13, 2026

---

## Problem Statement

Phases 1-11 have implemented core PDT functionality. Phase 12 objective: **Configure Progressive Web App (PWA) settings** to enable "Add to Home Screen" installation on Android handheld devices (Zebra TC21-HC, Honeywell CT45 XP, CipherLab RS36) for offline use and standalone mode.

### Current State
- ✅ Haptic feedback implemented and tested (Phase 10)
- ✅ All components created and passing (Phases 1-10)
- ⏳ Testing deferred to post-integration (after Phase 14)
- ❌ PWA manifest not yet verified/configured
- ❌ Service worker caching not verified

### Target State (End of Phase 12)
- ✅ `manifest.json` configured with standalone display, portrait orientation, correct start URL
- ✅ Service worker caching strategy includes handheld-specific assets (handheld.css, component bundles)
- ✅ PWA installable on Android devices via "Add to Home Screen" prompt

---

## Analysis

### Reuse Strategy

**Existing PWA Infrastructure:**
1. Create React App (CRA) includes default service worker setup
2. `frontend/public/manifest.json` — file already exists (needs verification/update)
3. Service worker registration — handled by CRA's built-in `registerServiceWorker` if present
4. Workbox configuration — CRA v5+ uses Workbox under the hood with default caching

**Files to Check/Modify:**
- `frontend/public/manifest.json` — Verify/update 3 fields
- `frontend/public/index.html` — Verify PWA meta tags (likely already present)
- `frontend/src/index.css` or `global.css` — May need viewport adjustments (already done in Phase 6)
- Service worker — CRA handles this automatically; no code changes needed

**No New Files Required:**
- ❌ Don't create custom service worker (CRA manages this)
- ❌ Don't add Workbox config (CRA default is sufficient for MVP)
- ✅ Only modify manifest.json if needed

---

## Implementation Steps

### Step 1: Verify and Update `manifest.json` (Task 12.1)

**File:** `frontend/public/manifest.json`

**Current expected structure:**
```json
{
  "short_name": "Expiry Manager",
  "name": "Date Management for Pharmacy",
  "icons": [...],
  "start_url": "/",
  "display": "standalone",
  "scope": "/",
  "theme_color": "#000000",
  "background_color": "#ffffff"
}
```

**Required fields for PDT:**
1. ✅ `"display": "standalone"` — **Must be present** (fullscreen mode, no address bar)
2. ✅ `"orientation": "portrait"` — **Add if missing** (lock to portrait for 5" screens)
3. ✅ `"start_url": "/"` or `"/scan"` — **Verify correct** (open at /scan for handheld flow, / for desktop)

**Decision to make:**
- **Open question:** Should handheld installations open at `/` (dashboard) or `/scan` (scan page)?
  - **Recommended:** `/scan` for PDT devices (users launch app to scan immediately)
  - **Alternative:** `/` (users choose workflow via navigation)
  - **For now:** Keep as `/`, users can navigate to `/scan` from menu

**Action:** 
- Read manifest.json
- Add `"orientation": "portrait"` if missing
- Verify `"display": "standalone"` is present
- Optionally change `"start_url"` to `"/scan"` (can be tested with Pharmacy A pilot)

### Step 2: Verify PWA Meta Tags in index.html (Task 12.1b)

**File:** `frontend/public/index.html`

**Required tags (likely already present from CRA):**
```html
<!-- PWA Meta Tags -->
<meta name="theme-color" content="#000000" />
<meta name="description" content="Date Management for Pharmacy" />
<link rel="manifest" href="%PUBLIC_URL%/manifest.json" />
<link rel="apple-touch-icon" href="%PUBLIC_URL%/logo192.png" />
```

**Action:**
- Verify these tags exist in `<head>`
- No changes expected (CRA default includes these)

### Step 3: Verify Service Worker Registration (Task 12.1c)

**File:** `frontend/src/index.tsx` or `frontend/src/serviceWorkerRegistration.ts`

**Expected behavior:**
- CRA includes service worker registration by default
- On production builds, service worker is registered automatically
- On development (`npm start`), service worker is not registered (to avoid caching issues)

**Action:**
- Check `frontend/src/index.tsx` for `serviceWorker.register()` call
- If present, no changes needed
- If missing, add service worker registration (unlikely with CRA)

### Step 4: Test PWA Installation on Android (Task 12.2)

**Devices available:**
- Real Android device with Chrome browser (if available)
- Android emulator (API 30+, with Chrome app)

**Pre-requisite:** App must be served over HTTPS or localhost (PWA spec requirement)

**Installation steps on Android Chrome:**
1. Navigate to app URL: `http://localhost:3000` (dev) or production URL
2. Wait 3-5 seconds for "Add to Home Screen" prompt to appear (Chrome shows 3-dot menu if prompt doesn't auto-show)
3. Tap "Add to Home Screen" or menu option
4. Confirm installation
5. Launch app from home screen
6. Verify:
   - App runs in fullscreen (no address bar)
   - Portrait orientation is locked
   - "/" or "/scan" starts correctly
   - Navigation works (can still access other pages)

**Testing checklist:**
- [ ] PWA prompt appears (or accessible via menu)
- [ ] Installation completes
- [ ] App launches in standalone mode (no browser chrome)
- [ ] Orientation stays portrait (doesn't rotate to landscape)
- [ ] Navigation works after installation
- [ ] Offline assets load (service worker caching)

### Step 5: Verify Service Worker Caching Includes New Assets (Task 12.3)

**Service Worker Behavior:**
- CRA with Workbox automatically caches:
  - `*.js` bundles
  - `*.css` files
  - Images and fonts
  - `manifest.json`

**New Assets from Phase 1-11:**
- ✅ `frontend/src/styles/handheld.css` — automatically cached by Workbox
- ✅ React component bundles (`HandheldScanner.tsx`, etc.) — automatically cached
- ✅ `manifest.json` — automatically cached

**Action:**
- No code changes needed—Workbox handles this automatically
- On production build (`npm run build`), inspect `build/` folder to confirm CSS is bundled
- Optionally: run `npm run build` and check `build/static/css/` to verify handheld.css is included

**Verification command:**
```bash
npm run build
ls -la build/static/css/
# Should show compiled CSS files including handheld styles
```

---

## Task Breakdown

```
Phase 12: PWA Configuration (Tasks 12.1-12.3)

12.1 Verify and update manifest.json
   ├─ Read frontend/public/manifest.json
   ├─ Verify "display": "standalone" present
   ├─ Add "orientation": "portrait" if missing
   ├─ Verify "start_url": "/" (or update to "/scan")
   ├─ Verify PWA meta tags in index.html
   └─ Verify service worker registration
   Effort: 15 min

12.2 Test PWA "Add to Home Screen" on Android
   ├─ Install app on Android device (real or emulator)
   ├─ Verify fullscreen mode (no address bar)
   ├─ Verify portrait orientation locked
   ├─ Verify start_url opens correctly
   ├─ Test navigation within app
   └─ Document any issues
   Effort: 30 min (with Android device available)

12.3 Verify service worker caching
   ├─ Run npm run build
   ├─ Inspect build/static/css/ for handheld.css
   ├─ Verify new component bundles present
   └─ Optionally: test offline mode in DevTools
   Effort: 10 min

Total Estimated Effort: 55 minutes (~1 hour)
```

---

## Success Criteria

- ✅ `manifest.json` has `"display": "standalone"` and `"orientation": "portrait"`
- ✅ `"start_url"` verified (either `"/"` or `"/scan"`)
- ✅ PWA "Add to Home Screen" prompt appears on Android Chrome
- ✅ App installs and runs in fullscreen/standalone mode
- ✅ Portrait orientation locked on handheld
- ✅ Service worker caches new CSS and component bundles
- ✅ Ready for Phase 13 (Documentation)

---

## Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|-----------|
| No Android device available for testing | Medium | Use Android emulator (API 30+) or skip to Phase 13 (test with real device at Pharmacy A pilot) |
| PWA prompt doesn't appear | Low | Ensure app meets PWA criteria (manifest, meta tags, service worker) |
| Orientation lock doesn't work on certain devices | Low | Document as device-specific; test on target devices (Zebra, Honeywell) |
| Service worker caching fails | Low | CRA/Workbox handles this; no custom code needed |

---

## Next Phase Preview

**Phase 13 (Documentation and Config Guides):**
- Create per-vendor setup guides (Zebra DataWedge, Honeywell, CipherLab)
- Create handheld debug guide
- Update README with handheld PWA setup instructions

---

## Sign-Off

**Ready to Proceed?**
- [x] Analysis complete
- [x] Strategy validated  
- [x] Effort estimated at ~1 hour
- [ ] **User approval required** → Proceed to BUILD phase

Once approved, will execute tasks 12.1-12.3 systematically.
