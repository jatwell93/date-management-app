import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fetchMock } from '../../test-utils/fetchMock';
import { TrialUpgradeFlow } from '../TrialUpgradeFlow';

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

vi.mock('../../lib/api.service', () => ({
  buildApiUrl: (route: string) => `https://api.test${route}`,
}));

/** Clicks the "Upgrade" CTA inside a specific tier card. */
async function clickTierUpgrade(tier: string) {
  const card = await screen.findByTestId(`tier-card-${tier}`);
  userEvent.click(within(card).getByRole('button', { name: /upgrade/i }));
}

describe('TrialUpgradeFlow', () => {
  const trialStatus = {
    isInTrial: true,
    isTrialExpired: false,
    subscription: {
      status: 'TRIALING',
      tierLevel: 'professional',
      trialEndDate: '2026-05-20',
      trialStartedAt: '2026-05-01',
      trialConvertedAt: null,
      daysRemaining: 7,
      billingCycle: null,
    },
    tierLimits: {
      maxUsers: 3,
      maxProducts: 10000,
      maxStoreAreas: 20,
      features: ['csv_upload'],
    },
  };

  beforeEach(() => {
    fetchMock.resetMocks();
    vi.clearAllMocks();
    vi.spyOn(window, 'open').mockImplementation(() => null);
    process.env.REACT_APP_STRIPE_PRICE_PROFESSIONAL_MONTHLY = 'price_professional_monthly';
    process.env.REACT_APP_STRIPE_PRICE_PROFESSIONAL_ANNUAL = 'price_professional_annual';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts Stripe checkout for trialing users', async () => {
    fetchMock
      .mockResponseOnce(JSON.stringify(trialStatus))
      .mockResponseOnce(JSON.stringify({ url: 'https://checkout.stripe.test/session' }));

    render(<TrialUpgradeFlow token="test-token" />);

    await clickTierUpgrade('professional');

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.test/subscription/create-checkout-session',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('price_professional_monthly'),
        }),
      );
    });
    expect(window.open).toHaveBeenCalledWith(
      'https://checkout.stripe.test/session',
      '_self',
      'noopener',
    );
  });

  it('uses the Professional annual launch price for annual checkout', async () => {
    fetchMock
      .mockResponseOnce(JSON.stringify(trialStatus))
      .mockResponseOnce(JSON.stringify({ url: 'https://checkout.stripe.test/annual' }));

    render(<TrialUpgradeFlow token="test-token" />);

    userEvent.click(await screen.findByRole('button', { name: /Annual/i }));
    await clickTierUpgrade('professional');

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.test/subscription/create-checkout-session',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('price_professional_annual'),
        }),
      );
    });
  });

  it('shows the Professional launch pricing in AUD', async () => {
    fetchMock.mockResponseOnce(JSON.stringify(trialStatus));

    render(<TrialUpgradeFlow token="test-token" />);

    const professional = await screen.findByTestId('tier-card-professional');
    expect(within(professional).getByText('A$99')).toBeInTheDocument();

    userEvent.click(screen.getByRole('button', { name: /Annual/i }));

    await waitFor(() => {
      expect(within(professional).getByText(/Billed A\$990 annually/)).toBeInTheDocument();
    });
  });

  it('lets expired-trial starter users start an upgrade', async () => {
    fetchMock
      .mockResponseOnce(
        JSON.stringify({
          ...trialStatus,
          isInTrial: false,
          isTrialExpired: true,
          subscription: {
            ...trialStatus.subscription,
            status: 'EXPIRED',
            tierLevel: 'starter',
            daysRemaining: 0,
          },
        }),
      )
      .mockResponseOnce(JSON.stringify({ url: 'https://checkout.stripe.test/expired' }));

    render(<TrialUpgradeFlow token="test-token" />);

    expect(await screen.findByText('Starter plan')).toBeInTheDocument();
    await clickTierUpgrade('professional');

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.test/subscription/create-checkout-session',
        expect.objectContaining({ method: 'POST' }),
      );
    });
    expect(window.open).toHaveBeenCalledWith(
      'https://checkout.stripe.test/expired',
      '_self',
      'noopener',
    );
  });

  it('announces a loading state instead of rendering a blank page', async () => {
    fetchMock.mockResponseOnce(JSON.stringify(trialStatus));

    render(<TrialUpgradeFlow token="test-token" />);

    expect(screen.getByRole('status')).toHaveTextContent(/Loading plan details/);
    expect(
      await screen.findByRole('heading', { level: 1, name: /Professional Trial/ }),
    ).toBeInTheDocument();
  });

  it('shows plan limits rather than placeholder usage counts', async () => {
    fetchMock.mockResponseOnce(JSON.stringify(trialStatus));

    render(<TrialUpgradeFlow token="test-token" />);

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Your plan limits' }),
    ).toBeInTheDocument();
    expect(screen.getByText('up to 10,000')).toBeInTheDocument();
    expect(screen.getByText('up to 3')).toBeInTheDocument();
    expect(screen.queryByText(/Your current usage/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^0 \//)).not.toBeInTheDocument();
  });

  it('names the plan from the subscription tier for non-trial users', async () => {
    fetchMock.mockResponseOnce(
      JSON.stringify({
        ...trialStatus,
        isInTrial: false,
        isTrialExpired: true,
        subscription: { ...trialStatus.subscription, status: 'EXPIRED', tierLevel: 'free' },
      }),
    );

    render(<TrialUpgradeFlow token="test-token" />);

    expect(await screen.findByRole('heading', { level: 1, name: 'Free plan' })).toBeInTheDocument();
  });

  it('names an expired Professional trial by the tier it is held to', async () => {
    fetchMock.mockResponseOnce(
      JSON.stringify({
        ...trialStatus,
        isInTrial: false,
        isTrialExpired: true,
        subscription: {
          ...trialStatus.subscription,
          status: 'TRIALING',
          tierLevel: 'professional',
          effectiveTierLevel: 'free',
          daysRemaining: 0,
        },
      }),
    );

    render(<TrialUpgradeFlow token="test-token" />);

    expect(await screen.findByRole('heading', { level: 1, name: 'Free plan' })).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { level: 1, name: 'Professional plan' }),
    ).not.toBeInTheDocument();
  });

  it('keeps a readable error when checkout fails with a non-JSON body', async () => {
    fetchMock
      .mockResponseOnce(JSON.stringify(trialStatus))
      .mockResponseOnce('<html>Bad gateway</html>', { status: 502 });

    render(<TrialUpgradeFlow token="test-token" />);

    await clickTierUpgrade('professional');

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to convert trial');
    expect(window.open).not.toHaveBeenCalled();
  });

  it('shows a current-plan state for active paid users', async () => {
    fetchMock.mockResponseOnce(
      JSON.stringify({
        ...trialStatus,
        isInTrial: false,
        isTrialExpired: false,
        subscription: {
          ...trialStatus.subscription,
          status: 'ACTIVE',
          tierLevel: 'professional',
          billingCycle: 'monthly',
          daysRemaining: null,
        },
      }),
    );

    render(<TrialUpgradeFlow token="test-token" />);

    expect(await screen.findByText('Professional plan active')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /upgrade/i })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
