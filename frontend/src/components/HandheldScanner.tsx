import React from 'react';
import { Scanner } from './Scanner';
import { useHandheldDetectionContext } from '../contexts/HandheldContext';
import { HandheldScannerProps } from '../types/handheld';

export const HandheldScanner: React.FC<HandheldScannerProps> = ({
  onScan,
  defaultMode,
  continuous,
  disabled,
  showToolbar = true,
  syncStatus,
  onSyncNow,
  className = '',
}) => {
  const { isHandheld } = useHandheldDetectionContext();

  // Determine default mode based on handheld detection
  const scannerDefaultMode = isHandheld ? 'camera' : defaultMode || 'text';

  return (
    <div className={`handheld-scanner ${isHandheld ? 'full-screen-scan' : ''} ${className}`}>
      <Scanner
        onScan={onScan}
        defaultMode={scannerDefaultMode}
        continuous={continuous}
        disabled={disabled}
        isHandheld={isHandheld}
      />
    </div>
  );
};
