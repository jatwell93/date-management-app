/**
 * Custom hook for handheld device detection
 * Extracts detection logic from HandheldContext for reusability
 */

import { useState, useEffect, useCallback } from 'react';
import { HandheldDetectionResult } from '../types/handheld';
import { DEVICE_PATTERNS, SCREEN_THRESHOLDS, STORAGE_KEYS } from '../config/handheld';

interface UseHandheldDetectionResult {
  isHandheld: boolean;
  detectionMethod: 'override' | 'userAgent' | 'dimensions' | 'unknown';
  detectionResult: HandheldDetectionResult | null;
  refresh: () => void;
}

// Storage key for localStorage override
const FORCE_HANDHELD_KEY = STORAGE_KEYS.FORCE_HANDHELD;

// Device detection logic
const detectHandheldDevice = (): HandheldDetectionResult => {
  const screenWidth = window.innerWidth;
  const screenHeight = window.innerHeight;

  // Check localStorage override first
  const forceHandheld = localStorage.getItem(FORCE_HANDHELD_KEY);
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

export const useHandheldDetection = (): UseHandheldDetectionResult => {
  const [detectionResult, setDetectionResult] = useState<HandheldDetectionResult | null>(null);

  // Initialize detection on mount
  useEffect(() => {
    const result = detectHandheldDevice();
    setDetectionResult(result);
  }, []);

  // Refresh detection function
  const refresh = useCallback(() => {
    const result = detectHandheldDevice();
    setDetectionResult(result);
  }, []);

  useEffect(() => {
    let resizeTimeout: number | undefined;
    const handleResize = () => {
      if (resizeTimeout) {
        window.clearTimeout(resizeTimeout);
      }
      resizeTimeout = window.setTimeout(() => {
        refresh();
      }, 150);
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);

    return () => {
      if (resizeTimeout) {
        window.clearTimeout(resizeTimeout);
      }
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, [refresh]);

  return {
    isHandheld: detectionResult?.isHandheld ?? false,
    detectionMethod: detectionResult?.method ?? 'unknown',
    detectionResult,
    refresh,
  };
};
