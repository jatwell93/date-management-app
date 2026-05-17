import React, { useEffect, useRef, useState, useCallback } from 'react';
import Quagga from 'quagga';
import * as Sentry from '@sentry/react';
import { triggerHaptic } from '../lib/haptic';
import { TIMING_CONSTANTS } from '../config/handheld'; // ✓ Import constants (fixes 17.9)
import { ScannerStateIndicator, ScannerState } from './ScannerStateIndicator';

interface CameraScannerProps {
  onDetected: (code: string) => void;
  onScannerReady?: () => void;
  onScannerReset?: () => void;
  continuous?: boolean;
  isHandheld?: boolean;
}

export function CameraScanner({
  onDetected,
  onScannerReady,
  onScannerReset,
  continuous = false,
  isHandheld = false,
}: CameraScannerProps) {
  const videoRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [scannerState, setScannerState] = useState<ScannerState>('ready');
  const recentScansRef = useRef<Set<string>>(new Set());

  // Debounce utility to track recent barcode scans (last 2 seconds)
  const isDuplicateScan = useCallback((barcode: string): boolean => {
    if (recentScansRef.current.has(barcode)) {
      return true;
    }

    // Add to recent scans
    recentScansRef.current.add(barcode);

    // Remove after 2 seconds (using config constant - fixes 17.9)
    setTimeout(() => {
      recentScansRef.current.delete(barcode);
    }, TIMING_CONSTANTS.DEDUP_WINDOW_MS);

    return false;
  }, []);

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
        onScannerReady?.();
      },
    );

    Quagga.onDetected((data: unknown) => {
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

      onDetected(barcode);
      setScannerState('scanned');

      // Only stop the scanner after detection if not in continuous mode
      // Wait 1 second before stopping to allow UI updates (fixes 17.9)
      if (!continuous) {
        setTimeout(() => {
          Quagga.stop();
        }, 1000);
      }
    });
  }, [onDetected, onScannerReady, continuous, isDuplicateScan]);

  useEffect(() => {
    initScanner();

    // Cleanup function
    return () => {
      if (Quagga) {
        Quagga.stop();
      }
    };
  }, [initScanner]);

  const handleResetScanner = () => {
    setError(null); // Clear any error when resetting
    setScannerState('ready');
    if (Quagga) {
      Quagga.stop();
    }

    // Small timeout to ensure scanner stops before restarting
    setTimeout(() => {
      initScanner(); // Re-initialize scanner instead of just calling start()
      onScannerReset?.();
    }, 300);
  };

  if (error) {
    return (
      <div className={`camera-scanner ${isHandheld ? 'h-full flex flex-col scanner-context' : ''}`}>
        <ScannerStateIndicator state={scannerState} />
        <div
          className={`w-full bg-muted flex items-center justify-center rounded border border-dashed ${
            isHandheld ? 'flex-1 min-h-[300px]' : 'h-64'
          }`}
        >
          <div className="text-center p-4">
            <p className={`text-semantic-critical font-medium mb-2 ${isHandheld ? 'text-lg' : ''}`}>
              Camera Error
            </p>
            <p className={`text-semantic-text-secondary ${isHandheld ? 'text-base' : 'text-sm'}`}>
              {error}
            </p>
            <button
              type="button"
              onClick={handleResetScanner}
              className={`mt-4 px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded ${
                isHandheld ? 'py-3 text-lg min-h-[48px]' : ''
              }`}
            >
              Try Again
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`camera-scanner ${isHandheld ? 'h-full flex flex-col scanner-context' : ''}`}>
      <ScannerStateIndicator state={scannerState} />
      <div
        ref={videoRef}
        className={`w-full bg-black flex items-center justify-center rounded ${
          isHandheld ? 'flex-1' : 'h-64'
        }`}
      >
        <div className="text-white text-center">
          <p className={isHandheld ? 'text-lg' : ''}>Camera feed will appear here</p>
          <p className={`mt-2 ${isHandheld ? 'text-base' : 'text-sm'}`}>
            Point your camera at a barcode
          </p>
          {continuous && (
            <p className={`mt-1 text-yellow-300 ${isHandheld ? 'text-sm' : 'text-xs'}`}>
              Continuous scan mode
            </p>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={handleResetScanner}
        className={`mt-2 px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded ${
          isHandheld ? 'py-3 text-lg min-h-[48px]' : ''
        }`}
      >
        Reset Scanner
      </button>
    </div>
  );
}
