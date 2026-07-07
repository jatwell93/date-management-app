import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SubscriptionSettingsPage } from '../SubscriptionSettingsPage';

vi.mock('../../hooks/useFreshApiToken', () => ({
  useFreshApiToken: (() => {
    const callbacks = new Map<string, jest.Mock>();
    return (token: string | null) => {
      const key = token ?? '__missing__';
      if (!callbacks.has(key)) {
        callbacks.set(key, vi.fn().mockResolvedValue(token || undefined));
      }
      return callbacks.get(key);
    };
  })(),
}));

vi.mock('@sentry/react', () => ({
  captureException: vi.fn(),
}));

vi.mock('../../components/SubscriptionDashboard', () => ({
  SubscriptionDashboard: () => <div>Subscription dashboard</div>,
}));

vi.mock('../../components/UpgradeModal', () => ({
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

vi.mock('../../components/ManageSubscriptionButton', () => ({
  ManageSubscriptionButton: () => <button type="button">Manage Billing</button>,
}));

vi.mock('../../components/UsageWarning', () => ({
  UsageWarning: () => <div>Usage warning</div>,
}));

global.fetch = vi.fn();

describe('SubscriptionSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, 'alert').mockImplementation(() => undefined);
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

  it('hides Manage Billing and shows a subscribe CTA for a free plan', async () => {
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

    expect(await screen.findByRole('button', { name: /View plans/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Manage Billing/i })).not.toBeInTheDocument();
  });

  it('shows Manage Billing for an active paid plan', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tierLevel: 'starter', status: 'active' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          skus: { current: 0, limit: 5000 },
          users: { current: 1, limit: 3 },
          storage: { current: 0, limit: 10737418240 },
        }),
      });

    render(<SubscriptionSettingsPage token="test-token" />);

    expect(await screen.findByRole('button', { name: /Manage Billing/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /View plans/i })).not.toBeInTheDocument();
  });

  it('shows Manage Billing for a canceled paid plan that still has a Stripe customer', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tierLevel: 'starter', status: 'canceled' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          skus: { current: 0, limit: 5000 },
          users: { current: 1, limit: 3 },
          storage: { current: 0, limit: 10737418240 },
        }),
      });

    render(<SubscriptionSettingsPage token="test-token" />);

    expect(await screen.findByRole('button', { name: /Manage Billing/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /View plans/i })).not.toBeInTheDocument();
  });

  it('does not start Checkout for Enterprise contact sales', async () => {
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

    expect(
      await screen.findByText('Enterprise plans are configured by contract. Please contact support.'),
    ).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
