import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ScanPage } from '../ScanPage';
import { apiService } from '../../lib/api.service';
import { offlineStorage } from '../../lib/offline-storage';

// Mock dependencies
jest.mock('../../lib/api.service');
jest.mock('../../lib/offline-storage');

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
  Scanner: ({ onScan }: { onScan: (val: string) => void }) => (
    <div data-testid="mock-scanner">
      <input data-testid="scanner-input" onChange={(e) => onScan(e.target.value)} />
      <button data-testid="trigger-scan" onClick={() => onScan('1234567890')}>
        Scan Barcode
      </button>
      <button data-testid="trigger-sku-scan" onClick={() => onScan('123456')}>
        Scan SKU
      </button>
    </div>
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
    cost_price: 10.0,
  };

  // Valid Product (SKU <= 8 chars)
  const mockProductSKU = {
    id: 102,
    name: 'Test Product SKU',
    sku: '123456',
    barcode: '9999999999',
    cost_price: 20.0,
  };

  beforeEach(() => {
    jest.clearAllMocks();

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

    // Mock Online status
    Object.defineProperty(navigator, 'onLine', {
      value: true,
      writable: true,
    });
  });

  it('renders and fetches store areas on mount', async () => {
    render(<ScanPage token={mockToken} />);

    await waitFor(() => {
      expect(apiService.get).toHaveBeenCalledWith('/store-areas', mockToken);
    });

    expect(screen.getByText(/Inventory Scan/i)).toBeInTheDocument();
  });

  it('displays product details after scanning a valid barcode (>8 chars)', async () => {
    render(<ScanPage token={mockToken} />);

    const scanButton = screen.getByTestId('trigger-scan');
    fireEvent.click(scanButton);

    await waitFor(() => {
      expect(apiService.get).toHaveBeenCalledWith(
        expect.stringContaining('/products/by-barcode/1234567890'),
        mockToken,
      );
    });

    expect(screen.getByText('Test Product Barcode')).toBeInTheDocument();
    expect(screen.getByText('TEST-SKU-1')).toBeInTheDocument();
  });

  it('displays product details after scanning a valid SKU (<=8 chars)', async () => {
    render(<ScanPage token={mockToken} />);

    const scanButton = screen.getByTestId('trigger-sku-scan');
    fireEvent.click(scanButton);

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

    render(<ScanPage token={mockToken} />);

    const scanButton = screen.getByTestId('trigger-scan');
    fireEvent.click(scanButton);

    await waitFor(() => {
      expect(screen.getByText(/Please add new product details:/i)).toBeInTheDocument();
    });
  });

  it('submits inventory item successfully when online', async () => {
    render(<ScanPage token={mockToken} />);

    // Wait for store areas
    await waitFor(() => expect(apiService.get).toHaveBeenCalledWith('/store-areas', mockToken));

    // 1. Scan
    userEvent.click(screen.getByTestId('trigger-scan'));
    await waitFor(() => screen.findByText('Test Product Barcode'));

    // 2. Fill Expiry
    const expiryInput = screen.getByLabelText(/Expiry Date/i);
    fireEvent.change(expiryInput, { target: { value: '2025-12-31' } });

    // 3. Select Location
    fireEvent.change(screen.getByTestId('location-select'), { target: { value: '1' } });

    // 4. Submit
    const submitButton = screen.getByText(/Confirm & Save/i);
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

    expect(await screen.findByText(/Inventory item added successfully/i)).toBeInTheDocument();
  });

  it('saves to offline storage when offline', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, writable: true });

    render(<ScanPage token={mockToken} />);

    // Wait for store areas
    await waitFor(() => expect(apiService.get).toHaveBeenCalledWith('/store-areas', mockToken));

    // 1. Scan
    userEvent.click(screen.getByTestId('trigger-scan'));
    await waitFor(() => screen.findByText('Test Product Barcode'));

    // 2. Fill Form
    fireEvent.change(screen.getByLabelText(/Expiry Date/i), { target: { value: '2025-12-31' } });

    // 3. Select Location
    fireEvent.change(screen.getByTestId('location-select'), { target: { value: '1' } });

    // 4. Submit
    const submitButton = screen.getByText(/Confirm & Save/i);
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

    expect(await screen.findByText(/Offline: Inventory item saved/i)).toBeInTheDocument();
  });
});
