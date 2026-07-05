import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DetailedExpiryReportPage } from '../pages/DetailedExpiryReportPage';
import { apiService } from '../lib/api.service';
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
    put: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

const daysFromNow = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
};

describe('DetailedExpiryReportPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the worklist heading, summary, and a link to all expiry entries', async () => {
    // @ts-expect-error — apiService.get is mocked as vi.fn()
    apiService.get.mockImplementation((url) => {
      if (url === '/reports/expiry-details') {
        return Promise.resolve([
          {
            inventoryId: 10,
            expiryDate: daysFromNow(20),
            status: 'Markdown 3',
            productId: 20,
            productName: 'Very Long Pharmacy Product Name With Strength 500 mg Tablets',
            sku: 'SKU-500',
            costPrice: 12.5,
            locationId: 2,
            locationName: 'Front Counter',
            subDepartment: 'Cold and Flu',
          },
        ]);
      }
      return Promise.resolve([]);
    });

    render(<DetailedExpiryReportPage token="test-session-value" />);

    expect(screen.getByRole('status')).toHaveTextContent(/Loading detailed expiry report/i);

    expect(
      await screen.findByRole('heading', { name: /Markdown Worklist/i, level: 1 }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('main', { name: /Detailed expiry reporting workspace/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /Expiry stock action summary/i })).toHaveTextContent(
      /Markdown action/i,
    );
    expect(screen.getByRole('region', { name: /Primary shelf decision/i })).toHaveTextContent(
      /Expired risk/i,
    );

    const allEntriesLink = screen.getByRole('link', { name: /Browse all expiry entries/i });
    expect(allEntriesLink).toHaveAttribute('href', '/expiry-entries');
  });

  it('announces missing token and fetch errors', async () => {
    render(<DetailedExpiryReportPage token={null} />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/Authentication token is missing/i);
    });
  });

  it('does not render the full expiry table or per-row edit/delete controls', async () => {
    // @ts-expect-error — apiService.get is mocked as vi.fn()
    apiService.get.mockImplementation((url) => {
      if (url === '/reports/expiry-details') {
        return Promise.resolve([
          {
            inventoryId: 10,
            expiryDate: daysFromNow(20),
            status: 'Markdown 3',
            productId: 20,
            productName: 'Worklist Product',
            sku: 'SKU-1',
            costPrice: 12.5,
            locationId: 2,
            locationName: 'Front Counter',
            subDepartment: 'Cold and Flu',
          },
        ]);
      }
      return Promise.resolve([]);
    });

    render(<DetailedExpiryReportPage token="test-session-value" />);

    await screen.findByRole('heading', { name: /Markdown Worklist/i, level: 1 });

    expect(screen.queryByRole('button', { name: /^Edit$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Delete$/i })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('table', { name: /Printable full expiry table/i, hidden: true }),
    ).not.toBeInTheDocument();
  });

  it('groups active stock into the markdown worklist and records sold-through', async () => {
    // @ts-expect-error — apiService.get is mocked as vi.fn()
    apiService.get.mockImplementation((url) => {
      if (url === '/reports/expiry-details') {
        return Promise.resolve([
          {
            inventoryId: 1,
            expiryDate: daysFromNow(75), // Markdown 1 window (61–90 days)
            status: 'Markdown 1',
            productId: 1,
            productName: 'M1 Product',
            sku: 'SKU-M1',
            costPrice: 10,
            locationId: 2,
            locationName: 'Front Counter',
            subDepartment: null,
          },
          {
            inventoryId: 2,
            expiryDate: daysFromNow(10), // Markdown 3 window (0–30 days)
            status: 'Markdown 3',
            productId: 2,
            productName: 'M3 Product',
            sku: 'SKU-M3',
            costPrice: 10,
            locationId: 2,
            locationName: 'Front Counter',
            subDepartment: null,
          },
        ]);
      }
      return Promise.resolve([]);
    });
    // @ts-expect-error — apiService.post is mocked as vi.fn()
    apiService.post.mockResolvedValue({});

    render(<DetailedExpiryReportPage token="test-session-value" />);

    const markdown1Group = await screen.findByRole('region', { name: /Apply Markdown 1/i });
    expect(markdown1Group).toHaveTextContent('M1 Product');
    expect(screen.getByRole('region', { name: /Markdown 3 — urgent/i })).toHaveTextContent(
      'M3 Product',
    );

    const soldThroughButtons = screen.getAllByRole('button', { name: /Sold through/i });
    fireEvent.click(soldThroughButtons[0]);

    const postMock = apiService.post as unknown as jest.Mock;
    await waitFor(() => {
      expect(postMock).toHaveBeenCalledTimes(1);
    });
    expect(postMock.mock.calls[0][0]).toBe('/expired-items/process');
    expect(postMock.mock.calls[0][1]).toEqual({ inventoryItemId: 1, action: 'sold_through' });
  });
});
