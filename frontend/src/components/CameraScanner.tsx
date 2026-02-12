import React, { useEffect, useRef, useState, useCallback } from 'react';
import Quagga from 'quagga';

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
  const recentScansRef = useRef<Set<string>>(new Set());

  // Debounce utility to track recent barcode scans (last 2 seconds)
  const isDuplicateScan = useCallback((barcode: string): boolean => {
    if (recentScansRef.current.has(barcode)) {
      return true;
    }

    // Add to recent scans
    recentScansRef.current.add(barcode);

    // Remove after 2 seconds
    setTimeout(() => {
      recentScansRef.current.delete(barcode);
    }, 2000);

    return false;
  }, []);

  useEffect(() => {
    const initScanner = () => {
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
        (err: any) => {
          if (err) {
            console.error('Error initializing Quagga:', err);
            setError('Error accessing camera. Please ensure you have granted camera permissions.');
            return;
          }

          Quagga.start();
          onScannerReady?.();
        },
      );

      Quagga.onDetected((data: any) => {
        if (data && data.codeResult && data.codeResult.code) {
          const barcode = data.codeResult.code;

          // Skip duplicate barcodes within 2-second window
          if (isDuplicateScan(barcode)) {
            console.log('Skipping duplicate barcode scan:', barcode);
            return;
          }

          onDetected(barcode);

          // Only stop the scanner after detection if not in continuous mode
          if (!continuous) {
            setTimeout(() => {
              Quagga.stop();
            }, 1000);
          }
        }
      });
    };

    initScanner();

    // Cleanup function
    return () => {
      if (Quagga) {
        Quagga.stop();
      }
    };
  }, [onDetected, continuous, isDuplicateScan]);

  const handleResetScanner = () => {
    setError(null); // Clear any error when resetting
    if (Quagga) {
      Quagga.stop();
    }

    // Small timeout to ensure scanner stops before restarting
    setTimeout(() => {
      if (Quagga) {
        Quagga.start();
        onScannerReset?.();
      }
    }, 300);
  };

  if (error) {
    return (
      <div className={`camera-scanner ${isHandheld ? 'h-full flex flex-col' : ''}`}>
        <div
          className={`w-full bg-gray-200 flex items-center justify-center rounded border border-dashed ${
            isHandheld ? 'flex-1 min-h-[300px]' : 'h-64'
          }`}
        >
          <div className="text-center p-4">
            <p className={`text-red-500 font-medium mb-2 ${isHandheld ? 'text-lg' : ''}`}>
              Camera Error
            </p>
            <p className={`text-gray-600 ${isHandheld ? 'text-base' : 'text-sm'}`}>{error}</p>
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
    <div className={`camera-scanner ${isHandheld ? 'h-full flex flex-col' : ''}`}>
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
