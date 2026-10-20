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
import { MIN_HARDWARE_SCAN_LENGTH, TIMING_CONSTANTS } from '../config/handheld'; // ✓ Import config constants (fixes 17.9)

interface UseHardwareScanOptions {
  timingThreshold?: number; // ms - max time between keystrokes for hardware scan detection
  debounceMs?: number; // ms - debounce time for Enter key to prevent double-submit
  terminatorWindowMs?: number; // ms - max time from the last character to the trailing Enter
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
  const {
    timingThreshold = 50,
    debounceMs = 100,
    terminatorWindowMs = TIMING_CONSTANTS.SCAN_TERMINATOR_WINDOW_MS,
  } = options;

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

        // A scanner sends Enter soon after its last character (allowing for a configured
        // suffix delay). A late Enter belongs to the user, so a fast burst typed earlier
        // (key repeat, quick typing) is dropped.
        if (now - lastKeystrokeTimeRef.current > terminatorWindowMs) {
          accumulatorRef.current = '';
          isHardwareScanRef.current = false;
          return;
        }

        // If we accumulated characters in hardware scan mode, submit the barcode
        if (
          accumulatorRef.current.length >= MIN_HARDWARE_SCAN_LENGTH &&
          isHardwareScanRef.current
        ) {
          const barcode = accumulatorRef.current;
          accumulatorRef.current = '';
          isHardwareScanRef.current = false;

          // Trigger haptic feedback on successful scan using config constant (fixes 17.9)
          triggerHaptic(TIMING_CONSTANTS.HAPTIC_DURATION_MS);

          // Invoke callback with barcode
          // (GS1-128 parsing can be done in parent component as needed)
          onScan(barcode);
        }

        // Anything shorter is a typed fragment: drop it so this Enter only submits the form.
        accumulatorRef.current = '';
        isHardwareScanRef.current = false;
        return;
      }

      // A held key auto-repeats faster than the timing threshold. Scanners never send
      // repeats, so a repeat ends any burst in progress instead of extending it.
      if (event.repeat) {
        accumulatorRef.current = '';
        isHardwareScanRef.current = false;
        lastKeystrokeTimeRef.current = now;
        return;
      }

      // Check timing: hardware scans are rapid (multiple keys within ~50ms)
      const timeSinceLastKeystroke = now - lastKeystrokeTimeRef.current;
      lastKeystrokeTimeRef.current = now;

      // Ignore non-printable keys (Shift, Control, Alt, etc.)
      // Only accumulate single characters that form a barcode
      if (key.length === 1) {
        // Timing check: a keystroke within threshold of the previous one = hardware scan
        if (accumulatorRef.current.length > 0 && timeSinceLastKeystroke <= timingThreshold) {
          accumulatorRef.current += key;
          isHardwareScanRef.current = true;
        } else {
          // First keystroke, or gap > threshold = human typing so far. A lone key is not
          // a scan: a typed "5" then Enter in a form field must submit the form.
          accumulatorRef.current = key;
          isHardwareScanRef.current = false;
        }
      }
    },
    [timingThreshold, debounceMs, terminatorWindowMs, onScan],
  );

  // Attach keydown listener on mount, remove on unmount
  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown]);
}
