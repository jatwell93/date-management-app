import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { UsageReportPage } from '../pages/UsageReportPage';
import { apiService } from '../lib/api.service';
import '@testing-library/jest-dom';

jest.mock('../hooks/useFreshApiToken', () => ({
  useFreshApiToken: (() => {
    const callbacks = new Map<string, jest.Mock>();
    return (token: string | null) => {
      const key = token ?? '__missing__';
      if (!callbacks.has(key)) {
        callbacks.set(key, jest.fn().mockResolvedValue(token || undefined));
      }
      return callbacks.get(key);
    };
  })(),
}));

// Mock apiService
jest.mock('../lib/api.service', () => ({
  apiService: {
    get: jest.fn(),
  },
}));

jest.mock('react-chartjs-2', () => ({
  Bar: () => <div role="img" aria-label="Items added by user chart" />,
  Line: () => <div role="img" aria-label="Items added per day chart" />,
}));

describe('UsageReportPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders usage report data on successful fetch', async () => {
    // Mock all the API calls the component makes
    // @ts-expect-error — apiService.get is mocked as jest.fn()
    apiService.get.mockImplementation((url) => {
      if (url === '/reports/daily-usage') {
        return Promise.resolve([
          {
            date: '2025-01-30',
            user_id: 1,
            user_role: 'Manager',
            creations: 5,
            updates: 3,
            deletions: 1,
          },
        ]);
      }
      if (url.startsWith('/reports/items-by-user')) {
        return Promise.resolve([{ userId: 1, userName: 'Manager 1', itemCount: 150 }]);
      }
      if (url === '/reports/items-by-date') {
        return Promise.resolve([{ date: '2025-01-30', itemCount: 20 }]);
      }
      return Promise.resolve([]);
    });

    const tokenValue = 'test-session-value';
    render(<UsageReportPage token={tokenValue} />);

    expect(screen.getByRole('status')).toHaveTextContent(/Loading usage report/i);

    // Wait for content to load - the component shows "Stock Added by Team Member" and "Daily Activity"
    expect(
      await screen.findByRole('heading', { name: /Stock Added by Team Member/i, level: 2 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Usage Report/i, level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('main', { name: /Usage reporting workspace/i })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /User contribution summary/i })).toHaveTextContent(
      /Manager 1/i,
    );
    expect(screen.getByRole('heading', { name: /Daily Activity/i })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /Daily Stock Additions/i, level: 2 }),
    ).toBeInTheDocument();

    // Manager 1 appears in both desktop table and mobile list
    const managerElements = screen.getAllByText(/Manager 1/i);
    expect(managerElements.length).toBeGreaterThanOrEqual(1);

    expect(screen.getByRole('table', { name: /Items added by user summary/i })).toHaveTextContent(
      /150/i,
    );
    expect(screen.getByRole('table', { name: /Items added per day summary/i })).toHaveTextContent(
      new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium' }).format(new Date('2025-01-30')),
    );

    expect(apiService.get).toHaveBeenCalledWith(
      '/reports/daily-usage',
      tokenValue,
      expect.any(Object),
    );
  });

  it('displays an error message if token is missing', async () => {
    render(<UsageReportPage token={null} />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/Authentication token is missing/i);
    });
  });

  it('displays an error message on failed data fetch', async () => {
    // @ts-expect-error — apiService.get is mocked as jest.fn()
    apiService.get.mockRejectedValue(new Error('Failed to load usage report'));

    const tokenValue = 'test-session-value';
    render(<UsageReportPage token={tokenValue} />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/Failed to load usage report/i);
    });
  });

  it('keeps chart loading visible until both chart datasets have loaded', async () => {
    let resolveItemsByDate: (value: Array<{ date: string; itemCount: number }>) => void = () => {};
    const itemsByDatePromise = new Promise<Array<{ date: string; itemCount: number }>>(
      (resolve) => {
        resolveItemsByDate = resolve;
      },
    );

    // @ts-expect-error — apiService.get is mocked as jest.fn()
    apiService.get.mockImplementation((url) => {
      if (url === '/reports/daily-usage') {
        return Promise.resolve([]);
      }
      if (url.startsWith('/reports/items-by-user')) {
        return Promise.resolve([{ userId: 1, userName: 'Manager 1', itemCount: 150 }]);
      }
      if (url === '/reports/items-by-date') {
        return itemsByDatePromise;
      }
      return Promise.resolve([]);
    });

    render(<UsageReportPage token="test-session-value" />);

    expect(
      await screen.findByRole('heading', { name: /Stock Added by Team Member/i, level: 2 }),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/Loading chart data/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/No daily stock additions recorded yet/i)).not.toBeInTheDocument();

    await act(async () => {
      resolveItemsByDate([{ date: '2025-01-30', itemCount: 20 }]);
      await itemsByDatePromise;
    });

    expect(
      await screen.findByRole('table', { name: /Items added per day summary/i }),
    ).toBeInTheDocument();
  });
});
