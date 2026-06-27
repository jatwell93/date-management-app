import React from 'react';
import { render, screen } from '@testing-library/react';
import { HandheldScanner } from '../HandheldScanner';
import { HandheldProvider } from '../../contexts/HandheldContext';

// Mock the Scanner component
vi.mock('../Scanner', () => ({
  Scanner: ({ onScan, defaultMode }: any) => (
    <div data-testid="scanner-mock">
      <span>Scanner Mock</span>
      <span data-testid="default-mode">{defaultMode}</span>
      <button
        data-testid="mock-scanner-button"
        onClick={() =>
          onScan({
            barcode: '1234567890',
            timestamp: Date.now(),
            source: 'camera' as const,
          })
        }
      >
        Trigger Scan
      </button>
    </div>
  ),
}));

// Mock the useHandheldDetectionContext hook
vi.mock('../../contexts/HandheldContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../contexts/HandheldContext')>()),
  useHandheldDetectionContext: vi.fn(),
}));

const mockUseHandheldDetectionContext = (await import('../../contexts/HandheldContext'))
  .useHandheldDetectionContext as unknown as jest.Mock;

describe('HandheldScanner', () => {
  const mockOnScan = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders Scanner with defaultMode="camera" when isHandheld=true', () => {
    mockUseHandheldDetectionContext.mockReturnValue({
      isHandheld: true,
      detectionResult: {
        isHandheld: true,
        method: 'userAgent',
        screenWidth: 480,
        screenHeight: 800,
      },
    });

    render(
      <HandheldProvider>
        <HandheldScanner onScan={mockOnScan} />
      </HandheldProvider>,
    );

    expect(screen.getByTestId('scanner-mock')).toBeInTheDocument();
    expect(screen.getByTestId('default-mode')).toHaveTextContent('camera');
  });

  it('renders Scanner with defaultMode="text" when isHandheld=false', () => {
    mockUseHandheldDetectionContext.mockReturnValue({
      isHandheld: false,
      detectionResult: {
        isHandheld: false,
        method: 'unknown',
        screenWidth: 1200,
        screenHeight: 800,
      },
    });

    render(
      <HandheldProvider>
        <HandheldScanner onScan={mockOnScan} />
      </HandheldProvider>,
    );

    expect(screen.getByTestId('scanner-mock')).toBeInTheDocument();
    expect(screen.getByTestId('default-mode')).toHaveTextContent('text');
  });

  it('applies handheld-specific styling classes', () => {
    mockUseHandheldDetectionContext.mockReturnValue({
      isHandheld: true,
      detectionResult: {
        isHandheld: true,
        method: 'userAgent',
        screenWidth: 480,
        screenHeight: 800,
      },
    });

    const { container } = render(
      <HandheldProvider>
        <HandheldScanner onScan={mockOnScan} />
      </HandheldProvider>,
    );

    // Check for handheld-specific classes
    const handheldScanner = container.firstChild;
    expect(handheldScanner).toHaveClass('handheld-scanner');
    expect(handheldScanner).toHaveClass('scanner-context');
  });

  it('passes onScan prop to Scanner component', () => {
    mockUseHandheldDetectionContext.mockReturnValue({
      isHandheld: true,
      detectionResult: {
        isHandheld: true,
        method: 'userAgent',
        screenWidth: 480,
        screenHeight: 800,
      },
    });

    render(
      <HandheldProvider>
        <HandheldScanner onScan={mockOnScan} />
      </HandheldProvider>,
    );

    // The mock Scanner should receive the onScan prop
    expect(screen.getByTestId('scanner-mock')).toBeInTheDocument();
  });

  it('throws error when used outside HandheldProvider', () => {
    mockUseHandheldDetectionContext.mockImplementation(() => {
      throw new Error('useHandheldDetectionContext must be used within a HandheldProvider');
    });

    // Mock console.error to avoid noise in test output
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => {
      render(<HandheldScanner onScan={mockOnScan} />);
    }).toThrow('useHandheldDetectionContext must be used within a HandheldProvider');

    consoleSpy.mockRestore();
  });
});
