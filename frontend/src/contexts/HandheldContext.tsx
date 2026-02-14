/**
 * React Context for handheld device detection and state management
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { IHandheldContext } from '../types/handheld';
import { useHandheldDetection } from '../hooks/useHandheldDetection';
import { SYNC_STRATEGIES, STORAGE_KEYS, DEFAULTS } from '../config/handheld';
import { offlineSyncService } from '../lib/offline-sync';

type SyncStrategy = (typeof SYNC_STRATEGIES)[keyof typeof SYNC_STRATEGIES];

// Create the context
const HandheldContext = createContext<IHandheldContext | null>(null);

// Hook to use the handheld context
export const useHandheldDetectionContext = (): IHandheldContext => {
  const context = useContext(HandheldContext);
  if (!context) {
    throw new Error('useHandheldDetectionContext must be used within a HandheldProvider');
  }
  return context;
};

// Provider component
interface HandheldProviderProps {
  children: React.ReactNode;
}

export const HandheldProvider: React.FC<HandheldProviderProps> = ({ children }) => {
  // Use the detection hook
  const { isHandheld, detectionResult, refresh } = useHandheldDetection();
  const [syncStrategy, setSyncStrategyState] = useState<SyncStrategy>(DEFAULTS.SYNC_STRATEGY);
  const [hapticEnabled, setHapticEnabled] = useState<boolean>(DEFAULTS.HAPTIC_ENABLED);
  const [audioFeedbackEnabled, setAudioFeedbackEnabled] = useState<boolean>(
    DEFAULTS.AUDIO_FEEDBACK_ENABLED,
  );

  // Load persisted settings on mount
  useEffect(() => {
    const savedStrategy = localStorage.getItem(STORAGE_KEYS.SYNC_STRATEGY) as SyncStrategy;
    if (savedStrategy && Object.values(SYNC_STRATEGIES).includes(savedStrategy)) {
      setSyncStrategyState(savedStrategy);
    }
  }, []);

  // Refresh detection function (delegates to hook)
  const refreshDetection = useCallback(() => {
    refresh();
  }, [refresh]);

  // Sync strategy setter with persistence
  const setSyncStrategy = useCallback((strategy: SyncStrategy) => {
    setSyncStrategyState(strategy);
    localStorage.setItem(STORAGE_KEYS.SYNC_STRATEGY, strategy);

    // Update the offline sync service with the new strategy
    offlineSyncService.setSyncStrategy(strategy);
  }, []);

  // Haptic enabled setter
  const handleSetHapticEnabled = useCallback((enabled: boolean) => {
    setHapticEnabled(enabled);
  }, []);

  // Audio feedback enabled setter
  const handleSetAudioFeedbackEnabled = useCallback((enabled: boolean) => {
    setAudioFeedbackEnabled(enabled);
  }, []);

  // Context value
  const contextValue: IHandheldContext = {
    isHandheld,
    detectionResult,
    syncStrategy,
    hapticEnabled,
    audioFeedbackEnabled,
    setSyncStrategy,
    setHapticEnabled: handleSetHapticEnabled,
    setAudioFeedbackEnabled: handleSetAudioFeedbackEnabled,
    refreshDetection,
  };

  return <HandheldContext.Provider value={contextValue}>{children}</HandheldContext.Provider>;
};
