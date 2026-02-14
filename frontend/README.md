# LLXPRT - Date Management Application (React Frontend)

This is a Progressive Web App (PWA) for pharmacy inventory date management and markdown tracking. The app is optimized for both desktop and handheld pharmacy PDT devices (Zebra TC21-HC, CipherLab RS36, etc.).

## Handheld PWA Setup (Android Pharmacy PDT Devices)

The application is a **Progressive Web App (PWA)** optimized for pharmacy handheld terminals (Zebra TC21-HC, Honeywell CT45 XP, CipherLab RS36, etc.). This section covers setup, configuration, and deployment to physical devices.

### Quick Setup: Add App to Home Screen

1. **On an Android device with Chrome or default browser:**
   - Navigate to the app URL: `https://app.example.com`
   - Tap the **three-dot menu** (top-right) > **"Add to Home Screen"**
   - Confirm the app name and icon
   - The app now appears as a shortcut on your home screen

2. **Launch as standalone app:**
   - Tap the app icon on home screen
   - The app opens in **full-screen mode** (no browser address bar)
   - All offline features and barcode scanning work in standalone mode

### Testing on Desktop (Without Physical Device)

To test the handheld layout and functionality on a desktop:

```bash
# Start the development server
npm start

# In your browser, add the debug parameter:
http://localhost:3000/?forceHandheld=true
```

This forces the app into handheld mode with:
- Full-screen scanner interface
- Larger touch targets (48×48px minimum buttons)
- Handheld-specific toolbar with sync status
- Responsive layout optimized for 5" screens

### Device Hardware Setup

Before installing the app on a pharmacy device:

1. **WiFi Configuration:**
   - Connect the device to the pharmacy WiFi network
   - Verify connectivity: try opening any website in the browser
   - Most pharmacy networks require authentication—your IT team handles this setup

2. **Configure Device Barcode Scanner:**
   - Each device vendor (Zebra, Honeywell, CipherLab) has different setup steps
   - Follow the appropriate guide:
     - **[Zebra DataWedge Setup](../../docs/handheld-devices.md#zebra-tc21-hc--tc26-hc-datawedge)**
     - **[Honeywell Configuration](../../docs/handheld-devices.md#honeywell-ct45-xp-enterprise-mobility)**
     - **[CipherLab Reader Config](../../docs/handheld-devices.md#cipherlab-rs36-reader-config)**

3. **Enable App Permissions:**
   - When you first launch the app, it may request **Camera** permission (for optional QR code scanning)
   - Tap **Allow** to enable camera features
   - The app also requests **Storage** permission for offline data—tap **Allow**

### PWA Features: What Works Offline

The app includes full **offline support** via service worker:

- **Barcode scanning:** All scans are captured locally and queued
- **Product lookup:** Recent products cached in IndexedDB
- **Data persistence:** All scans persist until WiFi sync completes
- **Sync on reconnect:** When WiFi returns, scans automatically sync to the server
- **Manual sync:** Tap **Sync Now** button to trigger sync immediately

**Offline workflow:**
1. Scan barcodes while disconnected
2. App stores scans in local IndexedDB database
3. Sync status shows "Offline"
4. Reconnect to WiFi
5. Sync status changes to "Syncing..." then "Synced"
6. Data now appears in the cloud system

### Install the App on a Physical Device

**Step-by-step installation:**

1. **On the pharmacy device:**
   - Open **Chrome** or the default browser
   - Navigate to: `https://app.example.com` (your production domain)

2. **Add to home screen:**
   - Tap the **three-dot menu** icon
   - Tap **"Add to Home Screen"** (or **"Install app"** on newer Android)
   - Confirm the app name
   - Tap **"Install"**

3. **Verify installation:**
   - The app icon now appears on the home screen
   - Tap it to launch the app in full-screen standalone mode
   - You should see the handheld UI (large buttons, full-screen scanner)

### Configuration for Multiple Devices

If managing many devices (pharmacy chain with 10+ PDTs):

1. **Bulk app installation (MDM):**
   - Use your Mobile Device Management (MDM) platform to push the app to all devices
   - Devices receive the PWA app URL automatically
   - No manual installation required on each device

2. **Pre-configure WiFi:**
   - Your IT team configures WiFi network on devices before deployment
   - Devices connect automatically when powered on

3. **Test in staging first:**
   - Deploy to a test environment URL first (e.g., `https://staging.app.example.com`)
   - Test handheld features (barcode scanning, offline sync, GS1 parsing) with 1–2 devices
   - Once verified, switch all devices to production URL

### Troubleshooting Handheld Setup

| Issue | Solution |
|-------|----------|
| **App doesn't detect as handheld** | Make sure device screen is ≤600×800px, OR add `?forceHandheld=true` to URL |
| **Barcode scanning doesn't work** | Verify device scanner is configured (see device setup guide for Zebra/Honeywell/CipherLab) |
| **WiFi not working** | Ensure device WiFi is enabled and connected to pharmacy network; contact your IT support |
| **Can't add app to home screen** | Use Chrome (not default browser); ensure HTTPS is enabled on production URL |
| **Sync fails after scanning** | Check WiFi connectivity; verify your account is still logged in; try manual sync |
| **App is slow or freezing** | Restart device; clear browser cache (Settings > Apps > [Browser] > Storage > Clear Cache) |

---

## Handheld UI Components Documentation

The application includes specialized components for pharmacy PDT devices:

- **[Handheld Components Guide](../../docs/handheld-components.md)** - Usage examples for HandheldScanner, HandheldScanToolbar, and HandheldLayout
- **[Handheld Device Configuration](../../docs/handheld-devices.md)** - Per-vendor setup: Zebra DataWedge, Honeywell Settings, CipherLab Reader Config
- **[Handheld Debug Guide](../../docs/handheld-debug-guide.md)** - Troubleshooting barcode input, testing without hardware, keyboard event inspection
- **[Accessibility Guidelines](../../docs/handheld-accessibility.md)** - Touch target sizes, color contrast, keyboard navigation, screen reader support
- **[PWA Configuration](../../docs/handheld-pwa.md)** - Manifest.json setup, service worker, HTTPS deployment
- **[Testing Guide](../../docs/handheld-testing.md)** - Unit tests, integration tests, device emulation, actual hardware testing

## Quick Start

### Installation

```bash
cd frontend
npm install
```

### Development

```bash
npm start
```

Opens [http://localhost:3000](http://localhost:3000) with hot reload.

### Testing

```bash
# Run all tests
npm test

# Run with coverage
npm test -- --coverage

# Watch mode
npm test -- --watch

# Handheld component tests only
npm test -- --testPathPattern="ScanPage"
```

### Production Build

```bash
npm run build
```

Builds the app for production to the `build/` folder with optimizations.

## Project Structure

```
frontend/
├── src/
│   ├── components/
│   │   ├── HandheldScanner.tsx          # Full-screen camera scanner for PDT
│   │   ├── HandheldScanToolbar.tsx      # Floating sync/settings toolbar
│   │   ├── Scanner.tsx                  # Base scanner component
│   │   └── ...
│   ├── layouts/
│   │   └── HandheldLayout.tsx           # Conditional handheld/desktop layout
│   ├── pages/
│   │   ├── ScanPage.tsx                 # Primary scan workflow page
│   │   └── ...
│   ├── contexts/
│   │   └── HandheldContext.tsx          # Device detection context
│   ├── services/
│   │   ├── apiService.ts                # API client
│   │   └── ...
│   └── types/
│       └── handheld.ts                  # TypeScript interfaces
├── public/
│   ├── manifest.json                    # PWA manifest (portrait, standalone)
│   ├── index.html                       # HTML entry point
│   └── ...
├── package.json
└── README.md
```

## Available Scripts (CRA)

In the project directory, you can run:

### `npm start`

Runs the app in the development mode.\
Open [http://localhost:3000](http://localhost:3000) to view it in the browser.

The page will reload if you make edits.\
You will also see any lint errors in the console.

### `npm test`

Launches the test runner in the interactive watch mode.\
See the section about [running tests](https://facebook.github.io/create-react-app/docs/running-tests) for more information.

### `npm run build`

Builds the app for production to the `build` folder.\
It correctly bundles React in production mode and optimizes the build for the best performance.

The build is minified and the filenames include the hashes.\
Your app is ready to be deployed!

See the section about [deployment](https://facebook.github.io/create-react-app/docs/deployment) for more information.

### `npm run eject`

**Note: this is a one-way operation. Once you `eject`, you can’t go back!**

If you aren’t satisfied with the build tool and configuration choices, you can `eject` at any time. This command will remove the single build dependency from your project.

Instead, it will copy all the configuration files and the transitive dependencies (webpack, Babel, ESLint, etc) right into your project so you have full control over them. All of the commands except `eject` will still work, but they will point to the copied scripts so you can tweak them. At this point you’re on your own.

You don’t have to ever use `eject`. The curated feature set is suitable for small and middle deployments, and you shouldn’t feel obligated to use this feature. However we understand that this tool wouldn’t be useful if you couldn’t customize it when you are ready for it.

## Learn More

You can learn more in the [Create React App documentation](https://facebook.github.io/create-react-app/docs/getting-started).

To learn React, check out the [React documentation](https://reactjs.org/).
