import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { HandheldScanToolbar } from '../HandheldScanToolbar';
import { HandheldProvider } from '../../contexts/HandheldContext';

// Mock the useHandheldDetectionContext hook
vi.mock('../../contexts/HandheldContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../contexts/HandheldContext')>()),
  useHandheldDetectionContext: vi.fn(),
}));

const mockUseHandheldDetectionContext = (await import('../../contexts/HandheldContext'))
  .useHandheldDetectionContext as unknown as jest.Mock;

describe('HandheldScanToolbar', () => {
  const mockOnSyncNow = vi.fn();
  const mockOnSettingsClick = vi.fn();

  const defaultProps = {
    userName: 'John Doe',
    syncStatus: 'synced' as const,
    onSyncNow: mockOnSyncNow,
    onSettingsClick: mockOnSettingsClick,
    queueLength: 0,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseHandheldDetectionContext.mockReturnValue({
      isHandheld: true,
      detectionResult: {
        isHandheld: true,
        method: 'userAgent',
        screenWidth: 480,
        screenHeight: 800,
      },
      syncStrategy: 'real-time', // ✓ Default sync strategy
      setSyncStrategy: vi.fn(), // ✓ Sync strategy setter
      hapticEnabled: true,
      audioFeedbackEnabled: false,
      setHapticEnabled: vi.fn(),
      setAudioFeedbackEnabled: vi.fn(),
      refreshDetection: vi.fn(),
    });
  });

  it('renders user name when provided', () => {
    render(
      <HandheldProvider>
        <HandheldScanToolbar {...defaultProps} />
      </HandheldProvider>,
    );

    expect(screen.getByText('John Doe')).toBeInTheDocument();
  });

  it('displays sync status indicators', () => {
    render(
      <HandheldProvider>
        <HandheldScanToolbar {...defaultProps} syncStatus="syncing" />
      </HandheldProvider>,
    );

    expect(screen.getByText('Syncing...')).toBeInTheDocument();
  });

  it('shows different sync status messages', () => {
    const { rerender } = render(
      <HandheldProvider>
        <HandheldScanToolbar {...defaultProps} syncStatus="synced" />
      </HandheldProvider>,
    );

    expect(screen.getByText('Synced')).toBeInTheDocument();

    rerender(
      <HandheldProvider>
        <HandheldScanToolbar {...defaultProps} syncStatus="offline" />
      </HandheldProvider>,
    );

    expect(screen.getByText('Offline')).toBeInTheDocument();

    rerender(
      <HandheldProvider>
        <HandheldScanToolbar {...defaultProps} syncStatus="failed" />
      </HandheldProvider>,
    );

    expect(screen.getByText('Sync Failed')).toBeInTheDocument();
  });

  it('disables Sync Now button when queue is empty', () => {
    render(
      <HandheldProvider>
        <HandheldScanToolbar {...defaultProps} queueLength={0} />
      </HandheldProvider>,
    );

    const syncButton = screen.getByRole('button', { name: /sync now/i });
    expect(syncButton).toBeDisabled();
  });

  it('enables Sync Now button when queue has items', () => {
    render(
      <HandheldProvider>
        <HandheldScanToolbar {...defaultProps} queueLength={5} />
      </HandheldProvider>,
    );

    const syncButton = screen.getByRole('button', { name: /sync now/i });
    expect(syncButton).toBeEnabled();
  });

  it('calls onSyncNow when Sync Now button is clicked', () => {
    render(
      <HandheldProvider>
        <HandheldScanToolbar {...defaultProps} queueLength={3} />
      </HandheldProvider>,
    );

    const syncButton = screen.getByRole('button', { name: /sync now/i });
    fireEvent.click(syncButton);

    expect(mockOnSyncNow).toHaveBeenCalledTimes(1);
  });

  it('uses sync strategy from context', () => {
    mockUseHandheldDetectionContext.mockReturnValue({
      isHandheld: true,
      detectionResult: {
        isHandheld: true,
        method: 'userAgent',
        screenWidth: 480,
        screenHeight: 800,
      },
      syncStrategy: 'batch', // ✓ Correct enum value (not 'batch-10-min')
      setSyncStrategy: vi.fn(),
      hapticEnabled: true,
      audioFeedbackEnabled: false,
      setHapticEnabled: vi.fn(),
      setAudioFeedbackEnabled: vi.fn(),
      refreshDetection: vi.fn(),
    });

    render(
      <HandheldProvider>
        <HandheldScanToolbar {...defaultProps} />
      </HandheldProvider>,
    );

    // Toolbar should render successfully with context sync strategy
    expect(screen.getByTestId('handheld-scan-toolbar')).toBeInTheDocument();
  });

  it('renders settings button', () => {
    render(
      <HandheldProvider>
        <HandheldScanToolbar {...defaultProps} />
      </HandheldProvider>,
    );

    const settingsButton = screen.getByRole('button', { name: /settings/i });
    expect(settingsButton).toBeInTheDocument();
  });

  it('calls onSettingsClick when settings button is clicked', () => {
    render(
      <HandheldProvider>
        <HandheldScanToolbar {...defaultProps} />
      </HandheldProvider>,
    );

    const settingsButton = screen.getByRole('button', { name: /settings/i });
    fireEvent.click(settingsButton);

    expect(mockOnSettingsClick).toHaveBeenCalledTimes(1);
  });

  it('applies handheld-specific styling', () => {
    const { container } = render(
      <HandheldProvider>
        <HandheldScanToolbar {...defaultProps} />
      </HandheldProvider>,
    );

    const toolbar = container.querySelector('[data-testid="handheld-scan-toolbar"]');
    expect(toolbar).toHaveClass('handheld-scan-toolbar');
  });

  it('uses scanner adaptation classes for touch targets and focus treatment', () => {
    render(
      <HandheldProvider>
        <HandheldScanToolbar {...defaultProps} queueLength={1} />
      </HandheldProvider>,
    );

    expect(screen.getByTestId('handheld-scan-toolbar')).toHaveClass('scanner-context');
    expect(screen.getByRole('button', { name: /settings/i })).toHaveClass('min-h-[48px]');
    expect(screen.getByTestId('sync-now-button')).toHaveClass('min-h-[48px]');
  });

  it('positions as sticky toolbar with proper z-index', () => {
    const { container } = render(
      <HandheldProvider>
        <HandheldScanToolbar {...defaultProps} />
      </HandheldProvider>,
    );

    const toolbar = container.querySelector('[data-testid="handheld-scan-toolbar"]');
    expect(toolbar).toHaveClass('sticky');
    expect(toolbar).toHaveClass('z-40');
  });

  it('throws error when used outside HandheldProvider', () => {
    mockUseHandheldDetectionContext.mockImplementation(() => {
      throw new Error('useHandheldDetectionContext must be used within a HandheldProvider');
    });

    // Mock console.error to avoid noise in test output
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => {
      render(<HandheldScanToolbar {...defaultProps} />);
    }).toThrow('useHandheldDetectionContext must be used within a HandheldProvider');

    consoleSpy.mockRestore();
  });
});
