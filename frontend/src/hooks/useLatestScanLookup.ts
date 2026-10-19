import { useCallback, useEffect, useRef } from 'react';

export interface ScanLookup {
  /** Aborted when a newer scan starts or the view unmounts. */
  signal: AbortSignal;
  /** True while this is still the latest scan; only then may it update the view. */
  isCurrent: () => boolean;
  /** Ends this scan's in-flight state (no-op once a newer scan has started). */
  finish: () => void;
}

/**
 * Tracks barcode-scan product lookups so only the latest scan counts.
 *
 * `inFlightRef` is read synchronously by submit handlers: a keyboard-wedge scanner
 * ends its burst with Enter, which submits a focused form in the same task as the
 * scan callback, before React re-renders.
 */
export function useLatestScanLookup() {
  const scanIdRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const inFlightRef = useRef(false);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const start = useCallback((): ScanLookup => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const scanId = ++scanIdRef.current;
    inFlightRef.current = true;

    const isCurrent = () => scanIdRef.current === scanId;
    const finish = () => {
      if (!isCurrent()) return;
      // Clear on a later task so the scanner's trailing Enter is still ignored.
      setTimeout(() => {
        if (isCurrent()) inFlightRef.current = false;
      }, 0);
    };

    return { signal: controller.signal, isCurrent, finish };
  }, []);

  return { start, inFlightRef };
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
