import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DetailedExpiryReportPage } from '../pages/DetailedExpiryReportPage';
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

jest.mock('../lib/api.service', () => ({
  apiService: {
    get: jest.fn(),
    put: jest.fn(),
    post: jest.fn(),
    delete: jest.fn(),
  },
}));

describe('DetailedExpiryReportPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders a mobile-ready expiry action summary without a desktop fallback warning', async () => {
    // @ts-expect-error — apiService.get is mocked as jest.fn()
    apiService.get.mockImplementation((url) => {
      if (url === '/reports/expiry-details') {
        return Promise.resolve([
          {
            inventoryId: 10,
            expiryDate: '2025-02-01',
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
      if (url === '/store-areas') {
        return Promise.resolve([{ id: 2, name: 'Front Counter' }]);
      }
      return Promise.resolve([]);
    });

    render(<DetailedExpiryReportPage token="test-session-value" />);

    expect(screen.getByRole('status')).toHaveTextContent(/Loading detailed expiry report/i);

    expect(
      await screen.findByRole('heading', { name: /Detailed Expiry Report/i, level: 1 }),
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
    expect(screen.getByRole('list', { name: /Mobile expiry row summary/i })).toHaveTextContent(
      /Very Long Pharmacy Product Name/i,
    );
    expect(
      screen.getByText(/Open each row summary for the immediate shelf decision/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/best viewed on a desktop/i)).not.toBeInTheDocument();
  });

  it('announces missing token and fetch errors', async () => {
    render(<DetailedExpiryReportPage token={null} />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/Authentication token is missing/i);
    });
  });

  it('keeps the current row in edit mode when saving fails', async () => {
    // @ts-expect-error — apiService.get is mocked as jest.fn()
    apiService.get.mockImplementation((url) => {
      if (url === '/reports/expiry-details') {
        return Promise.resolve([
          {
            inventoryId: 10,
            expiryDate: '2025-02-01',
            status: 'Markdown 3',
            productId: 20,
            productName: 'First Product',
            sku: 'SKU-1',
            costPrice: 12.5,
            locationId: 2,
            locationName: 'Front Counter',
            subDepartment: 'Cold and Flu',
          },
          {
            inventoryId: 11,
            expiryDate: '2025-03-01',
            status: 'Markdown 2',
            productId: 21,
            productName: 'Second Product',
            sku: 'SKU-2',
            costPrice: 15,
            locationId: 3,
            locationName: 'Aisle 1',
            subDepartment: 'Pain Relief',
          },
        ]);
      }
      if (url === '/store-areas') {
        return Promise.resolve([
          { id: 2, name: 'Front Counter' },
          { id: 3, name: 'Aisle 1' },
        ]);
      }
      return Promise.resolve([]);
    });
    // @ts-expect-error — apiService.put is mocked as jest.fn()
    apiService.put.mockRejectedValue(new Error('Could not save item'));

    render(<DetailedExpiryReportPage token="test-session-value" />);

    const editButtons = await screen.findAllByRole('button', { name: /^Edit$/i });
    fireEvent.click(editButtons[0]);
    fireEvent.click(screen.getByRole('button', { name: /^Save$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Could not save item/i);
    expect(screen.getByDisplayValue('2025-02-01')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('2025-03-01')).not.toBeInTheDocument();
  });

  it('groups active stock into the markdown worklist and records sold-through', async () => {
    const daysFromNow = (n: number) => {
      const d = new Date();
      d.setDate(d.getDate() + n);
      return d.toISOString().split('T')[0];
    };

    // @ts-expect-error — apiService.get is mocked as jest.fn()
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
      if (url === '/store-areas') {
        return Promise.resolve([{ id: 2, name: 'Front Counter' }]);
      }
      return Promise.resolve([]);
    });
    // @ts-expect-error — apiService.post is mocked as jest.fn()
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
