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
import { TIMING_CONSTANTS } from '../config/handheld'; // ✓ Import config constants (fixes 17.9)

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

          // Trigger haptic feedback on successful scan using config constant (fixes 17.9)
          triggerHaptic(TIMING_CONSTANTS.HAPTIC_DURATION_MS);

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
