import React from 'react';
import { randomUUID } from 'crypto';
import { render, screen, waitFor } from '@testing-library/react';
import { ReportsPage } from '../pages/ReportsPage';
import { apiService } from '../lib/api.service';
import '@testing-library/jest-dom';

// Mock apiService
jest.mock('../lib/api.service', () => ({
  apiService: {
    get: jest.fn(),
  },
}));

describe('ReportsPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders monthly expiry report data on successful fetch', async () => {
    (apiService.get as jest.Mock).mockImplementation((url: string) => {
      if (url === '/reports/expiry') {
        return Promise.resolve([
          {
            month: '2025-08',
            total_expiring: 10,
            expired_count: 5,
            markdown1_count: 2,
            markdown2_count: 1,
            markdown3_count: 2,
            total_markdown: 5,
            latest_expiry_date: '2025-08-31',
          },
        ]);
      }
      if (url === '/reports/expiry-overall') {
        return Promise.resolve({
          month: 'Overall',
          total_expiring: 100,
          expired_count: 50,
          markdown1_count: 20,
          markdown2_count: 10,
          markdown3_count: 20,
          total_markdown: 50,
          latest_expiry_date: '2025-12-31',
        });
      }
      return Promise.reject(new Error('Unknown URL'));
    });

    const tokenValue = randomUUID();
    render(<ReportsPage token={tokenValue} />);

    expect(screen.getByText(/Loading reports…/i)).toBeInTheDocument();

    expect(await screen.findByText(/Monthly Expiry Report/i)).toBeInTheDocument();
    // Use getAllByText since the month appears multiple times (in month and latest_expiry_date columns)
    expect(screen.getAllByText(/2025-08/i).length).toBeGreaterThan(0);

    expect(apiService.get).toHaveBeenCalledWith('/reports/expiry', tokenValue);
  });

  it('displays an error message if token is missing', async () => {
    render(<ReportsPage token={null} />);

    await waitFor(() => {
      expect(screen.getByText(/Error: Authentication token is missing./i)).toBeInTheDocument();
    });
  });

  it('displays an error message on failed data fetch', async () => {
    (apiService.get as jest.Mock).mockRejectedValue(new Error('Failed to load report'));

    const tokenValue = randomUUID();
    render(<ReportsPage token={tokenValue} />);

    await waitFor(() => {
      expect(screen.getByText(/Error: Failed to load report/i)).toBeInTheDocument();
    });
  });
});
