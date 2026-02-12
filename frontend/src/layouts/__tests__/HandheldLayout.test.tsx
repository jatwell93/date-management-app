import React from 'react';
import { render, screen } from '@testing-library/react';
import { HandheldLayout } from '../HandheldLayout';
import { HandheldProvider } from '../../contexts/HandheldContext';
import { HandheldScanToolbar } from '../../components/HandheldScanToolbar';

// Mock the HandheldScanToolbar component
jest.mock('../../components/HandheldScanToolbar', () => ({
  HandheldScanToolbar: ({ userName, syncStatus, onSyncNow, onSettingsClick, queueLength }: any) => (
    <div data-testid="handheld-scan-toolbar">
      <span>Toolbar Mock</span>
      <span data-testid="toolbar-user-name">{userName}</span>
      <span data-testid="toolbar-sync-status">{syncStatus}</span>
    </div>
  ),
}));

// Mock the useHandheldDetectionContext hook
jest.mock('../../contexts/HandheldContext', () => ({
  ...jest.requireActual('../../contexts/HandheldContext'),
  useHandheldDetectionContext: jest.fn(),
}));

const mockUseHandheldDetectionContext =
  require('../../contexts/HandheldContext').useHandheldDetectionContext;

describe('HandheldLayout', () => {
  const mockOnSyncNow = jest.fn();
  const mockOnSettingsClick = jest.fn();

  const defaultProps = {
    children: <div>Test Content</div>,
    userName: 'John Doe',
    syncStatus: 'synced' as const,
    onSyncNow: mockOnSyncNow,
    onSettingsClick: mockOnSettingsClick,
    queueLength: 0,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders children content', () => {
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
        <HandheldLayout {...defaultProps}>
          <div data-testid="child-content">Test Content</div>
        </HandheldLayout>
      </HandheldProvider>,
    );

    expect(screen.getByTestId('child-content')).toBeInTheDocument();
    expect(screen.getByText('Test Content')).toBeInTheDocument();
  });

  it('renders HandheldScanToolbar when isHandheld=true', () => {
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
        <HandheldLayout {...defaultProps}>
          <div>Content</div>
        </HandheldLayout>
      </HandheldProvider>,
    );

    expect(screen.getByTestId('handheld-scan-toolbar')).toBeInTheDocument();
  });

  it('does not render HandheldScanToolbar when isHandheld=false', () => {
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
        <HandheldLayout {...defaultProps}>
          <div>Content</div>
        </HandheldLayout>
      </HandheldProvider>,
    );

    expect(screen.queryByTestId('handheld-scan-toolbar')).not.toBeInTheDocument();
  });

  it('applies full viewport height styling for handheld devices', () => {
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
        <HandheldLayout {...defaultProps}>
          <div>Content</div>
        </HandheldLayout>
      </HandheldProvider>,
    );

    const layout = container.firstChild;
    expect(layout).toHaveClass('h-screen');
    expect(layout).toHaveClass('flex');
    expect(layout).toHaveClass('flex-col');
  });

  it('applies full-screen layout without max-width container for handheld devices', () => {
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
        <HandheldLayout {...defaultProps}>
          <div>Content</div>
        </HandheldLayout>
      </HandheldProvider>,
    );

    const mainContent = container.querySelector('main');
    expect(mainContent).toHaveClass('flex-1');
    expect(mainContent).not.toHaveClass('max-w-7xl');
    expect(mainContent).not.toHaveClass('mx-auto');
  });

  it('applies desktop layout with max-width container when isHandheld=false', () => {
    mockUseHandheldDetectionContext.mockReturnValue({
      isHandheld: false,
      detectionResult: {
        isHandheld: false,
        method: 'unknown',
        screenWidth: 1200,
        screenHeight: 800,
      },
    });

    const { container } = render(
      <HandheldProvider>
        <HandheldLayout {...defaultProps}>
          <div>Content</div>
        </HandheldLayout>
      </HandheldProvider>,
    );

    const mainContent = container.querySelector('main');
    expect(mainContent).toHaveClass('max-w-7xl');
    expect(mainContent).toHaveClass('mx-auto');
    expect(mainContent).toHaveClass('p-4');
  });

  it('passes toolbar props to HandheldScanToolbar', () => {
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
        <HandheldLayout {...defaultProps}>
          <div>Content</div>
        </HandheldLayout>
      </HandheldProvider>,
    );

    expect(screen.getByTestId('toolbar-user-name')).toHaveTextContent('John Doe');
    expect(screen.getByTestId('toolbar-sync-status')).toHaveTextContent('synced');
  });

  it('throws error when used outside HandheldProvider', () => {
    mockUseHandheldDetectionContext.mockImplementation(() => {
      throw new Error('useHandheldDetectionContext must be used within a HandheldProvider');
    });

    // Mock console.error to avoid noise in test output
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => {
      render(
        <HandheldLayout {...defaultProps}>
          <div>Content</div>
        </HandheldLayout>,
      );
    }).toThrow('useHandheldDetectionContext must be used within a HandheldProvider');

    consoleSpy.mockRestore();
  });
});
