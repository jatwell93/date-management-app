import { fetchMock } from '../test-utils/fetchMock';
import { ApiError, apiService, API_AUTH_UNAUTHORIZED_EVENT } from '../lib/api.service';

describe('apiService 401 handling', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchMock.resetMocks();
    localStorage.clear();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {
      // Silence expected JSDOM navigation noise in this test suite.
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('clears auth storage and does not force navigation on 401 responses', async () => {
    localStorage.setItem('authToken', 'test-auth-token');
    localStorage.setItem('session', 'test-session-token');

    const unauthorizedListener = vi.fn();
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

describe('apiService structured errors and partial writes', () => {
  beforeEach(() => {
    fetchMock.resetMocks();
  });

  it('preserves policy validation status, code, and field errors', async () => {
    fetchMock.mockResponseOnce(
      JSON.stringify({
        code: 'POLICY_VALIDATION_FAILED',
        message: 'Supplier policy is invalid',
        statusCode: 422,
        errors: [{ field: 'representativeEmail', message: 'Enter a valid email address' }],
      }),
      { status: 422 },
    );

    const request = apiService.post('/supplier-credits/suppliers', {}, 'test-bearer');

    await expect(request).rejects.toMatchObject({
      name: 'ApiError',
      message: 'Supplier policy is invalid',
      status: 422,
      code: 'POLICY_VALIDATION_FAILED',
      errors: [{ field: 'representativeEmail', message: 'Enter a valid email address' }],
    });
    await expect(request).rejects.toBeInstanceOf(ApiError);
  });

  it('preserves authorization failures without treating them as field errors', async () => {
    fetchMock.mockResponseOnce(
      JSON.stringify({ code: 'FORBIDDEN', message: 'Admin access is required', statusCode: 403 }),
      { status: 403 },
    );

    await expect(
      apiService.patch('/supplier-credits/suppliers/7', { name: 'Acme' }),
    ).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
      errors: [],
    });
  });

  it('sends PATCH requests with JSON and bearer authorization', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ id: 7 }), { status: 200 });

    await apiService.patch('/supplier-credits/suppliers/7', { name: 'Acme' }, 'test-bearer');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3001/api/supplier-credits/suppliers/7',
      expect.objectContaining({
        method: 'PATCH',
        headers: expect.objectContaining({ Authorization: 'Bearer test-bearer' }),
        body: JSON.stringify({ name: 'Acme' }),
      }),
    );
  });
});
