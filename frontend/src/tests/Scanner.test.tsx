import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { Scanner } from '../components/Scanner';
import '@testing-library/jest-dom';

// Import the mocked hook
import { useHardwareScan } from '../hooks/useHardwareScan';

// Import Quagga for mocking
import Quagga from 'quagga';

// Add the CameraScanner mock here
jest.mock('../components/CameraScanner', () => ({
  CameraScanner: ({
    onDetected,
    disabled,
  }: {
    onDetected: (barcode: string) => void;
    disabled?: boolean;
  }) => (
    <div>
      <div>Camera Scanner</div>
      <button disabled={disabled} onClick={() => onDetected('CAMERA_SCAN_123')}>
        Trigger Scan
      </button>
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
    expect(screen.getByLabelText(/Barcode or SKU/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Use barcode/i })).toBeInTheDocument();
    expect(screen.getByTestId('scanner-state-indicator')).toBeInTheDocument();
  });

  it('disables manual, camera, and hardware scan entry points when disabled', () => {
    let capturedOnScanCallback: ((barcode: string) => void) | null = null;
    mockUseHardwareScan.mockImplementation((cb) => {
      capturedOnScanCallback = cb;
    });

    render(<Scanner onScan={mockOnScan} disabled />);

    const input = screen.getByLabelText(/Barcode or SKU/i);
    expect(input).toBeDisabled();
    expect(screen.getByRole('button', { name: /Use barcode/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Use Camera/i })).toBeDisabled();

    fireEvent.change(input, { target: { value: '12345' } });
    fireEvent.click(screen.getByRole('button', { name: /Use barcode/i }));

    act(() => {
      if (capturedOnScanCallback) {
        capturedOnScanCallback('987654321');
      }
    });

    expect(mockOnScan).not.toHaveBeenCalled();
  });

  it('keeps camera scan controls disabled in camera mode when disabled', async () => {
    render(<Scanner onScan={mockOnScan} defaultMode="camera" disabled />);

    expect(screen.getByRole('button', { name: /Use Text Input/i })).toBeDisabled();
    expect(await screen.findByRole('button', { name: /Trigger Scan/i })).toBeDisabled();
  });

  it('calls onScan with the entered barcode when button is clicked', () => {
    render(<Scanner onScan={mockOnScan} />);

    fireEvent.change(screen.getByLabelText(/Barcode or SKU/i), {
      target: { value: '12345' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Use barcode/i }));

    expect(mockOnScan).toHaveBeenCalledWith(
      expect.objectContaining({
        barcode: '12345',
        source: 'manual',
        timestamp: expect.any(Number),
      }),
    );
    expect(screen.getByLabelText(/Barcode or SKU/i)).toHaveValue(''); // Input should be cleared
    expect(screen.getByText(/Item scanned/i)).toBeInTheDocument();
  });

  it('calls onScan with the entered barcode when form is submitted', () => {
    render(<Scanner onScan={mockOnScan} />);

    const input = screen.getByLabelText(/Barcode or SKU/i);
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
    expect(screen.getByLabelText(/Barcode or SKU/i)).toHaveValue(''); // Input should be cleared
  });

  it('does not call onScan if barcode is empty', () => {
    render(<Scanner onScan={mockOnScan} />);

    fireEvent.click(screen.getByRole('button', { name: /Use barcode/i }));
    expect(mockOnScan).not.toHaveBeenCalled();
  });

  describe('defaultMode prop', () => {
    it('starts in text mode by default', () => {
      render(<Scanner onScan={mockOnScan} />);
      expect(screen.getByLabelText(/Barcode or SKU/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Use Camera/i })).toBeInTheDocument();
    });

    it('starts in camera mode when defaultMode="camera"', async () => {
      render(<Scanner onScan={mockOnScan} defaultMode="camera" />);
      await waitFor(() => {
        expect(screen.getAllByText(/Camera Scanner/i).length).toBeGreaterThan(0);
      });
      expect(screen.getByRole('button', { name: /Use Text Input/i })).toBeInTheDocument();
      expect(screen.queryByTestId('scanner-state-indicator')).not.toBeInTheDocument();
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
    it('switches to camera mode when Use Camera button is clicked', async () => {
      render(<Scanner onScan={mockOnScan} />);

      fireEvent.click(screen.getByRole('button', { name: /Use Camera/i }));

      await waitFor(() => {
        expect(screen.getAllByText(/Camera Scanner/i).length).toBeGreaterThan(0);
      });
      expect(screen.getByRole('button', { name: /Use Text Input/i })).toBeInTheDocument();
    });

    it('switches back to text mode when Use Text Input button is clicked', async () => {
      render(<Scanner onScan={mockOnScan} defaultMode="camera" />);

      await screen.findByRole('button', { name: /Trigger Scan/i });
      fireEvent.click(screen.getByRole('button', { name: /Use Text Input/i }));

      expect(screen.getByLabelText(/Barcode or SKU/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Use Camera/i })).toBeInTheDocument();
    });
  });
});
