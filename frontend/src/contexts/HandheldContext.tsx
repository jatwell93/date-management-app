/**
 * React Context for handheld device detection and state management
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { IHandheldContext, HandheldDetectionResult } from '../types/handheld';
import { DEVICE_PATTERNS, SCREEN_THRESHOLDS, SYNC_STRATEGIES } from '../config/handheld';

type SyncStrategy = (typeof SYNC_STRATEGIES)[keyof typeof SYNC_STRATEGIES];

// Storage keys for localStorage
const STORAGE_KEYS = {
  FORCE_HANDHELD: 'handheld_force_handheld',
  SYNC_STRATEGY: 'handheld_sync_strategy',
} as const;

// Default values
const DEFAULTS = {
  SYNC_STRATEGY: 'automatic' as SyncStrategy,
  HAPTIC_ENABLED: true,
  AUDIO_FEEDBACK_ENABLED: true,
} as const;

// Create the context
const HandheldContext = createContext<IHandheldContext | null>(null);

// Hook to use the handheld context
export const useHandheldDetection = (): IHandheldContext => {
  const context = useContext(HandheldContext);
  if (!context) {
    throw new Error('useHandheldDetection must be used within a HandheldProvider');
  }
  return context;
};

// Device detection logic
const detectHandheldDevice = (): HandheldDetectionResult => {
  const screenWidth = window.innerWidth;
  const screenHeight = window.innerHeight;

  // Check localStorage override first
  const forceHandheld = localStorage.getItem(STORAGE_KEYS.FORCE_HANDHELD);
  if (forceHandheld === 'true') {
    return {
      isHandheld: true,
      method: 'override',
      screenWidth,
      screenHeight,
    };
  }

  // Check user agent patterns
  const userAgent = navigator.userAgent;
  let deviceType: HandheldDetectionResult['deviceType'];

  if (DEVICE_PATTERNS.ZEBRA.test(userAgent)) {
    deviceType = 'zebra';
  } else if (DEVICE_PATTERNS.HONEYWELL.test(userAgent)) {
    deviceType = 'honeywell';
  } else if (DEVICE_PATTERNS.CIPHERLAB.test(userAgent)) {
    deviceType = 'cipherlab';
  }

  if (deviceType) {
    return {
      isHandheld: true,
      method: 'userAgent',
      deviceType,
      screenWidth,
      screenHeight,
    };
  }

  // Check screen dimensions as fallback
  const isSmallScreen =
    screenWidth <= SCREEN_THRESHOLDS.MAX_WIDTH && screenHeight <= SCREEN_THRESHOLDS.MAX_HEIGHT;

  return {
    isHandheld: isSmallScreen,
    method: isSmallScreen ? 'dimensions' : 'unknown',
    screenWidth,
    screenHeight,
  };
};

// Provider component
interface HandheldProviderProps {
  children: React.ReactNode;
}

export const HandheldProvider: React.FC<HandheldProviderProps> = ({ children }) => {
  const [detectionResult, setDetectionResult] = useState<HandheldDetectionResult | null>(null);
  const [syncStrategy, setSyncStrategyState] = useState<SyncStrategy>(DEFAULTS.SYNC_STRATEGY);
  const [hapticEnabled, setHapticEnabled] = useState<boolean>(DEFAULTS.HAPTIC_ENABLED);
  const [audioFeedbackEnabled, setAudioFeedbackEnabled] = useState<boolean>(
    DEFAULTS.AUDIO_FEEDBACK_ENABLED,
  );

  // Initialize detection on mount
  useEffect(() => {
    const result = detectHandheldDevice();
    setDetectionResult(result);

    // Load persisted settings
    const savedStrategy = localStorage.getItem(STORAGE_KEYS.SYNC_STRATEGY) as SyncStrategy;
    if (savedStrategy && Object.values(SYNC_STRATEGIES).includes(savedStrategy)) {
      setSyncStrategyState(savedStrategy);
    }
  }, []);

  // Refresh detection function
  const refreshDetection = useCallback(() => {
    const result = detectHandheldDevice();
    setDetectionResult(result);
  }, []);

  // Sync strategy setter with persistence
  const setSyncStrategy = useCallback((strategy: SyncStrategy) => {
    setSyncStrategyState(strategy);
    localStorage.setItem(STORAGE_KEYS.SYNC_STRATEGY, strategy);
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
    isHandheld: detectionResult?.isHandheld ?? false,
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
