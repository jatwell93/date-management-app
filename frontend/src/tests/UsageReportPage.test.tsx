import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { UsageReportPage } from '../pages/UsageReportPage';
import { apiService } from '../lib/api.service';
import '@testing-library/jest-dom';

// Mock apiService
jest.mock('../lib/api.service', () => ({
  apiService: {
    get: jest.fn(),
  },
}));

// Mock canvas for chart.js (required in jsdom environment)
HTMLCanvasElement.prototype.getContext = jest.fn();

describe('UsageReportPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders usage report data on successful fetch', async () => {
    // Mock all the API calls the component makes
    (apiService.get as jest.Mock).mockImplementation((url: string) => {
      if (url === '/reports/daily-usage') {
        return Promise.resolve([
          { date: '2025-01-30', user_id: 1, user_role: 'Manager', creations: 5, updates: 3, deletions: 1 },
        ]);
      }
      if (url === '/reports/items-by-user') {
        return Promise.resolve([
          { userId: 1, userName: 'Manager 1', itemCount: 150 },
        ]);
      }
      if (url === '/reports/items-by-date') {
        return Promise.resolve([
          { date: '2025-01-30', itemCount: 20 },
        ]);
      }
      return Promise.resolve([]);
    });

    const tokenValue = 'test-session-value';
    render(<UsageReportPage token={tokenValue} />);

    expect(screen.getByText(/Loading usage report.../i)).toBeInTheDocument();

    // Wait for content to load - the component shows "Items Added by User" and "Daily User Activity Report"
    expect(await screen.findByText(/Items Added by User/i)).toBeInTheDocument();
    expect(screen.getByText(/Daily User Activity Report/i)).toBeInTheDocument();
    expect(screen.getByText(/Items Added per Day/i)).toBeInTheDocument();

    expect(apiService.get).toHaveBeenCalledWith('/reports/daily-usage', tokenValue);
  });

  it('displays an error message if token is missing', async () => {
    render(<UsageReportPage token={null} />);

    await waitFor(() => {
      expect(screen.getByText(/Error: Authentication token is missing./i)).toBeInTheDocument();
    });
  });

  it('displays an error message on failed data fetch', async () => {
    (apiService.get as jest.Mock).mockRejectedValue(new Error('Failed to load usage report'));

    const tokenValue = 'test-session-value';
    render(<UsageReportPage token={tokenValue} />);

    await waitFor(() => {
      expect(screen.getByText(/Error: Failed to load usage report/i)).toBeInTheDocument();
    });
  });
});
