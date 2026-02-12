/**
 * useHardwareScan Hook
 * Listens for keyboard wedge barcode input from PDT devices
 *
 * Hardware barcode scanners emit rapid keystroke sequences (multiple keys within ~50ms)
 * terminated by Enter. This hook distinguishes hardware scans from human typing based on
 * keystroke timing patterns.
 */

import { useEffect, useRef, useCallback } from 'react';
import { triggerHaptic } from '../lib/haptic';

interface UseHardwareScanOptions {
  timingThreshold?: number; // ms - max time between keystrokes for hardware scan detection
  debounceMs?: number; // ms - debounce time for Enter key to prevent double-submit
}

/**
 * Hook to detect and handle hardware barcode scanner input via keyboard wedge events
 *
 * @param onScan - Callback invoked with parsed barcode string when scan is detected
 * @param options - Configuration options for timing thresholds
 * @returns void
 *
 * Example:
 * ```tsx
 * const ScanComponent = () => {
 *   useHardwareScan((barcode) => {
 *     console.log('Scanned:', barcode);
 *   }, { timingThreshold: 50 });
 *   return <div>Scan barcode...</div>;
 * };
 * ```
 */
export function useHardwareScan(
  onScan: (barcode: string) => void,
  options: UseHardwareScanOptions = {},
): void {
  const { timingThreshold = 50, debounceMs = 100 } = options;

  // Refs to maintain state across renders
  const accumulatorRef = useRef<string>('');
  const lastKeystrokeTimeRef = useRef<number>(0);
  const isHardwareScanRef = useRef<boolean>(false);
  const lastEnterTimeRef = useRef<number>(0);

  // Handle keydown events from hardware scanners or manual input
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const key = event.key;
      const now = Date.now();

      // Handle Enter key as scan terminator
      if (key === 'Enter') {
        const timeSinceLastEnter = now - lastEnterTimeRef.current;

        // Debounce: ignore rapid Enter presses within debounceMs
        if (timeSinceLastEnter < debounceMs) {
          return;
        }

        lastEnterTimeRef.current = now;

        // If we accumulated characters in hardware scan mode, submit the barcode
        if (accumulatorRef.current.length > 0 && isHardwareScanRef.current) {
          const barcode = accumulatorRef.current;
          accumulatorRef.current = '';
          isHardwareScanRef.current = false;

          // Trigger haptic feedback on successful scan
          triggerHaptic(50);

          // Invoke callback with barcode
          // (GS1-128 parsing can be done in parent component as needed)
          onScan(barcode);
        }

        return;
      }

      // Check timing: hardware scans are rapid (multiple keys within ~50ms)
      const timeSinceLastKeystroke = now - lastKeystrokeTimeRef.current;
      lastKeystrokeTimeRef.current = now;

      // Ignore non-printable keys (Shift, Control, Alt, etc.)
      // Only accumulate single characters that form a barcode
      if (key.length === 1) {
        // Timing check: first keystroke or within threshold = hardware scan
        if (accumulatorRef.current.length === 0 || timeSinceLastKeystroke <= timingThreshold) {
          accumulatorRef.current += key;
          isHardwareScanRef.current = true;
        } else {
          // Gap > threshold = human typing, reset accumulator
          accumulatorRef.current = key;
          isHardwareScanRef.current = false;
        }
      }
    },
    [timingThreshold, debounceMs, onScan],
  );

  // Attach keydown listener on mount, remove on unmount
  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown]);
}
 * Custom hook for hardware barcode scanning via keyboard wedge
 * Detects rapid keystroke sequences typical of barcode scanners
 */

import { useEffect, useRef, useCallback } from 'react';
import { HardwareScanResult } from '../types/handheld';
import { TIMING_CONSTANTS, STORAGE_KEYS } from '../config/handheld';
import { parseGS1Barcode } from '../lib/gs1-parser';

interface UseHardwareScanOptions {
  onScan: (result: HardwareScanResult) => void;
  enabled?: boolean;
  minLength?: number;
  maxLength?: number;
}

interface UseHardwareScanResult {
  isListening: boolean;
  clearBuffer: () => void;
  lastScan: HardwareScanResult | null;
}

// Storage key for tracking last scan to prevent duplicates
const LAST_SCAN_KEY = STORAGE_KEYS.LAST_BARCODE;

export const useHardwareScan = ({
  onScan,
  enabled = true,
  minLength = 3,
  maxLength = 100,
}: UseHardwareScanOptions): UseHardwareScanResult => {
  const bufferRef = useRef<string>('');
  const lastKeyTimeRef = useRef<number>(0);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastScanRef = useRef<HardwareScanResult | null>(null);

  // Clear the current buffer and timeout
  const clearBuffer = useCallback(() => {
    bufferRef.current = '';
    lastKeyTimeRef.current = 0;
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  // Process completed scan
  const processScan = useCallback(
    (barcode: string) => {
      if (!barcode || barcode.length < minLength || barcode.length > maxLength) {
        clearBuffer();
        return;
      }

      // Check for duplicate scans within dedup window
      const now = Date.now();
      const lastScanTime = lastScanRef.current?.timestamp || 0;
      if (
        now - lastScanTime < TIMING_CONSTANTS.DEDUP_WINDOW_MS &&
        lastScanRef.current?.barcode === barcode
      ) {
        clearBuffer();
        return;
      }

      // Parse GS1 barcode if applicable
      const gs1Result = parseGS1Barcode(barcode);

      const scanResult: HardwareScanResult = {
        barcode,
        timestamp: now,
        source: 'hardware',
        // Include GS1 data if parsed successfully
        ...(gs1Result.isValid && {
          gs1Data: gs1Result,
        }),
      };

      lastScanRef.current = scanResult;

      // Store last barcode for dedup
      try {
        localStorage.setItem(
          LAST_SCAN_KEY,
          JSON.stringify({
            barcode,
            timestamp: now,
          }),
        );
      } catch (error) {
        // Ignore localStorage errors (e.g., quota exceeded)
        console.warn('Failed to store last scan in localStorage:', error);
      }

      onScan(scanResult);
      clearBuffer();
    },
    [onScan, minLength, maxLength, clearBuffer],
  );

  // Handle keydown events
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!enabled) return;

      const now = Date.now();
      const timeSinceLastKey = now - lastKeyTimeRef.current;

      // If this is the first key or within the hardware scan threshold
      if (
        lastKeyTimeRef.current === 0 ||
        timeSinceLastKey <= TIMING_CONSTANTS.KEYBOARD_WEDGE_THRESHOLD_MS
      ) {
        // Handle special keys
        if (event.key === 'Enter') {
          // Enter key marks end of barcode
          if (bufferRef.current.length >= minLength) {
            processScan(bufferRef.current);
          } else {
            clearBuffer();
          }
          return;
        }

        // Only add printable characters
        if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
          bufferRef.current += event.key;
          lastKeyTimeRef.current = now;

          // Clear any existing timeout
          if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
          }

          // Set timeout to process scan if no more keys come in
          timeoutRef.current = setTimeout(() => {
            if (bufferRef.current.length >= minLength) {
              processScan(bufferRef.current);
            } else {
              clearBuffer();
            }
          }, TIMING_CONSTANTS.KEYBOARD_WEDGE_THRESHOLD_MS + 10);
        }
      } else {
        // Time gap too large - this is likely human typing, clear buffer
        clearBuffer();
      }
    },
    [enabled, minLength, processScan, clearBuffer],
  );

  // Set up event listeners
  useEffect(() => {
    if (!enabled) return;

    document.addEventListener('keydown', handleKeyDown, true);

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      clearBuffer();
    };
  }, [enabled, handleKeyDown, clearBuffer]);

  // Load last scan from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(LAST_SCAN_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.barcode && parsed.timestamp) {
          lastScanRef.current = {
            barcode: parsed.barcode,
            timestamp: parsed.timestamp,
            source: 'hardware',
          };
        }
      }
    } catch (error) {
      // Ignore localStorage errors
      console.warn('Failed to load last scan from localStorage:', error);
    }
  }, []);

  return {
    isListening: enabled,
    clearBuffer,
    lastScan: lastScanRef.current,
  };
};
