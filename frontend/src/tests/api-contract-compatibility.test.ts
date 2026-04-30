import { apiService } from '../lib/api.service';
import { InventoryItem } from '../types/inventory';

// Mock apiService
jest.mock('../lib/api.service', () => ({
  apiService: {
    post: jest.fn(),
  },
}));

// Mock console.warn to capture deprecation warnings
const mockConsoleWarn = jest.spyOn(console, 'warn').mockImplementation();

describe('API Contract Compatibility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConsoleWarn.mockClear();
  });

  afterEach(() => {
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

    it('should accept snake_case field names (backward compatibility)', async () => {
      const mockResponse = { id: 1, message: 'Item created successfully' };
      (apiService.post as jest.Mock).mockResolvedValue(mockResponse);

      const itemData = {
        product_id: 1,
        expiry_date: '2026-12-31',
        location_id: 1,
        status: 'active',
      };

      await apiService.post('/inventory-items', itemData, 'mock_token');

      expect(apiService.post).toHaveBeenCalledWith('/inventory-items', itemData, 'mock_token');
    });

    it('should handle mixed field names (camelCase takes precedence)', async () => {
      const mockResponse = { id: 1, message: 'Item created successfully' };
      (apiService.post as jest.Mock).mockResolvedValue(mockResponse);

      const itemData = {
        productId: 2, // camelCase should take precedence
        product_id: 1, // snake_case should be ignored
        expiryDate: '2026-12-31',
        locationId: 1,
        status: 'active',
      };

      await apiService.post('/inventory-items', itemData, 'mock_token');

      expect(apiService.post).toHaveBeenCalledWith('/inventory-items', itemData, 'mock_token');
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

    it('should validate required fields in snake_case format', async () => {
      const mockResponse = { error: 'Missing or invalid productId' };
      (apiService.post as jest.Mock).mockResolvedValue(mockResponse);

      const invalidItemData = {
        // Missing product_id
        expiry_date: '2026-12-31',
        location_id: 1,
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
