import { useState, useEffect } from 'react';
import { CameraScanner } from './CameraScanner';
import { useHardwareScan } from '../hooks/useHardwareScan';
import { HardwareScanResult } from '../types/handheld';

interface ScannerProps {
  onScan: (result: HardwareScanResult) => void;
  defaultMode?: 'text' | 'camera';
  continuous?: boolean;
  disabled?: boolean;
  isHandheld?: boolean;
}

export function Scanner({ onScan, defaultMode = 'text', isHandheld = false }: ScannerProps) {
  const [input, setInput] = useState('');
  const [useCamera, setUseCamera] = useState(defaultMode === 'camera');

  // Initialize hardware scan hook
  const { isListening } = useHardwareScan({
    onScan: (result) => {
      onScan(result);
    },
    enabled: true, // Always listen for hardware scans
  });

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
    setUseCamera(false); // Return to text input after scan
  };

  return (
    <div className={isHandheld ? 'h-full flex flex-col' : ''}>
      {!useCamera ? (
        <form onSubmit={handleFormSubmit} className={isHandheld ? 'flex-1 flex flex-col p-4' : ''}>
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
        <div className={`mb-4 ${isHandheld ? 'h-full flex flex-col' : ''}`}>
          <div className={`flex justify-between items-center mb-2 ${isHandheld ? 'px-4 py-2' : ''}`}>
            <h3 className={`text-lg font-semibold text-foreground ${isHandheld ? 'text-xl' : ''}`}>Camera Scanner</h3>
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
          <div className={isHandheld ? 'flex-1' : ''}>
            <CameraScanner
              onDetected={handleScan}
              onScannerReady={() => console.log('Scanner ready')}
              onScannerReset={() => console.log('Scanner reset')}
              isHandheld={isHandheld}
            />
          </div>
        </div>
      )}
    </div>
  );
}
