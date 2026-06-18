import * as Sentry from '@sentry/react';
import { resolveApiToken } from '../auth-token';

jest.mock('@sentry/react', () => ({
  captureException: jest.fn(),
}));

describe('resolveApiToken', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('falls back to the prop token and records Clerk refresh failures without token values', async () => {
    const refreshError = new Error('Clerk token refresh failed');
    const getToken = jest.fn().mockRejectedValue(refreshError);

    await expect(
      resolveApiToken({
        fallbackToken: 'expired-prop-token',
        getToken,
        actionTag: 'dashboard-fetch',
      }),
    ).resolves.toBe('expired-prop-token');

    expect(Sentry.captureException).toHaveBeenCalledWith(refreshError, {
      tags: { feature: 'auth-token', action: 'dashboard-fetch' },
    });
    expect(JSON.stringify((Sentry.captureException as jest.Mock).mock.calls)).not.toContain(
      'expired-prop-token',
    );
  });
});
