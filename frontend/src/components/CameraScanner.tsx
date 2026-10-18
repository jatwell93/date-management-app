import React, { useEffect, useRef, useState, useCallback } from 'react';
import Quagga from 'quagga';
import * as Sentry from '@sentry/react';
import { triggerHaptic } from '../lib/haptic';
import { TIMING_CONSTANTS } from '../config/handheld'; // ✓ Import constants (fixes 17.9)
import { ScannerStateIndicator, ScannerState } from './ScannerStateIndicator';
import { Button } from './ui/button';

interface CameraScannerProps {
  onDetected: (code: string) => void;
  onScannerReady?: () => void;
  onScannerReset?: () => void;
  continuous?: boolean;
  disabled?: boolean;
  isHandheld?: boolean;
}

function getScannerContainerClassName(isHandheld: boolean) {
  return `camera-scanner ${isHandheld ? 'h-full flex flex-col scanner-context' : ''}`;
}

function ResetScannerButton({
  isHandheld,
  label,
  disabled,
  onClick,
}: {
  isHandheld: boolean;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      disabled={disabled}
      onClick={onClick}
      size={isHandheld ? 'lg' : 'default'}
      className={isHandheld ? 'min-h-[48px] text-lg' : 'min-h-11'}
    >
      {label}
    </Button>
  );
}

export function CameraScanner({
  onDetected,
  onScannerReady,
  onScannerReset,
  continuous = false,
  disabled = false,
  isHandheld = false,
}: CameraScannerProps) {
  const videoRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [scannerState, setScannerState] = useState<ScannerState>('ready');
  const recentScansRef = useRef<Set<string>>(new Set());
  const detectedHandlerRef = useRef<((data: unknown) => void) | null>(null);
  const timeoutsRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  // Keep the latest props in refs so a parent re-render (new inline callbacks)
  // does not tear down and re-initialise the camera stream.
  const onDetectedRef = useRef(onDetected);
  const onScannerReadyRef = useRef(onScannerReady);
  const onScannerResetRef = useRef(onScannerReset);
  const continuousRef = useRef(continuous);
  const disabledRef = useRef(disabled);
  useEffect(() => {
    onDetectedRef.current = onDetected;
    onScannerReadyRef.current = onScannerReady;
    onScannerResetRef.current = onScannerReset;
    continuousRef.current = continuous;
    disabledRef.current = disabled;
  });

  const schedule = useCallback((callback: () => void, delay: number) => {
    const id = setTimeout(() => {
      timeoutsRef.current.delete(id);
      callback();
    }, delay);
    timeoutsRef.current.add(id);
  }, []);

  // Debounce utility to track recent barcode scans (last 2 seconds)
  const isDuplicateScan = useCallback(
    (barcode: string): boolean => {
      if (recentScansRef.current.has(barcode)) {
        return true;
      }

      // Add to recent scans
      recentScansRef.current.add(barcode);

      // Remove after 2 seconds (using config constant - fixes 17.9)
      schedule(() => {
        recentScansRef.current.delete(barcode);
      }, TIMING_CONSTANTS.DEDUP_WINDOW_MS);

      return false;
    },
    [schedule],
  );

  // Extract scanner initialization logic so it can be reused
  const initScanner = useCallback(() => {
    if (!videoRef.current) return;

    Quagga.init(
      {
        inputStream: {
          name: 'Live',
          type: 'LiveStream',
          target: videoRef.current,
          constraints: {
            facingMode: 'environment', // Prefer rear camera if available
            width: 640,
            height: 480,
          },
        },
        decoder: {
          readers: [
            'code_128_reader',
            'ean_reader',
            'ean_8_reader',
            'code_39_reader',
            'code_39_vin_reader',
            'codabar_reader',
            'upc_reader',
            'upc_e_reader',
            'i2of5_reader',
          ],
        },
      },
      (err: unknown) => {
        if (err) {
          const initError = err instanceof Error ? err : new Error('Unknown camera error');
          Sentry.captureException(initError, {
            tags: { feature: 'camera-scanner' },
          });
          setError('Error accessing camera. Please ensure you have granted camera permissions.');
          setScannerState('error');
          return;
        }

        Quagga.start();
        setScannerState('scanning');
        onScannerReadyRef.current?.();
      },
    );

    const detectedHandler = (data: unknown) => {
      if (disabledRef.current) {
        return;
      }

      const code = (data as { codeResult?: { code?: string } })?.codeResult?.code;
      if (!code) {
        return;
      }

      // Trigger haptic feedback on successful barcode detection
      triggerHaptic(50);

      const barcode = code;

      // Skip duplicate barcodes within 2-second window
      if (isDuplicateScan(barcode)) {
        setScannerState('warning');
        return;
      }

      onDetectedRef.current(barcode);
      setScannerState('scanned');

      // Only stop the scanner after detection if not in continuous mode
      // Wait 1 second before stopping to allow UI updates (fixes 17.9)
      if (!continuousRef.current) {
        schedule(() => {
          Quagga.stop();
        }, 1000);
      }
    };

    detectedHandlerRef.current = detectedHandler;
    Quagga.onDetected(detectedHandler);
  }, [isDuplicateScan, schedule]);

  useEffect(() => {
    initScanner();
    const pendingTimeouts = timeoutsRef.current;

    // Cleanup function
    return () => {
      pendingTimeouts.forEach((id) => clearTimeout(id));
      pendingTimeouts.clear();
      if (detectedHandlerRef.current) {
        Quagga.offDetected(detectedHandlerRef.current);
        detectedHandlerRef.current = null;
      }
      if (Quagga) {
        Quagga.stop();
      }
    };
  }, [initScanner]);

  const handleResetScanner = () => {
    setError(null); // Clear any error when resetting
    setScannerState('ready');
    if (detectedHandlerRef.current) {
      Quagga.offDetected(detectedHandlerRef.current);
      detectedHandlerRef.current = null;
    }
    if (Quagga) {
      Quagga.stop();
    }

    // Small timeout to ensure scanner stops before restarting
    schedule(() => {
      initScanner(); // Re-initialize scanner instead of just calling start()
      onScannerResetRef.current?.();
    }, 300);
  };

  if (error) {
    return (
      <div className={getScannerContainerClassName(isHandheld)}>
        <ScannerStateIndicator state={scannerState} />
        <div
          className={`w-full bg-muted flex items-center justify-center rounded border border-dashed ${
            isHandheld ? 'flex-1 min-h-[300px]' : 'h-64'
          }`}
        >
          <div className="text-center p-4" role="alert">
            <p className={`text-semantic-critical font-medium mb-2 ${isHandheld ? 'text-lg' : ''}`}>
              Camera Error
            </p>
            <p className={`text-semantic-text-secondary ${isHandheld ? 'text-base' : 'text-sm'}`}>
              {error}
            </p>
            <div className="mt-4">
              <ResetScannerButton
                isHandheld={isHandheld}
                label="Try Again"
                disabled={disabled}
                onClick={handleResetScanner}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={getScannerContainerClassName(isHandheld)}>
      <ScannerStateIndicator state={scannerState} />
      <div
        ref={videoRef}
        className={`w-full bg-semantic-canvas flex items-center justify-center rounded ${
          isHandheld ? 'flex-1' : 'h-64'
        }`}
      >
        <div className="text-semantic-canvas-foreground text-center">
          <p className={isHandheld ? 'text-lg' : ''}>Camera starts after permission is granted</p>
          <p className={`mt-2 ${isHandheld ? 'text-base' : 'text-sm'}`}>
            Aim at the product barcode
          </p>
          {continuous && (
            <p
              className={`mt-1 text-semantic-warning-muted ${isHandheld ? 'text-base' : 'text-sm'}`}
            >
              Continuous scan mode
            </p>
          )}
        </div>
      </div>
      <div className="mt-2">
        <ResetScannerButton
          isHandheld={isHandheld}
          label="Reset Scanner"
          disabled={disabled}
          onClick={handleResetScanner}
        />
      </div>
    </div>
  );
}
