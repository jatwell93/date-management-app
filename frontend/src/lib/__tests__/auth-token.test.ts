import * as Sentry from '@sentry/react';
import { resolveApiToken } from '../auth-token';

vi.mock('@sentry/react', () => ({
  captureException: vi.fn(),
}));

describe('resolveApiToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('falls back to the prop token and records Clerk refresh failures without token values', async () => {
    const refreshError = new Error('Clerk token refresh failed');
    const getToken = vi.fn().mockRejectedValue(refreshError);

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
