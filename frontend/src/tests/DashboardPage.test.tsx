import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { DashboardPage } from '../pages/DashboardPage';
import { apiService } from '../lib/api.service';
import '@testing-library/jest-dom';

const mockGetToken = vi.fn();

vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({
    getToken: mockGetToken,
  }),
}));

// Mock apiService
vi.mock('../lib/api.service', () => ({
  apiService: {
    get: vi.fn(),
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
    vi.clearAllMocks();
    mockGetToken.mockResolvedValue(undefined);
  });

  it('renders dashboard data on successful fetch', async () => {
    (apiService.get as jest.Mock).mockResolvedValue({
      stats: {
        totalProducts: 100,
        totalInventoryItems: 42,
        expiringItems: 10,
        expiredActionItems: 5,
      },
      activity: {
        lastCatalogueUpload: {
          fileName: 'catalogue-sep.csv',
          uploadedAt: '2025-09-24T10:00:00Z',
        },
        expiredItemsEnteredToday: 7,
        stockLossLast30Days: 1234.5,
      },
    });

    const tokenValue = 'test-session-value';
    renderDashboard(tokenValue);

    expect(screen.getByRole('status')).toHaveTextContent(/Loading pharmacy dashboard/i);

    expect(
      await screen.findByRole('heading', { name: /Dashboard/i, level: 1 }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Review expiring stock and expired items awaiting a decision/i),
    ).toBeInTheDocument();
    expect(await screen.findByText(/Total Products/i)).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByText(/Inventory Items/i)).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Expiring Soon/i, level: 3 })).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /Expired — needs action/i, level: 3 }),
    ).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText(/Recent Activity/i)).toBeInTheDocument();
    expect(screen.getByText(/Catalogue last updated/i)).toBeInTheDocument();
    expect(screen.getByText(/catalogue-sep\.csv/i)).toBeInTheDocument();
    expect(screen.getByText(/Expired items added today/i)).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText(/Stock loss \(last 30 days\)/i)).toBeInTheDocument();
    expect(screen.getByText(/\$1,234\.50/)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /Needs attention/i })).toHaveTextContent(
      /15 items need a stock decision/i,
    );
    expect(screen.getByText(/Within 30 days of expiry/i)).toBeInTheDocument();
    expect(screen.getByText(/Mark these as sold-through or expired/i)).toBeInTheDocument();
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

  it('shows a fallback when no catalogue has been uploaded', async () => {
    (apiService.get as jest.Mock).mockResolvedValue({
      stats: {
        totalProducts: 0,
        totalInventoryItems: 0,
        expiringItems: 0,
        expiredActionItems: 0,
      },
      activity: {
        lastCatalogueUpload: null,
        expiredItemsEnteredToday: 0,
        stockLossLast30Days: 0,
      },
    });

    renderDashboard('test-session-value');

    expect(await screen.findByText(/No catalogue uploaded yet/i)).toBeInTheDocument();
    expect(screen.getByText(/\$0\.00/)).toBeInTheDocument();
  });

  it('does not render an invalid upload timestamp as a time element', async () => {
    (apiService.get as jest.Mock).mockResolvedValue({
      stats: {
        totalProducts: 0,
        totalInventoryItems: 0,
        expiringItems: 0,
        expiredActionItems: 0,
      },
      activity: {
        lastCatalogueUpload: {
          fileName: 'broken.csv',
          uploadedAt: 'not-a-date',
        },
        expiredItemsEnteredToday: 0,
        stockLossLast30Days: 0,
      },
    });

    renderDashboard('test-session-value');

    const fallbackTimestamp = await screen.findByText('Time not available');
    expect(fallbackTimestamp.tagName).toBe('SPAN');
    expect(fallbackTimestamp).not.toHaveAttribute('dateTime');
  });

  it('renders without an activity payload', async () => {
    (apiService.get as jest.Mock).mockResolvedValue({
      stats: {
        totalProducts: 0,
        totalInventoryItems: 0,
        expiringItems: 0,
        expiredActionItems: 0,
      },
    });

    renderDashboard('test-session-value');

    expect(await screen.findByText(/No catalogue uploaded yet/i)).toBeInTheDocument();
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

  it('refreshes the Clerk token before fetching dashboard data', async () => {
    mockGetToken.mockResolvedValue('fresh-clerk-token');
    (apiService.get as jest.Mock).mockResolvedValue({
      stats: {
        totalProducts: 1,
        totalInventoryItems: 1,
        expiringItems: 0,
        expiredActionItems: 0,
      },
      activity: {
        lastCatalogueUpload: null,
        expiredItemsEnteredToday: 0,
        stockLossLast30Days: 0,
      },
    });

    renderDashboard('expired-prop-token');

    await waitFor(() => {
      expect(mockGetToken).toHaveBeenCalled();
      expect(apiService.get).toHaveBeenCalledWith('/dashboard', 'fresh-clerk-token');
    });
  });
});
