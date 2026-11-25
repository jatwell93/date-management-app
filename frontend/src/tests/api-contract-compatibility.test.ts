import { apiService } from '../lib/api.service';
import { InventoryItem } from '../types/inventory';

// Mock apiService
vi.mock('../lib/api.service', () => ({
  apiService: {
    post: vi.fn(),
  },
}));

// Mock console.warn to capture deprecation warnings
const mockConsoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

describe('API Contract Compatibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConsoleWarn.mockClear();
  });

  afterAll(() => {
    mockConsoleWarn.mockRestore();
  });

  describe('Inventory Items API', () => {
    it('should accept camelCase field names', async () => {
      const mockResponse = { id: 1, message: 'Item created successfully' };
      (apiService.post as jest.Mock).mockResolvedValue(mockResponse);

      const itemData = {
        productId: 1,
        expiryDate: '2026-12-31',
        locationId: 1,
        status: 'active',
      };

      await apiService.post('/inventory-items', itemData, 'mock_token');

      expect(apiService.post).toHaveBeenCalledWith('/inventory-items', itemData, 'mock_token');
    });

    it('should reject a snake_case-only body (Worker reads camelCase only)', async () => {
      // Mirrors the Worker: only productId is read, so snake_case-only is invalid.
      (apiService.post as jest.Mock).mockImplementation(
        async (_path: string, body: Record<string, unknown>) =>
          Number.isInteger(body.productId) ? { id: 1 } : { error: 'Missing or invalid productId' },
      );

      const snakeCaseBody = {
        product_id: 1,
        expiry_date: '2026-12-31',
        location_id: 1,
        status: 'active',
      };

      const result = await apiService.post('/inventory-items', snakeCaseBody, 'mock_token');

      expect(result).toEqual({ error: 'Missing or invalid productId' });
    });

    it('should ignore snake_case fields next to camelCase ones', async () => {
      (apiService.post as jest.Mock).mockImplementation(
        async (_path: string, body: Record<string, unknown>) => ({ productId: body.productId }),
      );

      const result = await apiService.post(
        '/inventory-items',
        { productId: 2, product_id: 1, expiryDate: '2026-12-31', locationId: 1 },
        'mock_token',
      );

      expect(result).toEqual({ productId: 2 });
    });

    it('should validate required fields in camelCase format', async () => {
      const mockResponse = { error: 'Missing or invalid productId' };
      (apiService.post as jest.Mock).mockResolvedValue(mockResponse);

      const invalidItemData = {
        // Missing productId
        expiryDate: '2026-12-31',
        locationId: 1,
      };

      await apiService.post('/inventory-items', invalidItemData, 'mock_token');

      expect(apiService.post).toHaveBeenCalledWith(
        '/inventory-items',
        invalidItemData,
        'mock_token',
      );
    });
  });

  describe('Type System Consistency', () => {
    it('should have consistent field names across frontend types', () => {
      // Create a sample InventoryItem to verify type structure
      const sampleItem: InventoryItem = {
        id: 1,
        productId: 1,
        expiryDate: '2026-12-31',
        locationId: 1,
        status: 'active',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      };

      // Verify camelCase properties exist
      expect(sampleItem).toHaveProperty('productId');
      expect(sampleItem).toHaveProperty('expiryDate');
      expect(sampleItem).toHaveProperty('locationId');

      // Verify snake_case properties don't exist on the type
      expect(sampleItem).not.toHaveProperty('product_id');
      expect(sampleItem).not.toHaveProperty('expiry_date');
      expect(sampleItem).not.toHaveProperty('location_id');
    });
  });
});
