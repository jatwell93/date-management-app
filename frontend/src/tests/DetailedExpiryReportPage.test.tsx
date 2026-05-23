import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { DetailedExpiryReportPage } from '../pages/DetailedExpiryReportPage';
import { apiService } from '../lib/api.service';
import '@testing-library/jest-dom';

jest.mock('../lib/api.service', () => ({
  apiService: {
    get: jest.fn(),
    put: jest.fn(),
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
});
