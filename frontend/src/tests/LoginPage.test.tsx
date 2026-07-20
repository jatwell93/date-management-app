import React from 'react';
import { randomUUID } from 'crypto';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LoginPage } from '../components/LoginPage';
import { apiService } from '../lib/api.service';

// Mock apiService
vi.mock('../lib/api.service', () => ({
  apiService: {
    post: vi.fn(),
  },
}));

// Default mock implementation for successful login
const mockAuthToken = randomUUID();

describe('LoginPage', () => {
  const mockOnLogin = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (apiService.post as jest.Mock).mockResolvedValue({ token: mockAuthToken });
  });

  test('renders login form', () => {
    render(<LoginPage onLogin={mockOnLogin} />);
    expect(screen.getByLabelText(/PIN/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Login/i })).toBeInTheDocument();
  });

  test('calls onLogin with token on successful login', async () => {
    render(<LoginPage onLogin={mockOnLogin} />);
    const pinInput = screen.getByLabelText(/PIN/i);
    const loginButton = screen.getByRole('button', { name: /Login/i });

    fireEvent.change(pinInput, { target: { value: '12345' } });
    fireEvent.click(loginButton);

    await waitFor(() => {
      expect(mockOnLogin).toHaveBeenCalledWith(mockAuthToken);
    });

    expect(apiService.post).toHaveBeenCalledTimes(1);
    expect(apiService.post).toHaveBeenCalledWith('/auth/login', { pin: '12345' });
  });

  test('displays error message on failed login', async () => {
    (apiService.post as jest.Mock).mockRejectedValueOnce(new Error('Invalid credentials'));

    render(<LoginPage onLogin={mockOnLogin} />);
    const pinInput = screen.getByLabelText(/PIN/i);
    const loginButton = screen.getByRole('button', { name: /Login/i });

    fireEvent.change(pinInput, { target: { value: 'wrongpin' } });
    fireEvent.click(loginButton);

    expect(await screen.findByText(/Invalid credentials/i)).toBeInTheDocument();
    expect(mockOnLogin).not.toHaveBeenCalled();
  });
});
