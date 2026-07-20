/**
 * Tests for Haptic Feedback Utility
 * Tests Web Vibration API integration for barcode scan confirmation
 */

import { triggerHaptic } from '../haptic';

describe('haptic', () => {
  beforeEach(() => {
    // Mock navigator.vibrate if not already mocked
    if (!navigator.vibrate) {
      Object.defineProperty(navigator, 'vibrate', {
        value: vi.fn().mockReturnValue(true),
        writable: true,
        configurable: true,
      });
    }
    // Clear all mocks before each test
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Clean up vibrate mock
    if (navigator.vibrate && typeof navigator.vibrate === 'function') {
      (navigator.vibrate as jest.Mock).mockClear();
    }
  });

  describe('triggerHaptic', () => {
    it('should call navigator.vibrate() with default duration of 50ms', () => {
      triggerHaptic();

      expect(navigator.vibrate).toHaveBeenCalledWith(50);
    });

    it('should call navigator.vibrate() with custom duration', () => {
      triggerHaptic(100);

      expect(navigator.vibrate).toHaveBeenCalledWith(100);
    });

    it('should handle missing navigator.vibrate gracefully (no error thrown)', () => {
      const originalVibrate = navigator.vibrate;
      // @ts-expect-error - Intentionally removing vibrate method for testing
      delete navigator.vibrate;

      // This should not throw an error
      expect(() => {
        triggerHaptic();
      }).not.toThrow();

      // Restore original method
      Object.defineProperty(navigator, 'vibrate', {
        value: originalVibrate,
        writable: true,
        configurable: true,
      });
    });

    it('should respect custom duration parameter of 75ms', () => {
      triggerHaptic(75);

      expect(navigator.vibrate).toHaveBeenCalledWith(75);
    });

    it('should support zero duration (stop vibration)', () => {
      triggerHaptic(0);

      expect(navigator.vibrate).toHaveBeenCalledWith(0);
    });

    it('should handle error thrown by navigator.vibrate gracefully', () => {
      (navigator.vibrate as jest.Mock).mockImplementation(() => {
        throw new Error('Vibration denied by permissions');
      });

      // This should not throw an error
      expect(() => {
        triggerHaptic(50);
      }).not.toThrow();

      expect(navigator.vibrate).toHaveBeenCalled();
    });

    it('should return undefined (void function)', () => {
      const result = triggerHaptic();

      expect(result).toBeUndefined();
    });
  });
});
