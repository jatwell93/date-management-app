import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SubscriptionSettingsPage } from '../SubscriptionSettingsPage';

jest.mock('@sentry/react', () => ({
  captureException: jest.fn(),
}));

jest.mock('../../components/SubscriptionDashboard', () => ({
  SubscriptionDashboard: () => <div>Subscription dashboard</div>,
}));

jest.mock('../../components/UpgradeModal', () => ({
  UpgradeModal: ({ onSelectPlan }: { onSelectPlan: (tier: string, cycle: string) => void }) => (
    <div>
      <button type="button" onClick={() => onSelectPlan('starter', 'annual')}>
        Select Starter Annual
      </button>
      <button type="button" onClick={() => onSelectPlan('professional', 'monthly')}>
        Select Professional Monthly
      </button>
      <button type="button" onClick={() => onSelectPlan('enterprise', 'monthly')}>
        Contact Enterprise Sales
      </button>
    </div>
  ),
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
    jest.spyOn(window, 'alert').mockImplementation(() => undefined);
    process.env.REACT_APP_STRIPE_PRICE_STARTER_MONTHLY = 'price_starter_monthly';
    process.env.REACT_APP_STRIPE_PRICE_STARTER_ANNUAL = 'price_starter_annual';
    process.env.REACT_APP_STRIPE_PRICE_PROFESSIONAL_MONTHLY = 'price_professional_monthly';
    process.env.REACT_APP_STRIPE_PRICE_PROFESSIONAL_ANNUAL = 'price_professional_annual';
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

  it('starts Checkout with the Starter annual launch price', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tierLevel: 'free', status: 'active' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          skus: { current: 0, limit: 500 },
          users: { current: 1, limit: 1 },
          storage: { current: 0, limit: 1073741824 },
        }),
      })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'stop after request' }) });

    render(<SubscriptionSettingsPage token="test-token" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Select Starter Annual' }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/subscription/create-checkout-session'),
        expect.objectContaining({ body: expect.stringContaining('price_starter_annual') }),
      );
    });
  });

  it('does not start Checkout for Enterprise contact sales', async () => {
    const alertSpy = window.alert as jest.Mock;
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tierLevel: 'free', status: 'active' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          skus: { current: 0, limit: 500 },
          users: { current: 1, limit: 1 },
          storage: { current: 0, limit: 1073741824 },
        }),
      });

    render(<SubscriptionSettingsPage token="test-token" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Contact Enterprise Sales' }));

    expect(alertSpy).toHaveBeenCalledWith(
      'Enterprise plans are configured by contract. Please contact support.',
    );
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
