const RAW_API_BASE_URL =
  process.env.REACT_APP_API_URL || process.env.REACT_APP_API_BASE_URL || 'http://localhost:3001';

export const API_BASE_URL = RAW_API_BASE_URL.replace(/\/+$/, '');
export const API_AUTH_UNAUTHORIZED_EVENT = 'app:auth-unauthorized';

export interface ApiFieldError {
  field: string;
  message: string;
}

export class ApiError extends Error {
  readonly name = 'ApiError';
  readonly statusCode: number;

  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly errors: ApiFieldError[] = [],
  ) {
    super(message);
    this.statusCode = status;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

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
      const errorData: unknown = await response.json().catch(() => ({}));
      const errorRecord =
        typeof errorData === 'object' && errorData !== null
          ? (errorData as Record<string, unknown>)
          : {};
      const errorMessage =
        typeof errorRecord.message === 'string'
          ? errorRecord.message
          : typeof errorRecord.error === 'string'
            ? errorRecord.error
            : `HTTP error! status: ${response.status}`;
      const fieldErrors = Array.isArray(errorRecord.errors)
        ? errorRecord.errors.filter(
            (error): error is ApiFieldError =>
              typeof error === 'object' &&
              error !== null &&
              typeof (error as Record<string, unknown>).field === 'string' &&
              typeof (error as Record<string, unknown>).message === 'string',
          )
        : [];

      throw new ApiError(
        errorMessage,
        response.status,
        typeof errorRecord.code === 'string' ? errorRecord.code : undefined,
        fieldErrors,
      );
    }

    return response.json();
  }

  async get<T>(endpoint: string, token?: string, signal?: AbortSignal): Promise<T> {
    const headers: HeadersInit = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    return this.request<T>(endpoint, { method: 'GET', headers, signal });
  }

  async post<T>(endpoint: string, data: unknown, token?: string, signal?: AbortSignal): Promise<T> {
    const headers: HeadersInit = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    return this.request<T>(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(data),
      signal,
    });
  }

  async put<T>(endpoint: string, data: unknown, token?: string, signal?: AbortSignal): Promise<T> {
    const headers: HeadersInit = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    return this.request<T>(endpoint, {
      method: 'PUT',
      headers,
      body: JSON.stringify(data),
      signal,
    });
  }

  async patch<T>(
    endpoint: string,
    data: unknown,
    token?: string,
    signal?: AbortSignal,
  ): Promise<T> {
    const headers: HeadersInit = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    return this.request<T>(endpoint, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(data),
      signal,
    });
  }

  async delete<T>(endpoint: string, token?: string, signal?: AbortSignal): Promise<T> {
    const headers: HeadersInit = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    return this.request<T>(endpoint, { method: 'DELETE', headers, signal });
  }
}

export const apiService = new ApiService();
