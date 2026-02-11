/**
 * TypeScript interfaces and types for handheld device integration
 */

import { SyncStrategy } from '../config/handheld';

// Result of handheld device detection
export interface HandheldDetectionResult {
  isHandheld: boolean;
  method: 'override' | 'userAgent' | 'dimensions' | 'unknown';
  deviceType?: 'zebra' | 'honeywell' | 'cipherlab' | 'generic';
  screenWidth: number;
  screenHeight: number;
}

// Raw result from hardware barcode scanning
export interface HardwareScanResult {
  barcode: string;
  timestamp: number;
  source: 'hardware' | 'camera' | 'manual';
  confidence?: number; // For camera scans
}

// Parsed result from GS1-128 barcode
export interface GS1ParseResult {
  raw: string;
  gtin?: string; // Global Trade Item Number (01)
  batchLot?: string; // Batch or lot number (10)
  expiryDate?: string; // ISO date string (17) - converted from YYMMDD
  serialNumber?: string; // Serial number (21)
  isValid: boolean;
  errors: string[];
}

// Sync strategy configuration
export interface SyncStrategyConfig {
  strategy: SyncStrategy;
  intervalMs?: number; // For batch mode
  retryAttempts: number;
  retryDelayMs: number[];
}

// Context interface for handheld state management
export interface IHandheldContext {
  isHandheld: boolean;
  detectionResult: HandheldDetectionResult | null;
  syncStrategy: SyncStrategy;
  hapticEnabled: boolean;
  audioFeedbackEnabled: boolean;
  setSyncStrategy: (strategy: SyncStrategy) => void;
  setHapticEnabled: (enabled: boolean) => void;
  setAudioFeedbackEnabled: (enabled: boolean) => void;
  refreshDetection: () => void;
}

// Props for components that need handheld awareness
export interface HandheldAwareProps {
  isHandheld?: boolean;
  className?: string;
}

// Scanner component props
export interface ScannerProps extends HandheldAwareProps {
  onScan: (result: HardwareScanResult) => void;
  defaultMode?: 'text' | 'camera';
  continuous?: boolean;
  disabled?: boolean;
}

// Camera scanner specific props
export interface CameraScannerProps extends HandheldAwareProps {
  onDetected: (barcode: string, confidence?: number) => void;
  continuous?: boolean;
  constraints?: MediaStreamConstraints;
}

// Handheld scanner component props
export interface HandheldScannerProps extends ScannerProps {
  showToolbar?: boolean;
  syncStatus?: 'syncing' | 'synced' | 'offline' | 'failed';
  onSyncNow?: () => void;
}

// Layout component props
export interface HandheldLayoutProps {
  children: React.ReactNode;
  showToolbar?: boolean;
  toolbarContent?: React.ReactNode;
}

// Toolbar component props
export interface HandheldScanToolbarProps {
  userName?: string;
  syncStatus: 'syncing' | 'synced' | 'offline' | 'failed';
  syncStrategy: SyncStrategy;
  onSyncStrategyChange: (strategy: SyncStrategy) => void;
  onSyncNow: () => void;
  onSettingsClick: () => void;
  queueLength: number;
}

// Haptic feedback utility
export interface HapticOptions {
  duration?: number;
  pattern?: number[];
}

// Audio feedback utility
export interface AudioFeedbackOptions {
  enabled: boolean;
  volume?: number;
}

// Error types for handheld operations
export class HandheldError extends Error {
  constructor(
    message: string,
    public code: string,
    public recoverable: boolean = true,
  ) {
    super(message);
    this.name = 'HandheldError';
  }
}

export class GS1ParseError extends HandheldError {
  constructor(
    message: string,
    public rawBarcode: string,
  ) {
    super(message, 'GS1_PARSE_ERROR');
  }
}

export class HardwareScanError extends HandheldError {
  constructor(
    message: string,
    public source: string,
  ) {
    super(message, 'HARDWARE_SCAN_ERROR');
  }
}
