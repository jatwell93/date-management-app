import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { CameraScanner } from '../CameraScanner';
import Quagga from 'quagga';
import userEvent from '@testing-library/user-event';

// Mock Quagga
jest.mock('quagga', () => ({
  init: jest.fn(),
  start: jest.fn(),
  stop: jest.fn(),
  onDetected: jest.fn(),
  offDetected: jest.fn(),
}));

describe('CameraScanner', () => {
  const mockOnDetected = jest.fn();
  const mockOnScannerReady = jest.fn();
  const mockOnScannerReset = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('initializes Quagga on mount', () => {
    render(<CameraScanner onDetected={mockOnDetected} />);
    
    expect(Quagga.init).toHaveBeenCalledTimes(1);
    // Check config if needed
    expect(Quagga.init).toHaveBeenCalledWith(
      expect.objectContaining({
        inputStream: expect.objectContaining({
          type: 'LiveStream',
        }),
      }),
      expect.any(Function)
    );
  });

  it('starts scanner when initialization succeeds', () => {
    // Mock init to call the callback with no error
    (Quagga.init as jest.Mock).mockImplementation((config, callback) => {
      callback(null); // Success
    });

    render(<CameraScanner onDetected={mockOnDetected} onScannerReady={mockOnScannerReady} />);
    
    expect(Quagga.start).toHaveBeenCalled();
    expect(mockOnScannerReady).toHaveBeenCalled();
  });

  it('handles initialization error', () => {
    // Mock init to call callback WITH error
    (Quagga.init as jest.Mock).mockImplementation((config, callback) => {
      callback(new Error('Permission denied'));
    });

    render(<CameraScanner onDetected={mockOnDetected} />);
    
    expect(Quagga.start).not.toHaveBeenCalled();
    // Expect error message
    expect(screen.getByText(/Camera Error/i)).toBeInTheDocument();
  });

  it('calls onDetected when code is scanned', () => {
    // Capture the onDetected callback
    let onDetectedCallback: Function | null = null;
    (Quagga.onDetected as jest.Mock).mockImplementation((cb) => {
      onDetectedCallback = cb;
    });

    render(<CameraScanner onDetected={mockOnDetected} />);

    // Trigger detection
    const mockData = { codeResult: { code: '123456' } };
    act(() => {
      if (onDetectedCallback) {
        onDetectedCallback(mockData);
      }
    });

    expect(mockOnDetected).toHaveBeenCalledWith('123456');
  });

  it('stops scanner after detection (after delay)', () => {
    jest.useFakeTimers();
    let onDetectedCallback: Function | null = null;
    (Quagga.onDetected as jest.Mock).mockImplementation((cb) => {
      onDetectedCallback = cb;
    });

    render(<CameraScanner onDetected={mockOnDetected} />);

    act(() => {
      if (onDetectedCallback) {
        onDetectedCallback({ codeResult: { code: '123456' } });
      }
    });

    // Should NOT have stopped yet (1s delay)
    expect(Quagga.stop).not.toHaveBeenCalled();

    // Advance time
    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(Quagga.stop).toHaveBeenCalled();
    jest.useRealTimers();
  });
  
  it('stops scanner on unmount', () => {
      const { unmount } = render(<CameraScanner onDetected={mockOnDetected} />);
      unmount();
      expect(Quagga.stop).toHaveBeenCalled();
  });

  it('resets scanner when retry button is clicked', () => {
    jest.useFakeTimers();

    // 1. Mock failure first.
    (Quagga.init as jest.Mock).mockImplementationOnce((config, callback) => {
      callback(new Error('Permission denied'));
    });

    render(<CameraScanner onDetected={mockOnDetected} />);
    
    // Verify error and retry button
    const retryButton = screen.getByText(/Try Again/i);
    expect(retryButton).toBeInTheDocument();
    
    // Clear mocks to track calls during reset
    jest.clearAllMocks();
    
    // 2. Click retry
    userEvent.click(retryButton);
    
    // Verity stop called immediately
    expect(Quagga.stop).toHaveBeenCalled();
    
    // 3. Fast forward for timeout
    act(() => {
        jest.advanceTimersByTime(300);
    });
    
    // 4. Verify start called
    expect(Quagga.start).toHaveBeenCalled();
    
    jest.useRealTimers();
  });
});
