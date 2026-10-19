import React from 'react';
import { useHandheldDetectionContext } from '../contexts/HandheldContext';
import { HandheldScanToolbar } from '../components/HandheldScanToolbar';
import { HandheldLayoutProps } from '../types/handheld';
import { SHELL_MAIN_CLASS, SHELL_MAIN_ID } from './shellMain';

export const HandheldLayout: React.FC<HandheldLayoutProps> = ({
  children,
  userName,
  syncStatus = 'synced',
  onSyncNow = () => {
    // Default empty handler
  },
  onSettingsClick = () => {
    // Default empty handler
  },
  queueLength = 0,
}) => {
  const { isHandheld } = useHandheldDetectionContext();

  return (
    <div
      className={isHandheld ? 'handheld-layout h-dvh min-h-0 flex flex-col overflow-hidden' : ''}
    >
      {isHandheld && (
        <HandheldScanToolbar
          userName={userName}
          syncStatus={syncStatus}
          onSyncNow={onSyncNow}
          onSettingsClick={onSettingsClick}
          queueLength={queueLength}
        />
      )}
      <main
        id={SHELL_MAIN_ID}
        tabIndex={-1}
        className={isHandheld ? 'flex-1 min-h-0 overflow-auto outline-hidden' : SHELL_MAIN_CLASS}
      >
        {children}
      </main>
    </div>
  );
};
