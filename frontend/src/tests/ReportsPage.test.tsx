import React from 'react';
import { randomUUID } from 'crypto';
import { render, screen, waitFor } from '@testing-library/react';
import { ReportsPage } from '../pages/ReportsPage';
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

describe('ReportsPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders monthly expiry report data on successful fetch', async () => {
    // @ts-expect-error — apiService.get is mocked as jest.fn()
    apiService.get.mockImplementation((url) => {
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
            expiry_risk_count: 3,
            next_month_markdown_count: 7,
            active_expiry_stock_count: 45,
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
          expiry_risk_count: 3,
          next_month_markdown_count: 7,
          active_expiry_stock_count: 45,
          latest_expiry_date: '2025-12-31',
        });
      }
      return Promise.reject(new Error('Unknown URL'));
    });

    const tokenValue = randomUUID();
    render(<ReportsPage token={tokenValue} />);

    expect(await screen.findByText(/Monthly expiry report/i)).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /Expiry reporting/i, level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('main', { name: /Expiry reporting workspace/i })).toBeInTheDocument();
    expect(screen.getByText(/Expiry action summary/i)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /Primary expiry decision/i })).toHaveTextContent(
      /Expiry risk/i,
    );
    expect(screen.getByRole('region', { name: /Expiry stock action summary/i })).toHaveTextContent(
      /Expiry risk/i,
    );
    expect(screen.getByText(/Entering markdown next month/i)).toBeInTheDocument();
    expect(screen.getByText(/Active expiry stock/i)).toBeInTheDocument();
    expect(screen.queryByText(/Next review window/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Total Items$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Markdown 1$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Markdown 2$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Markdown 3$/i)).not.toBeInTheDocument();
    // Use getAllByText since the month appears multiple times (in month and latest_expiry_date columns)
    expect(screen.getAllByText(/2025-08/i).length).toBeGreaterThan(0);

    expect(apiService.get).toHaveBeenCalledWith('/reports/expiry', tokenValue, expect.any(Object));
  });

  it('renders production-shaped report payloads without visible NaN counts', async () => {
    // @ts-expect-error — apiService.get is mocked as jest.fn()
    apiService.get.mockImplementation((url) => {
      if (url === '/reports/expiry') {
        return Promise.resolve([
          {
            month: '2026-06',
            total_expiring: '8',
            expired_count: null,
            markdown1_count: '2',
            markdown2_count: '1',
            markdown3_count: '3',
            total_markdown: '6',
            latest_expiry_date: '2026-06-30',
          },
        ]);
      }
      if (url === '/reports/expiry-overall') {
        return Promise.resolve({
          month: 'Overall',
          total_expiring: '18',
          expired_count: '4',
          markdown1_count: '5',
          markdown2_count: '2',
          markdown3_count: '3',
          total_markdown: '10',
          expiry_risk_count: '3',
          next_month_markdown_count: null,
          latest_expiry_date: '2026-10-31',
        });
      }
      return Promise.reject(new Error('Unknown URL'));
    });

    const tokenValue = randomUUID();
    render(<ReportsPage token={tokenValue} />);

    expect(await screen.findByText(/Monthly expiry report/i)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /Primary expiry decision/i })).toHaveTextContent('3');
    expect(screen.getByText(/Entering markdown next month/i).parentElement).toHaveTextContent('0');
    expect(screen.getByText(/Active expiry stock/i).parentElement).toHaveTextContent('0');
    expect(screen.queryByText(/NaN/i)).not.toBeInTheDocument();
  });

  it('displays an error message if token is missing', async () => {
    render(<ReportsPage token={null} />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/Authentication token is missing/i);
    });
  });

  it('displays an error message on failed data fetch', async () => {
    // @ts-expect-error — apiService.get is mocked as jest.fn()
    apiService.get.mockRejectedValue(new Error('Failed to load report'));

    const tokenValue = randomUUID();
    render(<ReportsPage token={tokenValue} />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/Failed to load report/i);
    });
  });

  it('clears previous report errors before a successful refetch', async () => {
    const firstToken = randomUUID();
    const secondToken = randomUUID();

    // @ts-expect-error — apiService.get is mocked as jest.fn()
    apiService.get.mockImplementation((url, token) => {
      if (token === firstToken) {
        return Promise.reject(new Error('Temporary report failure'));
      }
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
            expiry_risk_count: 3,
            next_month_markdown_count: 7,
            active_expiry_stock_count: 45,
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
          expiry_risk_count: 3,
          next_month_markdown_count: 7,
          active_expiry_stock_count: 45,
          latest_expiry_date: '2025-12-31',
        });
      }
      return Promise.reject(new Error('Unknown URL'));
    });

    const { rerender } = render(<ReportsPage token={firstToken} />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/Temporary report failure/i);

    rerender(<ReportsPage token={secondToken} />);

    expect(await screen.findByText(/Monthly expiry report/i)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: /Expiry stock action summary/i })).toHaveTextContent(
      /Expiry risk/i,
    );
  });

  it('renders the sell-through by markdown level report when data is available', async () => {
    // @ts-expect-error — apiService.get is mocked as jest.fn()
    apiService.get.mockImplementation((url) => {
      if (url === '/reports/expiry') {
        return Promise.resolve([]);
      }
      if (url === '/reports/expiry-overall') {
        return Promise.resolve({
          month: 'Overall',
          total_expiring: 0,
          expired_count: 0,
          total_markdown: 0,
          expiry_risk_count: 0,
          next_month_markdown_count: 0,
          active_expiry_stock_count: 0,
          latest_expiry_date: '',
        });
      }
      if (url === '/reports/sell-through') {
        return Promise.resolve([
          { markdownLevel: 1, soldCount: 4 },
          { markdownLevel: 3, soldCount: 9 },
          { markdownLevel: null, soldCount: 2 },
        ]);
      }
      return Promise.reject(new Error('Unknown URL'));
    });

    render(<ReportsPage token={randomUUID()} />);

    const section = await screen.findByText(/Sell-through by markdown level/i);
    expect(section).toBeInTheDocument();
    expect(screen.getByText(/Markdown 1 \(61–90 days\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Sold before markdown/i)).toBeInTheDocument();
  });
});
