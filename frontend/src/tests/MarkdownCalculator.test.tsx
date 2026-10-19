import React from 'react';
import fs from 'fs';
import path from 'path';
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MarkdownCalculator } from '../components/MarkdownCalculator';
import { apiService } from '../lib/api.service';
import '@testing-library/jest-dom';
import { DEFAULT_MARKDOWN_MATRIX_SET } from '@shared/markdown';

const mockGetToken = vi.fn();

vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({
    getToken: mockGetToken,
  }),
}));

const mockScannerProps: Array<{
  onScan: (result: { barcode: string; timestamp: number; source: 'manual' }) => void;
  isHandheld?: boolean;
}> = [];

vi.mock('../components/Scanner', () => ({
  Scanner: (props: {
    onScan: (result: { barcode: string; timestamp: number; source: 'manual' }) => void;
    isHandheld?: boolean;
  }) => {
    mockScannerProps.push(props);

    return (
      <button
        type="button"
        data-handheld={props.isHandheld ? 'true' : 'false'}
        onClick={() =>
          props.onScan({
            barcode: 'SKU123',
            timestamp: Date.now(),
            source: 'manual',
          })
        }
      >
        Scan test product
      </button>
    );
  },
}));

vi.mock('../lib/api.service', () => ({
  apiService: {
    get: vi.fn(),
  },
}));

describe('MarkdownCalculator', () => {
  const mockToken = 'fake-token';
  const mockedApiGet = apiService.get as jest.Mock;
  const markdownConfigResponse = {
    matrices: DEFAULT_MARKDOWN_MATRIX_SET,
    matrix: DEFAULT_MARKDOWN_MATRIX_SET.NO_CREDIT,
    hasRetailData: false,
  };

  beforeEach(() => {
    mockScannerProps.length = 0;
    mockedApiGet.mockReset();
    mockedApiGet.mockImplementation((path: string) =>
      path === '/markdown-config' ? Promise.resolve(markdownConfigResponse) : Promise.resolve(null),
    );
    mockGetToken.mockResolvedValue(undefined);
  });

  async function waitForMatrixReady() {
    await waitFor(() => {
      expect(screen.queryByText(/Loading markdown pricing/i)).not.toBeInTheDocument();
    });
  }

  it('does not calculate or display a price before markdown matrices are ready', async () => {
    mockedApiGet.mockImplementation((path: string) =>
      path === '/markdown-config' ? new Promise(() => undefined) : Promise.resolve(null),
    );
    render(<MarkdownCalculator token={mockToken} />);

    fireEvent.change(screen.getByLabelText(/Cost Price/i), { target: { value: '100' } });
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 15);
    fireEvent.change(screen.getByLabelText(/Expiry Date/i), {
      target: { value: futureDate.toISOString().split('T')[0] },
    });

    expect(screen.getByRole('button', { name: /Calculate Markdown/i })).toBeDisabled();
    expect(screen.getByText(/Loading markdown pricing/i)).toBeInTheDocument();
    expect(screen.queryByText(/\$25\.00/i)).not.toBeInTheDocument();
  });

  it('renders the markdown calculator form', async () => {
    render(<MarkdownCalculator token={mockToken} />);
    await waitForMatrixReady();
    expect(screen.getByLabelText(/Cost Price/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Expiry Date/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Calculate Markdown/i })).toBeInTheDocument();
  });

  it('calculates markdown price correctly for items expiring within 30 days', async () => {
    render(<MarkdownCalculator token={mockToken} />);
    await waitForMatrixReady();

    // Set cost price
    fireEvent.change(screen.getByLabelText(/Cost Price/i), {
      target: { value: '100' },
    });

    // Set expiry date to 15 days from now (Markdown 3 - 75% off)
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 15);
    const dateString = futureDate.toISOString().split('T')[0];

    fireEvent.change(screen.getByLabelText(/Expiry Date/i), {
      target: { value: dateString },
    });
    fireEvent.click(screen.getByRole('button', { name: /Calculate Markdown/i }));

    expect(screen.getByText(/Markdown 3/i)).toBeInTheDocument();
    expect(screen.getByText(/\$25.00/i)).toBeInTheDocument();
  });

  it('uses Australian currency formatting for pharmacy markdown values', () => {
    const componentSource = fs.readFileSync(
      path.join(__dirname, '../components/MarkdownCalculator.tsx'),
      'utf8',
    );

    expect(componentSource).toContain("new Intl.NumberFormat('en-AU'");
    expect(componentSource).toContain("currency: 'AUD'");
  });

  it('starts with an explicit not-yet-calculated result state', async () => {
    render(<MarkdownCalculator token={mockToken} />);
    await waitForMatrixReady();

    const result = screen.getByRole('status', { name: /markdown result/i });
    expect(result).toHaveTextContent(/No markdown calculated yet/i);
    expect(result).not.toHaveTextContent(/^Normal$/i);
  });

  it('displays Expired status for items past expiry date', async () => {
    render(<MarkdownCalculator token={mockToken} />);
    await waitForMatrixReady();

    // Set cost price
    fireEvent.change(screen.getByLabelText(/Cost Price/i), {
      target: { value: '50' },
    });

    // Set expiry date to yesterday
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 1);
    const dateString = pastDate.toISOString().split('T')[0];

    fireEvent.change(screen.getByLabelText(/Expiry Date/i), {
      target: { value: dateString },
    });
    fireEvent.click(screen.getByRole('button', { name: /Calculate Markdown/i }));

    expect(screen.getByText(/Expired/i)).toBeInTheDocument();
  });

  it('announces calculated markdown results in the result region', async () => {
    render(<MarkdownCalculator token={mockToken} />);
    await waitForMatrixReady();

    fireEvent.change(screen.getByLabelText(/Cost Price/i), {
      target: { value: '100' },
    });

    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 15);

    fireEvent.change(screen.getByLabelText(/Expiry Date/i), {
      target: { value: futureDate.toISOString().split('T')[0] },
    });
    fireEvent.click(screen.getByRole('button', { name: /Calculate Markdown/i }));

    const result = screen.getByRole('status', { name: /markdown result/i });
    expect(result).toHaveTextContent(/Markdown 3/i);
    expect(result).toHaveTextContent(/\$25\.00/i);
  });

  it('shows specific validation guidance for missing expiry date', async () => {
    render(<MarkdownCalculator token={mockToken} />);
    await waitForMatrixReady();

    fireEvent.change(screen.getByLabelText(/Cost Price/i), {
      target: { value: '12.50' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Calculate Markdown/i }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      /Choose an expiry date before calculating a markdown/i,
    );
  });

  it('shows specific validation guidance for invalid cost values', async () => {
    render(<MarkdownCalculator token={mockToken} />);
    await waitForMatrixReady();

    fireEvent.change(screen.getByLabelText(/Cost Price/i), {
      target: { value: '-4' },
    });
    fireEvent.change(screen.getByLabelText(/Expiry Date/i), {
      target: { value: '2026-06-30' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Calculate Markdown/i }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      /Enter a cost price greater than 0 before calculating a markdown/i,
    );
  });

  it('shows recoverable product lookup errors without leaking raw API wording', async () => {
    mockedApiGet.mockImplementation((path: string) =>
      path === '/markdown-config'
        ? Promise.resolve(markdownConfigResponse)
        : Promise.reject(new Error('Request failed with status 500: stack trace')),
    );

    render(<MarkdownCalculator token={mockToken} />);

    fireEvent.click(screen.getByRole('button', { name: /Scan test product/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        /We could not look up that product. Enter the cost price and expiry date manually/i,
      );
    });
    expect(screen.queryByText(/stack trace/i)).not.toBeInTheDocument();
  });

  it('wraps long scanned and product values inside structured product feedback', async () => {
    const product = {
      id: 1,
      name: 'Long pharmacy product name '.repeat(8),
      sku: 'SKU-' + '1234567890'.repeat(6),
      barcode: '9300000000000'.repeat(5),
      costPrice: 42.5,
    };
    mockedApiGet.mockImplementation((path: string) =>
      Promise.resolve(path === '/markdown-config' ? markdownConfigResponse : product),
    );

    render(<MarkdownCalculator token={mockToken} />);

    fireEvent.click(screen.getByRole('button', { name: /Scan test product/i }));

    const productSummary = await screen.findByRole('region', { name: /scanned product/i });
    expect(productSummary).toHaveClass('min-w-0');
    expect(productSummary).toHaveTextContent(/Long pharmacy product name/i);
    expect(within(productSummary).getAllByText(/SKU/i).length).toBeGreaterThan(0);
    expect(within(productSummary).getByText(/\$42\.50/i)).toBeInTheDocument();
  });

  it('refreshes the Clerk token before scanning product details', async () => {
    mockGetToken.mockResolvedValue('fresh-clerk-token');
    const product = {
      id: 1,
      name: 'Fresh Token Product',
      sku: 'SKU123',
      barcode: '9300000000000',
      costPrice: 42.5,
    };
    mockedApiGet.mockImplementation((path: string) =>
      Promise.resolve(path === '/markdown-config' ? markdownConfigResponse : product),
    );

    render(<MarkdownCalculator token="expired-prop-token" />);

    fireEvent.click(screen.getByRole('button', { name: /Scan test product/i }));

    await waitFor(() => {
      expect(mockGetToken).toHaveBeenCalled();
      expect(apiService.get).toHaveBeenCalledWith('/products/by-sku/SKU123', 'fresh-clerk-token');
    });
  });

  it('lets the user enter cost manually when the catalog product has no cost price', async () => {
    const product = {
      id: 7,
      name: 'No Cost Product',
      sku: 'SKU123',
      barcode: '9300000000001',
      costPrice: undefined,
    };
    mockedApiGet.mockImplementation((path: string) =>
      Promise.resolve(path === '/markdown-config' ? markdownConfigResponse : product),
    );

    render(<MarkdownCalculator token={mockToken} />);
    await waitForMatrixReady();

    fireEvent.click(screen.getByRole('button', { name: /Scan test product/i }));

    const productSummary = await screen.findByRole('region', { name: /scanned product/i });
    expect(productSummary).toHaveTextContent(/Not available/i);
    expect(productSummary).not.toHaveTextContent(/\$NaN/i);

    // Cost input stays editable so the markdown can still be calculated manually.
    const costInput = screen.getByLabelText(/Cost Price/i);
    expect(costInput).not.toBeDisabled();

    fireEvent.change(costInput, { target: { value: '100' } });
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 15);
    fireEvent.change(screen.getByLabelText(/Expiry Date/i), {
      target: { value: futureDate.toISOString().split('T')[0] },
    });
    fireEvent.click(screen.getByRole('button', { name: /Calculate Markdown/i }));

    expect(screen.getByText(/Markdown 3/i)).toBeInTheDocument();
    expect(screen.getByText(/\$25\.00/i)).toBeInTheDocument();
  });

  it('exposes the card title as the page heading', async () => {
    render(<MarkdownCalculator token={mockToken} />);
    await waitForMatrixReady();

    expect(
      screen.getByRole('heading', { level: 1, name: /Expiry markdown calculator/i }),
    ).toBeInTheDocument();
  });

  it('ties validation errors to the invalid field and moves focus to it', async () => {
    render(<MarkdownCalculator token={mockToken} />);
    await waitForMatrixReady();

    const costInput = screen.getByLabelText(/Cost Price/i);
    const expiryInput = screen.getByLabelText(/Expiry Date/i);
    expect(costInput).toHaveAttribute('aria-required', 'true');
    expect(expiryInput).toHaveAttribute('aria-required', 'true');

    fireEvent.click(screen.getByRole('button', { name: /Calculate Markdown/i }));
    expect(costInput).toHaveAttribute('aria-invalid', 'true');
    expect(costInput).toHaveAccessibleDescription(/Enter a cost price greater than 0/i);
    expect(costInput).toHaveFocus();
    expect(expiryInput).not.toHaveAttribute('aria-invalid');

    fireEvent.change(costInput, { target: { value: '12.50' } });
    fireEvent.click(screen.getByRole('button', { name: /Calculate Markdown/i }));
    expect(costInput).not.toHaveAttribute('aria-invalid');
    expect(expiryInput).toHaveAttribute('aria-invalid', 'true');
    expect(expiryInput).toHaveAccessibleDescription(/Choose an expiry date/i);
    expect(expiryInput).toHaveFocus();
    // The entered cost is preserved after a validation error.
    expect(costInput).toHaveValue(12.5);
  });

  it('uses AA error ink, a decimal keypad and tabular money values', async () => {
    render(<MarkdownCalculator token={mockToken} />);
    await waitForMatrixReady();

    const costInput = screen.getByLabelText(/Cost Price \(AUD\)/i);
    expect(costInput).toHaveAttribute('inputmode', 'decimal');

    fireEvent.click(screen.getByRole('button', { name: /Calculate Markdown/i }));
    expect(screen.getByRole('alert')).toHaveClass('text-semantic-critical-muted-foreground');

    fireEvent.change(costInput, { target: { value: '100' } });
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 15);
    fireEvent.change(screen.getByLabelText(/Expiry Date/i), {
      target: { value: futureDate.toISOString().split('T')[0] },
    });
    fireEvent.click(screen.getByRole('button', { name: /Calculate Markdown/i }));
    expect(screen.getByText(/\$25\.00/i)).toHaveClass('tabular-nums');
  });

  it('keeps the last-scanned live region mounted before the first scan', async () => {
    render(<MarkdownCalculator token={mockToken} />);
    await waitForMatrixReady();

    const lastScanned = screen.getByRole('status', { name: /last scanned code/i });
    expect(lastScanned).toBeEmptyDOMElement();

    fireEvent.click(screen.getByRole('button', { name: /Scan test product/i }));
    expect(screen.getByRole('status', { name: /last scanned code/i })).toBe(lastScanned);
    expect(lastScanned).toHaveTextContent('Last scanned: SKU123');
  });

  it("ignores the hardware scanner's trailing Enter while the scanned product loads", async () => {
    let resolveLookup: (product: unknown) => void = () => undefined;
    mockedApiGet.mockImplementation((path: string) =>
      path === '/markdown-config'
        ? Promise.resolve(markdownConfigResponse)
        : new Promise((resolve) => {
            resolveLookup = resolve;
          }),
    );

    render(<MarkdownCalculator token={mockToken} />);
    await waitForMatrixReady();

    // Stale values from a previous product are in the form and an input has focus.
    const costInput = screen.getByLabelText(/Cost Price/i);
    fireEvent.change(costInput, { target: { value: '100' } });
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 15);
    fireEvent.change(screen.getByLabelText(/Expiry Date/i), {
      target: { value: futureDate.toISOString().split('T')[0] },
    });
    costInput.focus();

    // A keyboard-wedge burst ends in Enter: the scan callback runs, then the
    // same Enter submits the focused form.
    act(() => {
      mockScannerProps[mockScannerProps.length - 1].onScan({
        barcode: 'SKU123',
        timestamp: Date.now(),
        source: 'manual',
      });
      fireEvent.submit(costInput.closest('form')!);
    });

    const result = screen.getByRole('status', { name: /markdown result/i });
    expect(result).toHaveTextContent(/No markdown calculated yet/i);

    await waitFor(() => {
      expect(mockedApiGet.mock.calls.map(([path]) => path)).toContain('/products/by-sku/SKU123');
    });
    resolveLookup({ id: 9, name: 'Scanned', sku: 'SKU123', barcode: '930', costPrice: 40 });
    await screen.findByRole('region', { name: /scanned product/i });
    await waitFor(() => {
      fireEvent.submit(costInput.closest('form')!);
      expect(result).toHaveTextContent(/\$10\.00/i);
    });
  });

  it('calculates when the form is submitted with Enter', async () => {
    render(<MarkdownCalculator token={mockToken} />);
    await waitForMatrixReady();

    fireEvent.change(screen.getByLabelText(/Cost Price/i), { target: { value: '100' } });
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 15);
    const expiryInput = screen.getByLabelText(/Expiry Date/i);
    fireEvent.change(expiryInput, { target: { value: futureDate.toISOString().split('T')[0] } });
    fireEvent.submit(expiryInput.closest('form')!);

    expect(screen.getByRole('status', { name: /markdown result/i })).toHaveTextContent(/\$25\.00/i);
  });

  it('keeps a catalog cost read-only but focusable, with an explanation', async () => {
    const product = {
      id: 3,
      name: 'Catalog Cost Product',
      sku: 'SKU123',
      barcode: '9300000000002',
      costPrice: 42.5,
    };
    mockedApiGet.mockImplementation((path: string) =>
      Promise.resolve(path === '/markdown-config' ? markdownConfigResponse : product),
    );

    render(<MarkdownCalculator token={mockToken} />);
    await waitForMatrixReady();
    fireEvent.click(screen.getByRole('button', { name: /Scan test product/i }));
    await screen.findByRole('region', { name: /scanned product/i });

    const costInput = screen.getByLabelText(/Cost Price/i);
    expect(costInput).not.toBeDisabled();
    expect(costInput).toHaveAttribute('readonly');
    expect(costInput).toHaveValue(42.5);
    expect(costInput).toHaveAccessibleDescription(/From the product catalog/i);
    costInput.focus();
    expect(costInput).toHaveFocus();
  });

  it('treats stock expiring today as expired at any local time of day', async () => {
    // Only Date is faked so promises and waitFor keep running on real timers.
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      // 00:05 local: a UTC-midnight parse of the expiry date would still be hours away
      // in any zone east of UTC and produce a 1-day markdown band instead of Expired.
      vi.setSystemTime(new Date(2026, 9, 16, 0, 5));
      render(<MarkdownCalculator token={mockToken} />);
      await waitForMatrixReady();

      fireEvent.change(screen.getByLabelText(/Cost Price/i), { target: { value: '50' } });
      fireEvent.change(screen.getByLabelText(/Expiry Date/i), {
        target: { value: '2026-10-16' },
      });
      fireEvent.click(screen.getByRole('button', { name: /Calculate Markdown/i }));

      const result = screen.getByRole('status', { name: /markdown result/i });
      expect(result).toHaveTextContent(/Expired/i);

      fireEvent.change(screen.getByLabelText(/Expiry Date/i), {
        target: { value: '2026-10-17' },
      });
      fireEvent.click(screen.getByRole('button', { name: /Calculate Markdown/i }));
      expect(result).toHaveTextContent(/Markdown 3/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it('passes handheld scanner intent and uses touch-friendly primary controls', async () => {
    render(<MarkdownCalculator token={mockToken} />);
    await waitForMatrixReady();

    expect(mockScannerProps[0]).toEqual(expect.objectContaining({ isHandheld: true }));
    expect(screen.getByRole('button', { name: /Calculate Markdown/i })).toHaveClass('min-h-11');
    expect(screen.getByLabelText(/Cost Price/i)).toHaveClass('min-h-11');
    expect(screen.getByLabelText(/Expiry Date/i)).toHaveClass('min-h-11');
  });
});
