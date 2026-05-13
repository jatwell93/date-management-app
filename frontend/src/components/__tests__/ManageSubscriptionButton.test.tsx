import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ManageSubscriptionButton } from '../ManageSubscriptionButton';

jest.mock('@sentry/react', () => ({
  captureException: jest.fn(),
}));

global.fetch = jest.fn();

describe('ManageSubscriptionButton', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows a recoverable billing portal error when Stripe portal creation fails', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Portal unavailable' }),
    });

    render(<ManageSubscriptionButton token="test-token" />);

    fireEvent.click(screen.getByRole('button', { name: /Manage Billing/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/Unable to open billing portal/i);
    });

    expect(screen.getByRole('button', { name: /Manage Billing/i })).not.toBeDisabled();
  });
});
