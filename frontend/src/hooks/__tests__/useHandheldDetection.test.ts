/**
 * Tests for useHandheldDetection hook
 */

import { renderHook, act } from '@testing-library/react';
import { useHandheldDetection } from '../useHandheldDetection';

// Mock window and navigator APIs
const mockWindow = {
  innerWidth: 800,
  innerHeight: 600,
};

const mockNavigator = {
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
};

Object.defineProperty(window, 'innerWidth', { value: mockWindow.innerWidth, writable: true });
Object.defineProperty(window, 'innerHeight', { value: mockWindow.innerHeight, writable: true });
Object.defineProperty(navigator, 'userAgent', { value: mockNavigator.userAgent, writable: true });

// Mock localStorage
const localStorageMock = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
};
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

describe('useHandheldDetection', () => {
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    localStorageMock.getItem.mockReturnValue(null);
    localStorageMock.setItem.mockImplementation(() => {});
    localStorageMock.removeItem.mockImplementation(() => {});
    localStorageMock.clear.mockImplementation(() => {});

    // Reset window dimensions
    Object.defineProperty(window, 'innerWidth', { value: 800, writable: true });
    Object.defineProperty(window, 'innerHeight', { value: 600, writable: true });

    // Reset user agent
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      writable: true
    });
  });

  describe('localStorage override', () => {
    it('should detect handheld when forceHandheld is set to true', () => {
      localStorageMock.getItem.mockReturnValue('true');

      const { result } = renderHook(() => useHandheldDetection());

      expect(result.current.isHandheld).toBe(true);
      expect(result.current.detectionMethod).toBe('override');
      expect(result.current.detectionResult).toEqual({
        isHandheld: true,
        method: 'override',
        screenWidth: 800,
        screenHeight: 600,
      });
    });

    it('should not detect handheld when forceHandheld is not set', () => {
      localStorageMock.getItem.mockReturnValue(null);

      const { result } = renderHook(() => useHandheldDetection());

      expect(result.current.isHandheld).toBe(false);
      expect(result.current.detectionMethod).toBe('unknown');
    });
  });

  describe('user agent detection', () => {
    it('should detect Zebra device', () => {
      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 (Linux; Android 8.1.0; TC21) AppleWebKit/537.36',
        writable: true
      });

      const { result } = renderHook(() => useHandheldDetection());

      expect(result.current.isHandheld).toBe(true);
      expect(result.current.detectionMethod).toBe('userAgent');
      expect(result.current.detectionResult?.deviceType).toBe('zebra');
    });

    it('should detect Honeywell device', () => {
      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 (Linux; Android 8.1.0; CT45) AppleWebKit/537.36 Honeywell',
        writable: true
      });

      const { result } = renderHook(() => useHandheldDetection());

      expect(result.current.isHandheld).toBe(true);
      expect(result.current.detectionMethod).toBe('userAgent');
      expect(result.current.detectionResult?.deviceType).toBe('honeywell');
    });

    it('should detect CipherLab device', () => {
      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 (Linux; Android 8.1.0; RS36) AppleWebKit/537.36 CipherLab',
        writable: true
      });

      const { result } = renderHook(() => useHandheldDetection());

      expect(result.current.isHandheld).toBe(true);
      expect(result.current.detectionMethod).toBe('userAgent');
      expect(result.current.detectionResult?.deviceType).toBe('cipherlab');
    });
  });

  describe('screen dimension detection', () => {
    it('should detect handheld for small screens', () => {
      Object.defineProperty(window, 'innerWidth', { value: 500, writable: true });
      Object.defineProperty(window, 'innerHeight', { value: 800, writable: true });

      const { result } = renderHook(() => useHandheldDetection());

      expect(result.current.isHandheld).toBe(true);
      expect(result.current.detectionMethod).toBe('dimensions');
    });

    it('should not detect handheld for large screens', () => {
      Object.defineProperty(window, 'innerWidth', { value: 1200, writable: true });
      Object.defineProperty(window, 'innerHeight', { value: 800, writable: true });

      const { result } = renderHook(() => useHandheldDetection());

      expect(result.current.isHandheld).toBe(false);
      expect(result.current.detectionMethod).toBe('unknown');
    });

    it('should detect handheld at threshold dimensions', () => {
      Object.defineProperty(window, 'innerWidth', { value: 600, writable: true });
      Object.defineProperty(window, 'innerHeight', { value: 900, writable: true });

      const { result } = renderHook(() => useHandheldDetection());

      expect(result.current.isHandheld).toBe(true);
      expect(result.current.detectionMethod).toBe('dimensions');
    });
  });

  describe('refresh function', () => {
    it('should re-run detection when refresh is called', () => {
      localStorageMock.getItem.mockReturnValue(null);

      const { result } = renderHook(() => useHandheldDetection());

      expect(result.current.isHandheld).toBe(false);

      // Change localStorage and call refresh
      localStorageMock.getItem.mockReturnValue('true');

      act(() => {
        result.current.refresh();
      });

      expect(result.current.isHandheld).toBe(true);
      expect(result.current.detectionMethod).toBe('override');
    });

    it('should update screen dimensions when refresh is called', () => {
      const { result } = renderHook(() => useHandheldDetection());

      expect(result.current.detectionResult?.screenWidth).toBe(800);
      expect(result.current.detectionResult?.screenHeight).toBe(600);

      // Change window dimensions
      Object.defineProperty(window, 'innerWidth', { value: 400, writable: true });
      Object.defineProperty(window, 'innerHeight', { value: 700, writable: true });

      act(() => {
        result.current.refresh();
      });

      expect(result.current.detectionResult?.screenWidth).toBe(400);
      expect(result.current.detectionResult?.screenHeight).toBe(700);
      expect(result.current.isHandheld).toBe(true);
      expect(result.current.detectionMethod).toBe('dimensions');
    });
  });

  describe('initial state', () => {
    it('should return false for isHandheld initially when no detection criteria met', () => {
      const { result } = renderHook(() => useHandheldDetection());

      expect(result.current.isHandheld).toBe(false);
      expect(result.current.detectionMethod).toBe('unknown');
      expect(result.current.detectionResult).toEqual({
        isHandheld: false,
        method: 'unknown',
        screenWidth: 800,
        screenHeight: 600,
      });
    });

    it('should initialize with correct screen dimensions', () => {
      Object.defineProperty(window, 'innerWidth', { value: 1024, writable: true });
      Object.defineProperty(window, 'innerHeight', { value: 768, writable: true });

      const { result } = renderHook(() => useHandheldDetection());

      expect(result.current.detectionResult?.screenWidth).toBe(1024);
      expect(result.current.detectionResult?.screenHeight).toBe(768);
    });
  });

  describe('detection priority', () => {
    it('should prioritize localStorage override over user agent', () => {
      localStorageMock.getItem.mockReturnValue('true');
      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 (Linux; Android 8.1.0; TC21) AppleWebKit/537.36',
        writable: true
      });

      const { result } = renderHook(() => useHandheldDetection());

      expect(result.current.isHandheld).toBe(true);
      expect(result.current.detectionMethod).toBe('override');
      expect(result.current.detectionResult?.deviceType).toBeUndefined();
    });

    it('should prioritize user agent over screen dimensions', () => {
      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 (Linux; Android 8.1.0; TC21) AppleWebKit/537.36',
        writable: true
      });
      Object.defineProperty(window, 'innerWidth', { value: 1200, writable: true });
      Object.defineProperty(window, 'innerHeight', { value: 800, writable: true });

      const { result } = renderHook(() => useHandheldDetection());

      expect(result.current.isHandheld).toBe(true);
      expect(result.current.detectionMethod).toBe('userAgent');
      expect(result.current.detectionResult?.deviceType).toBe('zebra');
    });
  });
});