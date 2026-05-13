import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import fetchMock from 'jest-fetch-mock';
import { CSVUploadPage } from '../CSVUploadPage';
import {
  validateCSVColumns,
  estimateRowCount,
  type ColumnValidationResult,
} from '../../utils/csvValidator';

// Mock react-router-dom
const mockNavigate = jest.fn();
const mockSearchParams = new URLSearchParams();
jest.mock('react-router-dom', () => ({
  useSearchParams: () => [mockSearchParams],
  useNavigate: () => mockNavigate,
}));

jest.mock('../../lib/api.service', () => ({
  buildApiUrl: (route: string) => `https://api.test${route}`,
}));

jest.mock('../../utils/csvValidator', () => {
  const actual = jest.requireActual('../../utils/csvValidator');
  return {
    ...actual,
    validateCSVColumns: jest.fn(),
    estimateRowCount: jest.fn(),
  };
});

describe('CSVUploadPage expiry import', () => {
  const validColumns: ColumnValidationResult = {
    isValid: true,
    missingColumns: [],
    importType: 'expiry-list',
    foundColumns: {
      sku: 'SKU',
      usedByDate: 'Used-By Date',
    },
    suggestions: {},
  };

  beforeEach(() => {
    fetchMock.resetMocks();
    jest.clearAllMocks();
    localStorage.clear();

    (validateCSVColumns as jest.Mock).mockResolvedValue(validColumns);
    (estimateRowCount as jest.Mock).mockReturnValue(null);

    (URL.createObjectURL as unknown as jest.Mock) = jest.fn(() => 'blob:test-url');
    (URL.revokeObjectURL as unknown as jest.Mock) = jest.fn();

    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('switches to expiry mode UX with template actions', async () => {
    render(<CSVUploadPage token="test-token" />);

    expect(screen.getByText('Product Upload (CSV/XLSX/XLS)')).toBeInTheDocument();

    userEvent.click(screen.getByRole('button', { name: 'Expiry List Import' }));

    expect(screen.getByText('Expiry List Import (CSV/XLSX/XLS)')).toBeInTheDocument();
    expect(screen.getByText('Download Import Templates')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download CSV Template' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download XLSX Template' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download XLS Template' })).toBeInTheDocument();
  });

  it('shows rejected row details after direct expiry upload response', async () => {
    fetchMock
      .mockResponseOnce(
        JSON.stringify({
          strategy: 'direct',
          uploadUrl: '/api/upload/direct',
          method: 'POST',
          key: 'uploads/org-123/123-expiry.csv',
        }),
      )
      .mockResponseOnce(
        JSON.stringify({
          key: 'uploads/org-123/123-expiry.csv',
          importedCount: 1,
          mergedCount: 1,
          rejectedCount: 1,
          rejectedRows: [
            {
              rowNumber: 3,
              rawValues: {
                sku: 'SKU-3',
                itemDescription: 'Bad Date',
                usedByDate: '12/12',
              },
              reason: 'year-missing-or-ambiguous: Date must include a year for day/month format',
              reasonCode: 'year-missing-or-ambiguous',
            },
          ],
        }),
      );

    render(<CSVUploadPage token="test-token" defaultImportType="expiry-list" />);

    const fileInput = screen.getByLabelText('CSV/XLSX/XLS File') as HTMLInputElement;
    const file = new File(
      ['SKU,Item Description,Used-By Date\nSKU-1,Milk,12/12/26'],
      'expiry.csv',
      {
        type: 'text/csv',
      },
    );

    fireEvent.change(fileInput, { target: { files: [file] } });

    userEvent.click(screen.getByRole('button', { name: 'Upload Expiry List' }));

    expect(await screen.findByText('Upload Successful!')).toBeInTheDocument();
    expect(screen.getAllByText('Rows imported: 1').length).toBeGreaterThan(0);
    expect(screen.getByText('Rows merged: 1')).toBeInTheDocument();
    expect(screen.getAllByText('Rows rejected: 1').length).toBeGreaterThan(0);
    expect(screen.getByText('Rejected rows')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Row 3: year-missing-or-ambiguous: Date must include a year for day/month format',
      ),
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    const initiateCall = fetchMock.mock.calls[0];
    const initiateBody = JSON.parse((initiateCall?.[1] as RequestInit).body as string);
    expect(initiateBody.importType).toBe('expiry-list');
  });

  it('fails fast when polling receives a non-retryable status error', async () => {
    fetchMock
      .mockResponseOnce(
        JSON.stringify({
          strategy: 'presigned',
          uploadUrl: 'https://upload.test/presigned',
          method: 'PUT',
          key: 'uploads/org-123/123-products.csv',
        }),
      )
      .mockResponseOnce('', { status: 200 })
      .mockResponseOnce(JSON.stringify({ message: 'Upload completed and processing started' }))
      .mockResponseOnce(JSON.stringify({ error: 'Access denied' }), { status: 403 });

    render(<CSVUploadPage token="test-token" />);

    const fileInput = screen.getByLabelText('CSV/XLSX/XLS File') as HTMLInputElement;
    const file = new File(['SKU,Name,Barcode,Cost\nSKU-1,Milk,123,12.99'], 'products.csv', {
      type: 'text/csv',
    });

    fireEvent.change(fileInput, { target: { files: [file] } });

    userEvent.click(screen.getByRole('button', { name: 'Upload CSV/XLSX/XLS' }));

    expect(await screen.findByText('Upload Failed')).toBeInTheDocument();
    expect(await screen.findByText('Processing failed: Access denied')).toBeInTheDocument();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(4);
    });
  });

  it('shows the most recent product catalog upload summary after completion', async () => {
    const productColumns: ColumnValidationResult = {
      isValid: true,
      missingColumns: [],
      importType: 'product-catalog',
      foundColumns: {
        sku: 'SKU',
        name: 'Name',
        cost: 'Cost',
        barcode: 'Barcode',
      },
      suggestions: {},
    };
    (validateCSVColumns as jest.Mock).mockResolvedValue(productColumns);

    fetchMock
      .mockResponseOnce(
        JSON.stringify({
          strategy: 'direct',
          uploadUrl: '/api/upload/direct',
          method: 'POST',
          key: 'uploads/org-123/products.csv',
        }),
      )
      .mockResponseOnce(
        JSON.stringify({
          key: 'uploads/org-123/products.csv',
        }),
      )
      .mockResponseOnce(
        JSON.stringify({
          status: 'complete',
          importedCount: 3,
          updatedCount: 1,
          skippedCount: 0,
          processedCount: 4,
          totalCount: 4,
        }),
      );

    render(<CSVUploadPage token="test-token" />);

    expect(screen.getByText('No completed uploads yet.')).toBeInTheDocument();

    const fileInput = screen.getByLabelText('CSV/XLSX/XLS File') as HTMLInputElement;
    const file = new File(['SKU,Name,Barcode,Cost\nSKU-1,Milk,123,12.99'], 'products.csv', {
      type: 'text/csv',
    });

    fireEvent.change(fileInput, { target: { files: [file] } });
    userEvent.click(screen.getByRole('button', { name: 'Upload CSV/XLSX/XLS' }));

    expect(await screen.findByText('Product catalog')).toBeInTheDocument();
    expect(screen.getByText('Last uploaded file')).toBeInTheDocument();
    expect(screen.getAllByText('products.csv').length).toBeGreaterThan(0);
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.getAllByText('Products imported: 3').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Products updated: 1').length).toBeGreaterThan(0);
  });

  it('restores the last-upload summary from local storage on page load', () => {
    localStorage.setItem(
      'csvUpload:lastUploadSummary',
      JSON.stringify({
        fileName: 'previous-products.csv',
        importType: 'product-catalog',
        status: 'completed',
        importedCount: 12,
        updatedCount: 2,
        rejectedCount: 1,
        processedCount: 15,
      }),
    );

    render(<CSVUploadPage token="test-token" />);

    expect(screen.getByText('Last uploaded file')).toBeInTheDocument();
    expect(screen.getByText('previous-products.csv')).toBeInTheDocument();
    expect(screen.getByText('Product catalog')).toBeInTheDocument();
    expect(screen.getByText('Products imported: 12')).toBeInTheDocument();
    expect(screen.getByText('Products updated: 2')).toBeInTheDocument();
    expect(screen.getByText('Rows rejected: 1')).toBeInTheDocument();
  });

  it('downloads CSV, XLSX, and XLS templates', async () => {
    render(<CSVUploadPage token="test-token" defaultImportType="expiry-list" />);

    userEvent.click(screen.getByRole('button', { name: 'Download CSV Template' }));
    userEvent.click(screen.getByRole('button', { name: 'Download XLSX Template' }));
    userEvent.click(screen.getByRole('button', { name: 'Download XLS Template' }));

    expect(URL.createObjectURL).toHaveBeenCalledTimes(3);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(3);
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(3);
  });
});
