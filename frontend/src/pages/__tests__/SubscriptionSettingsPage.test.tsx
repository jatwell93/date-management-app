import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SubscriptionSettingsPage } from '../SubscriptionSettingsPage';

jest.mock('@sentry/react', () => ({
  captureException: jest.fn(),
}));

jest.mock('../../components/SubscriptionDashboard', () => ({
  SubscriptionDashboard: () => <div>Subscription dashboard</div>,
}));

jest.mock('../../components/UpgradeModal', () => ({
  UpgradeModal: () => null,
}));

jest.mock('../../components/ManageSubscriptionButton', () => ({
  ManageSubscriptionButton: () => <button type="button">Manage Billing</button>,
}));

jest.mock('../../components/UsageWarning', () => ({
  UsageWarning: () => <div>Usage warning</div>,
}));

global.fetch = jest.fn();

describe('SubscriptionSettingsPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows a recoverable error when billing settings fail to load', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Subscription unavailable' }),
    });

    render(<SubscriptionSettingsPage token="test-token" />);

    await waitFor(() => {
      expect(screen.getByText(/Unable to load billing settings/i)).toBeInTheDocument();
    });

    expect(screen.getByText(/Your subscription details could not be loaded/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Retry billing data/i })).toBeInTheDocument();
  });

  it('retries loading billing settings when the retry action is clicked', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Subscription unavailable' }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Usage unavailable' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          tierLevel: 'starter',
          status: 'active',
          billingCycle: 'monthly',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          skus: { current: 10, limit: 500 },
          users: { current: 1, limit: 1 },
          storage: { current: 0, limit: 1073741824 },
        }),
      });

    render(<SubscriptionSettingsPage token="test-token" />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Retry billing data/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Retry billing data/i }));

    await waitFor(() => {
      expect(screen.queryByText(/Unable to load billing settings/i)).not.toBeInTheDocument();
    });
  });
});
