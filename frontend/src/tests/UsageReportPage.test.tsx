import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { UsageReportPage } from '../pages/UsageReportPage';
import '@testing-library/jest-dom';

// Mock fetch API
global.fetch = jest.fn(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve([{ user: 'Manager 1', scans: 150, markdowns: 20 }]),
  } as Response),
);

describe('UsageReportPage', () => {
  it('renders usage report data on successful fetch', async () => {
    const tokenValue = 'test-session-value';
    render(<UsageReportPage token={tokenValue} />);

    expect(screen.getByText(/Loading usage report.../i)).toBeInTheDocument();

    expect(await screen.findByText(/User Usage Report/i)).toBeInTheDocument();
    expect(screen.getByText(/Manager 1/i)).toBeInTheDocument();
    expect(screen.getByText(/150/i)).toBeInTheDocument();
    expect(screen.getByText(/20/i)).toBeInTheDocument();

    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3001/reports/usage',
      expect.objectContaining({
        headers: { Authorization: `Bearer ${tokenValue}` },
      }),
    );
  });

  it('displays an error message if token is missing', async () => {
    render(<UsageReportPage token={null} />);

    await waitFor(() => {
      expect(screen.getByText(/Error: Authentication token is missing./i)).toBeInTheDocument();
    });
  });

  it('displays an error message on failed data fetch', async () => {
    (global.fetch as jest.Mock).mockImplementationOnce(() =>
      Promise.resolve({
        ok: false,
        json: () => Promise.resolve({ message: 'Failed to load usage report' }),
      } as Response),
    );

    const tokenValue = 'test-session-value';
    render(<UsageReportPage token={tokenValue} />);

    await waitFor(() => {
      expect(screen.getByText(/Error: Failed to load usage report/i)).toBeInTheDocument();
    });
  });
});
