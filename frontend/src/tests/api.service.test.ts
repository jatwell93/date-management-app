import fetchMock from 'jest-fetch-mock';
import { apiService, API_AUTH_UNAUTHORIZED_EVENT } from '../lib/api.service';

describe('apiService 401 handling', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchMock.resetMocks();
    localStorage.clear();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {
      // Silence expected JSDOM navigation noise in this test suite.
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('clears auth storage and does not force navigation on 401 responses', async () => {
    localStorage.setItem('authToken', 'test-auth-token');
    localStorage.setItem('session', 'test-session-token');

    const unauthorizedListener = jest.fn();
    window.addEventListener(API_AUTH_UNAUTHORIZED_EVENT, unauthorizedListener);

    fetchMock.mockResponseOnce('', { status: 401 });

    await expect(apiService.get('/store-areas', 'test-bearer')).rejects.toThrow(
      'Authentication failed. You have been logged out.',
    );

    expect(localStorage.getItem('authToken')).toBeNull();
    expect(localStorage.getItem('session')).toBeNull();
    expect(unauthorizedListener).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).not.toHaveBeenCalled();

    window.removeEventListener(API_AUTH_UNAUTHORIZED_EVENT, unauthorizedListener);
  });
});
