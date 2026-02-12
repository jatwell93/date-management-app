import React from 'react';
import { useHandheldDetectionContext } from '../contexts/HandheldContext';
import { HandheldScanToolbar } from '../components/HandheldScanToolbar';
import { HandheldLayoutProps } from '../types/handheld';

export const HandheldLayout: React.FC<HandheldLayoutProps> = ({
  children,
  userName,
  syncStatus = 'synced',
  onSyncNow = () => {},
  onSettingsClick = () => {},
  queueLength = 0,
}) => {
  const { isHandheld } = useHandheldDetectionContext();

  return (
    <div className={isHandheld ? 'h-screen flex flex-col' : ''}>
      {isHandheld && (
        <HandheldScanToolbar 
          userName={userName}
          syncStatus={syncStatus}
          onSyncNow={onSyncNow}
          onSettingsClick={onSettingsClick}
          queueLength={queueLength}
        />
      )}
      <main className={
        isHandheld
          ? 'flex-1 overflow-auto'
          : 'p-4 max-w-7xl mx-auto'
      }>
        {children}
      </main>
    </div>
  );
};