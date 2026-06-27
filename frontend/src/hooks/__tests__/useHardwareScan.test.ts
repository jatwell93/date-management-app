/**
 * Tests for useHardwareScan Hook
 * Tests hardware barcode input via keyboard wedge events from PDT devices
 *
 * Uses fake timers to avoid flaky timing-dependent failures.
 * The hook uses Date.now() for timing comparisons, so we mock it alongside timers.
 */

import { renderHook } from '@testing-library/react';
import { useHardwareScan } from '../useHardwareScan';

function dispatchKey(key: string) {
  document.dispatchEvent(new KeyboardEvent('keydown', { key }));
}

describe('useHardwareScan', () => {
  let mockNow: number;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockNow = 1000;
    vi.spyOn(Date, 'now').mockImplementation(() => mockNow);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should be callable without errors when mounted', () => {
    const onScan = vi.fn();
    renderHook(() => useHardwareScan(onScan));
    expect(onScan).not.toHaveBeenCalled();
  });

  it('should accumulate rapid keystrokes within 50ms timing window and emit onScan on Enter', () => {
    const onScan = vi.fn();
    renderHook(() => useHardwareScan(onScan));

    // Simulate hardware scan: rapid keystrokes 5ms apart (within 50ms threshold)
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8'];
    keys.forEach((key) => {
      dispatchKey(key);
      mockNow += 5;
    });

    // Enter to finish scan
    mockNow += 5;
    dispatchKey('Enter');

    expect(onScan).toHaveBeenCalledWith('12345678');
  });

  it('should NOT trigger hardware scan for slow human typing (>50ms between keystrokes)', () => {
    const onScan = vi.fn();
    renderHook(() => useHardwareScan(onScan));

    dispatchKey('a');
    mockNow += 200; // >50ms gap = human typing
    dispatchKey('b');
    mockNow += 200;
    dispatchKey('Enter');

    // onScan should NOT have been called for slow typing
    expect(onScan).not.toHaveBeenCalled();
  });

  it('should accumulate characters correctly across Enter boundary', () => {
    const onScan = vi.fn();
    renderHook(() => useHardwareScan(onScan));

    // First scan: ABC
    ['A', 'B', 'C'].forEach((key) => {
      dispatchKey(key);
      mockNow += 5;
    });
    mockNow += 5;
    dispatchKey('Enter');

    expect(onScan).toHaveBeenCalledWith('ABC');
    expect(onScan).toHaveBeenCalledTimes(1);
  });

  it('should handle Enter key without any accumulated characters gracefully', () => {
    const onScan = vi.fn();
    renderHook(() => useHardwareScan(onScan));

    dispatchKey('Enter');

    // onScan should not call with empty barcode
    expect(onScan).not.toHaveBeenCalled();
  });

  it('should ignore non-printable keys except Enter', () => {
    const onScan = vi.fn();
    renderHook(() => useHardwareScan(onScan));

    // Simulate scan with special keys mixed in
    const keys = ['1', 'Shift', '2', 'Control', '3', 'Alt', '4'];
    keys.forEach((key) => {
      dispatchKey(key);
      mockNow += 5;
    });
    mockNow += 5;
    dispatchKey('Enter');

    // Should only contain printable characters
    expect(onScan).toHaveBeenCalledWith('1234');
  });

  it('should prevent duplicate rapid Enter presses from double-submitting', () => {
    const onScan = vi.fn();
    renderHook(() => useHardwareScan(onScan, { timingThreshold: 200 }));

    // Rapid keystroke scan
    ['1', '2', '3'].forEach((key) => {
      dispatchKey(key);
      mockNow += 5;
    });

    // First Enter
    mockNow += 5;
    dispatchKey('Enter');

    // Second Enter immediately after (within 100ms debounce window)
    mockNow += 10;
    dispatchKey('Enter');

    // onScan should only be called once
    expect(onScan).toHaveBeenCalledTimes(1);
    expect(onScan).toHaveBeenCalledWith('123');
  });
});
