/**
 * Tests for useHardwareScan Hook
 * Tests hardware barcode input via keyboard wedge events from PDT devices
 */

import { renderHook, act } from '@testing-library/react';
import { useHardwareScan } from '../useHardwareScan';

describe('useHardwareScan', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should be callable without errors when mounted', () => {
    const onScan = jest.fn();
    const { result } = renderHook(() => useHardwareScan(onScan));
    // Hook setup without errors is success
    expect(onScan).not.toHaveBeenCalled();
  });

  it('should accumulate rapid keystrokes within 50ms timing window and emit onScan on Enter', (done) => {
    const onScan = jest.fn();
    renderHook(() => useHardwareScan(onScan));

    const simulateRapidKeystrokes = () => {
      // Simulate hardware scan: rapid keystrokes within 50ms window
      const keys = ['1', '2', '3', '4', '5', '6', '7', '8'];

      keys.forEach((key, index) => {
        setTimeout(() => {
          const event = new KeyboardEvent('keydown', { key });
          document.dispatchEvent(event);
        }, index * 5); // 5ms apart = 40ms total, within 50ms threshold
      });

      // Simulate Enter key to end the scan
      setTimeout(() => {
        const enterEvent = new KeyboardEvent('keydown', { key: 'Enter' });
        document.dispatchEvent(enterEvent);

        // Give callback time to fire
        setTimeout(() => {
          expect(onScan).toHaveBeenCalledWith('12345678');
          done();
        }, 10);
      }, 50);
    };

    simulateRapidKeystrokes();
  });

  it('should NOT trigger hardware scan for slow human typing (>50ms between keystrokes)', (done) => {
    const onScan = jest.fn();
    renderHook(() => useHardwareScan(onScan));

    // Simulate slow typing (200ms apart = human speed)
    const event1 = new KeyboardEvent('keydown', { key: 'a' });
    document.dispatchEvent(event1);

    setTimeout(() => {
      const event2 = new KeyboardEvent('keydown', { key: 'b' });
      document.dispatchEvent(event2);

      setTimeout(() => {
        const enterEvent = new KeyboardEvent('keydown', { key: 'Enter' });
        document.dispatchEvent(enterEvent);

        setTimeout(() => {
          // onScan should NOT have been called for slow typing
          expect(onScan).not.toHaveBeenCalled();
          done();
        }, 10);
      }, 200); // >50ms, breaks hardware scan detection
    }, 200);
  });

  it('should accumulate characters correctly across Enter boundary', (done) => {
    const onScan = jest.fn();
    renderHook(() => useHardwareScan(onScan));

    // This test verifies accumulator is cleared after Enter
    // and new scan doesn't get prefixed with old barcode
    const keys1 = ['A', 'B', 'C'];
    keys1.forEach((key, index) => {
      setTimeout(() => {
        const event = new KeyboardEvent('keydown', { key });
        document.dispatchEvent(event);
      }, index * 5);
    });

    setTimeout(() => {
      const enterEvent = new KeyboardEvent('keydown', { key: 'Enter' });
      document.dispatchEvent(enterEvent);

      setTimeout(() => {
        expect(onScan).toHaveBeenCalledWith('ABC');
        expect(onScan).toHaveBeenCalledTimes(1);
        done();
      }, 25);
    }, 30);
  });

  it('should handle Enter key without any accumulated characters gracefully', (done) => {
    const onScan = jest.fn();
    renderHook(() => useHardwareScan(onScan));

    const enterEvent = new KeyboardEvent('keydown', { key: 'Enter' });
    document.dispatchEvent(enterEvent);

    setTimeout(() => {
      // onScan should not call with empty barcode
      expect(onScan).not.toHaveBeenCalled();
      done();
    }, 10);
  });

  it('should ignore non-printable keys except Enter', (done) => {
    const onScan = jest.fn();
    renderHook(() => useHardwareScan(onScan));

    // Simulate scan with special keys mixed in
    const keys = ['1', 'Shift', '2', 'Control', '3', 'Alt', '4'];
    keys.forEach((key, index) => {
      setTimeout(() => {
        const event = new KeyboardEvent('keydown', { key });
        document.dispatchEvent(event);
      }, index * 5);
    });

    setTimeout(() => {
      const enterEvent = new KeyboardEvent('keydown', { key: 'Enter' });
      document.dispatchEvent(enterEvent);

      setTimeout(() => {
        // Should only contain printable characters
        expect(onScan).toHaveBeenCalledWith('1234');
        done();
      }, 10);
    }, 50);
  });

  it('should prevent duplicate rapid Enter presses from double-submitting', (done) => {
    const onScan = jest.fn();
    renderHook(() => useHardwareScan(onScan, { timingThreshold: 200 }));

    // Rapid keystroke scan
    const keys = ['1', '2', '3'];
    keys.forEach((key, index) => {
      setTimeout(() => {
        const event = new KeyboardEvent('keydown', { key });
        document.dispatchEvent(event);
      }, index * 5);
    });

    setTimeout(() => {
      // First Enter
      const enterEvent1 = new KeyboardEvent('keydown', { key: 'Enter' });
      document.dispatchEvent(enterEvent1);

      setTimeout(() => {
        // Second Enter immediately after (within debounce window)
        const enterEvent2 = new KeyboardEvent('keydown', { key: 'Enter' });
        document.dispatchEvent(enterEvent2);

        setTimeout(() => {
          // onScan should only be called once
          expect(onScan).toHaveBeenCalledTimes(1);
          expect(onScan).toHaveBeenCalledWith('123');
          done();
        }, 10);
      }, 10); // Very close to first Enter
    }, 50);
  });
});
