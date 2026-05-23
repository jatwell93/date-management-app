import React from 'react';
import { act, render, screen } from '@testing-library/react';
import ExpiredItemsPage from '../pages/ExpiredItemsPage';
import { apiService } from '../lib/api.service';
import { getExpiredItems } from '../services/expiredItemService';
import '@testing-library/jest-dom';

jest.mock('../lib/api.service', () => ({
  apiService: {
    get: jest.fn(),
  },
}));

jest.mock('../services/expiredItemService', () => ({
  getExpiredItems: jest.fn(),
  processExpiredItem: jest.fn(),
}));

jest.mock('../components/ExpiredLossReport', () => () => <div>Expired loss report</div>);

jest.mock('react-chartjs-2', () => ({
  Bar: () => <div role="img" aria-label="Loss chart" />,
}));

describe('ExpiredItemsPage', () => {
  const mockedApiGet = apiService.get as jest.MockedFunction<typeof apiService.get>;
  const mockedGetExpiredItems = getExpiredItems as jest.MockedFunction<typeof getExpiredItems>;

  beforeEach(() => {
    jest.clearAllMocks();
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
});
