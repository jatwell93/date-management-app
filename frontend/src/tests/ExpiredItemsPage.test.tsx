import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ExpiredItemsPage from '../pages/ExpiredItemsPage';
import { apiService } from '../lib/api.service';
import { getExpiredItems, processExpiredItem } from '../services/expiredItemService';
import '@testing-library/jest-dom';

vi.mock('../hooks/useFreshApiToken', () => ({
  useFreshApiToken: (() => {
    const callbacks = new Map<string, jest.Mock>();
    return (token: string | null) => {
      const key = token ?? '__missing__';
      if (!callbacks.has(key)) {
        callbacks.set(key, vi.fn().mockResolvedValue(token || undefined));
      }
      return callbacks.get(key);
    };
  })(),
}));

vi.mock('../lib/api.service', () => ({
  apiService: {
    get: vi.fn(),
  },
}));

vi.mock('../services/expiredItemService', () => ({
  getExpiredItems: vi.fn(),
  processExpiredItem: vi.fn(),
}));

vi.mock('../components/ExpiredLossReport', () => ({
  default: () => <div>Expired loss report</div>,
}));

vi.mock('react-chartjs-2', () => ({
  Bar: () => <div role="img" aria-label="Loss chart" />,
}));

describe('ExpiredItemsPage', () => {
  const mockedApiGet = apiService.get as jest.MockedFunction<typeof apiService.get>;
  const mockedGetExpiredItems = getExpiredItems as jest.MockedFunction<typeof getExpiredItems>;
  const mockedProcessExpiredItem = processExpiredItem as jest.MockedFunction<
    typeof processExpiredItem
  >;

  beforeEach(() => {
    vi.clearAllMocks();
    mockedApiGet.mockReset();
    mockedGetExpiredItems.mockReset();
    mockedProcessExpiredItem.mockReset();
  });

  it('passes the chart abort signal into both loss report requests', async () => {
    mockedGetExpiredItems.mockResolvedValue([]);
    mockedApiGet.mockResolvedValue([]);

    render(<ExpiredItemsPage token="test-session-value" />);

    expect(await screen.findByText(/No expired items found/i)).toBeInTheDocument();
    expect(mockedApiGet).toHaveBeenCalledWith(
      '/reports/loss-by-sku',
      'test-session-value',
      expect.any(AbortSignal),
    );
    expect(mockedApiGet).toHaveBeenCalledWith(
      '/reports/loss-by-department',
      'test-session-value',
      expect.any(AbortSignal),
    );
  });

  it('aborts a retry request when the page unmounts', async () => {
    let retrySignal: AbortSignal | undefined;
    let rejectRetry: (reason?: unknown) => void = () => {};

    mockedGetExpiredItems
      .mockRejectedValueOnce(new Error('Initial load failed'))
      .mockImplementationOnce((_token, signal?: AbortSignal) => {
        retrySignal = signal;
        return new Promise((_resolve, reject) => {
          rejectRetry = reject;
        });
      });

    const { unmount } = render(<ExpiredItemsPage token="test-session-value" />);

    const retryButton = await screen.findByRole('button', { name: /Try again/i });
    await act(async () => {
      retryButton.click();
    });
    expect(retrySignal?.aborted).toBe(false);

    unmount();

    expect(retrySignal?.aborted).toBe(true);

    await act(async () => {
      rejectRetry(new DOMException('Aborted', 'AbortError'));
    });
  });

  it('submits the entered whole write-off quantity for an expired item group', async () => {
    mockedGetExpiredItems
      .mockResolvedValueOnce([
        {
          id: 101,
          productId: 20,
          productName: 'Cold Chain Vaccine',
          sku: 'VAC-100',
          expiryDate: '2026-05-01',
          status: 'Expired',
          costPrice: 12.5,
          locationId: 4,
          locationName: 'Fridge',
          quantityAvailable: 100,
        },
      ])
      .mockResolvedValueOnce([]);
    mockedApiGet.mockResolvedValue([]);
    mockedProcessExpiredItem.mockResolvedValue({
      id: 900,
      inventoryItemId: 101,
      userId: 7,
      action: 'expired',
      unitsDiscarded: 37,
      financialLoss: 462.5,
      markdownLevel: null,
      transactionDate: '2026-06-30T00:00:00.000Z',
    });

    render(<ExpiredItemsPage token="test-session-value" />);

    expect(await screen.findAllByText('Cold Chain Vaccine')).not.toHaveLength(0);
    fireEvent.click(screen.getAllByRole('button', { name: /^Expired$/i })[0]);
    fireEvent.change(screen.getByLabelText(/Units to Discard/i), { target: { value: '37' } });
    fireEvent.click(screen.getByRole('button', { name: /Mark Expired/i }));

    expect(await screen.findByText(/37 units/i, {}, { timeout: 2000 })).toBeInTheDocument();
    expect(screen.getByText(/\$462\.50/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Confirm/i }));

    await waitFor(() => {
      expect(mockedProcessExpiredItem).toHaveBeenCalledWith(
        { inventoryItemId: 101, action: 'expired', unitsDiscarded: 37 },
        'test-session-value',
      );
    });
  });

  it.each([
    ['0', /Must be at least 1/i],
    ['1.5', /Enter a whole number/i],
    ['101', /Cannot exceed available quantity \(100\)/i],
  ])('rejects invalid write-off quantity %s before confirmation', async (quantity, message) => {
    mockedGetExpiredItems.mockResolvedValue([
      {
        id: 101,
        productId: 20,
        productName: 'Cold Chain Vaccine',
        sku: 'VAC-100',
        expiryDate: '2026-05-01',
        status: 'Expired',
        costPrice: 12.5,
        locationId: 4,
        locationName: 'Fridge',
        quantityAvailable: 100,
      },
    ]);
    mockedApiGet.mockResolvedValue([]);

    render(<ExpiredItemsPage token="test-session-value" />);

    expect(await screen.findAllByText('Cold Chain Vaccine')).not.toHaveLength(0);
    fireEvent.click(screen.getAllByRole('button', { name: /^Expired$/i })[0]);
    fireEvent.change(screen.getByLabelText(/Units to Discard/i), {
      target: { value: quantity },
    });
    fireEvent.click(screen.getByRole('button', { name: /Mark Expired/i }));

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.queryByText(/Confirm Action/i)).not.toBeInTheDocument();
    expect(mockedProcessExpiredItem).not.toHaveBeenCalled();
  });
});
