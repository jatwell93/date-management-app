import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StorageQuotaWarning } from '../StorageQuotaWarning';
import fetchMock from 'jest-fetch-mock';

describe('StorageQuotaWarning', () => {
  const mockUserId = 1;
  const mockAuthToken = 'mock-jwt-token';

  const mockQuotaData = {
    used: 858993459, // ~819 MB (81.9%)
    limit: 1073741824, // 1 GB
    percentageUsed: 81.9,
    tier: 'free',
    displayLimit: '1 GB',
    warningThreshold: 80,
    isWarning: true,
  };

  beforeEach(() => {
    fetchMock.resetMocks();
    localStorage.clear();
    jest.clearAllMocks();
  });

  const renderWarning = (props: Partial<React.ComponentProps<typeof StorageQuotaWarning>> = {}) =>
    render(<StorageQuotaWarning userId={mockUserId} token={mockAuthToken} {...props} />);

  const renderWarningWithoutToken = (
    props: Partial<React.ComponentProps<typeof StorageQuotaWarning>> = {},
  ) => render(<StorageQuotaWarning userId={mockUserId} {...props} />);

  describe('API Integration', () => {
    it('fetches quota data on mount with correct URL and headers', async () => {
      fetchMock.mockResponseOnce(JSON.stringify(mockQuotaData));

      renderWarning({ subscriptionTier: 'free' });

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          '/api/storage-quota/1?tier=free',
          expect.objectContaining({
            headers: {
              Authorization: 'Bearer mock-jwt-token',
            },
          }),
        );
      });
    });

    it('includes subscription tier in query params', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ ...mockQuotaData, tier: 'pro' }));

      renderWarning({ subscriptionTier: 'pro' });

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith('/api/storage-quota/1?tier=pro', expect.anything());
      });
    });

    it('handles API error gracefully', async () => {
      fetchMock.mockRejectOnce(new Error('Network error'));

      const { container } = renderWarning();

      await waitFor(() => {
        expect(container.firstChild).toBeNull(); // Modal should not render
      });
    });

    it('handles non-OK response status', async () => {
      fetchMock.mockResponseOnce('Unauthorized', { status: 401 });

      const { container } = renderWarning();

      await waitFor(() => {
        expect(container.firstChild).toBeNull(); // Modal should not render
      });
    });

    it('does not fetch when no auth token exists', async () => {
      const { container } = renderWarningWithoutToken();

      await waitFor(() => {
        expect(fetchMock).not.toHaveBeenCalled();
        expect(container.firstChild).toBeNull();
      });
    });
  });

  describe('Visibility Logic', () => {
    it('shows warning when quota is at warning threshold (80%)', async () => {
      fetchMock.mockResponseOnce(JSON.stringify(mockQuotaData));

      renderWarning();

      await waitFor(() => {
        expect(screen.getByText(/Storage Quota Warning/i)).toBeInTheDocument();
      });
    });

    it('shows warning when quota is above threshold (90%)', async () => {
      const highUsage = {
        ...mockQuotaData,
        used: 966367642, // ~922 MB (90%)
        percentageUsed: 90,
      };
      fetchMock.mockResponseOnce(JSON.stringify(highUsage));

      renderWarning();

      await waitFor(() => {
        expect(screen.getByText(/Storage Quota Warning/i)).toBeInTheDocument();
      });
    });

    it('does not show when quota is below threshold (70%)', async () => {
      const lowUsage = {
        ...mockQuotaData,
        used: 751619277, // ~717 MB (70%)
        percentageUsed: 70,
        isWarning: false,
      };
      fetchMock.mockResponseOnce(JSON.stringify(lowUsage));

      const { container } = renderWarning();

      await waitFor(() => {
        expect(container.firstChild).toBeNull();
      });
    });

    it('does not show when isWarning is false', async () => {
      const noWarning = {
        ...mockQuotaData,
        isWarning: false,
      };
      fetchMock.mockResponseOnce(JSON.stringify(noWarning));

      const { container } = renderWarning();

      await waitFor(() => {
        expect(container.firstChild).toBeNull();
      });
    });
  });

  describe('Data Display', () => {
    beforeEach(async () => {
      fetchMock.mockResponseOnce(JSON.stringify(mockQuotaData));
    });

    it('displays percentage correctly', async () => {
      renderWarning();

      await waitFor(() => {
        expect(screen.getByText(/81\.9%/)).toBeInTheDocument();
      });
    });

    it('displays used storage amount', async () => {
      renderWarning();

      await waitFor(() => {
        expect(screen.getByText(/819\.2 MB/)).toBeInTheDocument();
      });
    });

    it('displays total storage limit', async () => {
      renderWarning();

      await waitFor(() => {
        expect(screen.getByText('1 GB')).toBeInTheDocument();
      });
    });

    it('displays remaining storage when not at limit', async () => {
      renderWarning();

      await waitFor(() => {
        expect(screen.getByText(/You have.*remaining/i)).toBeInTheDocument();
      });
    });

    it('displays at-limit message when storage is full', async () => {
      fetchMock.resetMocks();
      const fullStorage = {
        ...mockQuotaData,
        used: 1073741824, // 1 GB
        percentageUsed: 100,
      };
      fetchMock.mockResponseOnce(JSON.stringify(fullStorage));

      renderWarning();

      await waitFor(() => {
        expect(screen.getByText(/You have reached your storage limit/i)).toBeInTheDocument();
      });
    });

    it('displays current subscription tier', async () => {
      renderWarning({ subscriptionTier: 'free' });

      await waitFor(() => {
        expect(screen.getByText('Current Plan:')).toBeInTheDocument();
        expect(screen.getByText('Free')).toBeInTheDocument();
      });
    });

    it('displays Pro tier correctly', async () => {
      fetchMock.resetMocks();
      const proQuota = {
        ...mockQuotaData,
        tier: 'pro',
        limit: 10737418240, // 10 GB
        displayLimit: '10 GB',
      };
      fetchMock.mockResponseOnce(JSON.stringify(proQuota));

      renderWarning({ subscriptionTier: 'pro' });

      await waitFor(() => {
        expect(screen.getByText('Current Plan:')).toBeInTheDocument();
        expect(screen.getByText('Pro')).toBeInTheDocument();
      });
    });

    it('renders progress bar with correct width', async () => {
      renderWarning();

      await waitFor(() => {
        const progressFill = document.querySelector('.storage-quota-warning__progress-fill');
        expect(progressFill).toHaveStyle({ width: '81.9%' });
      });
    });

    it('caps progress bar at 100% for over-quota usage', async () => {
      fetchMock.resetMocks();
      const overQuota = {
        ...mockQuotaData,
        used: 1181116007, // ~1.1 GB (110%)
        percentageUsed: 110,
      };
      fetchMock.mockResponseOnce(JSON.stringify(overQuota));

      renderWarning();

      await waitFor(() => {
        const progressFill = document.querySelector('.storage-quota-warning__progress-fill');
        expect(progressFill).toHaveStyle({ width: '100%' }); // Capped at 100%
      });
    });
  });

  describe('Dismiss Functionality', () => {
    beforeEach(async () => {
      fetchMock.mockResponseOnce(JSON.stringify(mockQuotaData));
    });

    it('dismisses when close button is clicked', async () => {
      const onDismiss = jest.fn();
      renderWarning({ onDismiss });

      await waitFor(() => {
        expect(screen.getByLabelText('Close warning')).toBeInTheDocument();
      });

      const closeButton = screen.getByLabelText('Close warning');
      await act(async () => {
        await userEvent.click(closeButton);
      });

      expect(onDismiss).toHaveBeenCalledTimes(1);
      expect(screen.queryByText(/Storage Quota Warning/i)).not.toBeInTheDocument();
    });

    it('dismisses when "Remind Me Later" button is clicked', async () => {
      const onDismiss = jest.fn();
      renderWarning({ onDismiss });

      await waitFor(() => {
        expect(screen.getByText('Remind Me Later')).toBeInTheDocument();
      });

      const remindLaterButton = screen.getByText('Remind Me Later');
      await act(async () => {
        await userEvent.click(remindLaterButton);
      });

      expect(onDismiss).toHaveBeenCalledTimes(1);
      expect(screen.queryByText(/Storage Quota Warning/i)).not.toBeInTheDocument();
    });

    it('dismisses when overlay is clicked', async () => {
      const onDismiss = jest.fn();
      renderWarning({ onDismiss });

      await waitFor(() => {
        expect(screen.getByText(/Storage Quota Warning/i)).toBeInTheDocument();
      });

      const overlay = document.querySelector('.storage-quota-warning__overlay');
      expect(overlay).toBeInTheDocument();

      await act(async () => {
        await userEvent.click(overlay!);
      });

      expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it('stores dismiss timestamp in localStorage', async () => {
      renderWarning();

      await waitFor(() => {
        expect(screen.getByText('Remind Me Later')).toBeInTheDocument();
      });

      const beforeDismiss = new Date().toISOString();

      const remindLaterButton = screen.getByText('Remind Me Later');
      await act(async () => {
        await userEvent.click(remindLaterButton);
      });

      const dismissKey = `storage-quota-dismissed-${mockUserId}`;
      const storedTimestamp = localStorage.getItem(dismissKey);
      expect(storedTimestamp).toBeTruthy();

      // Verify timestamp is recent
      const afterDismiss = new Date().toISOString();
      expect(storedTimestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(storedTimestamp! >= beforeDismiss).toBe(true);
      expect(storedTimestamp! <= afterDismiss).toBe(true);
    });

    it('does not show when dismissed within autoHideDays', async () => {
      // Set dismiss timestamp to 3 days ago
      const threeDaysAgo = new Date();
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
      localStorage.setItem(`storage-quota-dismissed-${mockUserId}`, threeDaysAgo.toISOString());

      const { container } = renderWarning({ autoHideDays: 7 });

      await waitFor(() => {
        expect(container.firstChild).toBeNull(); // Should not render
      });
    });

    it('shows again after autoHideDays have passed', async () => {
      // Set dismiss timestamp to 8 days ago (past default 7 days)
      const eightDaysAgo = new Date();
      eightDaysAgo.setDate(eightDaysAgo.getDate() - 8);
      localStorage.setItem(`storage-quota-dismissed-${mockUserId}`, eightDaysAgo.toISOString());

      renderWarning({ autoHideDays: 7 });

      await waitFor(() => {
        expect(screen.getByText(/Storage Quota Warning/i)).toBeInTheDocument();
      });
    });

    it('respects custom autoHideDays prop', async () => {
      // Set dismiss timestamp to 2 days ago
      const twoDaysAgo = new Date();
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
      localStorage.setItem(`storage-quota-dismissed-${mockUserId}`, twoDaysAgo.toISOString());

      const { container } = renderWarning({ autoHideDays: 3 });

      await waitFor(() => {
        expect(container.firstChild).toBeNull(); // Should not render (within 3 days)
      });
    });
  });

  describe('Upgrade Button', () => {
    beforeEach(async () => {
      fetchMock.mockResponseOnce(JSON.stringify(mockQuotaData));
    });

    it('calls onUpgrade when Upgrade Plan button is clicked', async () => {
      const onUpgrade = jest.fn();
      renderWarning({ onUpgrade });

      await waitFor(() => {
        expect(screen.getByText('Upgrade Plan')).toBeInTheDocument();
      });

      const upgradeButton = screen.getByText('Upgrade Plan');
      await act(async () => {
        await userEvent.click(upgradeButton);
      });

      expect(onUpgrade).toHaveBeenCalledTimes(1);
    });

    it('does not render Upgrade Plan button when onUpgrade is not provided', async () => {
      renderWarning();

      await waitFor(() => {
        expect(screen.getByText(/Storage Quota Warning/i)).toBeInTheDocument();
      });

      expect(screen.queryByText('Upgrade Plan')).not.toBeInTheDocument();
    });
  });

  describe('Byte Formatting', () => {
    it('formats bytes correctly', async () => {
      const testCases = [
        { bytes: 500, expected: '500 B' },
        { bytes: 1024, expected: '1 KB' },
        { bytes: 1536, expected: '1.5 KB' }, // 1.5 KB
        { bytes: 1048576, expected: '1 MB' }, // 1 MB
        { bytes: 524288000, expected: '500 MB' }, // ~500 MB
      ];

      for (const testCase of testCases) {
        fetchMock.resetMocks();

        const quota = {
          ...mockQuotaData,
          used: testCase.bytes,
          percentageUsed: (testCase.bytes / mockQuotaData.limit) * 100,
        };
        fetchMock.mockResponseOnce(JSON.stringify(quota));

        const { unmount } = renderWarning();

        await waitFor(() => {
          // Check that the expected text appears somewhere in the progress text area
          const progressText = document.querySelector('.storage-quota-warning__progress-text');
          expect(progressText).toHaveTextContent(testCase.expected);
        });

        unmount();
      }
    });
  });

  describe('Footer Message', () => {
    beforeEach(async () => {
      fetchMock.mockResponseOnce(JSON.stringify(mockQuotaData));
    });

    it('displays autoHideDays in footer message', async () => {
      renderWarning({ autoHideDays: 7 });

      await waitFor(() => {
        expect(screen.getByText(/remind you again in 7 days/i)).toBeInTheDocument();
      });
    });

    it('displays custom autoHideDays in footer message', async () => {
      fetchMock.resetMocks();
      fetchMock.mockResponseOnce(JSON.stringify(mockQuotaData));

      renderWarning({ autoHideDays: 14 });

      await waitFor(() => {
        expect(screen.getByText(/remind you again in 14 days/i)).toBeInTheDocument();
      });
    });
  });

  describe('Edge Cases', () => {
    it('handles 0 bytes used', async () => {
      const zeroUsage = {
        ...mockQuotaData,
        used: 0,
        percentageUsed: 0,
        isWarning: false,
      };
      fetchMock.mockResponseOnce(JSON.stringify(zeroUsage));

      const { container } = renderWarning();

      await waitFor(() => {
        expect(container.firstChild).toBeNull(); // Should not show
      });
    });

    it('handles exactly 80% usage', async () => {
      const exactly80 = {
        ...mockQuotaData,
        used: 858993459, // Exactly 80%
        percentageUsed: 80,
        isWarning: true,
      };
      fetchMock.mockResponseOnce(JSON.stringify(exactly80));

      renderWarning();

      await waitFor(() => {
        expect(screen.getByText(/Storage Quota Warning/i)).toBeInTheDocument();
      });
    });

    it('handles over 100% usage', async () => {
      const overLimit = {
        ...mockQuotaData,
        used: 1181116007, // 110%
        percentageUsed: 110,
        isWarning: true,
      };
      fetchMock.mockResponseOnce(JSON.stringify(overLimit));

      renderWarning();

      await waitFor(() => {
        expect(screen.getByText(/110%/)).toBeInTheDocument();
        expect(screen.getByText(/reached your storage limit/i)).toBeInTheDocument();
      });
    });
  });
});
