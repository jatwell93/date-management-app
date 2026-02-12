import { useState, useEffect } from 'react';
import { CameraScanner } from './CameraScanner';
import { useHardwareScan } from '../hooks/useHardwareScan';

interface ScannerProps {
  onScan: (scannedInput: string) => void;
  defaultMode?: 'text' | 'camera';
}

export function Scanner({ onScan, defaultMode = 'text' }: ScannerProps) {
  const [input, setInput] = useState('');
  const [useCamera, setUseCamera] = useState(defaultMode === 'camera');

  // Initialize hardware scan hook
  const { isListening } = useHardwareScan({
    onScan: (result) => {
      onScan(result.barcode);
    },
    enabled: true, // Always listen for hardware scans
  });

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInput(e.target.value);
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) {
      onScan(input.trim());
      setInput('');
    }
  };

  const handleScan = (code: string) => {
    onScan(code);
    setUseCamera(false); // Return to text input after scan
  };

  return (
    <div>
      {!useCamera ? (
        <form onSubmit={handleFormSubmit}>
          <input
            type="text"
            value={input}
            onChange={handleInputChange}
            placeholder="Scan barcode or enter manually"
            className="border p-2 rounded w-full mb-2"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              className="flex-1 px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded"
            >
              Submit
            </button>
            <button
              type="button"
              onClick={() => setUseCamera(true)}
              className="flex-1 px-4 py-2 bg-secondary hover:bg-secondary/80 text-secondary-foreground rounded"
            >
              Use Camera
            </button>
          </div>
        </form>
      ) : (
        <div className="mb-4">
          <div className="flex justify-between items-center mb-2">
            <h3 className="text-lg font-semibold text-foreground">Camera Scanner</h3>
            <button
              type="button"
              onClick={() => setUseCamera(false)}
              className="px-4 py-2 bg-secondary hover:bg-secondary/80 text-secondary-foreground rounded"
            >
              Use Text Input
            </button>
          </div>
          <CameraScanner
            onDetected={handleScan}
            onScannerReady={() => console.log('Scanner ready')}
            onScannerReset={() => console.log('Scanner reset')}
          />
        </div>
      )}
    </div>
  );
}
