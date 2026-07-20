import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fetchMock } from '../../test-utils/fetchMock';
import { CSVUploadPage } from '../CSVUploadPage';
import {
  validateCSVColumns,
  estimateRowCount,
  type ColumnValidationResult,
} from '../../utils/csvValidator';

const mockGetToken = vi.fn();

vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({
    getToken: mockGetToken,
  }),
}));

// Mock react-router-dom
const mockNavigate = vi.fn();
const mockSearchParams = new URLSearchParams();
vi.mock('react-router-dom', () => ({
  useSearchParams: () => [mockSearchParams],
  useNavigate: () => mockNavigate,
}));

vi.mock('../../lib/api.service', () => ({
  buildApiUrl: (route: string) => `https://api.test${route}`,
}));

vi.mock('../../utils/csvValidator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/csvValidator')>();
  return {
    ...actual,
    validateCSVColumns: vi.fn(),
    estimateRowCount: vi.fn(),
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
    vi.clearAllMocks();
    localStorage.clear();

    mockGetToken.mockResolvedValue('fresh-clerk-token');
    (validateCSVColumns as jest.Mock).mockResolvedValue(validColumns);
    (estimateRowCount as jest.Mock).mockReturnValue(null);

    (URL.createObjectURL as unknown as jest.Mock) = vi.fn(() => 'blob:test-url');
    (URL.revokeObjectURL as unknown as jest.Mock) = vi.fn();

    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('switches to expiry mode UX with template actions', async () => {
    render(<CSVUploadPage token="test-token" />);

    const productCatalogTab = screen.getByRole('tab', { name: 'Product Catalog' });
    const expiryListTab = screen.getByRole('tab', { name: 'Expiry List Import' });

    expect(screen.getByText('Product Catalog Upload (CSV/XLSX/XLS)')).toBeInTheDocument();
    expect(productCatalogTab).toHaveAttribute('aria-selected', 'true');
    expect(productCatalogTab).toHaveAttribute('aria-controls', 'csv-upload-product-catalog-panel');
    expect(expiryListTab).toHaveAttribute('aria-selected', 'false');
    expect(expiryListTab).not.toHaveAttribute('aria-controls');

    userEvent.click(screen.getByRole('tab', { name: 'Expiry List Import' }));

    expect(screen.getByText('Expiry List Import (CSV/XLSX/XLS)')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Product Catalog' })).not.toHaveAttribute(
      'aria-controls',
    );
    expect(screen.getByRole('tab', { name: 'Expiry List Import' })).toHaveAttribute(
      'aria-controls',
      'csv-upload-expiry-list-panel',
    );
    expect(screen.getByRole('tab', { name: 'Expiry List Import' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByText('Download Import Templates')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download CSV Template' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download XLSX Template' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download XLS Template' })).toBeInTheDocument();
  });

  it('announces column validation failures as alerts', async () => {
    (validateCSVColumns as jest.Mock).mockResolvedValue({
      isValid: false,
      missingColumns: ['usedByDate'],
      importType: 'expiry-list',
      foundColumns: {
        sku: 'SKU',
      },
      suggestions: {},
    });

    render(<CSVUploadPage token="test-token" defaultImportType="expiry-list" />);

    const fileInput = screen.getByLabelText('CSV/XLSX/XLS File') as HTMLInputElement;
    const file = new File(['SKU,Item Description\nSKU-1,Milk'], 'expiry.csv', {
      type: 'text/csv',
    });

    fireEvent.change(fileInput, { target: { files: [file] } });

    expect(await screen.findByRole('alert')).toHaveTextContent('Column validation warning');
  });

  it('exposes in-flight upload progress to assistive technology', async () => {
    let resolveUpload!: (response: Response) => void;
    const uploadRequest = new Promise<Response>((resolve) => {
      resolveUpload = resolve;
    });

    fetchMock
      .mockResponseOnce(
        JSON.stringify({
          strategy: 'direct',
          uploadUrl: '/api/upload/direct',
          method: 'POST',
          key: 'uploads/org-123/products.csv',
        }),
      )
      .mockImplementationOnce(() => uploadRequest)
      .mockResponseOnce(
        JSON.stringify({
          status: 'complete',
          importedCount: 1,
          updatedCount: 0,
          skippedCount: 0,
          processedCount: 1,
          totalCount: 1,
        }),
      );

    render(<CSVUploadPage token="test-token" />);

    const fileInput = screen.getByLabelText('CSV/XLSX/XLS File') as HTMLInputElement;
    const file = new File(['SKU,Name,Barcode,Cost\nSKU-1,Milk,123,12.99'], 'products.csv', {
      type: 'text/csv',
    });

    fireEvent.change(fileInput, { target: { files: [file] } });
    userEvent.click(screen.getByRole('button', { name: 'Upload CSV/XLSX/XLS' }));

    const progressbar = await screen.findByRole('progressbar', { name: 'Upload progress' });

    expect(progressbar).toHaveAttribute('aria-valuemin', '0');
    expect(progressbar).toHaveAttribute('aria-valuemax', '100');
    expect(progressbar).toHaveAttribute('aria-valuenow', '0');
    expect(screen.getByRole('status', { name: 'Upload status' })).toHaveTextContent('Uploading');

    resolveUpload(
      new Response(JSON.stringify({ key: 'uploads/org-123/products.csv' }), { status: 200 }),
    );

    await waitFor(() => {
      expect(
        screen.queryByRole('progressbar', { name: 'Upload progress' }),
      ).not.toBeInTheDocument();
    });
  });

  it('uses touch-first responsive controls for handheld uploads', () => {
    render(<CSVUploadPage token="test-token" defaultImportType="expiry-list" />);

    const activePanel = screen.getByRole('tabpanel', { name: 'Expiry List Import' });

    expect(screen.getByRole('region', { name: 'CSV upload workspace' })).toHaveAttribute(
      'data-slot',
      'card',
    );
    expect(activePanel).toContainElement(
      screen.getByRole('button', { name: 'Download CSV Template' }),
    );
    expect(activePanel).toContainElement(
      screen.getByRole('button', { name: 'Upload Expiry List' }),
    );
    expect(screen.getByLabelText('CSV/XLSX/XLS File')).toHaveAttribute('data-slot', 'input');
    expect(screen.getByRole('tablist', { name: 'CSV import type' })).toHaveClass(
      'overflow-x-auto',
      'flex-nowrap',
    );
    expect(screen.getByRole('tab', { name: 'Product Catalog' })).toHaveClass(
      'min-h-11',
      'shrink-0',
    );
    expect(screen.getByRole('button', { name: 'Download CSV Template' })).toHaveClass(
      'min-h-11',
      'w-full',
      'sm:w-auto',
    );
    expect(screen.getByRole('button', { name: 'Upload Expiry List' })).toHaveClass(
      'min-h-11',
      'w-full',
      'sm:w-auto',
    );
    expect(screen.getByRole('button', { name: 'Reset' })).toHaveClass(
      'min-h-11',
      'w-full',
      'sm:w-auto',
    );
  });

  it('uses operator-facing progress copy for remote uploads', async () => {
    let resolveUpload!: (response: Response) => void;
    const uploadRequest = new Promise<Response>((resolve) => {
      resolveUpload = resolve;
    });

    fetchMock
      .mockResponseOnce(
        JSON.stringify({
          strategy: 'presigned',
          uploadUrl: 'https://upload.test/presigned',
          method: 'PUT',
          key: 'uploads/org-123/products.csv',
        }),
      )
      .mockImplementationOnce(() => uploadRequest)
      .mockResponseOnce(JSON.stringify({ message: 'Upload completed and processing started' }))
      .mockResponseOnce(
        JSON.stringify({
          status: 'complete',
          importedCount: 1,
          updatedCount: 0,
          skippedCount: 0,
          processedCount: 1,
          totalCount: 1,
        }),
      );

    render(<CSVUploadPage token="test-token" />);

    const fileInput = screen.getByLabelText('CSV/XLSX/XLS File') as HTMLInputElement;
    const file = new File(['SKU,Name,Barcode,Cost\nSKU-1,Milk,123,12.99'], 'products.csv', {
      type: 'text/csv',
    });

    fireEvent.change(fileInput, { target: { files: [file] } });
    userEvent.click(screen.getByRole('button', { name: 'Upload CSV/XLSX/XLS' }));

    expect(await screen.findByRole('status', { name: 'Upload status' })).toHaveTextContent(
      'Uploading file',
    );

    resolveUpload(new Response('', { status: 200 }));

    await waitFor(() => {
      expect(
        screen.queryByRole('progressbar', { name: 'Upload progress' }),
      ).not.toBeInTheDocument();
    });
  });

  it('uses the direct upload URL returned by initiate when it includes the upload key', async () => {
    fetchMock
      .mockResponseOnce(
        JSON.stringify({
          strategy: 'direct',
          uploadUrl: '/api/upload/direct/uploads%2Fuser-26%2Fproducts.csv',
          method: 'POST',
          key: 'uploads/user-26/products.csv',
        }),
      )
      .mockResponseOnce(
        JSON.stringify({
          key: 'uploads/user-26/products.csv',
        }),
      )
      .mockResponseOnce(
        JSON.stringify({
          status: 'complete',
          importedCount: 1,
          updatedCount: 0,
          skippedCount: 0,
          processedCount: 1,
          totalCount: 1,
        }),
      );

    render(<CSVUploadPage token="test-token" />);

    const fileInput = screen.getByLabelText('CSV/XLSX/XLS File') as HTMLInputElement;
    const file = new File(['SKU,Name,Barcode,Cost\nSKU-1,Milk,123,12.99'], 'products.csv', {
      type: 'text/csv',
    });

    fireEvent.change(fileInput, { target: { files: [file] } });
    userEvent.click(screen.getByRole('button', { name: 'Upload CSV/XLSX/XLS' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      'https://api.test/api/upload/direct/uploads%2Fuser-26%2Fproducts.csv',
    );
  });

  it('refreshes the Clerk token before starting an upload', async () => {
    fetchMock
      .mockResponseOnce(
        JSON.stringify({
          strategy: 'direct',
          uploadUrl: '/api/upload/direct/uploads%2Fuser-26%2Fproducts.csv',
          method: 'POST',
          key: 'uploads/user-26/products.csv',
        }),
      )
      .mockResponseOnce(
        JSON.stringify({
          key: 'uploads/user-26/products.csv',
        }),
      )
      .mockResponseOnce(
        JSON.stringify({
          status: 'complete',
          importedCount: 1,
          updatedCount: 0,
          skippedCount: 0,
          processedCount: 1,
          totalCount: 1,
        }),
      );

    render(<CSVUploadPage token="expired-prop-token" />);

    const fileInput = screen.getByLabelText('CSV/XLSX/XLS File') as HTMLInputElement;
    const file = new File(['SKU,Name,Barcode,Cost\nSKU-1,Milk,123,12.99'], 'products.csv', {
      type: 'text/csv',
    });

    fireEvent.change(fileInput, { target: { files: [file] } });
    userEvent.click(screen.getByRole('button', { name: 'Upload CSV/XLSX/XLS' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    const initiateOptions = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(mockGetToken).toHaveBeenCalled();
    expect(initiateOptions.headers).toEqual(
      expect.objectContaining({
        Authorization: 'Bearer fresh-clerk-token',
      }),
    );
  });

  it('falls back to the existing token when Clerk token refresh fails', async () => {
    mockGetToken.mockRejectedValue(new Error('Clerk token refresh failed'));

    fetchMock
      .mockResponseOnce(
        JSON.stringify({
          strategy: 'direct',
          uploadUrl: '/api/upload/direct/uploads%2Fuser-26%2Fproducts.csv',
          method: 'POST',
          key: 'uploads/user-26/products.csv',
        }),
      )
      .mockResponseOnce(
        JSON.stringify({
          key: 'uploads/user-26/products.csv',
        }),
      )
      .mockResponseOnce(
        JSON.stringify({
          status: 'complete',
          importedCount: 1,
          updatedCount: 0,
          skippedCount: 0,
          processedCount: 1,
          totalCount: 1,
        }),
      );

    render(<CSVUploadPage token="existing-prop-token" />);

    const fileInput = screen.getByLabelText('CSV/XLSX/XLS File') as HTMLInputElement;
    const file = new File(['SKU,Name,Barcode,Cost\nSKU-1,Milk,123,12.99'], 'products.csv', {
      type: 'text/csv',
    });

    fireEvent.change(fileInput, { target: { files: [file] } });
    userEvent.click(screen.getByRole('button', { name: 'Upload CSV/XLSX/XLS' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    const initiateOptions = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(initiateOptions.headers).toEqual(
      expect.objectContaining({
        Authorization: 'Bearer existing-prop-token',
      }),
    );
  });

  it('keeps format-guideline links safe when reduced-motion detection is unavailable', async () => {
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: undefined,
    });

    try {
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
            importedCount: 0,
            updatedCount: 0,
            skippedCount: 1,
            processedCount: 1,
            totalCount: 1,
            errors: ['Invalid column name: Product'],
          }),
        );

      render(<CSVUploadPage token="test-token" />);

      const fileInput = screen.getByLabelText('CSV/XLSX/XLS File') as HTMLInputElement;
      const file = new File(['SKU,Name,Barcode,Cost\nSKU-1,Milk,123,12.99'], 'products.csv', {
        type: 'text/csv',
      });

      fireEvent.change(fileInput, { target: { files: [file] } });
      userEvent.click(screen.getByRole('button', { name: 'Upload CSV/XLSX/XLS' }));

      const guidelineLink = await screen.findByRole('button', { name: 'See format guidelines' });

      expect(() => userEvent.click(guidelineLink)).not.toThrow();
    } finally {
      Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: originalMatchMedia,
      });
    }
  });

  it('keeps uploaded file previews horizontally scrollable on narrow screens', async () => {
    render(<CSVUploadPage token="test-token" />);

    const fileInput = screen.getByLabelText('CSV/XLSX/XLS File') as HTMLInputElement;
    const file = new File(['SKU,Name,Barcode,Cost\nSKU-1,Milk,123,12.99'], 'products.csv', {
      type: 'text/csv',
    });

    fireEvent.change(fileInput, { target: { files: [file] } });

    const previewRegion = await screen.findByRole('region', { name: 'File preview' });
    const previewTable = screen.getByRole('table');

    expect(previewRegion).toHaveClass('overflow-x-auto');
    expect(previewRegion).toHaveAttribute('tabIndex', '0');
    expect(previewTable).toHaveClass('min-w-max');
  });

  it('makes product catalog CSV/XLS/XLSX upload requirements clear', () => {
    render(<CSVUploadPage token="test-token" />);

    expect(screen.getByText('Product Catalog Upload (CSV/XLSX/XLS)')).toBeInTheDocument();
    expect(screen.getByLabelText('CSV/XLSX/XLS File')).toHaveAttribute(
      'accept',
      expect.stringContaining('.xlsx'),
    );
    expect(screen.getByText(/Required columns: SKU, Name, Cost, Barcode/i)).toBeInTheDocument();
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

    expect(await screen.findByText('Upload successful')).toBeInTheDocument();
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

    expect(await screen.findByText('Upload failed')).toBeInTheDocument();
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

  it('treats completed-with-errors as terminal and reports unchanged products', async () => {
    const productColumns: ColumnValidationResult = {
      isValid: true,
      missingColumns: [],
      importType: 'product-catalog',
      foundColumns: { sku: 'SKU', name: 'Name', cost: 'Cost', barcode: 'Barcode' },
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
      .mockResponseOnce(JSON.stringify({ key: 'uploads/org-123/products.csv', status: 'queued' }), {
        status: 202,
      })
      .mockResponseOnce(
        JSON.stringify({
          status: 'completed_with_errors',
          importedCount: 2,
          updatedCount: 1,
          unchangedCount: 4,
          skippedCount: 1,
          errorCount: 1,
          rowsProcessed: 8,
          rowsTotal: 8,
        }),
      );

    render(<CSVUploadPage token="test-token" />);
    const fileInput = screen.getByLabelText('CSV/XLSX/XLS File') as HTMLInputElement;
    fireEvent.change(fileInput, {
      target: {
        files: [
          new File(['SKU,Name,Barcode,Cost\nSKU-1,Milk,123,12.99'], 'products.csv', {
            type: 'text/csv',
          }),
        ],
      },
    });
    userEvent.click(screen.getByRole('button', { name: 'Upload CSV/XLSX/XLS' }));

    expect(await screen.findByText('Upload successful')).toBeInTheDocument();
    expect(screen.getByText('Products unchanged: 4')).toBeInTheDocument();
    expect(screen.getByText('Errors: 1')).toBeInTheDocument();
  });

  it('restores the last-upload summary and links completed catalogues to brand review', async () => {
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
    await userEvent.click(screen.getByRole('button', { name: 'Review brand matches' }));
    expect(mockNavigate).toHaveBeenCalledWith('/supplier-credits?view=catalogue-review');
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
