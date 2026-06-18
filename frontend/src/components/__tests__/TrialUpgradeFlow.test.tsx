import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import fetchMock from 'jest-fetch-mock';
import { TrialUpgradeFlow } from '../TrialUpgradeFlow';

jest.mock('../../hooks/useFreshApiToken', () => ({
  useFreshApiToken: (() => {
    const callbacks = new Map<string, jest.Mock>();
    return (token: string | null) => {
      const key = token ?? '__missing__';
      if (!callbacks.has(key)) {
        callbacks.set(key, jest.fn().mockResolvedValue(token || undefined));
      }
      return callbacks.get(key);
    };
  })(),
}));

jest.mock('../../lib/api.service', () => ({
  buildApiUrl: (route: string) => `https://api.test${route}`,
}));

describe('TrialUpgradeFlow', () => {
  const trialStatus = {
    isInTrial: true,
    isTrialExpired: false,
    subscription: {
      status: 'trialing',
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
    jest.clearAllMocks();
    jest.spyOn(window, 'open').mockImplementation(() => null);
    process.env.REACT_APP_STRIPE_PRICE_PROFESSIONAL_MONTHLY = 'price_professional_monthly';
    process.env.REACT_APP_STRIPE_PRICE_PROFESSIONAL_ANNUAL = 'price_professional_annual';
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('starts Stripe checkout for trialing users', async () => {
    fetchMock
      .mockResponseOnce(JSON.stringify(trialStatus))
      .mockResponseOnce(JSON.stringify({ url: 'https://checkout.stripe.test/session' }));

    render(<TrialUpgradeFlow token="test-token" />);

    userEvent.click(await screen.findByRole('button', { name: 'Upgrade Monthly' }));

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

    userEvent.click(await screen.findByRole('button', { name: 'Upgrade Annual' }));

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

    expect(await screen.findByText('A$99')).toBeInTheDocument();
    expect(screen.getByText('Billed A$990 yearly')).toBeInTheDocument();
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
            status: 'expired',
            tierLevel: 'starter',
            daysRemaining: 0,
          },
        }),
      )
      .mockResponseOnce(JSON.stringify({ url: 'https://checkout.stripe.test/expired' }));

    render(<TrialUpgradeFlow token="test-token" />);

    expect(await screen.findByText('Starter plan')).toBeInTheDocument();
    userEvent.click(screen.getByRole('button', { name: 'Upgrade Monthly' }));

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

  it('shows a current-plan state for active paid users', async () => {
    fetchMock.mockResponseOnce(
      JSON.stringify({
        ...trialStatus,
        isInTrial: false,
        isTrialExpired: false,
        subscription: {
          ...trialStatus.subscription,
          status: 'active',
          tierLevel: 'professional',
          billingCycle: 'monthly',
          daysRemaining: null,
        },
      }),
    );

    render(<TrialUpgradeFlow token="test-token" />);

    expect(await screen.findByText('Professional plan active')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Upgrade Monthly' })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
