# PWA Manifest Configuration for Handheld Deployment

This document explains the PWA manifest configuration for deploying the date-management app to pharmacy handheld devices.

## Overview

The Progressive Web App (PWA) manifest (`public/manifest.json`) defines how the app appears when installed as a standalone PWA on PDT devices. Proper configuration ensures:

- Correct orientation (portrait)
- Proper display mode (standalone, full-screen)
- Correct start URL for handheld deployment
- App icons on home screen
- Offline capability

## Current Manifest Configuration

### Location

```
frontend/public/manifest.json
```

### Current Settings

```json
{
  "short_name": "DateManager",
  "name": "LLXPRT - Date Management Application",
  "icons": [
    {
      "src": "favicon.ico",
      "sizes": "64x64 32x32 24x24 16x16",
      "type": "image/x-icon"
    },
    {
      "src": "logo192.png",
      "type": "image/png",
      "sizes": "192x192",
      "purpose": "any maskable"
    },
    {
      "src": "logo512.png",
      "type": "image/png",
      "sizes": "512x512",
      "purpose": "any maskable"
    }
  ],
  "start_url": "/",
  "display": "standalone",
  "theme_color": "#000000",
  "background_color": "#ffffff",
  "description": "Progressive Web Application for retail store inventory date management and markdown tracking",
  "lang": "en",
  "dir": "ltr",
  "categories": ["productivity", "utilities"],
  "orientation": "portrait"
}
```

## Configuration Details

### Required Handheld Settings

#### 1. Orientation: Portrait Only

```json
"orientation": "portrait"
```

✅ **Why:** Pharmacy PDT devices operate in portrait mode only (5" screens). Lock to prevent rotation.

#### 2. Display: Standalone

```json
"display": "standalone"
```

✅ **Why:** Hides browser UI (address bar, tabs), maximizes screen real estate for scanning.

**Display Options:**

- `standalone` → Full-screen, no browser UI (✅ Recommended)
- `fullscreen` → True full-screen (not recommended, less control)
- `minimal-ui` → Shows minimal browser controls
- `browser` → Normal browser window

#### 3. Start URL Configuration

```json
"start_url": "/"
```

**Current:** Desktop-optimized (`/` shows dashboard)

**For Handheld Deployment:** Consider setting to:

```json
"start_url": "/scan"
```

✅ **Why:** Pharmacy staff primarily use the scan page. Redirecting to `/scan` on app launch improves UX.

**Implementation:**

```tsx
// frontend/src/App.tsx
useEffect(() => {
  const { isHandheld } = useHandheldDetectionContext();

  if (isHandheld && location.pathname === '/') {
    navigate('/scan');
  }
}, [isHandheld]);
```

#### 4. Theme Color

```json
"theme_color": "#000000"
```

This sets the status bar color on Android home screen. Choose colors that match pharmacy branding:

```json
"theme_color": "#1e40af"      // Blue
"theme_color": "#059669"      // Green (pharmacy)
"theme_color": "#dc2626"      // Red (alert)
```

#### 5. Background Color

```json
"background_color": "#ffffff"
```

This is displayed while the app loads. Match to your splash screen or primary background.

## Icon Configuration

### Icon Requirements for Handheld

Icons must be:

1. **Square** (192×192, 512×512)
2. **PNG format**
3. **Transparent background** (or opaque)
4. **"maskable" purpose** for adaptive icons (Android)

### Icon Sizes

```json
{
  "src": "logo192.png",
  "type": "image/png",
  "sizes": "192x192",
  "purpose": "any maskable"
},
{
  "src": "logo512.png",
  "type": "image/png",
  "sizes": "512x512",
  "purpose": "any maskable"
}
```

- `192×192` → Used for home screen icons (most Android devices)
- `512×512` → Used for splash screens, app stores
- `purpose: "maskable"` → Android adaptive icon support (icon may be cropped)

### Generate Icons

```bash
# Example: Create 192×192 icon
convert original-logo.png -resize 192x192 logo192.png
convert original-logo.png -resize 512x512 logo512.png
```

## Short Name vs Full Name

```json
"short_name": "DateManager",           // Max 12 chars - home screen label
"name": "LLXPRT - Date Management..."  // Full name - splash screen
```

✅ **Note:** On 5" screens with low pixel density, keep `short_name` to 8-10 characters.

## Service Worker Integration

### Offline PWA Support

PWAs require a service worker for offline capability:

```tsx
// frontend/src/index.tsx
import { serviceWorkerRegistration } from './serviceWorkerRegistration';

// Register service worker for offline support
serviceWorkerRegistration.register();
```

### Service Worker Setup

```typescript
// frontend/src/service-worker.ts
self.addEventListener('install', (event) => {
  // Cache app shell
  const CACHE_NAME = 'llxprt-v1';
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll([
        '/',
        '/index.html',
        '/static/js/main.js',
        '/static/css/main.css',
        // ... other critical files
      ]);
    }),
  );
});

self.addEventListener('fetch', (event) => {
  // Network first, fallback to cache
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});
```

## Deployment Checklist

### Before Deploying to Handheld Devices

- [ ] **Manifest valid:** Check with `npx audit-ci` or DevTools
- [ ] **Icons present:** 192×192 and 512×512 PNG files in `public/`
- [ ] **Service worker:** Registered and working offline
- [ ] **HTTPS only:** PWAs require HTTPS in production
- [ ] **Start URL:** Routes to `/scan` or dashboard based on device
- [ ] **Orientation:** Set to `portrait`
- [ ] **Display:** Set to `standalone`
- [ ] **Theme color:** Matches app branding
- [ ] **No address bar:** Browser UI hidden with `standalone` display

### Testing Installation

```bash
# Build production bundle
npm run build

# Serve locally with HTTPS (using ngrok or local https server)
npx http-server -p 443 -S build

# On Android device:
# 1. Open Chrome/Edge
# 2. Navigate to HTTPS URL
# 3. Menu (⋮) → "Install app"
# 4. Confirm installation
```

### Testing on Actual Devices

- **Zebra TC21-HC/TC26-HC:** Android 11+, Chrome/WebKit
- **CipherLab RS36/RK25:** Android 9+, WebKit browser
- **Desktop:** Chrome DevTools → Device Emulation (360×800)

## Web Manifest Specification

### Full Manifest Structure

```json
{
  "name": "Full app name",
  "short_name": "Short name",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "orientation": "portrait",
  "dir": "ltr",
  "lang": "en",
  "theme_color": "#000000",
  "background_color": "#ffffff",
  "description": "App description",
  "categories": ["productivity"],
  "screenshots": [
    {
      "src": "screenshot1.png",
      "sizes": "540x720",
      "type": "image/png",
      "form_factor": "narrow"
    }
  ],
  "icons": [
    {
      "src": "icon.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any maskable"
    }
  ]
}
```

### Optional Advanced Properties

```json
{
  "scope": "/",           // Limits app scope to this path
  "categories": ["productivity", "utilities"],
  "screenshots": [...],   // For Google Play Store
  "shortcuts": [          // Quick actions (Android 7.1+)
    {
      "name": "Start Scan",
      "short_name": "Scan",
      "description": "Quick access to scan page",
      "url": "/scan",
      "icons": [{ "src": "scan-icon.png", "sizes": "96x96" }]
    }
  ]
}
```

## Link to Manifest in HTML

```html
<!-- frontend/public/index.html -->
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="theme-color" content="#000000" />
  <meta name="description" content="PWA for retail pharmacy date management" />
  <link rel="manifest" href="%PUBLIC_URL%/manifest.json" />
  <link rel="apple-touch-icon" href="%PUBLIC_URL%/logo192.png" />
  <!-- Barcode Scanner Polyfill -->
  <script src="%PUBLIC_URL%/barcode-scanner-polyfill.js"></script>
</head>
```

## HTTPS Requirement

✅ **Critical:** PWAs only work over HTTPS (except localhost).

### Production Deployment

For pharmacy deployment, ensure:

1. **Server:** Apache, Nginx, or Cloud CDN
2. **TLS/SSL:** Valid HTTPS certificate
3. **HSTS:** Enable HTTP Strict-Transport-Security
4. **CSP:** Content Security Policy headers

### Example Nginx Configuration

```nginx
server {
  listen 443 ssl http2;
  server_name pharmacy-app.example.com;

  ssl_certificate /etc/ssl/certs/pharmacy-app.crt;
  ssl_certificate_key /etc/ssl/private/pharmacy-app.key;
  ssl_protocols TLSv1.2 TLSv1.3;

  add_header Strict-Transport-Security "max-age=31536000; includeSubDomains";
  add_header X-Content-Type-Options "nosniff";

  root /var/www/pharmacy-app/build;
  index index.html;

  location / {
    # Single Page App routing
    try_files $uri $uri/ /index.html;
  }

  # Service Worker (no caching)
  location /service-worker.js {
    add_header Cache-Control "no-cache, no-store, must-revalidate";
  }

  # Static assets (cache 1 year)
  location /static/ {
    add_header Cache-Control "public, immutable, max-age=31536000";
  }
}
```

## Debugging PWA Issues

### Chrome DevTools

```
DevTools → Application → Manifest
  • Check for validation errors
  • Verify icons are loading
  • Test offline functionality
```

### Common Issues

| Issue                           | Cause                         | Fix                                                   |
| ------------------------------- | ----------------------------- | ----------------------------------------------------- |
| "Add to Home Screen" missing    | Manifest not found            | `<link rel="manifest" href="/manifest.json">` in HTML |
| Icons don't appear              | Icon paths incorrect          | Check `src` path in manifest, ensure PNG is square    |
| App doesn't load offline        | Service worker not registered | Call `serviceWorkerRegistration.register()`           |
| Display still shows address bar | `display: "browser"`          | Change to `display: "standalone"`                     |
| Orientation keeps changing      | Not set in manifest           | Add `"orientation": "portrait"`                       |

### Test Manifest Validity

```bash
# Use WebManifest validator
npx web-manifest-validator public/manifest.json
```

## Related Configuration Files

- **Service Worker:** `frontend/src/service-worker.ts`
- **HTML Head:** `frontend/public/index.html`
- **App Context:** `frontend/src/contexts/HandheldContext.tsx` (sets `display: 'standalone'`)
- **Start URL Logic:** `frontend/src/App.tsx` (routes to `/scan` on handheld)

## References

- **Web App Manifest Spec:** https://w3c.github.io/manifest/
- **MDN PWA Guide:** https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/
- **Chrome PWA Checklist:** https://developers.google.com/web/progressive-web-apps/checklist
- **Android App Manifest:** https://developer.android.com/guide/topics/manifest/manifest-intro
