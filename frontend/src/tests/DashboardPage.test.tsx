import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { DashboardPage } from '../pages/DashboardPage';
import { apiService } from '../lib/api.service';
import '@testing-library/jest-dom';

// Mock apiService
jest.mock('../lib/api.service', () => ({
  apiService: {
    get: jest.fn(),
  },
}));

describe('DashboardPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders dashboard data on successful fetch', async () => {
    (apiService.get as jest.Mock).mockResolvedValue({
      stats: {
        totalProducts: 100,
        totalInventoryItems: 42,
        expiringItems: 10,
        lowStockItems: 5,
      },
      recentActivity: [
        {
          id: 1,
          description: 'Activity 1',
          timestamp: '2025-09-24T10:00:00Z',
        },
      ],
    });

    const tokenValue = 'test-session-value';
    render(<DashboardPage token={tokenValue} />);

    expect(screen.getByText(/Loading dashboard.../i)).toBeInTheDocument();

    expect(await screen.findByText(/Total Products/i)).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByText(/Inventory Items/i)).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText(/Expiring Soon/i)).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText(/Low Stock/i)).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText(/Recent Activity/i)).toBeInTheDocument();
    expect(screen.getByText(/Activity 1/i)).toBeInTheDocument();

    expect(apiService.get).toHaveBeenCalledWith('/dashboard', tokenValue);
  });

  it('displays an error message if token is missing', async () => {
    render(<DashboardPage token={null} />);

    await waitFor(() => {
      expect(screen.getByText(/Error: Authentication token is missing./i)).toBeInTheDocument();
    });
  });

  it('displays an error message on failed data fetch', async () => {
    (apiService.get as jest.Mock).mockRejectedValueOnce(new Error('Failed to load data'));

    const tokenValue = 'test-session-value';
    render(<DashboardPage token={tokenValue} />);

    await waitFor(() => {
      expect(screen.getByText(/Error: Failed to load data/i)).toBeInTheDocument();
    });
  });
});
