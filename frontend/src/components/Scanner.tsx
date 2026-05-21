import { Suspense, lazy, useState } from 'react';
import { ScannerState, ScannerStateIndicator } from './ScannerStateIndicator';
import { useHardwareScan } from '../hooks/useHardwareScan';
import { HardwareScanResult } from '../types/handheld';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';

interface ScannerProps {
  onScan: (result: HardwareScanResult) => void;
  defaultMode?: 'text' | 'camera';
  continuous?: boolean;
  disabled?: boolean;
  isHandheld?: boolean;
}

const CameraScanner = lazy(() =>
  import('./CameraScanner').then((module) => ({ default: module.CameraScanner })),
);

function CameraScannerLoadingState({ isHandheld }: { isHandheld: boolean }) {
  return (
    <div
      role="status"
      className={`w-full bg-semantic-canvas text-semantic-canvas-foreground flex items-center justify-center rounded ${
        isHandheld ? 'flex-1 min-h-[300px]' : 'h-64'
      }`}
    >
      <span className={isHandheld ? 'text-lg' : 'text-sm'}>Preparing camera scanner</span>
    </div>
  );
}

export function Scanner({
  onScan,
  defaultMode = 'text',
  continuous = false, // ✓ Added default (fixes 17.6)
  disabled = false,
  isHandheld = false,
}: ScannerProps) {
  const [input, setInput] = useState('');
  const [useCamera, setUseCamera] = useState(defaultMode === 'camera');
  const [scannerState, setScannerState] = useState<ScannerState>('ready');

  // Initialize hardware scan hook - converts barcode string to HardwareScanResult
  useHardwareScan(
    (barcode) => {
      if (disabled) {
        return;
      }

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
    if (!disabled && input.trim()) {
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
    if (disabled) {
      return;
    }

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
          <Label
            htmlFor="scanner-barcode-input"
            className={`mb-2 block ${isHandheld ? 'text-base' : ''}`}
          >
            Barcode or SKU
          </Label>
          <Input
            id="scanner-barcode-input"
            type="text"
            value={input}
            onChange={handleInputChange}
            disabled={disabled}
            placeholder="Scan or type barcode/SKU"
            className={`mb-3 ${isHandheld ? 'h-12 text-lg' : ''}`}
          />
          <div className={`flex gap-2 ${isHandheld ? 'mt-auto' : ''}`}>
            <Button
              type="submit"
              disabled={disabled}
              size={isHandheld ? 'lg' : 'default'}
              className={`flex-1 ${isHandheld ? 'min-h-[48px] text-lg' : ''}`}
            >
              Use barcode
            </Button>
            <Button
              type="button"
              disabled={disabled}
              onClick={() => setUseCamera(true)}
              variant="secondary"
              size={isHandheld ? 'lg' : 'default'}
              className={`flex-1 ${isHandheld ? 'min-h-[48px] text-lg' : ''}`}
            >
              Use Camera
            </Button>
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
            <Button
              type="button"
              disabled={disabled}
              onClick={() => setUseCamera(false)}
              variant="secondary"
              size={isHandheld ? 'lg' : 'default'}
              className={isHandheld ? 'min-h-[48px] text-lg' : ''}
            >
              Use Text Input
            </Button>
          </div>
          <div className={isHandheld ? 'flex-1 camera-scanner-fullscreen' : ''}>
            <Suspense fallback={<CameraScannerLoadingState isHandheld={isHandheld} />}>
              <CameraScanner
                onDetected={handleScan}
                onScannerReady={() => setScannerState('ready')}
                onScannerReset={() => setScannerState('ready')}
                isHandheld={isHandheld}
                disabled={disabled}
                continuous={continuous} // ✓ Pass continuous mode (fixes 17.6)
              />
            </Suspense>
          </div>
        </div>
      )}
    </div>
  );
}
