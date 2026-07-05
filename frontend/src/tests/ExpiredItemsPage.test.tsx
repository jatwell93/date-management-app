import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

  it('allows clearing and typing a multi-digit write-off quantity for an expired item group', async () => {
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
      unitsDiscarded: 15,
      financialLoss: 187.5,
      markdownLevel: null,
      transactionDate: '2026-06-30T00:00:00.000Z',
    });

    render(<ExpiredItemsPage token="test-session-value" />);

    expect(await screen.findAllByText('Cold Chain Vaccine')).not.toHaveLength(0);
    await userEvent.click(screen.getAllByRole('button', { name: /^Expired$/i })[0]);

    const unitsInput = screen.getByLabelText(/Units to Discard/i);
    await userEvent.clear(unitsInput);
    expect(unitsInput).toHaveValue(null);

    await userEvent.type(unitsInput, '15');
    expect(unitsInput).toHaveValue(15);

    await userEvent.click(screen.getByRole('button', { name: /Mark Expired/i }));

    expect(await screen.findByText(/15 units/i, {}, { timeout: 2000 })).toBeInTheDocument();
    expect(screen.getByText(/\$187\.50/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Confirm/i }));

    await waitFor(() => {
      expect(mockedProcessExpiredItem).toHaveBeenCalledWith(
        { inventoryItemId: 101, action: 'expired', unitsDiscarded: 15 },
        'test-session-value',
      );
    });
  });

  it('omits unitsDiscarded from the payload when marking an item as sold through', async () => {
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
      id: 901,
      inventoryItemId: 101,
      userId: 7,
      action: 'sold_through',
      unitsDiscarded: null,
      financialLoss: null,
      markdownLevel: null,
      transactionDate: '2026-06-30T00:00:00.000Z',
    });

    render(<ExpiredItemsPage token="test-session-value" />);

    expect(await screen.findAllByText('Cold Chain Vaccine')).not.toHaveLength(0);
    await userEvent.click(screen.getAllByRole('button', { name: /Sold Through/i })[0]);

    await userEvent.click(screen.getByRole('button', { name: /Mark Sold Through/i }));

    expect(
      await screen.findByText(/marking this item as sold through/i, {}, { timeout: 2000 }),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Confirm/i }));

    await waitFor(() => {
      expect(mockedProcessExpiredItem).toHaveBeenCalledWith(
        { inventoryItemId: 101, action: 'sold_through' },
        'test-session-value',
      );
    });

    // The payload must not carry unitsDiscarded for sold-through; both the
    // production Worker and the backend ignore the field only when it is absent
    // and action is 'sold_through'.
    const [payload] = mockedProcessExpiredItem.mock.calls[0];
    expect(payload).not.toHaveProperty('unitsDiscarded');
  });

  it('uses one semantic typography system for process dialog detail and quantity text', async () => {
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
    // '0' is invalid (must be >= 1), so the error element renders and we can assert
    // its typography class. The quantity is intentionally NOT capped at the
    // scanned count anymore (issue #268), so a value above quantityAvailable is valid.
    fireEvent.change(screen.getByLabelText(/Units to Discard/i), { target: { value: '0' } });

    const dialog = screen.getByRole('dialog', { name: /Process Expired Item/i });
    const primaryValueElements = [
      within(dialog).getByText('Cold Chain Vaccine'),
      within(dialog).getByText('VAC-100'),
      within(dialog).getByText('Fridge'),
      within(dialog).getByText('01 May 2026'),
      within(dialog).getByText('$12.50'),
    ];
    primaryValueElements.forEach((element) => {
      expect(element).toHaveClass(
        'text-sm',
        'font-medium',
        'text-semantic-text-primary',
        'break-words',
      );
    });

    expect(
      within(dialog).getByText('Enter the total number of expired units to write off.'),
    ).toHaveClass('mt-1', 'text-sm', 'font-medium', 'text-semantic-text-secondary');
    expect(within(dialog).getByText('Must be at least 1')).toHaveClass(
      'mt-1',
      'text-sm',
      'font-medium',
      'text-semantic-critical',
    );
  });

  it('allows a write-off quantity greater than the scanned count (issue #268)', async () => {
    mockedGetExpiredItems
      .mockResolvedValueOnce([
        {
          id: 101,
          productId: 20,
          productName: 'Cold Chain Vaccine',
          sku: 'VAC-100',
          expiryDate: '2026-05-01',
          status: 'Expired',
          costPrice: 10,
          locationId: 4,
          locationName: 'Fridge',
          quantityAvailable: 1,
        },
      ])
      .mockResolvedValueOnce([]);
    mockedApiGet.mockResolvedValue([]);
    mockedProcessExpiredItem.mockResolvedValue({
      id: 902,
      inventoryItemId: 101,
      userId: 7,
      action: 'expired',
      unitsDiscarded: 15,
      financialLoss: 150,
      markdownLevel: null,
      transactionDate: '2026-06-30T00:00:00.000Z',
    });

    render(<ExpiredItemsPage token="test-session-value" />);

    expect(await screen.findAllByText('Cold Chain Vaccine')).not.toHaveLength(0);
    fireEvent.click(screen.getAllByRole('button', { name: /^Expired$/i })[0]);

    const unitsInput = screen.getByLabelText(/Units to Discard/i);
    fireEvent.change(unitsInput, { target: { value: '15' } });
    // No validation error even though quantityAvailable is 1.
    expect(screen.queryByText(/Must be at least 1/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Mark Expired/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Confirm/i }));

    await waitFor(() => {
      expect(mockedProcessExpiredItem).toHaveBeenCalledWith(
        { inventoryItemId: 101, action: 'expired', unitsDiscarded: 15 },
        'test-session-value',
      );
    });
  });

  it.each([
    ['0', /Must be at least 1/i],
    ['1.5', /Enter a whole number/i],
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

  it('renders a print-only desktop table without interactive actions', async () => {
    mockedGetExpiredItems.mockResolvedValue([
      {
        id: 201,
        productId: 30,
        productName: 'Printable Expired Item',
        sku: 'EXP-200',
        expiryDate: '2026-05-01',
        status: 'Expired',
        costPrice: 8.75,
        locationId: 5,
        locationName: 'Back Stock',
        quantityAvailable: 4,
      },
    ]);
    mockedApiGet.mockResolvedValue([]);

    render(<ExpiredItemsPage token="test-session-value" />);

    await screen.findAllByText('Printable Expired Item');

    const printTable = await screen.findByRole('table', {
      name: /Printable expired items table/i,
      hidden: true,
    });

    expect(printTable).toHaveTextContent('Printable Expired Item');
    expect(printTable).toHaveTextContent('EXP-200');
    expect(printTable).not.toHaveTextContent(/Actions/i);
    expect(printTable).not.toHaveTextContent(/Sold Through/i);
  });
});
