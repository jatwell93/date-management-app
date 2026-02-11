/**
 * Smoke Tests for StorageQuotaWarning Integration
 *
 * These tests verify the modal integrates correctly with the main app
 * and behaves as expected in realistic scenarios.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import fetchMock from 'jest-fetch-mock';
import { StorageQuotaWarning } from '../StorageQuotaWarning';

// Mock the App component parts we need
const MockAppWithStorageWarning: React.FC<{
  userId: number;
  tier: 'free' | 'pro' | 'enterprise';
}> = ({ userId, tier }) => {
  const [showWarning, setShowWarning] = React.useState(true);

  if (!showWarning) {
    return <div>Warning dismissed</div>;
  }

  return (
    <div>
      <h1>Main App Content</h1>
      <StorageQuotaWarning
        userId={userId}
        subscriptionTier={tier}
        onDismiss={() => setShowWarning(false)}
        onUpgrade={() => console.log('Navigate to upgrade')}
      />
    </div>
  );
};

describe('StorageQuotaWarning - Smoke Tests', () => {
  beforeEach(() => {
    fetchMock.resetMocks();
    localStorage.clear();
    jest.clearAllMocks();
  });

  describe('Integration with App', () => {
    it('should show warning overlay when storage exceeds 80% on free tier', async () => {
      localStorage.setItem('authToken', 'mock-token');
      fetchMock.mockResponseOnce(
        JSON.stringify({
          used: 858993459, // ~81.9%
          limit: 1073741824, // 1 GB
          percentageUsed: 81.9,
          tier: 'free',
          displayLimit: '1 GB',
          warningThreshold: 80,
          isWarning: true,
        }),
      );

      render(<MockAppWithStorageWarning userId={1} tier="free" />);

      // Verify main app content still visible
      expect(screen.getByText('Main App Content')).toBeInTheDocument();

      // Verify warning modal appears over the content
      await waitFor(() => {
        expect(screen.getByText(/Storage Quota Warning/i)).toBeInTheDocument();
        expect(screen.getByText(/81\.9%/)).toBeInTheDocument();
      });
    });

    it('should not interfere with app when storage is below 80%', async () => {
      localStorage.setItem('authToken', 'mock-token');
      fetchMock.mockResponseOnce(
        JSON.stringify({
          used: 536870912, // ~50%
          limit: 1073741824, // 1 GB
          percentageUsed: 50,
          tier: 'free',
          displayLimit: '1 GB',
          warningThreshold: 80,
          isWarning: false, // No warning
        }),
      );

      render(<MockAppWithStorageWarning userId={1} tier="free" />);

      // Main app content should be visible
      expect(screen.getByText('Main App Content')).toBeInTheDocument();

      // Warning should not appear
      await waitFor(() => {
        expect(screen.queryByText(/Storage Quota Warning/i)).not.toBeInTheDocument();
      });
    });

    it('should allow app interaction after dismissing warning', async () => {
      localStorage.setItem('authToken', 'mock-token');
      fetchMock.mockResponseOnce(
        JSON.stringify({
          used: 858993459, // ~81.9%
          limit: 1073741824,
          percentageUsed: 81.9,
          tier: 'free',
          displayLimit: '1 GB',
          warningThreshold: 80,
          isWarning: true,
        }),
      );

      render(<MockAppWithStorageWarning userId={1} tier="free" />);

      // Wait for warning to appear
      await waitFor(() => {
        expect(screen.getByText(/Storage Quota Warning/i)).toBeInTheDocument();
      });

      // Dismiss the warning
      const dismissButton = screen.getByText('Remind Me Later');
      await userEvent.click(dismissButton);

      // Verify modal is gone
      expect(screen.queryByText(/Storage QuotaWarning/i)).not.toBeInTheDocument();

      // Verify main app still accessible
      expect(screen.getByText('Warning dismissed')).toBeInTheDocument();
    });
  });

  describe('Real-world Scenarios', () => {
    it('should warn free tier user at 85% usage', async () => {
      localStorage.setItem('authToken', 'test-token');
      const freeLimit = 1 * 1024 * 1024 * 1024; // 1 GB
      const usage = Math.floor(freeLimit * 0.85); // 85%

      fetchMock.mockResponseOnce(
        JSON.stringify({
          used: usage,
          limit: freeLimit,
          percentageUsed: 85,
          tier: 'free',
          displayLimit: '1 GB',
          warningThreshold: 80,
          isWarning: true,
        }),
      );

      render(<MockAppWithStorageWarning userId={1} tier="free" />);

      await waitFor(() => {
        expect(screen.getByText(/85%/)).toBeInTheDocument();
        expect(screen.getByText(/Upgrade Plan/i)).toBeInTheDocument();
      });
    });

    it('should warn pro tier user at 90% usage (9GB of 10GB)', async () => {
      localStorage.setItem('authToken', 'test-token');
      const proLimit = 10 * 1024 * 1024 * 1024; // 10 GB
      const usage = Math.floor(proLimit * 0.9); // 90%

      fetchMock.mockResponseOnce(
        JSON.stringify({
          used: usage,
          limit: proLimit,
          percentageUsed: 90,
          tier: 'pro',
          displayLimit: '10 GB',
          warningThreshold: 80,
          isWarning: true,
        }),
      );

      render(<MockAppWithStorageWarning userId={2} tier="pro" />);

      await waitFor(() => {
        expect(screen.getByText(/90%/)).toBeInTheDocument();
        expect(screen.getByText(/Pro/)).toBeInTheDocument();
        expect(screen.getByText('10 GB')).toBeInTheDocument();
      });
    });

    it('should warn at exactly 100% usage', async () => {
      localStorage.setItem('authToken', 'test-token');
      const limit = 1 * 1024 * 1024 * 1024;

      fetchMock.mockResponseOnce(
        JSON.stringify({
          used: limit, // Exactly at limit
          limit: limit,
          percentageUsed: 100,
          tier: 'free',
          displayLimit: '1 GB',
          warningThreshold: 80,
          isWarning: true,
        }),
      );

      render(<MockAppWithStorageWarning userId={1} tier="free" />);

      await waitFor(() => {
        expect(screen.getByText(/100%/)).toBeInTheDocument();
        expect(screen.getByText(/reached your storage limit/i)).toBeInTheDocument();
      });
    });

    it('should handle network errors gracefully without crashing app', async () => {
      localStorage.setItem('authToken', 'test-token');
      fetchMock.mockRejectOnce(new Error('Network failure'));

      const { container } = render(<MockAppWithStorageWarning userId={1} tier="free" />);

      // App should still render
      expect(screen.getByText('Main App Content')).toBeInTheDocument();

      // Modal should not appear due to error
      await waitFor(() => {
        expect(screen.queryByText(/Storage Quota Warning/i)).not.toBeInTheDocument();
      });

      // Ensure no error boundaries triggered
      expect(container.querySelector('[role="alert"]')).not.toBeInTheDocument();
    });

    it('should persist dismissal across component remounts', async () => {
      localStorage.setItem('authToken', 'test-token');
      const quotaData = {
        used: 858993459,
        limit: 1073741824,
        percentageUsed: 81.9,
        tier: 'free',
        displayLimit: '1 GB',
        warningThreshold: 80,
        isWarning: true,
      };

      // First render and dismiss
      fetchMock.mockResponseOnce(JSON.stringify(quotaData));
      const { unmount } = render(<MockAppWithStorageWarning userId={1} tier="free" />);

      await waitFor(() => {
        expect(screen.getByText(/Storage Quota Warning/i)).toBeInTheDocument();
      });

      const dismissButton = screen.getByText('Remind Me Later');
      await userEvent.click(dismissButton);

      // Verify dismissed
      expect(localStorage.getItem('storage-quota-dismissed-1')).toBeTruthy();

      unmount();

      // Remount component
      fetchMock.mockResponseOnce(JSON.stringify(quotaData));
      render(<MockAppWithStorageWarning userId={1} tier="free" />);

      // Should not show warning again (dismissed recently)
      await waitFor(() => {
        expect(screen.queryByText(/Storage Quota Warning/i)).not.toBeInTheDocument();
      });
    });
  });

  describe('Performance and UX', () => {
    it('should render without blocking main UI', async () => {
      localStorage.setItem('authToken', 'test-token');
      fetchMock.mockResponseOnce(
        JSON.stringify({
          used: 858993459,
          limit: 1073741824,
          percentageUsed: 81.9,
          tier: 'free',
          displayLimit: '1 GB',
          warningThreshold: 80,
          isWarning: true,
        }),
      );

      const startTime = performance.now();
      render(<MockAppWithStorageWarning userId={1} tier="free" />);
      const renderTime = performance.now() - startTime;

      // Should render quickly (< 100ms)
      expect(renderTime).toBeLessThan(100);

      // Main content should be immediately visible
      expect(screen.getByText('Main App Content')).toBeInTheDocument();
    });

    it('should show loading state without blocking', async () => {
      localStorage.setItem('authToken', 'test-token');

      // Delay the response to simulate loading
      fetchMock.mockResponseOnce(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve({
                  body: JSON.stringify({
                    used: 858993459,
                    limit: 1073741824,
                    percentageUsed: 81.9,
                    tier: 'free',
                    displayLimit: '1 GB',
                    warningThreshold: 80,
                    isWarning: true,
                  }),
                }),
              100,
            ),
          ),
      );

      render(<MockAppWithStorageWarning userId={1} tier="free" />);

      // Main app should be visible immediately
      expect(screen.getByText('Main App Content')).toBeInTheDocument();

      // Warning should appear after loading
      await waitFor(
        () => {
          expect(screen.getByText(/Storage Quota Warning/i)).toBeInTheDocument();
        },
        { timeout: 2000 },
      );
    });
  });

  describe('Accessibility', () => {
    it('should have proper ARIA labels for screen readers', async () => {
      localStorage.setItem('authToken', 'test-token');
      fetchMock.mockResponseOnce(
        JSON.stringify({
          used: 858993459,
          limit: 1073741824,
          percentageUsed: 81.9,
          tier: 'free',
          displayLimit: '1 GB',
          warningThreshold: 80,
          isWarning: true,
        }),
      );

      render(<MockAppWithStorageWarning userId={1} tier="free" />);

      await waitFor(() => {
        const closeButton = screen.getByLabelText('Close warning');
        expect(closeButton).toBeInTheDocument();
        expect(closeButton).toHaveAttribute('aria-label', 'Close warning');
      });
    });

    it('should be keyboard navigable', async () => {
      localStorage.setItem('authToken', 'test-token');
      fetchMock.mockResponseOnce(
        JSON.stringify({
          used: 858993459,
          limit: 1073741824,
          percentageUsed: 81.9,
          tier: 'free',
          displayLimit: '1 GB',
          warningThreshold: 80,
          isWarning: true,
        }),
      );

      render(<MockAppWithStorageWarning userId={1} tier="free" />);

      await waitFor(() => {
        expect(screen.getByText(/Storage Quota Warning/i)).toBeInTheDocument();
      });

      // Verify buttons are focusable
      const remindLaterButton = screen.getByText('Remind Me Later');
      const upgradeButton = screen.getByText('Upgrade Plan');

      expect(remindLaterButton).toBeVisible();
      expect(upgradeButton).toBeVisible();

      // Both buttons should be tabbable
      remindLaterButton.focus();
      expect(document.activeElement).toBe(remindLaterButton);

      upgradeButton.focus();
      expect(document.activeElement).toBe(upgradeButton);
    });
  });
});
