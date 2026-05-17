import { useState } from 'react';
import { CameraScanner } from './CameraScanner';
import { ScannerState, ScannerStateIndicator } from './ScannerStateIndicator';
import { useHardwareScan } from '../hooks/useHardwareScan';
import { HardwareScanResult } from '../types/handheld';

interface ScannerProps {
  onScan: (result: HardwareScanResult) => void;
  defaultMode?: 'text' | 'camera';
  continuous?: boolean;
  disabled?: boolean;
  isHandheld?: boolean;
}

export function Scanner({
  onScan,
  defaultMode = 'text',
  continuous = false, // ✓ Added default (fixes 17.6)
  isHandheld = false,
}: ScannerProps) {
  const [input, setInput] = useState('');
  const [useCamera, setUseCamera] = useState(defaultMode === 'camera');
  const [scannerState, setScannerState] = useState<ScannerState>('ready');

  // Initialize hardware scan hook - converts barcode string to HardwareScanResult
  useHardwareScan(
    (barcode) => {
      const result: HardwareScanResult = {
        barcode: barcode,
        timestamp: Date.now(),
        source: 'hardware',
      };
      onScan(result);
      setScannerState('scanned');
    },
    { timingThreshold: 50 },
  );

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInput(e.target.value);
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) {
      const result: HardwareScanResult = {
        barcode: input.trim(),
        timestamp: Date.now(),
        source: 'manual',
      };
      onScan(result);
      setScannerState('scanned');
      setInput('');
    }
  };

  const handleScan = (code: string) => {
    const result: HardwareScanResult = {
      barcode: code,
      timestamp: Date.now(),
      source: 'camera',
    };
    onScan(result);
    setScannerState('scanned');
    // ✓ Only return to text input if NOT in continuous mode (fixes 17.6)
    if (!continuous) {
      setUseCamera(false);
    }
  };

  return (
    <div className={isHandheld ? 'h-full flex flex-col scanner-context' : ''}>
      {!useCamera && <ScannerStateIndicator state={scannerState} />}
      {!useCamera ? (
        <form onSubmit={handleFormSubmit} className={isHandheld ? 'flex-1 flex flex-col p-3' : ''}>
          <input
            type="text"
            value={input}
            onChange={handleInputChange}
            placeholder="Scan barcode or enter manually"
            className={`border p-2 rounded w-full mb-2 ${isHandheld ? 'text-lg py-3' : ''}`}
          />
          <div className={`flex gap-2 ${isHandheld ? 'mt-auto' : ''}`}>
            <button
              type="submit"
              className={`flex-1 px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded ${
                isHandheld ? 'py-4 text-lg min-h-[48px]' : ''
              }`}
            >
              Submit
            </button>
            <button
              type="button"
              onClick={() => setUseCamera(true)}
              className={`flex-1 px-4 py-2 bg-secondary hover:bg-secondary/80 text-secondary-foreground rounded ${
                isHandheld ? 'py-4 text-lg min-h-[48px]' : ''
              }`}
            >
              Use Camera
            </button>
          </div>
        </form>
      ) : (
        <div className={isHandheld ? 'h-full flex flex-col' : 'mb-4'}>
          <div
            className={`flex justify-between items-center mb-2 ${isHandheld ? 'px-3 py-2' : ''}`}
          >
            <h3
              className={`text-lg font-semibold font-heading text-foreground ${isHandheld ? 'text-xl' : ''}`}
            >
              Camera Scanner
            </h3>
            <button
              type="button"
              onClick={() => setUseCamera(false)}
              className={`px-4 py-2 bg-secondary hover:bg-secondary/80 text-secondary-foreground rounded ${
                isHandheld ? 'py-3 text-lg min-h-[48px]' : ''
              }`}
            >
              Use Text Input
            </button>
          </div>
          <div className={isHandheld ? 'flex-1 camera-scanner-fullscreen' : ''}>
            <CameraScanner
              onDetected={handleScan}
              onScannerReady={() => setScannerState('ready')}
              onScannerReset={() => setScannerState('ready')}
              isHandheld={isHandheld}
              continuous={continuous} // ✓ Pass continuous mode (fixes 17.6)
            />
          </div>
        </div>
      )}
    </div>
  );
}
