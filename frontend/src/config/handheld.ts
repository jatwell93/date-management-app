/**
 * Handheld device configuration for pharmacy PDT integration
 * Contains device detection patterns, timing thresholds, and constants
 */

// Device detection patterns - User Agent strings for common pharmacy PDTs
export const DEVICE_PATTERNS = {
  // Zebra Android devices (TC21-HC, TC26-HC, etc.)
  ZEBRA: /Android.*TC\d+|Android.*ET\d+|Android.*MC\d+/i,

  // Honeywell Android devices (CT45 XP, CT60 XP, etc.)
  HONEYWELL: /Android.*CT\d+|Android.*Dolphin|Honeywell/i,

  // CipherLab Android devices (RS36, RK25, etc.)
  CIPHERLAB: /Android.*RS\d+|Android.*RK\d+|CipherLab/i,
} as const;

// Screen dimension thresholds for handheld detection
export const SCREEN_THRESHOLDS = {
  MAX_WIDTH: 600, // pixels
  MAX_HEIGHT: 900, // pixels
  MIN_RATIO: 0.5, // width/height ratio for portrait orientation
} as const;

// Timing and performance constants
export const TIMING_CONSTANTS = {
  // Keyboard wedge detection - multiple keystrokes within this window = hardware scan
  KEYBOARD_WEDGE_THRESHOLD_MS: 50,

  // Duplicate scan prevention - ignore same barcode within this window
  DEDUP_WINDOW_MS: 2000,

  // Haptic feedback duration
  HAPTIC_DURATION_MS: 50,

  // GS1 parsing timeout
  GS1_PARSE_TIMEOUT_MS: 100,
} as const;

// Local storage keys
export const STORAGE_KEYS = {
  FORCE_HANDHELD: 'forceHandheld',
  SYNC_STRATEGY: 'sync-strategy', // ✓ Fixed: matches test expectations and offline-sync.ts line 48
  LAST_BARCODE: 'lastBarcode',
} as const;

// Supported barcode symbologies for hardware scanning
export const SUPPORTED_SYMBOLOGIES = [
  'EAN-13',
  'Code 128',
  'GS1-128',
  'UPC-A',
  'UPC-E',
  'Code 39',
  'Codabar',
] as const;

// GS1 Application Identifiers we parse for pharmacy use
export const GS1_APPLICATION_IDENTIFIERS = {
  GTIN: '01', // Global Trade Item Number
  BATCH_LOT: '10', // Batch or lot number
  EXPIRY_DATE: '17', // Expiry date (YYMMDD format)
  SERIAL_NUMBER: '21', // Serial number
} as const;

// Sync strategy options
export const SYNC_STRATEGIES = {
  REAL_TIME: 'real-time',
  BATCH: 'batch',
  MANUAL: 'manual',
} as const;

export type SyncStrategy = (typeof SYNC_STRATEGIES)[keyof typeof SYNC_STRATEGIES];

// Default configuration values
export const DEFAULTS = {
  SYNC_STRATEGY: SYNC_STRATEGIES.REAL_TIME,
  HAPTIC_ENABLED: true,
  AUDIO_FEEDBACK_ENABLED: false,
} as const;
