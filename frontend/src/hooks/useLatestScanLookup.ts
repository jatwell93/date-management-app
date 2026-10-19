import { useCallback, useEffect, useRef, useState } from 'react';

/** A product lookup that has not settled after this long is abandoned. */
export const SCAN_LOOKUP_TIMEOUT_MS = 15_000;

export class ScanLookupTimeoutError extends Error {
  constructor() {
    super('Product lookup timed out');
    this.name = 'ScanLookupTimeoutError';
  }
}

export interface ScanLookup {
  /** Aborted when a newer scan starts, the lookup times out, or the view unmounts. */
  signal: AbortSignal;
  /** True while this is still the latest scan; only then may it update the view. */
  isCurrent: () => boolean;
  /** Ends this scan's in-flight state (no-op once a newer scan has started). */
  finish: () => void;
}

/**
 * Tracks barcode-scan product lookups so only the latest scan counts.
 *
 * - `isLookingUp` drives the UI (e.g. disabling Calculate) while a lookup runs.
 * - `inFlightRef` is read synchronously by submit handlers: a keyboard-wedge scanner
 *   ends its burst with Enter, which submits a focused form in the same task as the
 *   scan callback, before React re-renders with `isLookingUp`.
 * - A lookup is aborted after SCAN_LOOKUP_TIMEOUT_MS so a hung request cannot keep
 *   the view locked.
 */
export function useLatestScanLookup() {
  const scanIdRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const inFlightRef = useRef(false);
  const [isLookingUp, setIsLookingUp] = useState(false);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const start = useCallback((): ScanLookup => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const scanId = ++scanIdRef.current;
    inFlightRef.current = true;
    setIsLookingUp(true);

    const timer = setTimeout(
      () => controller.abort(new ScanLookupTimeoutError()),
      SCAN_LOOKUP_TIMEOUT_MS,
    );
    const isCurrent = () => scanIdRef.current === scanId;
    const finish = () => {
      clearTimeout(timer);
      if (!isCurrent()) return;
      setIsLookingUp(false);
      // Clear on a later task so the scanner's trailing Enter is still ignored.
      setTimeout(() => {
        if (isCurrent()) inFlightRef.current = false;
      }, 0);
    };

    return { signal: controller.signal, isCurrent, finish };
  }, []);

  return { start, isLookingUp, inFlightRef };
}

/** Settles with `promise`, or rejects with the abort reason as soon as `signal` aborts. */
export function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}
