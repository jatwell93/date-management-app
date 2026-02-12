## Why

The pharmacy PDT integration requires specialized UI components optimized for handheld devices (CipherLab RS36, Zebra TC21-HC) with 5" screens and touch interfaces. Current desktop-focused components are too large and complex for pharmacy workflows. This change creates handheld-optimized UI components that prioritize scanning workflows, provide appropriate touch targets (48px+), and include pharmacy-specific features like sync status indicators and floating toolbars.

## What Changes

- **New Component**: `HandheldScanner` - wraps Scanner with camera-first mode and full-screen scan area
- **New Component**: `HandheldScanToolbar` - floating toolbar with sync status, user display, and navigation
- **New Layout**: `HandheldLayout` - replaces navigation with HandheldScanToolbar and optimizes for vertical space
- **Enhanced Detection**: Conditional rendering based on `isHandheld` context from device detection
- **Touch Optimization**: 48px+ button sizes, full-screen layouts, and pharmacy workflow prioritization

## Capabilities

### New Capabilities
- `handheld-scanner-component`: Touch-optimized scanner component with camera-first mode for handheld devices
- `handheld-scan-toolbar`: Floating toolbar component with sync status, user display, and navigation controls
- `handheld-layout`: Layout component that replaces desktop navigation with handheld-optimized UI
- `handheld-conditional-rendering`: Logic for detecting handheld devices and rendering appropriate UI components

### Modified Capabilities
- No existing capabilities are modified - this introduces new handheld-specific UI components

## Impact

- **Frontend Components**: New React components in `src/components/` directory
- **Layout System**: Modified app layout logic to conditionally use HandheldLayout
- **Styling**: New CSS classes for handheld optimization (48px touch targets, full-screen layouts)
- **Device Detection**: Enhanced use of existing `useHandheldDetection` hook for UI rendering decisions
- **Testing**: New component tests for handheld-specific components and conditional rendering</content>
<parameter name="filePath">c:\Users\josha\date-management-app\openspec\changes\handheld-ui-components\proposal.md