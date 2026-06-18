import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';

import { TrialBanner } from '../TrialBanner';

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

const trialStatus = {
  isInTrial: true,
  isTrialExpired: false,
  subscription: {
    status: 'TRIALING',
    tierLevel: 'professional',
    trialEndDate: '2026-06-01',
    trialStartedAt: '2026-05-18',
    trialConvertedAt: null,
    daysRemaining: 14,
    billingCycle: null,
  },
  tierLimits: {
    maxUsers: 1,
    maxProducts: 500,
    maxStoreAreas: 3,
    features: [],
  },
};

describe('TrialBanner', () => {
  beforeEach(() => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => trialStatus,
    } as Response);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('lets users dismiss the trial CTA for the current page session', async () => {
    render(
      <BrowserRouter>
        <TrialBanner token="test-token" />
      </BrowserRouter>,
    );

    expect(await screen.findByText(/14 days left/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /dismiss trial message/i }));

    await waitFor(() => {
      expect(screen.queryByText(/14 days left/i)).not.toBeInTheDocument();
    });
  });
});
