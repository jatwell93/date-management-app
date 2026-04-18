# Handheld UI Components Guide

This document provides usage examples and best practices for the handheld UI components used in the date-management pharmacy application.

## Overview

The handheld UI components are designed specifically for pharmacy PDT (Portable Data Terminal) devices with 5" screens, portrait orientation, and touch-based interaction. These components work alongside the handheld detection context to automatically adapt the UI when deployed to handheld devices.

## Components

### 1. HandheldScanner

**Location:** `frontend/src/components/HandheldScanner.tsx`

A full-screen camera scanner optimized for handheld PDT devices. This component wraps the base `Scanner` component and automatically defaults to camera mode on handheld devices.

#### Props

```typescript
interface HandheldScannerProps {
  onScan: (result: HardwareScanResult) => void;
  defaultMode?: 'camera' | 'text';
  continuous?: boolean;
  disabled?: boolean;
  showToolbar?: boolean;
  syncStatus?: SyncStatus;
  onSyncNow?: () => void;
  className?: string;
}
```

#### Usage Example

```tsx
import { HandheldScanner } from '../components/HandheldScanner';

export function ScanPage() {
  const handleBarcodeScan = (result: HardwareScanResult) => {
    console.log(`Scanned: ${result.barcode} at ${result.timestamp}`);
    // Process barcode...
  };

  return (
    <HandheldLayout>
      <HandheldScanner onScan={handleBarcodeScan} continuous={true} disabled={false} />
    </HandheldLayout>
  );
}
```

#### Key Features

- **Automatic Mode Selection:** Defaults to camera mode on handheld devices, text mode on desktop
- **Full-Screen Layout:** Maximizes the 5" screen real estate for scanning
- **Touch Optimization:** Supports hardware scanner input via keyboard emulation (Zebra DataWedge, CipherLab)
- **HardwareScanResult Support:** Receives barcode data with timestamp and source information

#### Hardware Scanner Integration

The HandheldScanner component receives input from hardware barcode scanners configured for keyboard emulation:

- **Zebra TC21-HC/TC26-HC with DataWedge:** Emulates keyboard input
- **CipherLab RS36/RK25 with ReaderConfig:** Emulates keyboard or Intent-based delivery
- **Desktop Testing:** Use the desktop Scanner's manual input or camera for simulation

### 2. HandheldScanToolbar

**Location:** `frontend/src/components/HandheldScanToolbar.tsx`

A floating bottom toolbar for handheld scan pages. Displays sync status, current user, and sync strategy controls.

#### Props

```typescript
interface HandheldScanToolbarProps {
  userName: string;
  syncStatus: SyncStatus; // 'synching' | 'synced' | 'offline' | 'failed'
  onSyncNow: () => void;
  onSettingsClick: () => void;
  queueLength: number;
}
```

#### Usage Example

```tsx
import { HandheldScanToolbar } from '../components/HandheldScanToolbar';

export function ScanPage() {
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('synced');
  const [queueLength, setQueueLength] = useState(0);

  const handleSettings = () => {
    // Navigate to settings or dashboard
  };

  const handleSyncNow = () => {
    setSyncStatus('synching');
    // Perform sync operation...
    setSyncStatus('synced');
  };

  return (
    <div>
      <HandheldScanToolbar
        userName="John Pharmacist"
        syncStatus={syncStatus}
        onSyncNow={handleSyncNow}
        onSettingsClick={handleSettings}
        queueLength={queueLength}
      />
      {/* Scan content */}
    </div>
  );
}
```

#### Key Features

- **Floating Bottom Position:** Always accessible, doesn't obscure scanning area
- **Sync Status Indicator:** Color-coded status (blue = syncing, green = synced, yellow = offline, red = failed)
- **Sync Strategy Selector:** Choose between real-time, batch (10 min), or manual sync
- **Disabled Sync Button:** Button is disabled when queue is empty (`queueLength === 0`)
- **Settings Access:** Quick access to settings/dashboard via gear icon
- **Touch-Optimized:** All buttons have 44px+ minimum height and width

#### Sync Status Colors

| Status    | Color  | Meaning                             |
| --------- | ------ | ----------------------------------- |
| `syncing` | Blue   | Currently synchronizing with server |
| `synced`  | Green  | All data synchronized successfully  |
| `offline` | Yellow | Device is offline, data queued      |
| `failed`  | Red    | Sync operation failed               |

### 3. HandheldLayout

**Location:** `frontend/src/layouts/HandheldLayout.tsx`

A layout wrapper that conditionally renders handheld or desktop interfaces. Automatically detects the device type and applies appropriate styling.

#### Props

```typescript
interface HandheldLayoutProps {
  children: React.ReactNode;
  userName?: string;
  syncStatus?: SyncStatus;
  onSyncNow?: () => void;
  onSettingsClick?: () => void;
  queueLength?: number;
}
```

#### Usage Example

```tsx
import { HandheldLayout } from '../layouts/HandheldLayout';
import { ScanPage } from './ScanPage';

export function App() {
  return (
    <HandheldLayout
      userName="John Pharmacist"
      syncStatus="synced"
      onSyncNow={handleSync}
      onSettingsClick={handleSettings}
      queueLength={0}
    >
      <ScanPage />
    </HandheldLayout>
  );
}
```

#### Key Features

- **Conditional Rendering:** Shows HandheldScanToolbar on handheld devices only
- **Full-Screen Layout:** On handheld, covers entire viewport (h-screen, flex-1 overflow-auto)
- **Desktop Compatibility:** On desktop, applies normal max-width container and padding
- **Context-Driven:** Uses `useHandheldDetectionContext()` to determine device type
- **Responsive:** Adjusts layout based on device capabilities

#### Layout Structure (Handheld Mode)

```
┌─────────────────────────────┐
│                             │
│   Main Content Area         │
│   (flex-1 overflow-auto)    │
│                             │
├─────────────────────────────┤
│ User | Sync Status | ⚙️     │
│ [Sync Strategy] [Sync Now] │  ← HandheldScanToolbar
└─────────────────────────────┘
```

## GS1 Barcode Support

Handheld components support GS1 barcode parsing for automatic data population:

### GS1 Format

```
(01)12345678901231(17)250131(10)BATCH001(21)SERIAL123
```

- `(01)`: GTIN (Global Trade Item Number) - 14 digits
- `(17)`: Expiry Date - YYMMDD format (e.g., 250131 = Jan 31, 2025)
- `(10)`: Batch Number - alphanumeric
- `(21)`: Serial Number - alphanumeric

### Auto-Population Example

```tsx
export function ScanPage() {
  const handleBarcodeScan = (result: HardwareScanResult) => {
    const parsed = parseGS1Barcode(result.barcode);

    if (parsed) {
      // Auto-populate form fields
      setGtin(parsed.gtin);
      setExpiryDate(formatDate(parsed.expiryDate)); // "2025-01-31"
      setBatchNumber(parsed.batchNumber);
      setSerialNumber(parsed.serialNumber);
    }
  };

  return <HandheldScanner onScan={handleBarcodeScan} />;
}
```

## Testing Handheld Components

### In Development

All handheld components can be tested in a browser using the **HandheldContext mock**. The mock provides:

```typescript
const mockHandheldContext = {
  isHandheld: true, // Set to false for desktop mode
  syncStrategy: 'real-time',
  setSyncStrategy: jest.fn(),
  detectionResult: {
    userAgent: 'Mozilla/5.0 (Linux; Android...',
    deviceType: 'handheld',
  },
  hapticEnabled: true,
  audioFeedbackEnabled: true,
  setHapticEnabled: jest.fn(),
  setAudioFeedbackEnabled: jest.fn(),
  refreshDetection: jest.fn(),
};
```

### Test Fixtures

Test scanner mocks are provided in `frontend/src/pages/__tests__/ScanPage.test.tsx`:

- **Desktop Scanner Mock:** Emits plain barcodes via `HardwareScanResult`
- **HandheldScanner Mock:** Provides 3 triggers:
  - Default barcode: `{ barcode: '1234567890', ... }`
  - GS1 trigger: `{ barcode: '(01)12345678901231(17)250131', ... }`
  - Invalid trigger: `{ barcode: 'INVALID', ... }` (for error handling)

### Integration Test Example

```typescript
import { render, screen } from '@testing-library/react';
import { ScanPage } from '../ScanPage';
import { HandheldProvider } from '../contexts/HandheldContext';

describe('ScanPage Handheld Integration', () => {
  it('renders HandheldScanner when in handheld mode', () => {
    render(
      <HandheldProvider value={{ isHandheld: true }}>
        <ScanPage />
      </HandheldProvider>
    );

    expect(screen.getByTestId('handheld-scanner')).toBeInTheDocument();
  });

  it('auto-populates expiry from GS1 barcode', async () => {
    render(
      <HandheldProvider value={{ isHandheld: true }}>
        <ScanPage />
      </HandheldProvider>
    );

    const gs1Button = screen.getByTestId('handheld-scan-gs1-trigger');
    fireEvent.click(gs1Button);

    // Expiry field should be auto-populated
    const expiryField = screen.getByDisplayValue('2025-01-31');
    expect(expiryField).toBeInTheDocument();
  });
});
```

## Best Practices

### 1. Always Use HandheldLayout as Top-Level Wrapper

Ensures handheld detection and toolbar are available throughout the app:

```tsx
<HandheldLayout userName={currentUser} syncStatus={status} ...>
  <Router>
    <Routes>
      <Route path="/scan" element={<ScanPage />} />
    </Routes>
  </Router>
</HandheldLayout>
```

### 2. Handle GS1 Parsing Errors

Always have a fallback when GS1 parsing fails:

```tsx
const handleBarcodeScan = (result: HardwareScanResult) => {
  const parsed = parseGS1Barcode(result.barcode);
  if (!parsed) {
    // Fall back to product lookup by plain barcode
    lookupProduct(result.barcode);
  }
};
```

### 3. Respect Offline State

Monitor network connectivity and display appropriate UI:

```tsx
const syncStatus = navigator.onLine ? 'synced' : 'offline';
```

### 4. Test on Multiple Screen Sizes

Test on actual 5" PDT devices or use device emulation:

- **Browser DevTools:** Emulate "Mobile" with 540x720 resolution
- **Actual Devices:** Test on Zebra TC21-HC, TC26-HC, CipherLab RS36, etc.

## Related Documentation

- [Accessibility Guidelines](./handheld-accessibility.md) - Touch target sizes, ARIA labels, color contrast
- [PWA Manifest Configuration](./handheld-pwa.md) - Manifest.json setup, orientation, start URL
- [Testing Guide](./handheld-testing.md) - Unit tests, integration tests, E2E test patterns
