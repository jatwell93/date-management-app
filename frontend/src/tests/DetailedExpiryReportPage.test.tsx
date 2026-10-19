import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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

const renderPage = (token: string | null) =>
  render(
    <MemoryRouter>
      <DetailedExpiryReportPage token={token} />
    </MemoryRouter>,
  );

const daysFromNow = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
};

// Local calendar date (not UTC) so 0/±1-day rows do not shift across the date line.
const localDaysFromNow = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const row = (inventoryId: number, days: number, productName: string) => ({
  inventoryId,
  expiryDate: localDaysFromNow(days),
  status: 'Markdown 3',
  productId: inventoryId,
  productName,
  sku: `SKU-${inventoryId}`,
  costPrice: 10,
  locationId: 2,
  locationName: 'Front Counter',
  subDepartment: null,
});

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

    renderPage('test-session-value');

    expect(screen.getByRole('status')).toHaveTextContent(/Loading detailed expiry report/i);

    expect(
      await screen.findByRole('heading', { name: /Markdown Worklist/i, level: 1 }),
    ).toBeInTheDocument();
    // The app shell owns the single <main> landmark; the page is a labelled region.
    expect(screen.queryByRole('main')).not.toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: /Detailed expiry reporting workspace/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /Expiry stock action summary/i })).toHaveTextContent(
      /Markdown action/i,
    );
    expect(screen.getByRole('region', { name: 'Expired stock to write off' })).toHaveTextContent(
      'Expired — write off',
    );

    const allEntriesLink = screen.getByRole('link', { name: /Browse all expiry entries/i });
    expect(allEntriesLink).toHaveAttribute('href', '/expiry-entries');
    // The expired panel points to where write-offs happen instead of dead-ending.
    expect(screen.getByRole('link', { name: 'Write off on Expired items' })).toHaveAttribute(
      'href',
      '/expired-items',
    );
  });

  it('counts the expired tile from the Expired items worklist; today stays in Markdown 3', async () => {
    // @ts-expect-error — apiService.get is mocked as vi.fn()
    apiService.get.mockImplementation((url) => {
      if (url === '/reports/expiry-details') {
        // The report endpoint only returns stock expiring today or later.
        return Promise.resolve([row(1, 0, 'Today Product')]);
      }
      if (url === '/expired-items') {
        return Promise.resolve([{ id: 11 }, { id: 12 }, { id: 13 }]);
      }
      return Promise.resolve([]);
    });

    renderPage('test-session-value');

    const tile = await screen.findByRole('region', { name: 'Expired stock to write off' });
    expect(tile).toHaveTextContent(/write off\s*3\s*These lines are past expiry/);
    const link = screen.getByRole('link', { name: 'Write off on Expired items' });
    expect(link).toHaveAttribute('href', '/expired-items');
    expect(link).toHaveClass('min-h-11');

    // 0 days: Markdown 3 work, counted under markdown action, not expired.
    const markdown3 = screen.getByRole('region', { name: /Markdown 3 — urgent/i });
    expect(markdown3).toHaveTextContent('Today Product');
    expect(screen.getByText('Markdown action').nextElementSibling).toHaveTextContent(/^1$/);
  });

  it('still renders the report when the Expired items count cannot be loaded', async () => {
    // @ts-expect-error — apiService.get is mocked as vi.fn()
    apiService.get.mockImplementation((url) => {
      if (url === '/reports/expiry-details') {
        return Promise.resolve([row(1, 10, 'Report Product')]);
      }
      if (url === '/expired-items') {
        return Promise.reject(new Error('Expired items unavailable'));
      }
      return Promise.resolve([]);
    });

    renderPage('test-session-value');

    const tile = await screen.findByRole('region', { name: 'Expired stock to write off' });
    expect(tile).toHaveTextContent('Count unavailable');
    expect(screen.getByRole('link', { name: 'Write off on Expired items' })).toHaveAttribute(
      'href',
      '/expired-items',
    );
    expect(screen.getByRole('region', { name: /Markdown 3 — urgent/i })).toHaveTextContent(
      'Report Product',
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('labels the markdown price and words near-term expiry precisely', async () => {
    // @ts-expect-error — apiService.get is mocked as vi.fn()
    apiService.get.mockImplementation((url) => {
      if (url === '/reports/expiry-details') {
        return Promise.resolve([row(1, 1, 'One Day Product'), row(2, 0, 'Today Product')]);
      }
      return Promise.resolve([]);
    });

    renderPage('test-session-value');

    const group = await screen.findByRole('region', { name: /Markdown 3 — urgent/i });
    expect(group).toHaveTextContent('1 day left');
    expect(group).not.toHaveTextContent('1 days left');
    expect(group).toHaveTextContent('Expires today');
    expect(group).toHaveTextContent(/Markdown price:/);
  });

  it('announces missing token and fetch errors', async () => {
    renderPage(null);

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

    renderPage('test-session-value');

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

    renderPage('test-session-value');

    const markdown1Group = await screen.findByRole('region', { name: /Apply Markdown 1/i });
    expect(markdown1Group).toHaveTextContent('M1 Product');
    expect(screen.getByRole('region', { name: /Markdown 3 — urgent/i })).toHaveTextContent(
      'M3 Product',
    );

    // Each row's action names its product so screen-reader users can tell the buttons apart.
    expect(
      screen.getByRole('button', { name: /^Sold through\s*:\s*M3 Product$/ }),
    ).toBeInTheDocument();
    const m1Button = screen.getByRole('button', { name: /^Sold through\s*:\s*M1 Product$/ });
    // Shop-floor action: at least a 44px touch target.
    expect(m1Button).toHaveClass('min-h-11');
    fireEvent.click(m1Button);

    const postMock = apiService.post as unknown as jest.Mock;
    await waitFor(() => {
      expect(postMock).toHaveBeenCalledTimes(1);
    });
    expect(postMock.mock.calls[0][0]).toBe('/expired-items/process');
    expect(postMock.mock.calls[0][1]).toEqual({ inventoryItemId: 1, action: 'sold_through' });
  });

  it('announces a failed sold-through and lets the user dismiss it', async () => {
    // @ts-expect-error — apiService.get is mocked as vi.fn()
    apiService.get.mockImplementation((url) => {
      if (url === '/reports/expiry-details') {
        return Promise.resolve([
          {
            inventoryId: 7,
            expiryDate: daysFromNow(15),
            status: 'Markdown 3',
            productId: 7,
            productName: 'Failing Product',
            sku: 'SKU-F',
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
    apiService.post.mockRejectedValue(new Error('Could not record sold through.'));

    renderPage('test-session-value');

    fireEvent.click(
      await screen.findByRole('button', { name: /^Sold through\s*:\s*Failing Product$/ }),
    );

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not record sold through.');

    const dismiss = screen.getByRole('button', { name: 'Dismiss error' });
    expect(dismiss).toHaveAttribute('type', 'button');
    fireEvent.click(dismiss);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('prices rows using the org markdown matrix, including a retail-basis band (#338)', async () => {
    // @ts-expect-error — apiService.get is mocked as vi.fn()
    apiService.get.mockImplementation((url) => {
      if (url === '/markdown-config') {
        const noCredit = {
          band1: { percentage: 50, basis: 'retail' },
          band2: { percentage: 60, basis: 'cost' },
          band3: { percentage: 75, basis: 'cost' },
        } as const;
        return Promise.resolve({
          matrices: {
            NO_CREDIT: noCredit,
            FULL_CREDIT: {
              band1: { percentage: 20, basis: 'cost' },
              band2: { percentage: 20, basis: 'cost' },
              band3: { percentage: 20, basis: 'cost' },
            },
          },
          matrix: noCredit,
          hasRetailData: true,
        });
      }
      if (url === '/reports/expiry-details') {
        return Promise.resolve([
          {
            inventoryId: 1,
            expiryDate: daysFromNow(75), // band1 (61–90 days) -> 50% off retail
            status: 'Markdown 1',
            productId: 1,
            productName: 'Retail Priced Product',
            sku: 'SKU-R1',
            costPrice: 10,
            retailPrice: 40,
            locationId: 2,
            locationName: 'Front Counter',
            subDepartment: null,
          },
        ]);
      }
      return Promise.resolve([]);
    });

    renderPage('test-session-value');

    const group = await screen.findByRole('region', { name: /Apply Markdown 1/i });
    // 50% off the $40 retail price = $20.00 — not the $5.00 the default cost ladder
    // (50% off $10 cost) would produce, proving the configured matrix drives pricing.
    await waitFor(() => {
      expect(group).toHaveTextContent('$20.00');
    });
    expect(group).not.toHaveTextContent('$5.00');
  });
});
