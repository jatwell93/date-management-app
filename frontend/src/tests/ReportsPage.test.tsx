import React from 'react';
import { randomUUID } from 'crypto';
import { render, screen, waitFor } from '@testing-library/react';
import { ReportsPage } from '../pages/ReportsPage';
import '@testing-library/jest-dom';

// Mock fetch API
global.fetch = jest.fn(() =>
  Promise.resolve({
    ok: true,
    json: () =>
      Promise.resolve([{ month: '2025-08', expiringItemsCount: 10, expiredItemsCount: 5 }]),
  } as Response),
);

describe('ReportsPage', () => {
  it('renders monthly expiry report data on successful fetch', async () => {
    const tokenValue = randomUUID();
    render(<ReportsPage token={tokenValue} />);

    expect(screen.getByText(/Loading reports.../i)).toBeInTheDocument();

    expect(await screen.findByText(/Monthly Expiry Report/i)).toBeInTheDocument();
    expect(screen.getByText(/2025-08/i)).toBeInTheDocument();
    expect(screen.getByText(/10/i)).toBeInTheDocument(); // Expiring Items
    expect(screen.getByText(/5/i)).toBeInTheDocument(); // Expired Items

    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3001/reports/expiry',
      expect.objectContaining({
        headers: { Authorization: `Bearer ${tokenValue}` },
      }),
    );
  });

  it('displays an error message if token is missing', async () => {
    render(<ReportsPage token={null} />);

    await waitFor(() => {
      expect(screen.getByText(/Error: Authentication token is missing./i)).toBeInTheDocument();
    });
  });

  it('displays an error message on failed data fetch', async () => {
    (global.fetch as jest.Mock).mockImplementationOnce(() =>
      Promise.resolve({
        ok: false,
        json: () => Promise.resolve({ message: 'Failed to load report' }),
      } as Response),
    );

    const tokenValue = randomUUID();
    render(<ReportsPage token={tokenValue} />);

    await waitFor(() => {
      expect(screen.getByText(/Error: Failed to load report/i)).toBeInTheDocument();
    });
  });
});
