import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ManageSubscriptionButton } from '../ManageSubscriptionButton';

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

jest.mock('@sentry/react', () => ({
  captureException: jest.fn(),
}));

global.fetch = jest.fn();

describe('ManageSubscriptionButton', () => {
  it('keeps the public root element button-shaped when there is no error', () => {
    const { container } = render(
      <ManageSubscriptionButton token="test-token" className="flex-1" />,
    );

    expect(container.firstElementChild).toBe(
      screen.getByRole('button', { name: /Manage Billing/i }),
    );
    expect(screen.getByRole('button', { name: /Manage Billing/i })).toHaveClass('flex-1');
  });

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
