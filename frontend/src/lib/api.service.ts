class ApiService {
  private baseUrl: string;

  constructor() {
    // Use environment variable or default to localhost:3001
    this.baseUrl = process.env.REACT_APP_API_URL || 'http://localhost:3001';
  }

  private async request<T>(endpoint: string, options: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    // If authentication error (401), log out the user and redirect to login
    if (response.status === 401) {
      // Remove auth token from localStorage
      localStorage.removeItem('authToken');

      // Redirect to login page by reloading the window
      // This will trigger the useEffect in App component to update isLoggedIn state
      window.location.href = '/login';

      throw new Error('Authentication failed. You have been logged out.');
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
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

  async post<T>(endpoint: string, data: any, token?: string): Promise<T> {
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

  async put<T>(endpoint: string, data: any, token?: string): Promise<T> {
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
