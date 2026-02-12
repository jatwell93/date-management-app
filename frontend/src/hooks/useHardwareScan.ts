/**
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
