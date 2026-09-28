import { fetchMock } from '../test-utils/fetchMock';
import {
  ApiError,
  apiService,
  API_AUTH_UNAUTHORIZED_EVENT,
  API_BASE_URL,
  DEFAULT_API_BASE_URL,
  resolveApiBaseUrl,
} from '../lib/api.service';

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
      // API_BASE_URL is env-configured (a local frontend/.env may override the
      // :8787 default); assert the resolved base plus the built path.
      `${API_BASE_URL}/api/supplier-credits/suppliers/7`,
      expect.objectContaining({
        method: 'PATCH',
        headers: expect.objectContaining({ Authorization: 'Bearer test-bearer' }),
        body: JSON.stringify({ name: 'Acme' }),
      }),
    );
  });
});

describe('resolveApiBaseUrl', () => {
  it('defaults to the wrangler dev origin when neither env var is set', () => {
    expect(resolveApiBaseUrl({})).toBe(DEFAULT_API_BASE_URL);
    expect(DEFAULT_API_BASE_URL).toBe('http://localhost:8787');
  });

  it('prefers REACT_APP_API_URL over REACT_APP_API_BASE_URL', () => {
    expect(
      resolveApiBaseUrl({
        REACT_APP_API_URL: 'http://a.example',
        REACT_APP_API_BASE_URL: 'http://b.example',
      }),
    ).toBe('http://a.example');
  });

  it('uses REACT_APP_API_BASE_URL when REACT_APP_API_URL is absent', () => {
    expect(resolveApiBaseUrl({ REACT_APP_API_BASE_URL: 'http://b.example' })).toBe(
      'http://b.example',
    );
  });

  it('treats an empty string as unset and falls through', () => {
    expect(
      resolveApiBaseUrl({ REACT_APP_API_URL: '', REACT_APP_API_BASE_URL: 'http://b.example' }),
    ).toBe('http://b.example');
    expect(resolveApiBaseUrl({ REACT_APP_API_URL: '' })).toBe(DEFAULT_API_BASE_URL);
  });

  it('strips trailing slashes', () => {
    expect(resolveApiBaseUrl({ REACT_APP_API_URL: 'http://a.example/' })).toBe('http://a.example');
    expect(resolveApiBaseUrl({ REACT_APP_API_URL: 'http://a.example/api//' })).toBe(
      'http://a.example/api',
    );
  });
});
