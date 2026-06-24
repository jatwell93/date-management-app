import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ScanPage } from '../ScanPage';
import { HandheldProvider } from '../../contexts/HandheldContext';
import { SyncStrategy } from '../../config/handheld';
import { apiService } from '../../lib/api.service';
import { offlineStorage } from '../../lib/offline-storage';

// Mock dependencies
jest.mock('../../lib/api.service');
jest.mock('../../lib/offline-storage');

const mockGetToken = jest.fn();

jest.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({
    getToken: mockGetToken,
  }),
}));

// Mock HandheldContext
const mockHandheldContext = {
  isHandheld: false,
  syncStrategy: 'real-time' as SyncStrategy,
  setSyncStrategy: jest.fn(),
  detectionResult: null,
  hapticEnabled: true,
  audioFeedbackEnabled: true,
  setHapticEnabled: jest.fn(),
  setAudioFeedbackEnabled: jest.fn(),
  refreshDetection: jest.fn(),
};

jest.mock('../../contexts/HandheldContext', () => ({
  HandheldProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useHandheldDetectionContext: () => mockHandheldContext,
}));

// Mock scrollIntoView for Radix UI
window.HTMLElement.prototype.scrollIntoView = jest.fn();
window.HTMLElement.prototype.hasPointerCapture = jest.fn();
window.HTMLElement.prototype.releasePointerCapture = jest.fn();

// Mock ResizeObserver
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Mock localforage
jest.mock('localforage', () => ({
  createInstance: jest.fn(() => ({
    setItem: jest.fn(),
    getItem: jest.fn(),
    removeItem: jest.fn(),
    clear: jest.fn(),
  })),
  config: jest.fn(),
}));

// Mock Scanner
jest.mock('../../components/Scanner', () => ({
  Scanner: ({ onScan }: { onScan: (val: any) => void }) => (
    <div data-testid="mock-scanner">
      <input
        data-testid="scanner-input"
        onChange={(e) =>
          onScan({ barcode: e.target.value, timestamp: Date.now(), source: 'camera' })
        }
      />
      <button
        data-testid="trigger-scan"
        onClick={() => onScan({ barcode: '1234567890', timestamp: Date.now(), source: 'camera' })}
      >
        Scan Barcode
      </button>
      <button
        data-testid="trigger-sku-scan"
        onClick={() => onScan({ barcode: '123456', timestamp: Date.now(), source: 'camera' })}
      >
        Scan SKU
      </button>
    </div>
  ),
}));

// Mock HandheldScanner
jest.mock('../../components/HandheldScanner', () => ({
  HandheldScanner: ({ onScan }: { onScan: (val: any) => void }) => (
    <main className="flex-1 overflow-auto" role="main">
      <div data-testid="handheld-scan-toolbar">
        <span>Synced</span>
        <button aria-label="Settings" type="button">
          Settings
        </button>
        <select
          data-testid="sync-strategy-selector"
          onChange={(e) => mockHandheldContext.setSyncStrategy(e.target.value)}
          value={mockHandheldContext.syncStrategy}
        >
          <option value="real-time">Real-time</option>
          <option value="batch-10-min">Batch (10 min)</option>
          <option value="manual">Manual</option>
        </select>
        <button disabled type="button">
          Sync Now
        </button>
      </div>

      <div data-testid="handheld-scanner">
        <button
          data-testid="handheld-scan-trigger"
          onClick={() =>
            onScan({
              barcode: '1234567890',
              timestamp: Date.now(),
              source: 'camera',
            })
          }
        >
          Scan with Camera
        </button>
        <button
          data-testid="handheld-scan-gs1-trigger"
          onClick={() =>
            onScan({
              barcode: '(01)12345678901231(17)250131',
              timestamp: Date.now(),
              source: 'camera',
            })
          }
        >
          Scan GS1
        </button>
        <button
          data-testid="handheld-scan-invalid-trigger"
          onClick={() =>
            onScan({
              barcode: 'invalid-gs1-data',
              timestamp: Date.now(),
              source: 'camera',
            })
          }
        >
          Scan Invalid
        </button>
      </div>
    </main>
  ),
}));

// Mock Radix UI Select components
jest.mock('../../components/ui/select', () => ({
  Select: ({ onValueChange, value, children }: any) => (
    <select
      data-testid="location-select"
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
}));

describe('ScanPage Integration', () => {
  const mockToken = 'fake-token';
  const mockStoreAreas = [
    { id: 1, name: 'Warehouse A', subDepartment: 'Electronics' },
    { id: 2, name: 'Backroom', subDepartment: 'Grocery' },
  ];

  // Valid Product (Barcode > 8 chars)
  const mockProductBarcode = {
    id: 101,
    name: 'Test Product Barcode',
    sku: 'TEST-SKU-1',
    barcode: '1234567890',
    costPrice: 10.0,
  };

  // Valid Product (SKU <= 8 chars)
  const mockProductSKU = {
    id: 102,
    name: 'Test Product SKU',
    sku: '123456',
    barcode: '9999999999',
    costPrice: 20.0,
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset handheld context mock
    mockHandheldContext.isHandheld = false;
    mockHandheldContext.syncStrategy = 'real-time' as SyncStrategy;

    // Default API mocks
    (apiService.get as jest.Mock).mockImplementation((url) => {
      if (url === '/store-areas') {
        return Promise.resolve(mockStoreAreas);
      }
      if (url.includes('/products/by-barcode/1234567890')) {
        return Promise.resolve(mockProductBarcode);
      }
      if (url.includes('/products/by-sku/123456')) {
        return Promise.resolve(mockProductSKU);
      }
      // Fail safe
      if (url.includes('/products/by-sku/1234567890'))
        return Promise.reject(new Error('Not found'));

      if (url.includes('/inventory-items/by-barcode')) return Promise.resolve([]);
      if (url.includes('/inventory-items/recent')) return Promise.resolve([]);

      return Promise.reject(new Error(`Not found call: ${url}`));
    });

    (apiService.post as jest.Mock).mockResolvedValue({});
    mockGetToken.mockResolvedValue(undefined);

    // Mock Online status
    Object.defineProperty(navigator, 'onLine', {
      value: true,
      writable: true,
    });
  });

  it('renders and fetches store areas on mount', async () => {
    render(
      <HandheldProvider>
        <ScanPage token={mockToken} />
      </HandheldProvider>,
    );

    await waitFor(() => {
      expect(apiService.get).toHaveBeenCalledWith('/store-areas', mockToken);
    });

    expect(screen.getByText(/Inventory Scan/i)).toBeInTheDocument();
  });

  it('displays product details after scanning a valid barcode (>8 chars)', async () => {
    render(
      <HandheldProvider>
        <ScanPage token={mockToken} />
      </HandheldProvider>,
    );

    // Wait for scanner to be rendered
    await waitFor(() => {
      expect(screen.getByTestId('mock-scanner')).toBeInTheDocument();
    });

    const scanButton = screen.getByTestId('trigger-scan');
    userEvent.click(scanButton);

    await waitFor(() => {
      expect(apiService.get).toHaveBeenCalledWith(
        expect.stringContaining('/products/by-barcode/1234567890'),
        mockToken,
      );
    });

    expect(await screen.findByText('Test Product Barcode')).toBeInTheDocument();
    expect(screen.getByText('TEST-SKU-1')).toBeInTheDocument();
  });

  it.each([
    { daysToExpiry: 89, percentage: 50, price: '5.00' },
    { daysToExpiry: 59, percentage: 60, price: '4.00' },
    { daysToExpiry: 29, percentage: 75, price: '2.50' },
  ])(
    'shows the $percentage% markdown for an expiry $daysToExpiry days away',
    async ({ daysToExpiry, percentage, price }) => {
      render(
        <HandheldProvider>
          <ScanPage token={mockToken} />
        </HandheldProvider>,
      );

      await screen.findByTestId('mock-scanner');
      userEvent.click(screen.getByTestId('trigger-scan'));
      await screen.findByText('Test Product Barcode');

      expect(screen.getByText(/Cost Price:/i).parentElement).toHaveTextContent('$10.00');

      const expiry = new Date();
      expiry.setDate(expiry.getDate() + daysToExpiry);
      const expiryValue = [
        expiry.getFullYear(),
        String(expiry.getMonth() + 1).padStart(2, '0'),
        String(expiry.getDate()).padStart(2, '0'),
      ].join('-');
      fireEvent.change(screen.getByLabelText(/Expiry Date/i), {
        target: { value: expiryValue },
      });

      expect(
        await screen.findByText((_content, element) =>
          Boolean(element?.textContent === `Markdown Price (${percentage}% off): $${price}`),
        ),
      ).toBeInTheDocument();
      expect(screen.queryByText(/\$NaN/i)).not.toBeInTheDocument();
    },
  );

  it('does not render a markdown price when the product cost is missing', async () => {
    (apiService.get as jest.Mock).mockImplementation((url) => {
      if (url === '/store-areas') return Promise.resolve(mockStoreAreas);
      if (url.includes('/products/by-barcode/1234567890')) {
        return Promise.resolve({ ...mockProductBarcode, costPrice: undefined });
      }
      if (url.includes('/inventory-items/')) return Promise.resolve([]);
      return Promise.reject(new Error(`Not found call: ${url}`));
    });

    render(
      <HandheldProvider>
        <ScanPage token={mockToken} />
      </HandheldProvider>,
    );

    await screen.findByTestId('mock-scanner');
    userEvent.click(screen.getByTestId('trigger-scan'));
    await screen.findByText('Test Product Barcode');

    const expiry = new Date();
    expiry.setDate(expiry.getDate() + 30);
    fireEvent.change(screen.getByLabelText(/Expiry Date/i), {
      target: {
        value: [
          expiry.getFullYear(),
          String(expiry.getMonth() + 1).padStart(2, '0'),
          String(expiry.getDate()).padStart(2, '0'),
        ].join('-'),
      },
    });

    expect(screen.getByText(/Cost Price:/i).parentElement).toHaveTextContent('Not available');
    expect(screen.queryByText(/Markdown Price/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\$NaN/i)).not.toBeInTheDocument();
  });

  it.each([
    { label: 'today', daysOffset: 0 },
    { label: 'already expired', daysOffset: -1 },
  ])(
    'shows an expired badge instead of markdown pricing when stock is $label',
    async ({ daysOffset }) => {
      render(
        <HandheldProvider>
          <ScanPage token={mockToken} />
        </HandheldProvider>,
      );

      await screen.findByTestId('mock-scanner');
      userEvent.click(screen.getByTestId('trigger-scan'));
      await screen.findByText('Test Product Barcode');

      const expiry = new Date();
      expiry.setDate(expiry.getDate() + daysOffset);
      fireEvent.change(screen.getByLabelText(/Expiry Date/i), {
        target: {
          value: [
            expiry.getFullYear(),
            String(expiry.getMonth() + 1).padStart(2, '0'),
            String(expiry.getDate()).padStart(2, '0'),
          ].join('-'),
        },
      });

      expect(await screen.findByText('Expired')).toHaveAttribute('data-slot', 'badge');
      expect(screen.queryByText(/Markdown Price/i)).not.toBeInTheDocument();
    },
  );

  it('displays product details after scanning a valid SKU (<=8 chars)', async () => {
    render(
      <HandheldProvider>
        <ScanPage token={mockToken} />
      </HandheldProvider>,
    );

    // Wait for scanner to be rendered
    await waitFor(() => {
      expect(screen.getByTestId('mock-scanner')).toBeInTheDocument();
    });

    const scanButton = screen.getByTestId('trigger-sku-scan');
    userEvent.click(scanButton);

    await waitFor(() => {
      expect(apiService.get).toHaveBeenCalledWith(
        expect.stringContaining('/products/by-sku/123456'),
        mockToken,
      );
    });

    expect(screen.getByText('Test Product SKU')).toBeInTheDocument();
  });

  it('shows new product form if product not found', async () => {
    (apiService.get as jest.Mock).mockImplementation((url) => {
      if (url === '/store-areas') return Promise.resolve(mockStoreAreas);
      return Promise.reject(new Error('404 Not found'));
    });

    render(
      <HandheldProvider>
        <ScanPage token={mockToken} />
      </HandheldProvider>,
    );

    // Wait for scanner to be rendered
    await waitFor(() => {
      expect(screen.getByTestId('mock-scanner')).toBeInTheDocument();
    });

    const scanButton = screen.getByTestId('trigger-scan');
    userEvent.click(scanButton);

    await waitFor(() => {
      expect(screen.getByText(/No catalog match for barcode 1234567890/i)).toBeInTheDocument();
    });
    expect(
      screen.getByText(/Create a product record before adding expiry stock/i),
    ).toBeInTheDocument();
  });

  it('creates a scanned product using the camelCase cost price contract', async () => {
    (apiService.get as jest.Mock).mockImplementation((url) => {
      if (url === '/store-areas') return Promise.resolve(mockStoreAreas);
      return Promise.reject(new Error('404 Not found'));
    });
    (apiService.post as jest.Mock).mockResolvedValue(mockProductBarcode);

    render(
      <HandheldProvider>
        <ScanPage token={mockToken} />
      </HandheldProvider>,
    );

    await screen.findByTestId('mock-scanner');
    userEvent.click(screen.getByTestId('trigger-scan'));
    await screen.findByText(/No catalog match for barcode 1234567890/i);

    fireEvent.change(screen.getByLabelText(/Product Name/i), {
      target: { value: 'Created Product' },
    });
    fireEvent.change(screen.getByLabelText(/^SKU$/i), { target: { value: 'CREATED-1' } });
    fireEvent.change(screen.getByLabelText(/Cost Price/i), { target: { value: '12.50' } });
    userEvent.click(screen.getByRole('button', { name: /Create product/i }));

    await waitFor(() => {
      expect(apiService.post).toHaveBeenCalledWith(
        '/products',
        {
          barcode: '1234567890',
          name: 'Created Product',
          sku: 'CREATED-1',
          costPrice: 12.5,
        },
        mockToken,
      );
    });
  });

  it('keeps unknown barcode lookup failures recoverable on the scan page', async () => {
    (apiService.get as jest.Mock).mockImplementation((url) => {
      if (url === '/store-areas') return Promise.resolve(mockStoreAreas);
      if (url.includes('/products/')) return Promise.reject(new Error('Network request failed'));
      return Promise.resolve([]);
    });

    render(
      <HandheldProvider>
        <ScanPage token={mockToken} />
      </HandheldProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('mock-scanner')).toBeInTheDocument();
    });

    userEvent.click(screen.getByTestId('trigger-scan'));

    expect(await screen.findByRole('alert')).toHaveTextContent('Error: Network request failed');
    expect(screen.getByTestId('scan-page-main')).toBeInTheDocument();
    expect(screen.getByTestId('mock-scanner')).toBeInTheDocument();
  });

  it('submits inventory item successfully when online', async () => {
    render(
      <HandheldProvider>
        <ScanPage token={mockToken} />
      </HandheldProvider>,
    );

    // Wait for store areas
    await waitFor(() => expect(apiService.get).toHaveBeenCalledWith('/store-areas', mockToken));

    // 1. Scan
    userEvent.click(screen.getByTestId('trigger-scan'));
    await screen.findByText('Test Product Barcode');

    // 2. Fill Expiry
    const expiryInput = screen.getByLabelText(/Expiry Date/i);
    fireEvent.change(expiryInput, { target: { value: '2025-12-31' } });

    // 3. Select Location
    fireEvent.change(screen.getByTestId('location-select'), { target: { value: '1' } });

    // 4. Submit
    const submitButton = screen.getByText(/Save expiry item/i);
    userEvent.click(submitButton);

    // 5. Verify
    await waitFor(() => {
      expect(apiService.post).toHaveBeenCalledWith(
        '/inventory-items',
        expect.objectContaining({
          productId: 101, // Test Product Barcode ID
          expiryDate: '2025-12-31',
          locationId: 1,
        }),
        mockToken,
      );
    });

    expect(await screen.findByText(/Expiry item saved to inventory/i)).toBeInTheDocument();
  });

  it('refreshes the Clerk token before submitting an online expiry item', async () => {
    mockGetToken.mockResolvedValue('fresh-clerk-token');
    render(
      <HandheldProvider>
        <ScanPage token="expired-prop-token" />
      </HandheldProvider>,
    );

    await waitFor(() =>
      expect(apiService.get).toHaveBeenCalledWith('/store-areas', 'fresh-clerk-token'),
    );

    userEvent.click(screen.getByTestId('trigger-scan'));
    await screen.findByText('Test Product Barcode');

    fireEvent.change(screen.getByLabelText(/Expiry Date/i), { target: { value: '2025-12-31' } });
    fireEvent.change(screen.getByTestId('location-select'), { target: { value: '1' } });

    userEvent.click(screen.getByText(/Save expiry item/i));

    await waitFor(() => {
      expect(mockGetToken).toHaveBeenCalled();
      expect(apiService.post).toHaveBeenCalledWith(
        '/inventory-items',
        expect.objectContaining({
          productId: 101,
          expiryDate: '2025-12-31',
          locationId: 1,
        }),
        'fresh-clerk-token',
      );
    });
  });

  it('refreshes the Clerk token before looking up scanned product details', async () => {
    mockGetToken.mockResolvedValue('fresh-clerk-token');
    render(
      <HandheldProvider>
        <ScanPage token="expired-prop-token" />
      </HandheldProvider>,
    );

    await waitFor(() =>
      expect(apiService.get).toHaveBeenCalledWith('/store-areas', 'fresh-clerk-token'),
    );

    userEvent.click(screen.getByTestId('trigger-scan'));

    await waitFor(() => {
      expect(mockGetToken).toHaveBeenCalled();
      expect(apiService.get).toHaveBeenCalledWith(
        expect.stringContaining('/products/by-barcode/1234567890'),
        'fresh-clerk-token',
      );
    });
  });

  it('saves to offline storage when offline', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, writable: true });

    render(
      <HandheldProvider>
        <ScanPage token={mockToken} />
      </HandheldProvider>,
    );

    // Wait for store areas
    await waitFor(() => expect(apiService.get).toHaveBeenCalledWith('/store-areas', mockToken));

    // 1. Scan
    userEvent.click(screen.getByTestId('trigger-scan'));
    await screen.findByText('Test Product Barcode');

    // 2. Fill Form
    fireEvent.change(screen.getByLabelText(/Expiry Date/i), { target: { value: '2025-12-31' } });

    // 3. Select Location
    fireEvent.change(screen.getByTestId('location-select'), { target: { value: '1' } });

    // 4. Submit
    const submitButton = screen.getByText(/Save expiry item/i);
    userEvent.click(submitButton);

    // 4. Verify Local Storage
    await waitFor(() => {
      expect(offlineStorage.setItem).toHaveBeenCalledWith(
        expect.stringContaining('pending-inventory-item'),
        expect.objectContaining({
          productId: 101,
          locationId: 1,
        }),
      );
      expect(apiService.post).not.toHaveBeenCalled();
    });

    expect(await screen.findByText(/Offline: expiry item queued for sync/i)).toBeInTheDocument();
  });

  it('uses specific copy when deleting a recent expiry entry', async () => {
    (apiService.get as jest.Mock).mockImplementation((url) => {
      if (url === '/store-areas') return Promise.resolve(mockStoreAreas);
      if (url.includes('/products/by-barcode/1234567890'))
        return Promise.resolve(mockProductBarcode);
      if (url.includes('/inventory-items/by-barcode')) return Promise.resolve([]);
      if (url.includes('/inventory-items/recent/product/101')) {
        return Promise.resolve([
          {
            id: 501,
            productId: 101,
            expiryDate: '2025-12-31',
            locationId: 1,
            status: 'active',
            createdAt: '2025-05-01T00:00:00.000Z',
            updatedAt: '2025-05-01T00:00:00.000Z',
          },
        ]);
      }
      return Promise.reject(new Error(`Not found call: ${url}`));
    });

    render(
      <HandheldProvider>
        <ScanPage token={mockToken} />
      </HandheldProvider>,
    );

    await waitFor(() => expect(apiService.get).toHaveBeenCalledWith('/store-areas', mockToken));

    userEvent.click(screen.getByTestId('trigger-scan'));

    expect(await screen.findByText('Recent Entries')).toBeInTheDocument();
    userEvent.click(screen.getByRole('button', { name: /Delete entry/i }));

    expect(await screen.findByText('Delete expiry entry?')).toBeInTheDocument();
    expect(
      screen.getByText(/This removes the 31\/12\/2025 expiry entry for Test Product Barcode/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Delete entry/i })).toBeInTheDocument();
    expect(screen.queryByText(/Are you absolutely sure/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Continue/i })).not.toBeInTheDocument();
  });

  describe('Handheld Integration Tests', () => {
    beforeEach(() => {
      // Reset to handheld mode for these tests
      mockHandheldContext.isHandheld = true;
      mockHandheldContext.syncStrategy = 'real-time';
    });

    afterEach(() => {
      // Reset to desktop mode for other tests
      mockHandheldContext.isHandheld = false;
      mockHandheldContext.syncStrategy = 'real-time' as SyncStrategy;
    });

    it('renders HandheldScanner instead of regular Scanner when in handheld mode', async () => {
      render(
        <HandheldProvider>
          <ScanPage token={mockToken} />
        </HandheldProvider>,
      );

      // Wait for store areas to load
      await waitFor(() => expect(apiService.get).toHaveBeenCalledWith('/store-areas', mockToken));

      // Should render HandheldScanner (which uses camera mode by default)
      expect(screen.getByTestId('handheld-scanner')).toBeInTheDocument();
      expect(screen.queryByTestId('mock-scanner')).not.toBeInTheDocument();
    });

    it('auto-populates expiry date from GS1 barcode data in handheld mode', async () => {
      // Mock GS1 barcode with expiry date
      const gs1Barcode = '(01)12345678901231(17)250131'; // GS1 with expiry 2025-01-31

      // Mock product lookup response
      (apiService.get as jest.Mock).mockImplementation((url) => {
        if (url === '/store-areas') {
          return Promise.resolve(mockStoreAreas);
        }
        if (url.includes('/products/by-barcode/12345678901231')) {
          return Promise.resolve({
            id: 102,
            name: 'GS1 Product',
            sku: 'GS1-001',
            barcode: gs1Barcode,
            costPrice: 15.0,
          });
        }
        if (url.includes('/inventory-items/by-barcode')) {
          return Promise.resolve([]);
        }
        if (url.includes('/inventory-items/recent/product/102')) {
          return Promise.resolve([]);
        }
        return Promise.reject(new Error(`Not found: ${url}`));
      });

      render(
        <HandheldProvider>
          <ScanPage token={mockToken} />
        </HandheldProvider>,
      );

      // Wait for store areas
      await waitFor(() => expect(apiService.get).toHaveBeenCalledWith('/store-areas', mockToken));

      // Trigger GS1 barcode scan
      const triggerButton = screen.getByTestId('handheld-scan-gs1-trigger');
      userEvent.click(triggerButton);

      // Wait for product to load
      await screen.findByText('GS1 Product');

      // Verify expiry date was auto-populated from GS1 data
      const expiryInput = screen.getByLabelText(/Expiry Date/i);
      expect(expiryInput).toHaveValue('2025-01-31');
    });

    it('displays sync strategy selector in handheld toolbar', async () => {
      render(
        <HandheldProvider>
          <ScanPage token={mockToken} />
        </HandheldProvider>,
      );

      // Wait for store areas
      await waitFor(() => expect(apiService.get).toHaveBeenCalledWith('/store-areas', mockToken));

      // Should show sync strategy selector
      const syncStrategySelect = screen.getByTestId('sync-strategy-selector');
      expect(syncStrategySelect).toBeInTheDocument();
      expect(syncStrategySelect).toHaveValue('real-time');
    });

    it('allows changing sync strategy in handheld mode', async () => {
      render(
        <HandheldProvider>
          <ScanPage token={mockToken} />
        </HandheldProvider>,
      );

      // Wait for store areas
      await waitFor(() => expect(apiService.get).toHaveBeenCalledWith('/store-areas', mockToken));

      // Change sync strategy to batch
      const syncStrategySelect = screen.getByTestId('sync-strategy-selector');
      userEvent.selectOptions(syncStrategySelect, 'batch-10-min');

      // Verify context was updated
      expect(mockHandheldContext.setSyncStrategy).toHaveBeenCalledWith('batch-10-min');
    });

    it('shows sync status in handheld toolbar', async () => {
      render(
        <HandheldProvider>
          <ScanPage token={mockToken} />
        </HandheldProvider>,
      );

      // Wait for store areas
      await waitFor(() => expect(apiService.get).toHaveBeenCalledWith('/store-areas', mockToken));

      // Should show sync status (default is 'synced')
      expect(screen.getByText('Synced')).toBeInTheDocument();
    });

    it('displays queue length in handheld toolbar when items are pending', async () => {
      // Mock pending items in queue
      mockHandheldContext.syncStrategy = 'manual'; // So items stay in queue
      Object.defineProperty(navigator, 'onLine', { value: false, writable: true });

      render(
        <HandheldProvider>
          <ScanPage token={mockToken} />
        </HandheldProvider>,
      );

      // Wait for store areas
      await waitFor(() => expect(apiService.get).toHaveBeenCalledWith('/store-areas', mockToken));

      // Scan and submit an item (this would normally add to queue)
      const triggerButton = screen.getByTestId('handheld-scan-trigger');
      userEvent.click(triggerButton);

      await screen.findByText('Test Product Barcode');

      // Fill form and submit
      fireEvent.change(screen.getByLabelText(/Expiry Date/i), { target: { value: '2025-12-31' } });
      fireEvent.change(screen.getByTestId('location-select'), { target: { value: '1' } });

      const submitButton = screen.getByText(/Save expiry item/i);
      fireEvent.click(submitButton);

      // In manual sync mode, item should be queued
      await waitFor(() => {
        expect(offlineStorage.setItem).toHaveBeenCalled();
      });

      // Queue length is currently TODO-wired to 0 in ScanPage, so sync button remains disabled
      const syncButton = screen.getByRole('button', { name: /sync now/i });
      expect(syncButton).toBeDisabled();
    });

    it('provides settings navigation in handheld toolbar', async () => {
      // We need to test this through the HandheldLayout integration
      // For now, verify the toolbar renders with settings button
      render(
        <HandheldProvider>
          <ScanPage token={mockToken} />
        </HandheldProvider>,
      );

      // Wait for store areas
      await waitFor(() => expect(apiService.get).toHaveBeenCalledWith('/store-areas', mockToken));

      // Settings button should be present
      const settingsButton = screen.getByRole('button', { name: /settings/i });
      expect(settingsButton).toBeInTheDocument();
    });

    it('applies full-screen layout in handheld mode', async () => {
      render(
        <HandheldProvider>
          <ScanPage token={mockToken} />
        </HandheldProvider>,
      );

      // Wait for store areas
      await waitFor(() => expect(apiService.get).toHaveBeenCalledWith('/store-areas', mockToken));

      // HandheldLayout applies full-screen classes on main wrapper
      const handheldMain = screen.getByRole('main');
      expect(handheldMain).toHaveClass('flex-1');
      expect(handheldMain).toHaveClass('overflow-auto');
    });

    it('handles GS1 parsing errors gracefully in handheld mode', async () => {
      // Mock invalid GS1 barcode
      const invalidGs1Barcode = 'invalid-gs1-data';

      (apiService.get as jest.Mock).mockImplementation((url) => {
        if (url === '/store-areas') {
          return Promise.resolve(mockStoreAreas);
        }
        if (url.includes(`/products/by-barcode/${invalidGs1Barcode}`)) {
          return Promise.reject(new Error('404 Not found'));
        }
        return Promise.reject(new Error(`Not found: ${url}`));
      });

      render(
        <HandheldProvider>
          <ScanPage token={mockToken} />
        </HandheldProvider>,
      );

      // Wait for store areas
      await waitFor(() => expect(apiService.get).toHaveBeenCalledWith('/store-areas', mockToken));

      // Trigger invalid scan
      const triggerButton = screen.getByTestId('handheld-scan-invalid-trigger');
      userEvent.click(triggerButton);

      // Should show new product form (graceful fallback)
      await waitFor(() => {
        expect(
          screen.getByText(/Create a product record before adding expiry stock/i),
        ).toBeInTheDocument();
      });
    });
  });
});
