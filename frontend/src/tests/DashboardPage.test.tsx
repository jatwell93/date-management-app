import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { DashboardPage } from '../pages/DashboardPage';
import { apiService } from '../lib/api.service';
import '@testing-library/jest-dom';

// Mock apiService
jest.mock('../lib/api.service', () => ({
  apiService: {
    get: jest.fn(),
  },
}));

function renderDashboard(token: string | null) {
  return render(
    <BrowserRouter>
      <DashboardPage token={token} />
    </BrowserRouter>,
  );
}

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
    renderDashboard(tokenValue);

    expect(screen.getByRole('status')).toHaveTextContent(/Loading pharmacy dashboard/i);

    expect(
      await screen.findByRole('heading', { name: /Dashboard/i, level: 1 }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Review expiring stock and low stock before the next order/i),
    ).toBeInTheDocument();
    expect(await screen.findByText(/Total Products/i)).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByText(/Inventory Items/i)).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Expiring Soon/i, level: 3 })).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Low Stock/i, level: 3 })).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText(/Recent Activity/i)).toBeInTheDocument();
    expect(screen.getByText(/Activity 1/i)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /Needs attention/i })).toHaveTextContent(
      /15 items need a stock decision/i,
    );
    expect(screen.getByText(/Use the expiry report to plan markdowns/i)).toBeInTheDocument();
    expect(screen.getByText(/Check whether these items need reordering/i)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /Inventory covered/i })).toBeInTheDocument();
    expect(screen.getByText(/100 products with 42 inventory records/i)).toBeInTheDocument();
    expect(screen.queryByText(/stock signals/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/stock pressure/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/tracked records/i)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open expiry report/i })).toHaveAttribute(
      'href',
      '/detailed-expiry-report',
    );
    expect(screen.getByRole('link', { name: /Open expiry report/i })).toHaveClass(
      'dashboard-action-link',
      'basis-0',
      'flex-1',
      'min-h-11',
      'min-w-0',
    );
    expect(screen.getByRole('link', { name: /View expired items/i })).toHaveAttribute(
      'href',
      '/expired-items',
    );
    expect(screen.getByRole('link', { name: /View expired items/i })).toHaveClass(
      'flex-1',
      'basis-0',
      'min-h-11',
      'min-w-0',
    );
    const expectedTimestamp = new Intl.DateTimeFormat('en-AU', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date('2025-09-24T10:00:00Z'));
    const timestamp = screen.getByText(expectedTimestamp);
    expect(timestamp).toHaveAttribute('dateTime', '2025-09-24T10:00:00Z');

    expect(apiService.get).toHaveBeenCalledWith('/dashboard', tokenValue);
  });

  it('shows an action-oriented empty activity state', async () => {
    (apiService.get as jest.Mock).mockResolvedValue({
      stats: {
        totalProducts: 0,
        totalInventoryItems: 0,
        expiringItems: 0,
        lowStockItems: 0,
      },
      recentActivity: [],
    });

    renderDashboard('test-session-value');

    expect(
      await screen.findByText(/Activity will appear after scans, imports, or stock edits/i),
    ).toBeInTheDocument();
  });

  it('displays an error message if token is missing', async () => {
    renderDashboard(null);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/Authentication token is missing/i);
    });
  });

  it('displays an error message on failed data fetch', async () => {
    (apiService.get as jest.Mock).mockRejectedValueOnce(new Error('Failed to load data'));

    const tokenValue = 'test-session-value';
    renderDashboard(tokenValue);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/Failed to load data/i);
    });
  });
});
