const RAW_API_BASE_URL =
  process.env.REACT_APP_API_URL || process.env.REACT_APP_API_BASE_URL || 'http://localhost:3001';

export const API_BASE_URL = RAW_API_BASE_URL.replace(/\/+$/, '');
export const API_AUTH_UNAUTHORIZED_EVENT = 'app:auth-unauthorized';

const ABSOLUTE_URL_REGEX = /^https?:\/\//i;

function normalizeEndpoint(endpoint: string): string {
  if (!endpoint) {
    return '/';
  }

  if (ABSOLUTE_URL_REGEX.test(endpoint)) {
    return endpoint;
  }

  return endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
}

export function buildApiUrl(endpoint: string, baseUrl: string = API_BASE_URL): string {
  const normalizedEndpoint = normalizeEndpoint(endpoint);

  if (ABSOLUTE_URL_REGEX.test(normalizedEndpoint)) {
    return normalizedEndpoint;
  }

  const sanitizedBaseUrl = baseUrl.replace(/\/+$/, '');
  const baseHasApiSuffix = /\/api$/i.test(sanitizedBaseUrl);
  const endpointHasApiPrefix =
    normalizedEndpoint === '/api' || normalizedEndpoint.startsWith('/api/');

  let finalEndpoint = normalizedEndpoint;

  if (baseHasApiSuffix && endpointHasApiPrefix) {
    finalEndpoint = normalizedEndpoint.replace(/^\/api/, '') || '/';
  } else if (!baseHasApiSuffix && !endpointHasApiPrefix) {
    finalEndpoint = `/api${normalizedEndpoint}`;
  }

  return `${sanitizedBaseUrl}${finalEndpoint}`;
}

class ApiService {
  private baseUrl: string;

  constructor() {
    // Use environment variable or default to localhost:3001
    this.baseUrl = API_BASE_URL;
  }

  private async request<T>(endpoint: string, options: RequestInit): Promise<T> {
    const url = buildApiUrl(endpoint, this.baseUrl);
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    // If authentication error (401), clear local auth state and notify app-level handlers
    if (response.status === 401) {
      // Remove auth token from localStorage
      localStorage.removeItem('authToken');
      localStorage.removeItem('session');

      // Emit a global auth event and let app-level auth handling decide next steps.
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent(API_AUTH_UNAUTHORIZED_EVENT, {
            detail: { endpoint: url, status: response.status },
          }),
        );
      }

      throw new Error('Authentication failed. You have been logged out.');
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage =
        typeof errorData.message === 'string'
          ? errorData.message
          : typeof errorData.error === 'string'
            ? errorData.error
            : `HTTP error! status: ${response.status}`;

      throw new Error(errorMessage);
    }

    return response.json();
  }

  async get<T>(endpoint: string, token?: string): Promise<T> {
    const headers: HeadersInit = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    return this.request<T>(endpoint, { method: 'GET', headers });
  }

  async post<T>(endpoint: string, data: unknown, token?: string): Promise<T> {
    const headers: HeadersInit = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    return this.request<T>(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(data),
    });
  }

  async put<T>(endpoint: string, data: unknown, token?: string): Promise<T> {
    const headers: HeadersInit = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    return this.request<T>(endpoint, {
      method: 'PUT',
      headers,
      body: JSON.stringify(data),
    });
  }

  async delete<T>(endpoint: string, token?: string): Promise<T> {
    const headers: HeadersInit = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    return this.request<T>(endpoint, { method: 'DELETE', headers });
  }
}

export const apiService = new ApiService();
