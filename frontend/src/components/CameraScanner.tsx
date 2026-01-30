import React, { useEffect, useRef, useState } from 'react';
import Quagga from 'quagga';

interface CameraScannerProps {
  onDetected: (code: string) => void;
  onScannerReady?: () => void;
  onScannerReset?: () => void;
}

export function CameraScanner({ onDetected, onScannerReady, onScannerReset }: CameraScannerProps) {
  const videoRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

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
          onDetected(data.codeResult.code);
          // Stop the scanner after a successful detection to prevent continuous scanning
          setTimeout(() => {
            Quagga.stop();
          }, 1000);
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
  }, [onDetected]);

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
      <div className="camera-scanner">
        <div className="w-full h-64 bg-gray-200 flex items-center justify-center rounded border border-dashed">
          <div className="text-center p-4">
            <p className="text-red-500 font-medium mb-2">Camera Error</p>
            <p className="text-sm text-gray-600">{error}</p>
            <button
              type="button"
              onClick={handleResetScanner}
              className="mt-4 px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded"
            >
              Try Again
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="camera-scanner">
      <div ref={videoRef} className="w-full h-64 bg-black flex items-center justify-center rounded">
        <div className="text-white text-center">
          <p>Camera feed will appear here</p>
          <p className="text-sm mt-2">Point your camera at a barcode</p>
        </div>
      </div>
      <button
        type="button"
        onClick={handleResetScanner}
        className="mt-2 px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded"
      >
        Reset Scanner
      </button>
    </div>
  );
}
