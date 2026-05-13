import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import fetchMock from 'jest-fetch-mock';
import { TrialUpgradeFlow } from '../TrialUpgradeFlow';

jest.mock('../../lib/api.service', () => ({
  buildApiUrl: (route) => `https://api.test${route}`,
}));

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
          status: 'ACTIVE',
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
