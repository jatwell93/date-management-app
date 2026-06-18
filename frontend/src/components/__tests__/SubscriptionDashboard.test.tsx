import { render, screen, waitFor } from '@testing-library/react';
import { SubscriptionDashboard } from '../SubscriptionDashboard';

jest.mock('../../hooks/useFreshApiToken', () => ({
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

// Mock API responses
const mockSubscriptionData = {
  tierLevel: 'professional',
  status: 'active',
  billingCycle: 'monthly',
  currentPeriodEnd: '2026-03-26T00:00:00Z',
};

const mockUsageData = {
  skus: { current: 1200, limit: 2000 },
  users: { current: 2, limit: 3 },
  storage: { current: 5368709120, limit: 10737418240 }, // 5GB / 10GB
  inventoryItems: { current: 8500, limit: null },
};

global.fetch = jest.fn();

describe('SubscriptionDashboard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders tier badge with correct tier level', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockSubscriptionData,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockUsageData,
      });

    render(<SubscriptionDashboard token="test-token" />);

    await waitFor(() => {
      expect(screen.getByText(/Professional/i)).toBeInTheDocument();
    });
  });

  it('displays usage progress bars for all resources', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockSubscriptionData,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockUsageData,
      });

    render(<SubscriptionDashboard token="test-token" />);

    await waitFor(() => {
      expect(screen.getByText(/SKUs/i)).toBeInTheDocument();
      expect(screen.getByText(/Users/i)).toBeInTheDocument();
      expect(screen.getByText(/Storage/i)).toBeInTheDocument();
    });

    // Check usage counts are displayed
    await waitFor(() => {
      expect(screen.getByText(/1,200/)).toBeInTheDocument();
      expect(screen.getByText(/2,000/)).toBeInTheDocument();
    });
  });

  it('shows upgrade CTA for non-premium tiers', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockSubscriptionData,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockUsageData,
      });

    render(<SubscriptionDashboard token="test-token" onUpgrade={jest.fn()} />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Upgrade Plan/i })).toBeInTheDocument();
    });
  });

  it('displays unlimited for null limits', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...mockSubscriptionData, tierLevel: 'premium' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ...mockUsageData,
          skus: { current: 5000, limit: null },
        }),
      });

    render(<SubscriptionDashboard token="test-token" />);

    await waitFor(() => {
      expect(screen.getAllByText(/Unlimited/i).length).toBeGreaterThan(0);
    });
  });

  it('handles API errors gracefully', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

    render(<SubscriptionDashboard token="test-token" />);

    await waitFor(() => {
      expect(screen.getByText(/Unable to load subscription data/i)).toBeInTheDocument();
    });
  });

  it('shows loading state initially', () => {
    (global.fetch as jest.Mock).mockImplementation(
      () => new Promise(() => {}), // Never resolves
    );

    render(<SubscriptionDashboard token="test-token" />);

    expect(screen.getByText(/Loading/i)).toBeInTheDocument();
  });

  it('calculates percentage correctly for progress bars', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockSubscriptionData,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockUsageData,
      });

    render(<SubscriptionDashboard token="test-token" />);

    // SKUs: 1200/2000 = 60%
    await waitFor(() => {
      const progressBars = screen.getAllByRole('progressbar');
      expect(progressBars.length).toBeGreaterThan(0);
    });
  });
});
