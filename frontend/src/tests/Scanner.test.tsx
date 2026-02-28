import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Scanner } from '../components/Scanner';
import '@testing-library/jest-dom';

// Add the CameraScanner mock here
jest.mock('../components/CameraScanner', () => ({
  CameraScanner: ({ onDetected }: { onDetected: (barcode: string) => void }) => (
    <div>
      <div>Camera Scanner</div>
      <button onClick={() => onDetected('CAMERA_SCAN_123')}>Trigger Scan</button>
    </div>
  ),
}));

// Mock Quagga for camera mode
jest.mock('quagga', () => ({
  init: jest.fn(),
  start: jest.fn(),
  stop: jest.fn(),
  onDetected: jest.fn(),
  offDetected: jest.fn(),
}));

// Mock `navigator.mediaDevices`
Object.defineProperty(global.navigator, 'mediaDevices', {
  value: {
    getUserMedia: jest.fn().mockResolvedValue({
      getTracks: () => [{ stop: jest.fn() }],
    }),
  },
  writable: true,
});

// Mock the useHardwareScan hook
jest.mock('../hooks/useHardwareScan', () => ({
  useHardwareScan: jest.fn(),
}));

// Import the mocked hook
import { useHardwareScan } from '../hooks/useHardwareScan';

// Import Quagga for mocking
import Quagga from 'quagga';

const mockUseHardwareScan = useHardwareScan as jest.MockedFunction<typeof useHardwareScan>;

describe('Scanner', () => {
  const mockOnScan = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    // Default mock implementation - hook returns void (no return value)
    mockUseHardwareScan.mockImplementation(() => {
      // No return value - side effect based hook
    });

    // Default Quagga mock - success
    (Quagga.init as jest.Mock).mockImplementation((config, callback) => {
      callback(null); // Success
    });
  });

  it('renders the scanner input and button', () => {
    render(<Scanner onScan={mockOnScan} />);
    expect(screen.getByPlaceholderText(/Scan barcode or enter manually/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Submit/i })).toBeInTheDocument();
  });

  it('calls onScan with the entered barcode when button is clicked', () => {
    render(<Scanner onScan={mockOnScan} />);

    fireEvent.change(screen.getByPlaceholderText(/Scan barcode or enter manually/i), {
      target: { value: '12345' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Submit/i }));

    expect(mockOnScan).toHaveBeenCalledWith(
      expect.objectContaining({
        barcode: '12345',
        source: 'manual',
        timestamp: expect.any(Number),
      }),
    );
    expect(screen.getByPlaceholderText(/Scan barcode or enter manually/i)).toHaveValue(''); // Input should be cleared
  });

  it('calls onScan with the entered barcode when form is submitted', () => {
    render(<Scanner onScan={mockOnScan} />);

    const input = screen.getByPlaceholderText(/Scan barcode or enter manually/i);
    fireEvent.change(input, {
      target: { value: '67890' },
    });

    // Submit the form
    const form = input.closest('form');
    fireEvent.submit(form!);

    expect(mockOnScan).toHaveBeenCalledWith(
      expect.objectContaining({
        barcode: '67890',
        source: 'manual',
        timestamp: expect.any(Number),
      }),
    );
    expect(screen.getByPlaceholderText(/Scan barcode or enter manually/i)).toHaveValue(''); // Input should be cleared
  });

  it('does not call onScan if barcode is empty', () => {
    render(<Scanner onScan={mockOnScan} />);

    fireEvent.click(screen.getByRole('button', { name: /Submit/i }));
    expect(mockOnScan).not.toHaveBeenCalled();
  });

  describe('defaultMode prop', () => {
    it('starts in text mode by default', () => {
      render(<Scanner onScan={mockOnScan} />);
      expect(screen.getByPlaceholderText(/Scan barcode or enter manually/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Use Camera/i })).toBeInTheDocument();
    });

    it('starts in camera mode when defaultMode="camera"', () => {
      render(<Scanner onScan={mockOnScan} defaultMode="camera" />);
      expect(screen.getAllByText(/Camera Scanner/i).length).toBeGreaterThan(0);
      expect(screen.getByRole('button', { name: /Use Text Input/i })).toBeInTheDocument();
    });
  });

  describe('hardware scan integration', () => {
    it('initializes useHardwareScan hook', () => {
      render(<Scanner onScan={mockOnScan} />);

      // Hook should be called with a callback function and options
      expect(mockUseHardwareScan).toHaveBeenCalledWith(expect.any(Function), expect.any(Object));
    });

    it('routes hardware scan through onScan callback as HardwareScanResult', () => {
      let capturedOnScanCallback: ((barcode: string) => void) | null = null;

      mockUseHardwareScan.mockImplementation((cb) => {
        capturedOnScanCallback = cb;
      });

      render(<Scanner onScan={mockOnScan} />);

      // Simulate hardware scan callback
      act(() => {
        if (capturedOnScanCallback) {
          capturedOnScanCallback('123456789');
        }
      });

      // Verify onScan was called with HardwareScanResult
      expect(mockOnScan).toHaveBeenCalledWith(
        expect.objectContaining({
          barcode: '123456789',
          source: 'hardware',
          timestamp: expect.any(Number),
        }),
      );
    });
  });

  describe('camera mode switching', () => {
    it('switches to camera mode when Use Camera button is clicked', () => {
      render(<Scanner onScan={mockOnScan} />);

      fireEvent.click(screen.getByRole('button', { name: /Use Camera/i }));

      expect(screen.getAllByText(/Camera Scanner/i).length).toBeGreaterThan(0);
      expect(screen.getByRole('button', { name: /Use Text Input/i })).toBeInTheDocument();
    });

    it('switches back to text mode when Use Text Input button is clicked', () => {
      render(<Scanner onScan={mockOnScan} defaultMode="camera" />);

      fireEvent.click(screen.getByRole('button', { name: /Use Text Input/i }));

      expect(screen.getByPlaceholderText(/Scan barcode or enter manually/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Use Camera/i })).toBeInTheDocument();
    });
  });
});
