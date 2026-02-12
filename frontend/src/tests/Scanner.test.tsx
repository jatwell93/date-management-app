import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Scanner } from '../components/Scanner';
import { HardwareScanResult } from '../types/handheld';
import '@testing-library/jest-dom';

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
    // Default mock implementation
    mockUseHardwareScan.mockReturnValue({
      isListening: true,
      clearBuffer: jest.fn(),
      lastScan: null,
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

    expect(mockOnScan).toHaveBeenCalledWith('12345');
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

    expect(mockOnScan).toHaveBeenCalledWith('67890');
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
      expect(screen.getByText(/Camera Scanner/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Use Text Input/i })).toBeInTheDocument();
    });
  });

  describe('hardware scan integration', () => {
    it('initializes useHardwareScan hook with correct props', () => {
      render(<Scanner onScan={mockOnScan} />);

      expect(mockUseHardwareScan).toHaveBeenCalledWith({
        onScan: expect.any(Function),
        enabled: true,
      });
    });

    it('routes hardware scan results through onScan callback', () => {
      let capturedOnScanCallback: ((result: HardwareScanResult) => void) | null = null;

      mockUseHardwareScan.mockImplementation((config) => {
        capturedOnScanCallback = config.onScan;
        return {
          isListening: true,
          clearBuffer: jest.fn(),
          lastScan: null,
        };
      });

      render(<Scanner onScan={mockOnScan} />);

      // Simulate hardware scan
      const mockHardwareResult: HardwareScanResult = {
        barcode: '987654321',
        timestamp: Date.now(),
        source: 'hardware',
        gs1Data: {
          raw: '(01)98765432109876',
          gtin: '98765432109876',
          isValid: true,
          errors: [],
        },
      };

      act(() => {
        if (capturedOnScanCallback) {
          capturedOnScanCallback(mockHardwareResult);
        }
      });

      expect(mockOnScan).toHaveBeenCalledWith('987654321');
    });

    it('handles hardware scans without GS1 data', () => {
      let capturedOnScanCallback: ((result: HardwareScanResult) => void) | null = null;

      mockUseHardwareScan.mockImplementation((config) => {
        capturedOnScanCallback = config.onScan;
        return {
          isListening: true,
          clearBuffer: jest.fn(),
          lastScan: null,
        };
      });

      render(<Scanner onScan={mockOnScan} />);

      // Simulate hardware scan without GS1 data
      const mockHardwareResult: HardwareScanResult = {
        barcode: '123456789',
        timestamp: Date.now(),
        source: 'hardware',
      };

      act(() => {
        if (capturedOnScanCallback) {
          capturedOnScanCallback(mockHardwareResult);
        }
      });

      expect(mockOnScan).toHaveBeenCalledWith('123456789');
    });
  });

  describe('camera mode switching', () => {
    it('switches to camera mode when Use Camera button is clicked', () => {
      render(<Scanner onScan={mockOnScan} />);

      fireEvent.click(screen.getByRole('button', { name: /Use Camera/i }));

      expect(screen.getByText(/Camera Scanner/i)).toBeInTheDocument();
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
